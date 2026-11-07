/**
 * The one parse of a database test file.
 * @param {string} path
 * @param {string} text
 * @returns {DbTestFile}
 */
export function readDbTestFile(path: string, text: string): DbTestFile;
/**
 * @param {Readonly<Record<string, string>>} sources
 * @param {DbTestsWhere} where
 * @param {DbTestsChange | null} [change]
 * @returns {DbTestsAnalysis}
 */
export function analyzeDbTestSources(sources: Readonly<Record<string, string>>, where: DbTestsWhere, change?: DbTestsChange | null): DbTestsAnalysis;
/**
 * Over the database test files a change touches, their tests today less their tests at the base.
 * @param {readonly string[]} touched
 * @param {readonly DbTestFile[]} today
 * @param {(path: string) => string | null} textAtBase
 * @param {(path: string) => boolean} [isDbTest]
 */
export function newDbTests(touched: readonly string[], today: readonly DbTestFile[], textAtBase: (path: string) => string | null, isDbTest?: (path: string) => boolean): number;
/**
 * The tree's database tests, and what the change adds against its base.
 * @param {import("../config.mjs").ChecksConfig} config the app's `checks.config.mjs`
 * @param {{ root?: string, env?: Readonly<Record<string, string | undefined>> }} [options]
 * @returns {DbTestsAnalysis}
 */
export function analyzeDbTests(config: import("../config.mjs").ChecksConfig, { root, env }?: {
    root?: string;
    env?: Readonly<Record<string, string | undefined>>;
}): DbTestsAnalysis;
/**
 * `sends`: its own body awaits, or it returns what may be a promise. `cases`: its table's rows, by
 * every table around it.
 */
export type DbTest = {
    title: string;
    line: number;
    sends: boolean;
    cases: number;
};
export type DbTestFile = {
    path: string;
    reason: boolean;
    tests: DbTest[];
};
/**
 * An exception to the stop: `tests` new database tests let through, and why.
 */
export type StopException = {
    tests: number;
    issue: string;
    reason: string;
};
/**
 * `added`: the tests in the files the change touches, today less at the base. A cut goes below zero.
 */
export type DbTestsChange = {
    base: string;
    added: number;
    exceptionsAtBase: readonly StopException[];
};
/**
 * Where an app's own parts of the check sit, for what a finding says.
 */
export type DbTestsWhere = {
    lists: string;
    exceptions: string;
    rule: string;
};
export type DbTestsAnalysis = {
    files: DbTestFile[];
    change: DbTestsChange | null;
    where: DbTestsWhere;
};
