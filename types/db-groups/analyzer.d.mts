/**
 * The analysis of a tree, as text: every path the app's `files` matches is a database test file.
 * @param {Sources} sources
 * @param {DbGroupsOn} on
 * @returns {DbGroupsAnalysis}
 */
export function analyzeDbGroupSources(sources: Sources, on: DbGroupsOn): DbGroupsAnalysis;
/**
 * The tree's database test files, and what each does to a process it would share.
 * @param {import("../config.mjs").ChecksConfig} config the app's `checks.config.mjs`
 * @param {{ root?: string }} [options]
 * @returns {DbGroupsAnalysis}
 */
export function analyzeDbGroups(config: import("../config.mjs").ChecksConfig, { root }?: {
    root?: string;
}): DbGroupsAnalysis;
/**
 * The names of one file: what it imports, under what name there, what it declares, and what stands
 * for what.
 */
export type Names = {
    imported: Map<string, string>;
    declared: Set<string>;
    aliases: Map<string, string>;
};
export type DbGroupsOn = import("../config.mjs").DbGroupsOn;
export type Touch = {
    kind: "fake" | "global-state" | "truncate";
    file: string;
    what: string;
};
/**
 * Where an app's own parts of the check sit, for what a finding says.
 */
export type DbGroupsWhere = {
    lists: string;
    setup: string | null;
};
/**
 * `files`: each database test file, with what it and the test helpers it reaches do.
 * `installsAtLoad`: app modules, outside the setup, that install at load.
 */
export type DbGroupsAnalysis = {
    files: {
        path: string;
        touches: Touch[];
    }[];
    installsAtLoad: string[];
    where: DbGroupsWhere;
};
export type Sources = Readonly<Record<string, string>>;
