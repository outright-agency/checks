/**
 * @param {DbGroupsAnalysis} analysis
 * @param {DbGroupsLists} lists
 * @returns {DbGroupsFinding[]}
 */
export function evaluateDbGroups(analysis: DbGroupsAnalysis, { apart, alone }: DbGroupsLists): DbGroupsFinding[];
/** Each finding as `rule: detail`, one a line. @param {readonly DbGroupsFinding[]} findings */
export function formatDbGroupsFindings(findings: readonly DbGroupsFinding[]): string;
/**
 * A FILE THAT FAKES OR CHANGES GLOBAL STATE KEEPS A PROCESS OF ITS OWN, AND NO OTHER DOES.
 *
 * Most database test files share a process, so what one leaves there the next one finds. The app's
 * lists of files kept apart and run alone equal what the source shows (analyzer.mjs says what it
 * reads).
 *
 *   shared-fake            a shared file fakes, itself or through a test helper
 *   shared-global-state    a shared file changes global state, itself or through a test helper
 *   apart-excuses-nothing  a listed file does neither, so it pays for a process it doesn't need
 *   apart-not-a-file       a listed path is no database test file
 *   truncate-not-alone     a file truncates beside others: it locks table after table, so a
 *                          neighbour can die of it
 *   alone-excuses-nothing  a file runs alone and truncates nothing, so the run waits for no reason
 *   install-at-load        an app module installs at load, outside the setup the shared group
 *                          loads: the shared group would get it by file order
 *
 * A file that poisons its neighbours in a way the syntax tree can't show is taught to the analyzer,
 * not listed by hand.
 *
 * Pure: analysis in, findings out; policy.test.mjs makes each fire.
 */
/** @typedef {import("./analyzer.mjs").DbGroupsAnalysis} DbGroupsAnalysis */
/** @typedef {import("./analyzer.mjs").Touch} Touch */
export const DB_GROUPS_RULES: readonly ["shared-fake", "shared-global-state", "apart-excuses-nothing", "apart-not-a-file", "truncate-not-alone", "alone-excuses-nothing", "install-at-load"];
export type DbGroupsAnalysis = import("./analyzer.mjs").DbGroupsAnalysis;
export type Touch = import("./analyzer.mjs").Touch;
export type DbGroupsRule = (typeof DB_GROUPS_RULES)[number];
export type DbGroupsFinding = {
    rule: DbGroupsRule;
    detail: string;
};
/**
 * The app's lists: the files kept apart, a process each, and the files that run alone.
 */
export type DbGroupsLists = {
    apart: readonly string[];
    alone?: readonly string[];
};
