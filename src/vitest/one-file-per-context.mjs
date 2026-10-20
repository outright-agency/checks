// Vitest's VM pools (`vmForks`, the preset's pool) isolate test files by giving each task a fresh VM
// context and module cache, and force `isolate: false` to do it. With `VITEST_MAX_WORKERS=1` the
// pool hands every file of the run to a single task, so the files share one context and every
// module in it: a module the first file loaded against its mock keeps that mock for every file
// after it. (Vitest 4.1 still does this for the variable; the `--maxWorkers=1` flag no longer
// does.) The preset floors the variable at two; the setup file claims its context before each file,
// so a run that gets past the floor fails here: a second claim means a second file is sharing it.

const CLAIM = Symbol.for("@outright/checks.file-context");

export const ONE_FILE_PER_CONTEXT_MESSAGE =
  "Two test files ran in one VM context, so the second shares every module the first loaded, mocks included. " +
  "Vitest's VM pools put every file of a one-worker run into one context. " +
  "Run with two workers or more: the preset raises VITEST_MAX_WORKERS to two, so this run set one worker without the preset's floor.";

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
