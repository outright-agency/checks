import { describe, expect, it } from "vitest";
import { analyzeDbTestSources } from "./analyzer.mjs";
import { DB_TESTS_RULES, evaluateDbTests, formatDbTestsFindings } from "./policy.mjs";

/** @typedef {import("./analyzer.mjs").StopException} StopException */
/** @typedef {import("./policy.mjs").DbTestDebt} DbTestDebt */
/** @typedef {import("./policy.mjs").DbTestsLists} DbTestsLists */

const LINE = "// Only a database proves: a trigger refuses it\n";
const SENDS = `it("sends", async () => { await x(); });\n`;
const SILENT = `it("silent", () => { expect(1).toBe(1); });\n`;
const PATH = "a.db.test.ts";

const LIMIT = 30;
const WHERE = { lists: "tests/lists.ts", exceptions: "tests/exceptions.ts", rule: "docs/rule.md" };

/** @type {DbTestDebt} */
const noReason = { rule: "db-test-no-reason", path: PATH, issue: "APP-1", reason: "old" };
/** @type {DbTestDebt} */
const silent = { rule: "db-test-sends-nothing", path: PATH, test: "silent", issue: "APP-1", reason: "old" };
/** @param {readonly DbTestDebt[]} [debt] @param {readonly StopException[]} [exceptions] @param {number} [limit] @returns {DbTestsLists} */
const lists = (debt = [], exceptions = [], limit = LIMIT) => ({ debt, exceptions, limit });
/** @param {string} text @param {DbTestsLists} [given] */
const rules = (text, given = lists()) =>
  evaluateDbTests(analyzeDbTestSources({ [PATH]: text }, WHERE), given).map(({ rule }) => rule);

describe("the database tests check — the file's line and what a test sends", () => {
  it("passes a file with its line and tests that send", () => {
    expect(rules(LINE + SENDS)).toEqual([]);
  });

  it("names a new file with no line", () => {
    expect(rules(SENDS)).toEqual(["db-test-no-reason"]);
  });

  it("lets a listed file go without its line", () => {
    expect(rules(SENDS, lists([noReason]))).toEqual([]);
  });

  it("names a test that sends nothing, by its line", () => {
    const findings = evaluateDbTests(analyzeDbTestSources({ [PATH]: LINE + SILENT }, WHERE), lists());
    expect(findings).toMatchObject([{ rule: "db-test-sends-nothing", path: PATH, line: 2 }]);
    expect(findings[0]?.detail).toContain("silent");
  });

  it("lets a listed test stand, and names a new one beside it", () => {
    const fresh = `it("fresh", () => { expect(1).toBe(1); });\n`;
    const findings = evaluateDbTests(analyzeDbTestSources({ [PATH]: LINE + SILENT + fresh }, WHERE), lists([silent]));
    expect(findings.map(({ rule, detail }) => [rule, detail.includes("fresh")])).toEqual([["db-test-sends-nothing", true]]);
  });

  it("counts two tests of one title against two entries", () => {
    expect(rules(LINE + SILENT + SILENT, lists([silent]))).toEqual(["db-test-sends-nothing"]);
    expect(rules(LINE + SILENT + SILENT, lists([silent, silent]))).toEqual([]);
  });

  it("names an entry that excuses nothing", () => {
    /** @type {DbTestDebt} */
    const gone = { ...noReason, path: "gone.db.test.ts" };
    expect(rules(LINE + SENDS, lists([noReason, gone, { ...silent, test: "sends" }]))).toEqual(["stale-debt", "stale-debt", "stale-debt"]);
    expect(rules(LINE + SILENT, lists([silent, silent]))).toEqual(["stale-debt"]);
  });

  it("names an entry with no issue or no reason, and an exception too", () => {
    expect(rules(SENDS, lists([{ ...noReason, issue: "" }]))).toEqual(["unnamed-debt"]);
    expect(rules(LINE + SENDS, lists([], [{ tests: 40, issue: "APP-1", reason: " " }]))).toEqual(["stop-exception-unnamed"]);
  });

  it("formats a finding with its place", () => {
    const text = formatDbTestsFindings(evaluateDbTests(analyzeDbTestSources({ [PATH]: LINE + SILENT }, WHERE), lists()));
    expect(text).toContain("db-test-sends-nothing  a.db.test.ts:2");
  });
});

describe("the database tests check — the stop", () => {
  const PAST = LIMIT + 1;
  /** @type {StopException} */
  const entry = { tests: PAST, issue: "APP-1", reason: "a new piece's rules" };
  /** @param {number} added @param {readonly StopException[]} [exceptionsAtBase] */
  const change = (added, exceptionsAtBase = []) => ({ base: "abcdef1234", added, exceptionsAtBase });
  /** @param {number} added @param {readonly StopException[]} [exceptions] @param {readonly StopException[]} [atBase] @param {number} [limit] */
  const judged = (added, exceptions = [], atBase = [], limit = LIMIT) =>
    evaluateDbTests(
      analyzeDbTestSources({ [PATH]: LINE + SENDS }, WHERE, change(added, atBase)),
      lists([], exceptions, limit)
    );
  /** @param {Parameters<typeof judged>} args */
  const fired = (...args) => judged(...args).map(({ rule }) => rule);

  it("stops at one past the limit, and says why", () => {
    const findings = judged(PAST);
    expect(findings.map(({ rule }) => rule)).toEqual(["db-tests-past-the-stop"]);
    expect(findings[0]?.detail).toContain(`${PAST} new database tests against abcdef1`);
    expect(findings[0]?.detail).toContain(`past the stop of ${LIMIT}`);
    expect(findings[0]?.detail).toContain(WHERE.exceptions);
  });

  it("lets the limit itself through", () => {
    expect(fired(LIMIT)).toEqual([]);
  });

  it("lets a cut through", () => {
    expect(fired(-40)).toEqual([]);
  });

  it("judges nothing with no base", () => {
    expect(evaluateDbTests(analyzeDbTestSources({ [PATH]: LINE + SENDS }, WHERE), lists([], [entry]))).toEqual([]);
  });

  it("takes an exception this change adds", () => {
    expect(fired(PAST, [entry])).toEqual([]);
  });

  it("refuses an exception smaller than the change", () => {
    expect(fired(PAST + 1, [entry])).toEqual(["db-tests-past-the-stop"]);
  });

  it("takes no exception the base already holds", () => {
    expect(fired(PAST, [entry], [entry])).toEqual(["db-tests-past-the-stop"]);
  });

  it("counts a second entry with the same words as new", () => {
    expect(fired(PAST, [entry, entry], [entry])).toEqual([]);
  });

  it("names an exception that isn't needed, only in the change that adds it", () => {
    expect(fired(5, [entry])).toEqual(["stop-exception-unused"]);
    expect(fired(5, [entry], [entry])).toEqual([]);
  });

  it("takes the limit the app hands in", () => {
    expect(fired(11, [], [], 10)).toEqual(["db-tests-past-the-stop"]);
    expect(fired(11, [], [], 11)).toEqual([]);
  });

  it("names the app's own files in what it says", () => {
    const texts = [
      ...evaluateDbTests(analyzeDbTestSources({ [PATH]: SILENT }, WHERE), lists()),
      ...evaluateDbTests(analyzeDbTestSources({ [PATH]: LINE + SENDS }, WHERE), lists([noReason])),
      ...judged(PAST),
    ].map(({ detail }) => detail);
    expect(texts[0]).toContain(WHERE.rule);
    expect(texts[1]).toContain(WHERE.rule);
    expect(texts[2]).toContain(WHERE.lists);
    expect(texts[3]).toContain(WHERE.exceptions);
    expect(texts[3]).toContain(WHERE.rule);
  });

  it("refuses a limit that is no number, which would turn the stop off unseen", () => {
    const given = /** @type {DbTestsLists} */ (/** @type {unknown} */ ({ debt: [], exceptions: [] }));
    expect(() => evaluateDbTests(analyzeDbTestSources({ [PATH]: LINE + SENDS }, WHERE), given)).toThrow(
      "the database tests check needs a limit: got undefined"
    );
    expect(() => judged(PAST, [], [], Number.NaN)).toThrow("the database tests check needs a limit: got NaN");
  });

  it("names an issue that is no key", () => {
    expect(rules(SENDS, lists([{ ...noReason, issue: "nope" }]))).toEqual(["unnamed-debt"]);
  });

  it("makes every rule fire", () => {
    /** @type {DbTestDebt} */
    const gone = { ...noReason, path: "gone.db.test.ts" };
    const seen = new Set([
      ...rules(SENDS),
      ...rules(LINE + SILENT),
      ...rules(LINE + SENDS, lists([gone])),
      ...rules(SENDS, lists([{ ...noReason, issue: "" }])),
      ...rules(LINE + SENDS, lists([], [{ ...entry, reason: "" }])),
      ...fired(PAST),
      ...fired(5, [entry]),
    ]);
    expect([...seen].sort()).toEqual([...DB_TESTS_RULES].sort());
  });
});
