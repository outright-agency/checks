import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE TESTS CHECK'S DISCOVERY — every test file the app's suite runs, read once as text. Pure
 * discovery: the policy judges.
 *
 * The tree is what git sees, tracked files and untracked ones it does not ignore, so a planted
 * test goes red before it is committed. `roots` are the folders the app's tests live under;
 * `skip` names the tests its suite runs under another config of its own (a database suite, a
 * package with its own runner), which this check does not answer for. A path with a dot-folder in
 * it is a copy of source (a worktree, a snapshot), never source.
 */

/** @typedef {"jsdom" | "node"} TestEnvironment */
/** @typedef {{ path: string, source: string, environment: TestEnvironment }} TestFile */
/** @typedef {{ files: TestFile[] }} TestsAnalysis */

/**
 * @typedef {object} AnalyzeTestsOptions
 * @property {string} [root] the repository's root; the working directory by default
 * @property {readonly string[]} [roots] the folders the tests live under; `src` and `scripts` by default
 * @property {RegExp} [skip] the test paths this check leaves to another config; none by default
 */

const DEFAULT_ROOTS = ["src", "scripts"];
const TEST_FILE = /\.test\.(?:[cm]?[jt]s|[jt]sx)$/;
const DOT_FOLDER = /(?:^|\/)\./;

/**
 * The environment a file asks for, read the way Vitest reads it: the first environment docblock
 * anywhere in the file, `@vitest-…` or `@jest-…`. jsdom and happy-dom are a DOM; anything else is
 * `node`.
 * @param {string} source
 * @returns {TestEnvironment}
 */
export function environmentOf(source) {
  const asked = /@(?:vitest|jest)-environment\s+([\w-]+)\b/.exec(source)?.[1];
  return asked === "jsdom" || asked === "happy-dom" ? "jsdom" : "node";
}

/**
 * Whether a path is a test the check reads: a test file, outside every dot-folder, not skipped.
 * @param {string} path
 * @param {{ skip?: RegExp }} [options]
 * @returns {boolean}
 */
export function isSuiteTest(path, { skip } = {}) {
  return TEST_FILE.test(path) && !DOT_FOLDER.test(path) && !(skip?.test(path) ?? false);
}

/**
 * Every test under the app's roots, sorted by path, each with its source and its environment.
 * @param {AnalyzeTestsOptions} [options]
 * @returns {TestsAnalysis}
 */
export function analyzeTests({ root = process.cwd(), roots = DEFAULT_ROOTS, skip } = {}) {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...roots],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  /** @type {TestFile[]} */
  const files = [];
  for (const path of new Set(listed.split("\0"))) {
    if (!isSuiteTest(path, { skip })) continue;
    const absolute = join(root, path);
    // Deleted in the working tree, still in the index.
    if (!existsSync(absolute)) continue;
    const source = readFileSync(absolute, "utf8");
    files.push({ path, source, environment: environmentOf(source) });
  }
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}
