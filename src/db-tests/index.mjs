// The database tests check, as an app imports it: `@outright/checks/db-tests`. It ships switched
// off: an app turns it on with `checks.dbTests` in its config, and hands it its lists. The discovery
// reads the app's database tests and what a change adds; the policy judges them.

export { analyzeDbTests } from "./analyzer.mjs";
export { DB_TESTS_RULES, evaluateDbTests, formatDbTestsFindings } from "./policy.mjs";

/** @typedef {import("./analyzer.mjs").DbTest} DbTest */
/** @typedef {import("./analyzer.mjs").DbTestFile} DbTestFile */
/** @typedef {import("./analyzer.mjs").DbTestsAnalysis} DbTestsAnalysis */
/** @typedef {import("./analyzer.mjs").DbTestsChange} DbTestsChange */
/** @typedef {import("./analyzer.mjs").DbTestsWhere} DbTestsWhere */
/** @typedef {import("./analyzer.mjs").StopException} StopException */
/** @typedef {import("./policy.mjs").DbTestDebt} DbTestDebt */
/** @typedef {import("./policy.mjs").DbTestsFinding} DbTestsFinding */
/** @typedef {import("./policy.mjs").DbTestsLists} DbTestsLists */
/** @typedef {import("./policy.mjs").DbTestsRule} DbTestsRule */
