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

export const DB_GROUPS_RULES = /** @type {const} */ ([
  "shared-fake",
  "shared-global-state",
  "apart-excuses-nothing",
  "apart-not-a-file",
  "truncate-not-alone",
  "alone-excuses-nothing",
  "install-at-load",
]);

/** @typedef {typeof DB_GROUPS_RULES[number]} DbGroupsRule */
/** @typedef {{ rule: DbGroupsRule, detail: string }} DbGroupsFinding */
/** The app's lists: the files kept apart, a process each, and the files that run alone. @typedef {{ apart: readonly string[], alone?: readonly string[] }} DbGroupsLists */

/** @param {string} path @param {Touch} touch */
const through = (path, touch) => (touch.file === path ? "" : ` (through ${touch.file})`);

/**
 * @param {DbGroupsAnalysis} analysis
 * @param {DbGroupsLists} lists
 * @returns {DbGroupsFinding[]}
 */
export function evaluateDbGroups(analysis, { apart, alone = [] }) {
  const { lists, setup } = analysis.where;
  /** @type {DbGroupsFinding[]} */
  const findings = [];
  const listed = new Set(apart);
  const single = new Set(alone);
  const known = new Set(analysis.files.map(({ path }) => path));

  for (const { path, touches: all } of analysis.files) {
    const truncates = all.find(({ kind }) => kind === "truncate");
    const touches = all.filter(({ kind }) => kind !== "truncate");
    if (truncates && !single.has(path)) {
      findings.push({ rule: "truncate-not-alone", detail: `${path} truncates a table${through(path, truncates)}: list it to run alone, in ${lists}` });
    }
    if (single.has(path)) {
      if (!truncates) findings.push({ rule: "alone-excuses-nothing", detail: `${path} truncates nothing: take it off the files that run alone, in ${lists}` });
      continue;
    }
    if (listed.has(path)) {
      if (touches.length === 0) {
        findings.push({
          rule: "apart-excuses-nothing",
          detail: `${path} fakes nothing and changes no global state: take it off the files kept apart, in ${lists}, so it shares a process`,
        });
      }
      continue;
    }
    const fake = touches.find(({ kind }) => kind === "fake");
    if (fake) {
      findings.push({ rule: "shared-fake", detail: `${path} ${fake.what}${through(path, fake)}: it can't share a process, so list it apart, in ${lists}` });
    }
    const state = touches.find(({ kind }) => kind === "global-state");
    if (state && !fake) {
      findings.push({
        rule: "shared-global-state",
        detail: `${path} ${state.what}${through(path, state)}: it can't share a process, so list it apart, in ${lists}`,
      });
    }
  }

  for (const path of [...apart, ...alone]) {
    if (!known.has(path)) findings.push({ rule: "apart-not-a-file", detail: `${path} is no database test file: take it off ${lists}` });
  }

  for (const path of analysis.installsAtLoad) {
    findings.push({
      rule: "install-at-load",
      detail: `${path} installs at load, so the shared group would get it by file order: install it from ${setup ?? "what the shared setup loads"}`,
    });
  }
  return findings;
}

/** Each finding as `rule: detail`, one a line. @param {readonly DbGroupsFinding[]} findings */
export function formatDbGroupsFindings(findings) {
  return findings.map(({ rule, detail }) => `${rule}: ${detail}`).join("\n");
}
