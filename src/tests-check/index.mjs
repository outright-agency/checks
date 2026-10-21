// The tests check, as an app imports it: `@outright/checks/tests-check`. The discovery reads every
// test under the app's roots; the policy judges them against the rules and the app's reviewed debt.

export { analyzeTests, environmentOf, isSuiteTest } from "./analyzer.mjs";
export { TESTS_RULES, evaluateTests, formatTestsFindings } from "./policy.mjs";

/** @typedef {import("./analyzer.mjs").AnalyzeTestsOptions} AnalyzeTestsOptions */
/** @typedef {import("./analyzer.mjs").TestEnvironment} TestEnvironment */
/** @typedef {import("./analyzer.mjs").TestFile} TestFile */
/** @typedef {import("./analyzer.mjs").TestsAnalysis} TestsAnalysis */
/** @typedef {import("./policy.mjs").TestsRule} TestsRule */
/** @typedef {import("./policy.mjs").TestsFinding} TestsFinding */
/** @typedef {import("./policy.mjs").TestsDebt} TestsDebt */
/** @typedef {import("./policy.mjs").TestsBaseline} TestsBaseline */
/** @typedef {import("./policy.mjs").TestsChecked} TestsChecked */
/** @typedef {import("./policy.mjs").TestsResult} TestsResult */
