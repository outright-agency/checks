// Vitest's VM pools (`vmForks`, the preset's pool) isolate test files by giving each task a fresh VM
// context and module cache, and force `isolate: false` to do it. A run whose files are handed to
// one task — `--no-file-parallelism`, or one worker (`--maxWorkers=1`, a `maxWorkers` of 1, or
// `VITEST_MAX_WORKERS=1`) — puts every file in one context and every module in it: a module the
// first file loaded against its mock keeps that mock for every file after it. The preset floors
// the variable at two, which covers some of those ways and not all; the setup file claims its
// context before each file, so a run that still shares one fails here: a second claim means a
// second file is sharing it.

const CLAIM = Symbol.for("@outright/checks.file-context");

export const ONE_FILE_PER_CONTEXT_MESSAGE =
  "Two test files ran in one VM context, so the second shares every module the first loaded, mocks included. " +
  "Vitest's VM pools put every file of a one-worker run into one context. " +
  "Run with two workers or more and file parallelism on: this comes from --no-file-parallelism, --maxWorkers=1, " +
  "a maxWorkers of 1, or VITEST_MAX_WORKERS=1 in a config without the preset's floor.";

/**
 * Claims `scope` (a test file's `globalThis`) for one test file, and throws when a file before it
 * already did.
 * @param {object} scope
 */
export function claimContextForOneFile(scope) {
  const marked = /** @type {Record<symbol, true | undefined>} */ (scope);
  if (marked[CLAIM]) throw new Error(ONE_FILE_PER_CONTEXT_MESSAGE);
  marked[CLAIM] = true;
}
