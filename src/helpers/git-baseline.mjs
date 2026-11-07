import { execFileSync } from "node:child_process";
import { Script, createContext } from "node:vm";
import ts from "typescript";
import { namesOf } from "../config.mjs";

/**
 * What a ratchet compares against: the baseline as it stood at a base commit. A ratchet that holds
 * a reviewed list (debt that may only shrink) reads the list at the base and refuses any entry the
 * change added.
 *
 * An app binds it once, with its config and any folders it has moved, in a module of its own:
 *
 *   import checks from "../../checks.config.mjs";
 *   const MOVED_ROOTS = [["src/lib/", "src/shared/lib/"]];
 *   export const { resolveRatchetBase, loadGitBaselineExport, withCurrentPathKeys } =
 *     gitBaseline(checks, { movedRoots: MOVED_ROOTS });
 *
 * CI hands the base commit in `<NAME>_RATCHET_BASE_SHA` (the `ci-base` action writes it).
 */

/** @typedef {(file: string, args: readonly string[], options: { cwd: string, encoding: "utf8" }) => string} ExecFile */

/**
 * @typedef {object} GitBaselineOptions
 * @property {string} [cwd]
 * @property {Readonly<Record<string, string | undefined>>} [env]
 * @property {ExecFile} [execFile]
 */

/**
 * A folder or file that moved: `[from, to]`. A folder ends in `/`; a file ends in `.`, which
 * carries its test with it. Both sit at least one folder deep (`src/…`).
 * @typedef {readonly [string, string]} MovedRoot
 */

/** Git with its stderr kept: a check asks for files the base may not carry, and that answer is no error. @type {ExecFile} */
const quiet = (file, args, options) =>
  execFileSync(file, args, {
    ...options,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

/** @param {{ cwd: string, execFile: ExecFile }} options @param {string[]} args */
function git(options, args) {
  return options.execFile("git", args, { cwd: options.cwd, encoding: "utf8" }).trim();
}

/** @param {GitBaselineOptions} options */
function resolved(options) {
  return {
    cwd: options.cwd ?? process.cwd(),
    execFile: options.execFile ?? /** @type {ExecFile} */ (execFileSync),
  };
}

/** @param {string} ref @param {{ cwd: string, execFile: ExecFile }} options */
function resolveCommit(ref, options) {
  try {
    return git(options, ["rev-parse", "--verify", `${ref}^{commit}`]);
  } catch {
    throw new Error(`Cannot resolve ratchet base commit ${JSON.stringify(ref)}.`);
  }
}

/**
 * Whether a baseline file exists at the ratchet base — the question a ratchet has to ask on the
 * branch that INTRODUCES it, because there is nothing on the base to compare against yet.
 *
 * The distinction this draws is the whole point. A base commit that cannot be resolved is a fetch
 * problem (a shallow clone), and that must stay loud: it throws here rather than reporting the
 * file as absent, so a broken CI checkout can never be mistaken for a first landing. A resolvable
 * base that simply does not carry the file is the bootstrap case, and the caller may treat it as
 * "no prior baseline" — which is honest, since none exists.
 *
 * This replaces pinning a seed commit by hand. A hardcoded SHA names the base a branch was cut
 * from, so it silently stops matching the moment anything else merges first.
 * @param {string} baseSha
 * @param {string} filePath
 * @param {GitBaselineOptions} [options]
 * @returns {boolean}
 */
export function baselineExistsAtBase(baseSha, filePath, options = {}) {
  const at = resolved(options);
  // Throws when the base itself is unreachable — never swallowed into a `false`.
  resolveCommit(baseSha, at);
  try {
    git(at, ["cat-file", "-e", `${baseSha}:${filePath}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * A file as it stood at the base, or null when the base doesn't carry it. A base that can't be
 * resolved stays loud, as in `baselineExistsAtBase`.
 * @param {string} baseSha
 * @param {string} filePath
 * @param {GitBaselineOptions} [options]
 * @returns {string | null}
 */
export function atBase(baseSha, filePath, options = {}) {
  const at = { ...options, execFile: options.execFile ?? quiet };
  if (!baselineExistsAtBase(baseSha, filePath, at)) return null;
  return at.execFile("git", ["show", `${baseSha}:${filePath}`], { cwd: resolved(at).cwd, encoding: "utf8" });
}

/**
 * What the change does between the base and the working tree: each file git sees as renamed (its
 * path at the base to its path today), and every file it touches, at both paths of a rename,
 * untracked files included.
 * @param {string} baseSha
 * @param {GitBaselineOptions} [options]
 * @returns {{ renames: Record<string, string>, touched: string[] }}
 */
export function changesSince(baseSha, options = {}) {
  const cwd = resolved(options).cwd;
  const read = (/** @type {string[]} */ args) => quiet("git", args, { cwd, encoding: "utf8" });
  const fields = read(["diff", "-M", "--name-status", "-z", baseSha]).split("\0");
  /** @type {Record<string, string>} */
  const renames = {};
  const touched = new Set(read(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean));
  for (let at = 0; at < fields.length; ) {
    const status = fields[at];
    if (status === "") break;
    if (status.startsWith("R") || status.startsWith("C")) {
      if (status.startsWith("R")) renames[fields[at + 1]] = fields[at + 2];
      touched.add(fields[at + 1]).add(fields[at + 2]);
      at += 3;
    } else {
      touched.add(fields[at + 1]);
      at += 2;
    }
  }
  return { renames, touched: [...touched] };
}

/**
 * Loads a TypeScript baseline export directly from a git blob. Baseline modules hold only data,
 * local helpers and type-only imports; runtime imports are refused, so the historical file cannot
 * execute arbitrary repository code.
 * @template T
 * @param {string} baseSha
 * @param {string} filePath
 * @param {string} exportName
 * @param {GitBaselineOptions} [options]
 * @returns {T}
 */
export function loadGitBaselineExport(baseSha, filePath, exportName, options = {}) {
  const at = resolved(options);
  let source;
  try {
    source = git(at, ["show", `${baseSha}:${filePath}`]);
  } catch {
    throw new Error(
      `Cannot read ${filePath} from ratchet base ${baseSha}; fetch the base history before running the ratchet.`
    );
  }

  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
    fileName: filePath,
    reportDiagnostics: true,
  });
  const diagnostics = output.diagnostics?.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  if (diagnostics?.length) {
    throw new Error(`Cannot transpile historical baseline ${filePath} from ${baseSha}.`);
  }
  if (/\brequire\s*\(|\bimport\s*\(/.test(output.outputText)) {
    throw new Error(`Historical baseline ${filePath} must not have runtime imports.`);
  }

  const module = { exports: /** @type {Record<string, unknown>} */ ({}) };
  const context = createContext({ exports: module.exports, module, Object });
  new Script(output.outputText, { filename: `${baseSha}:${filePath}` }).runInContext(context);
  if (!(exportName in module.exports)) {
    throw new Error(`Historical baseline ${filePath} does not export ${exportName}.`);
  }
  return /** @type {T} */ (module.exports[exportName]);
}

/** @param {string} text */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A historical subject in today's spelling.
 *
 * A baseline is keyed by subject, and a subject is a path — or a compound key built from several
 * (`cycle:a|b`, `a=>b`, `file|table|join`). When an app moves a folder, a base commit from before
 * the move spells those keys the old way, and a monotonic comparison against it would read the
 * whole reviewed list as debt added since the base — the opposite of what it exists to say.
 *
 * What such a comparison asks is whether a subject was REVIEWED at the base, not how it was spelt
 * there, so the historical spelling is mapped forward first. This never relaxes a rule: a
 * genuinely new subject has no record at the base under any spelling. Once a base carries the move
 * the mapping is a no-op.
 *
 * A subject may have lived through more than one move, so the pairs are applied until none
 * matches; each pair must move a path strictly toward today's spelling (no pair's `to` leads back
 * to an earlier pair's `from`), so the loop ends. List a longer `from` before a shorter one it
 * starts with. Only a path that starts at the repository's root and sits at least one folder deep
 * moves: a nested `src/` inside a package or `node_modules` is left as it is, and so is a file at
 * the root.
 * @param {string} subject
 * @param {readonly MovedRoot[]} movedRoots
 * @returns {string}
 */
export function toCurrentPathSpelling(subject, movedRoots) {
  return spell(subject, movedRoots, movedPaths(movedRoots));
}

/**
 * The paths a subject may hold that a move could reach: any starting at the repository's root
 * with one of the moved roots' first folders. `null` when nothing moved.
 * @param {readonly MovedRoot[]} movedRoots
 */
function movedPaths(movedRoots) {
  const firstSegments = [...new Set(movedRoots.map(([from]) => from.split("/")[0]))];
  if (firstSegments.length === 0) return null;
  return new RegExp(`(?<![\\w/])(?:${firstSegments.map(escapeRegExp).join("|")})\\/[\\w./-]+`, "g");
}

/**
 * @param {string} subject
 * @param {readonly MovedRoot[]} movedRoots
 * @param {RegExp | null} paths
 */
function spell(subject, movedRoots, paths) {
  if (paths === null) return subject;
  return subject.replace(paths, (path) => {
    let current = path;
    for (;;) {
      const pair = movedRoots.find(([from]) => current.startsWith(from));
      if (!pair) return current;
      current = `${pair[1]}${current.slice(pair[0].length)}`;
    }
  });
}

/**
 * The git baseline helpers, bound to an app by its name and its moved folders.
 * @param {{ name: string }} config the app's `checks.config.mjs`, or anything holding its name
 * @param {{ movedRoots?: readonly MovedRoot[] }} [options]
 */
export function gitBaseline(config, { movedRoots = [] } = {}) {
  const { env: names } = namesOf(config.name);
  const paths = movedPaths(movedRoots);

  /**
   * The base a run was handed, if any.
   * @param {Readonly<Record<string, string | undefined>>} env
   */
  const namedBase = (env) => env[names.ratchetBase] ?? env.GITHUB_BASE_SHA ?? env.GITHUB_EVENT_BEFORE;

  /**
   * The commit to compare the current checkout with. CI supplies it exactly; a local branch falls
   * back to its merge base with `main`. A missing CI base is never silently replaced by HEAD.
   * @param {GitBaselineOptions} [options]
   * @returns {string}
   */
  function resolveRatchetBase(options = {}) {
    const at = resolved(options);
    const explicit = namedBase(options.env ?? process.env);
    if (explicit) return resolveCommit(explicit, at);

    const head = git(at, ["rev-parse", "HEAD"]);
    const main = git(at, ["rev-parse", "main"]);
    if (head === main) return head;
    return git(at, ["merge-base", "HEAD", "main"]);
  }

  /**
   * The ratchet base, or null on a run by hand that names none: CI gives one only to a pull request
   * and a queue entry, so nothing is compared there. Any other base that can't be resolved throws,
   * and is never read as "no baseline".
   * @param {GitBaselineOptions} [options]
   * @returns {string | null}
   */
  function ratchetBase(options = {}) {
    const env = options.env ?? process.env;
    if (env.GITHUB_EVENT_NAME === "workflow_dispatch" && !env[names.ratchetBase]) return null;
    return resolveRatchetBase(options);
  }

  /**
   * The commit a change's own count starts from: the ratchet base, unless a checkout's `main` lags
   * `origin/main`. The merge base with a lagging `main` holds what others landed since, and a count
   * from it would charge them to this branch, so with no base named the later of the two forks
   * wins. Comparing baselines can't go wrong this way, since a lagging base only reads less.
   * @param {GitBaselineOptions} [options]
   * @returns {string | null}
   */
  function countBase(options = {}) {
    const base = ratchetBase(options);
    if (base === null || namedBase(options.env ?? process.env)) return base;
    const at = { cwd: options.cwd ?? process.cwd(), execFile: quiet };
    try {
      const fork = git(at, ["merge-base", "HEAD", "refs/remotes/origin/main"]);
      git(at, ["merge-base", "--is-ancestor", base, fork]);
      return fork;
    } catch {
      return base;
    }
  }

  return {
    resolveRatchetBase,
    ratchetBase,
    countBase,
    baselineExistsAtBase,
    atBase,
    changesSince,
    loadGitBaselineExport,
    /** @param {string} subject */
    toCurrentPathSpelling: (subject) => spell(subject, movedRoots, paths),
    /**
     * A baseline family keyed by subject, rekeyed in today's spelling.
     * @template T
     * @param {Readonly<Record<string, T>>} records
     * @returns {Readonly<Record<string, T>>}
     */
    withCurrentPathKeys: (records) =>
      Object.fromEntries(
        Object.entries(records).map(([subject, record]) => [
          spell(subject, movedRoots, paths),
          record,
        ])
      ),
  };
}
