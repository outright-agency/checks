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

export const DB_TESTS_RULES = /** @type {const} */ ([
  "db-test-no-reason",
  "db-test-sends-nothing",
  "stale-debt",
  "unnamed-debt",
  "stop-exception-unnamed",
  "db-tests-past-the-stop",
  "stop-exception-unused",
]);

/** @typedef {(typeof DB_TESTS_RULES)[number]} DbTestsRule */
/** @typedef {{ rule: DbTestsRule, path: string, line: number | null, detail: string }} DbTestsFinding */
/**
 * A test that came before the rule: a file with no line, or a test that sends nothing.
 * @typedef {{ rule: "db-test-no-reason", path: string, issue: string, reason: string } | { rule: "db-test-sends-nothing", path: string, test: string, issue: string, reason: string }} DbTestDebt
 */
/**
 * What an app hands the check: its reviewed debt, its exceptions today, and its limit.
 * @typedef {{ debt: readonly DbTestDebt[], exceptions: readonly StopException[], limit: number }} DbTestsLists
 */

/** An issue's key, as `ABC-12`. */
const ISSUE_KEY = /^[A-Z][A-Z0-9]*-\d+$/;

/** @param {string} path @param {string} title */
const key = (path, title) => `${path}\0${title}`;

/**
 * What an entry fails to name, or null when it names its issue and its reason.
 * @param {{ issue?: string, reason?: string }} entry
 * @returns {string | null}
 */
function unnamed(entry) {
  const issue = entry.issue !== undefined && ISSUE_KEY.test(entry.issue);
  const reason = entry.reason !== undefined && entry.reason.trim() !== "";
  if (!issue && !reason) return "names no issue and gives no reason: an entry gets in only with both.";
  if (!issue) return "names no issue: give it the issue it belongs to.";
  if (!reason) return "gives no reason: say why it stands.";
  return null;
}

/**
 * The exceptions today that the base doesn't hold, counted as entries, so a copy of an old one is a
 * new one.
 * @param {readonly StopException[]} exceptions
 * @param {readonly StopException[]} atBase
 */
function added(exceptions, atBase) {
  const held = atBase.map(({ tests, issue, reason }) => JSON.stringify([tests, issue, reason]));
  return exceptions.filter(({ tests, issue, reason }) => {
    const at = held.indexOf(JSON.stringify([tests, issue, reason]));
    if (at === -1) return true;
    held.splice(at, 1);
    return false;
  });
}

/**
 * @param {DbTestsAnalysis} analysis
 * @param {DbTestsLists} lists
 * @returns {DbTestsFinding[]}
 */
export function evaluateDbTests(analysis, { debt, exceptions, limit }) {
  const { lists: listsAt, exceptions: exceptionsAt, rule: ruleAt } = analysis.where;
  /** @type {DbTestsFinding[]} */
  const findings = [];
  /** @type {Set<string>} */
  const noReason = new Set();
  /** @type {Map<string, number>} */
  const silent = new Map();
  for (const entry of debt) {
    const problem = unnamed(entry);
    if (problem) findings.push({ rule: "unnamed-debt", path: entry.path, line: null, detail: problem });
    if (entry.rule === "db-test-no-reason") noReason.add(entry.path);
    else silent.set(key(entry.path, entry.test), (silent.get(key(entry.path, entry.test)) ?? 0) + 1);
  }
  const paths = new Set(analysis.files.map(({ path }) => path));
  for (const { path, reason, tests } of analysis.files) {
    if (reason && noReason.has(path)) {
      findings.push({ rule: "stale-debt", path, line: null, detail: `has its line now: take it off ${listsAt}` });
    } else if (!reason && !noReason.has(path)) {
      findings.push({
        rule: "db-test-no-reason",
        path,
        line: null,
        detail: `says nothing about why it needs a database: add a line "// Only a database proves: <what>", at the start of a line, three words or more, or make it a plain test (${ruleAt})`,
      });
    }
    for (const { title, line } of tests.filter((test) => !test.sends)) {
      const left = silent.get(key(path, title)) ?? 0;
      if (left > 0) silent.set(key(path, title), left - 1);
      else {
        findings.push({
          rule: "db-test-sends-nothing",
          path,
          line,
          detail: `"${title}" neither awaits nor returns a promise, so it sends the database nothing: it is a plain test, in a plain file, or, if it reads what a hook built, it joins a test that sends (${ruleAt})`,
        });
      }
    }
  }
  for (const path of noReason) {
    if (!paths.has(path)) {
      findings.push({ rule: "stale-debt", path, line: null, detail: `the tree no longer holds it: take it off ${listsAt}` });
    }
  }
  for (const [listed, left] of silent) {
    const [path = "", title = ""] = listed.split("\0");
    if (left > 0) {
      findings.push({ rule: "stale-debt", path, line: null, detail: `"${title}" sends something now, or is gone: take it off ${listsAt}` });
    }
  }
  for (const exception of exceptions) {
    const problem = unnamed(exception);
    if (problem) findings.push({ rule: "stop-exception-unnamed", path: exceptionsAt, line: null, detail: problem });
  }
  if (analysis.change !== null) {
    const { base, added: count, exceptionsAtBase } = analysis.change;
    const fresh = added(exceptions, exceptionsAtBase);
    if (count > limit && !fresh.some(({ tests }) => tests >= count)) {
      findings.push({
        rule: "db-tests-past-the-stop",
        path: exceptionsAt,
        line: null,
        detail: `${count} new database tests against ${base.slice(0, 7)}, past the stop of ${limit}: each costs every full run. Keep only what a database alone proves; the rest goes in plain tests. If they all earn their place, add an entry to ${exceptionsAt} with its issue, its reason and the count (${ruleAt}).`,
      });
    }
    if (count <= limit) {
      for (const { issue } of fresh) {
        findings.push({
          rule: "stop-exception-unused",
          path: exceptionsAt,
          line: null,
          detail: `${issue}'s exception excuses nothing: this change is within the stop, so take it off`,
        });
      }
    }
  }
  return findings;
}

/** @param {readonly DbTestsFinding[]} findings */
export function formatDbTestsFindings(findings) {
  return findings
    .map(({ rule, path, line, detail }) => `  ${rule}  ${path}${line === null ? "" : `:${line}`}\n    ${detail}`)
    .join("\n");
}
