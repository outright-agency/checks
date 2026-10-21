/**
 * Judges every test the analysis read, and settles the findings against the reviewed debt (none
 * when no baseline is given). `checked` counts what was read, for the live test's floors.
 * @param {TestsAnalysis} analysis
 * @param {TestsBaseline} [baseline]
 * @returns {TestsResult}
 */
export function evaluateTests(analysis: TestsAnalysis, baseline?: TestsBaseline): TestsResult;
/**
 * One line per finding: `path:line rule: text`.
 * @param {readonly TestsFinding[]} findings
 * @returns {string[]}
 */
export function formatTestsFindings(findings: readonly TestsFinding[]): string[];
/**
 * THE TESTS CHECK — the parts of a fast-test standard a machine can hold.
 *
 *   env-written            a test writes `process.env` itself (assigns, deletes, Object.assign)
 *                          instead of `vi.stubEnv`, so nothing puts it back for the next file
 *   env-unrestored         a file stubs the environment and never calls `vi.unstubAllEnvs`
 *   process-chdir          a test changes the process's working directory
 *   real-clock-sleep       a promise resolved by a real timer with a delay: a sleep
 *   wait-own-timeout       a wait that names its own timeout, overriding the suite's
 *   vi-wait-in-dom         `vi.waitFor` or `vi.waitUntil` in a DOM test, which ignores the longer
 *                          wait the setup gives Testing Library on CI
 *   wait-for-absence       a wait for a mock not to have been called: it passes on its first try
 *   budget-without-reason  a test's own budget with no comment beside it saying why
 *   stale-debt             a debt entry the tree has fewer of than it names: lower it, or remove it
 *
 * The rules read the syntax tree, not one spelling of it. A file is parsed only when its text
 * could hold a finding, so reading every test stays cheap.
 */
/** @typedef {import("./analyzer.mjs").TestFile} TestFile */
/** @typedef {import("./analyzer.mjs").TestsAnalysis} TestsAnalysis */
export const TESTS_RULES: readonly ["budget-without-reason", "env-unrestored", "env-written", "process-chdir", "real-clock-sleep", "stale-debt", "vi-wait-in-dom", "wait-for-absence", "wait-own-timeout"];
export type Budget = {
    call: ts.CallExpression;
    ms: number | null;
};
export type Comment = {
    pos: number;
    end: number;
    text: string;
};
export type TestFile = import("./analyzer.mjs").TestFile;
export type TestsAnalysis = import("./analyzer.mjs").TestsAnalysis;
export type TestsRule = (typeof TESTS_RULES)[number];
export type TestsFinding = {
    rule: TestsRule;
    path: string;
    line: number;
    text: string;
};
/**
 * Reviewed debt, exactly: `count` findings of `rule` in `path`, cleared by `issue`.
 */
export type TestsDebt = {
    path: string;
    rule: TestsRule;
    count: number;
    issue: string;
    reason: string;
};
export type TestsBaseline = {
    debt: readonly TestsDebt[];
};
export type TestsChecked = {
    files: number;
    jsdomFiles: number;
    parsed: number;
    budgets: number;
    waits: number;
};
export type TestsResult = {
    findings: TestsFinding[];
    checked: TestsChecked;
};
import ts from "typescript";
