/**
 * The environment a file asks for, read the way Vitest reads it: the first environment docblock
 * anywhere in the file, `@vitest-…` or `@jest-…`. jsdom and happy-dom are a DOM; anything else is
 * `node`.
 * @param {string} source
 * @returns {TestEnvironment}
 */
export function environmentOf(source: string): TestEnvironment;
/**
 * Whether a path is a test the check reads: a test file, outside every dot-folder, not skipped.
 * @param {string} path
 * @param {{ skip?: RegExp }} [options]
 * @returns {boolean}
 */
export function isSuiteTest(path: string, { skip }?: {
    skip?: RegExp;
}): boolean;
/**
 * Every test under the app's roots, sorted by path, each with its source and its environment.
 * @param {AnalyzeTestsOptions} [options]
 * @returns {TestsAnalysis}
 */
export function analyzeTests({ root, roots, skip }?: AnalyzeTestsOptions): TestsAnalysis;
export type TestEnvironment = "jsdom" | "node";
export type TestFile = {
    path: string;
    source: string;
    environment: TestEnvironment;
};
export type TestsAnalysis = {
    files: TestFile[];
};
export type AnalyzeTestsOptions = {
    /**
     * the repository's root; the working directory by default
     */
    root?: string | undefined;
    /**
     * the folders the tests live under; `src` and `scripts` by default
     */
    roots?: readonly string[] | undefined;
    /**
     * the test paths this check leaves to another config; none by default
     */
    skip?: RegExp | undefined;
};
