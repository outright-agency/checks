// `outright-checks check` — the inner loop. What a developer or an agent runs after every task, so
// its cost is most of what a session spends waiting.
//
// The app's steps (its `checks.config.mjs`, `check.steps`), one after another, in its order. None
// of them waits on another, but side by side their peaks add up: a typecheck holds a gigabyte or
// two and the tests as much again. Many sessions check at once on one machine, so a check's peak
// memory is what limits how many of them fit. Each step runs even when one before it failed, so
// one run names every failure.
//
// A step is a shell command, or a function that picks one from the paths the change touched (the
// last commit and the working tree) and may sit the change out. The built-in `tests` step is one
// vitest process for two projects (check-tests.mjs):
//
//   app       the application tests the import graph relates to the change, and every one of them
//             when the root's package.json, lockfile or Vitest config changed (the preset's rerun
//             triggers)
//   ratchets  the tests that read the source as text (the config's `ratchets` globs). Nothing
//             relates them to a change, so they run whole — their analyses cached by repository
//             content, so an unchanged tree parses nothing
//
// Each project still gets its own line, passed or FAILED.
//
// It takes no lock and leaves no receipt: it is not the gate. `outright-checks verify` is.

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { changedPaths, checkSteps, testStepResults } from "./lib.mjs";

/** @typedef {import("../config.mjs").ResolvedConfig} ResolvedConfig */
/** @typedef {import("./lib.mjs").StepResult} StepResult */

const CHECK_TESTS = fileURLToPath(new URL("./check-tests.mjs", import.meta.url));

/**
 * @param {{ cwd: string, config: ResolvedConfig }} options
 * @returns {Promise<number>}
 */
export async function main({ cwd, config }) {
  // A file a step needs that is missing (a checkout installed before a dependency joined the
  // lockfile) would fail its step with a bare "No such file" only after the others had run. Say
  // what to do before anything runs.
  const missing = config.check.requires.filter(({ path }) => !existsSync(join(cwd, path)));
  if (missing.length > 0) {
    for (const { message } of missing) console.log(`[check] ${message}`);
    return 1;
  }

  /** @param {string[]} args */
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
  if (!hasCommit(git, "HEAD")) {
    console.log("[check] the repository has no commit yet: the check compares a change with one. Commit, then check again.");
    return 1;
  }
  const base = hasCommit(git, "HEAD~1") ? "HEAD~1" : "HEAD";
  const changed = changedPaths(git("diff", "--name-only", base), git("status", "--porcelain"));

  const startedAt = Date.now();
  /** @type {StepResult[]} */
  const results = [];
  for (const step of checkSteps(config, changed)) {
    if ("tests" in step) {
      const { parentHeapMb, workerMemory } = config.check.tests;
      results.push(
        ...(await run(cwd, {
          name: "tests",
          file: process.execPath,
          args: [`--max-old-space-size=${parentHeapMb}`, CHECK_TESTS, base, workerMemory],
          reports: true,
        }))
      );
    } else {
      const [result] = await run(cwd, { name: step.name, file: "sh", args: ["-c", step.command] });
      results.push(step.chosen ? { ...result, command: step.command } : result);
    }
  }

  // A passing step says one line; a failing one says everything, last, where it will still be on
  // screen — once, though app and ratchets share one output.
  for (const result of results.filter((entry) => entry.code === 0)) {
    const files =
      result.files === undefined ? "" : ` — ${result.files} test file${result.files === 1 ? "" : "s"}`;
    const command = result.command === undefined ? "" : ` — ${result.command}`;
    console.log(`[check] ${result.name} passed in ${result.seconds}s${files}${command}`);
  }
  const failed = results.filter((entry) => entry.code !== 0);
  for (const output of new Set(failed.map((entry) => entry.output))) {
    for (const result of failed.filter((entry) => entry.output === output)) {
      const command = result.command === undefined ? "" : ` — ${result.command}`;
      console.log(`\n[check] ${result.name} FAILED in ${result.seconds}s${command}`);
    }
    console.log(`\n${output.trimEnd()}`);
  }
  console.log(`[check] ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  return failed.length > 0 ? 1 : 0;
}

/**
 * Whether `ref` names a commit. A repository with one commit compares the change with HEAD itself.
 * @param {(...args: string[]) => string} git
 * @param {string} ref
 */
function hasCommit(git, ref) {
  try {
    // `^{commit}`: the object itself must exist, not only a ref that names it.
    git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * One result per step — and one per project for the tests step, which reports them on a fourth
 * pipe. Every step runs at low priority: the machine it shares has other work to make room for.
 * @param {string} cwd
 * @param {{ name: string, file: string, args: string[], reports?: boolean }} step
 * @returns {Promise<StepResult[]>}
 */
function run(cwd, { name, file, args, reports = false }) {
  return new Promise((resolveStep) => {
    const startedAt = Date.now();
    const child = spawn("nice", ["-n", "10", file, ...args], {
      cwd,
      env: { ...process.env, FORCE_COLOR: process.stdout.isTTY ? "1" : "0" },
      stdio: ["pipe", "pipe", "pipe", ...(reports ? /** @type {const} */ (["pipe"]) : [])],
    });
    /** @type {Buffer[]} */
    const chunks = [];
    /** @type {Buffer[]} */
    const reportChunks = [];
    child.stdout?.on("data", (chunk) => chunks.push(chunk));
    child.stderr?.on("data", (chunk) => chunks.push(chunk));
    /** @type {import("node:stream").Readable | undefined} */ (child.stdio[3])?.on("data", (chunk) =>
      reportChunks.push(chunk)
    );
    // `close`, not `exit`: it waits for the pipes to drain, the report among them.
    child.on("close", (code, signal) => {
      const result = {
        name,
        code: signal ? 1 : (code ?? 1),
        seconds: ((Date.now() - startedAt) / 1000).toFixed(1),
        output: Buffer.concat(chunks).toString("utf8"),
      };
      resolveStep(
        reports
          ? testStepResults({ ...result, reportText: Buffer.concat(reportChunks).toString("utf8") })
          : [result]
      );
    });
  });
}
