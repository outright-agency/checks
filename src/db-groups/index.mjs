// The database groups check, as an app imports it: `@outright/checks/db-groups`. It ships switched
// off: an app turns it on with `checks.dbGroups` in its config, which hands it the app's own words,
// and its live test hands it the lists. The discovery reads what each database test file does to a
// process it would share; the policy judges it against the lists.

export { analyzeDbGroups } from "./analyzer.mjs";
export { DB_GROUPS_RULES, evaluateDbGroups, formatDbGroupsFindings } from "./policy.mjs";

/** @typedef {import("./analyzer.mjs").DbGroupsAnalysis} DbGroupsAnalysis */
/** @typedef {import("./analyzer.mjs").DbGroupsWhere} DbGroupsWhere */
/** @typedef {import("./analyzer.mjs").Touch} Touch */
/** @typedef {import("./policy.mjs").DbGroupsFinding} DbGroupsFinding */
/** @typedef {import("./policy.mjs").DbGroupsLists} DbGroupsLists */
/** @typedef {import("./policy.mjs").DbGroupsRule} DbGroupsRule */
