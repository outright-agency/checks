import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";
import { namesOf } from "../config.mjs";

/**
 * A ratchet's analysis of the live repository, computed once per repository state instead of
 * once per caller.
 *
 * An analyzer reads every source file. It is called by its `lint:*` command and again by its live
 * test — separate processes, so nothing in memory is shared — and again on every run of the inner
 * loop, which would otherwise re-parse a tree that has not changed since the last run.
 *
 * THE KEY IS CONTENT, NEVER TIME. It hashes the index (`git ls-files -s`: every tracked path with
 * its blob id) plus the bytes of every path `git status` reports — modified, staged, deleted,
 * untracked. Two states of the repository that differ in any file git can see produce different
 * keys, including the analyzers' own source. mtimes are not consulted: a checkout rewrites them
 * and a stale hit on a ratchet is a false green.
 *
 * What the key cannot see is a git-IGNORED file. An analyzer that reads only the files git lists
 * never reaches one; an analyzer that starts reading `node_modules`, a build folder or a generated
 * folder must not be wrapped in this.
 *
 * A cached result is PLAIN DATA — objects, arrays, strings, numbers. It is stored with
 * `v8.serialize`, which keeps one object that sits in two lists as one object (JSON would copy it
 * once per list and lose the identity). But the suite runs each file in a VM context, and a
 * deserialized value belongs to the host realm: plain objects and arrays still compare
 * structurally, while a host-realm `Set` or `Map` does not `toEqual` one built in the test. An
 * analysis that grows a Set must turn it into an array before it is wrapped.
 *
 * A root that is not the top of a git work tree — the temporary fixtures the tests build — is
 * never cached.
 *
 * An app binds it once, with its config, in a module of its own:
 *
 *   import checks from "../../checks.config.mjs";
 *   export const { cachedAnalysis } = analysisCache(checks);
 *
 * The cache lives in `node_modules/.cache/<name>-gate/analysis`, and `<NAME>_GATE_NO_CACHE=1`
 * turns it off for one run.
 */

const STALE_ENTRY_MS = 24 * 60 * 60 * 1000;

/** @typedef {(file: string, args: readonly string[], options: { cwd: string }) => Buffer} ExecFile */

/**
 * @typedef {object} AnalysisCacheOptions
 * @property {ExecFile} [execFile] injected in tests
 * @property {boolean} [disabled] the app's `<NAME>_GATE_NO_CACHE=1` sets it for one run
 */

/** @type {ExecFile} */
const defaultExecFile = (file, args, options) =>
  execFileSync(file, args, { ...options, maxBuffer: 256 * 1024 * 1024, stdio: "pipe" });

/** @type {Map<string, string | null>} */
const stateKeys = new Map();

/**
 * Paths from `git status --porcelain -z`: NUL-separated, a rename carrying its old path after it.
 * @param {string} output
 * @returns {string[]}
 */
export function porcelainPaths(output) {
  const tokens = output.split("\0").filter((token) => token.length > 0);
  /** @type {string[]} */
  const paths = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    paths.push(token.slice(3));
    if ("RC".includes(token[0]) || "RC".includes(token[1])) {
      index += 1;
      if (tokens[index]) paths.push(tokens[index]);
    }
  }
  return paths.sort();
}

/**
 * `null` when `repoRoot` is not the top of a git work tree.
 * @param {string} repoRoot
 * @param {AnalysisCacheOptions} [options]
 * @returns {string | null}
 */
export function repositoryStateKey(repoRoot, options = {}) {
  const execFile = options.execFile ?? defaultExecFile;
  /** @param {string[]} args */
  const git = (...args) => execFile("git", args, { cwd: repoRoot }).toString("utf8");
  try {
    if (realpathSync(git("rev-parse", "--show-toplevel").trim()) !== realpathSync(repoRoot)) {
      return null;
    }
    const hash = createHash("sha256");
    hash.update(git("ls-files", "-s"));
    for (const path of porcelainPaths(git("status", "--porcelain", "-z", "--untracked-files=all"))) {
      hash.update(`\0${path}\0`);
      const absolutePath = join(repoRoot, path);
      if (existsSync(absolutePath) && statSync(absolutePath).isFile()) {
        hash.update(readFileSync(absolutePath));
      } else {
        hash.update("\0absent");
      }
    }
    return hash.digest("hex");
  } catch {
    return null;
  }
}

/** @param {string} directory @param {string} name @param {string} keep */
function pruneOtherEntries(directory, name, keep) {
  const now = Date.now();
  for (const entry of readdirSync(directory)) {
    if (!entry.startsWith(`${name}-`) || entry === keep) continue;
    const path = join(directory, entry);
    try {
      if (now - statSync(path).mtimeMs > STALE_ENTRY_MS) rmSync(path, { force: true });
    } catch {
      // another process pruned it first
    }
  }
}

/**
 * The analysis cache, bound to an app by its name.
 * @param {{ name: string }} config the app's `checks.config.mjs`, or anything holding its name
 */
export function analysisCache(config) {
  const { gateFolder, env } = namesOf(config.name);
  const directory = `node_modules/.cache/${gateFolder}/analysis`;

  /**
   * `compute()`'s result for this repository state, from disk when some process has already
   * computed it. `inputs` is whatever else decides the result — the analyzer's options — and is
   * part of the key.
   * @template T
   * @param {string} name
   * @param {string} repoRoot
   * @param {unknown} inputs
   * @param {() => T} compute
   * @param {AnalysisCacheOptions} [options]
   * @returns {T}
   */
  function cachedAnalysis(name, repoRoot, inputs, compute, options = {}) {
    if (options.disabled ?? process.env[env.noCache] === "1") return compute();

    let stateKey = options.execFile ? undefined : stateKeys.get(repoRoot);
    if (stateKey === undefined) {
      stateKey = repositoryStateKey(repoRoot, options);
      if (!options.execFile) stateKeys.set(repoRoot, stateKey);
    }
    if (stateKey === null) return compute();

    // The root is part of the key: an analysis carries absolute paths, and two checkouts of one
    // state must not read each other's.
    const key = createHash("sha256")
      .update(stateKey)
      .update("\0")
      .update(repoRoot)
      .update("\0")
      .update(JSON.stringify(inputs ?? null))
      .digest("hex")
      .slice(0, 32);
    const folder = join(repoRoot, directory);
    const fileName = `${name}-${key}.v8`;
    const path = join(folder, fileName);

    if (existsSync(path)) {
      try {
        return /** @type {T} */ (deserialize(readFileSync(path)));
      } catch {
        // a torn or foreign file is a miss
      }
    }

    const result = compute();
    try {
      mkdirSync(folder, { recursive: true });
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, serialize(result));
      renameSync(temporary, path);
      pruneOtherEntries(folder, name, fileName);
    } catch {
      // an unwritable cache never fails a ratchet
    }
    return result;
  }

  return { cachedAnalysis, repositoryStateKey };
}
