/**
 * @param {DbTestsAnalysis} analysis
 * @param {DbTestsLists} lists
 * @returns {DbTestsFinding[]}
 */
export function evaluateDbTests(analysis: DbTestsAnalysis, { debt, exceptions, limit }: DbTestsLists): DbTestsFinding[];
/** @param {readonly DbTestsFinding[]} findings */
export function formatDbTestsFindings(findings: readonly DbTestsFinding[]): string;
/**
 * A database test earns its database. Rules, each a literal in `DB_TESTS_RULES`:
 *
 *   db-test-no-reason       a database test file with no line saying what only a database proves
 *   db-test-sends-nothing   a test in such a file that neither awaits nor returns a promise: it sends the database nothing
 *   stale-debt              a list's entry that excuses nothing: the file has its line, the test sends, or neither is there
 *   unnamed-debt            a list's entry with no issue or no reason
 *   stop-exception-unnamed  an exception with no issue or no reason
 *   db-tests-past-the-stop  a change with more new database tests than the app's limit, and no exception of its own for them
 *   stop-exception-unused   an exception a change adds that it doesn't need
 *
 * An exception counts only in the change that adds it: one the base holds excuses nothing and
 * stands as the record, so a later change has no way past on it, and it never goes stale. With no
 * base to read, the stop judges nothing.
 *
 * The app hands in its debt, its exceptions and its limit, and its config says where they sit:
 * nothing here is one app's.
 *
 * What it can't see: whether a line is true, which stays a review's; a sync helper a test returns,
 * which reads as a promise; a test under another name (`const dbIt = it`); and, in the count, a
 * table built by a call or a spread and a test in a loop or a helper, each of which counts once.
 */
/** @typedef {import("./analyzer.mjs").DbTestsAnalysis} DbTestsAnalysis */
/** @typedef {import("./analyzer.mjs").StopException} StopException */
export const DB_TESTS_RULES: readonly ["db-test-no-reason", "db-test-sends-nothing", "stale-debt", "unnamed-debt", "stop-exception-unnamed", "db-tests-past-the-stop", "stop-exception-unused"];
export type DbTestsAnalysis = import("./analyzer.mjs").DbTestsAnalysis;
export type StopException = import("./analyzer.mjs").StopException;
export type DbTestsRule = (typeof DB_TESTS_RULES)[number];
export type DbTestsFinding = {
    rule: DbTestsRule;
    path: string;
    line: number | null;
    detail: string;
};
/**
 * A test that came before the rule: a file with no line, or a test that sends nothing.
 */
export type DbTestDebt = {
    rule: "db-test-no-reason";
    path: string;
    issue: string;
    reason: string;
} | {
    rule: "db-test-sends-nothing";
    path: string;
    test: string;
    issue: string;
    reason: string;
};
/**
 * What an app hands the check: its reviewed debt, its exceptions today, and its limit.
 */
export type DbTestsLists = {
    debt: readonly DbTestDebt[];
    exceptions: readonly StopException[];
    limit: number;
};
