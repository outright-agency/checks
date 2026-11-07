import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { commitAll, git, scratchRepo } from "../../test/support/scratch-repo.mjs";
import { analyzeDbTestSources, analyzeDbTests, newDbTests, readDbTestFile } from "./analyzer.mjs";

const LINE = "// Only a database proves: a trigger refuses it";
const WHERE = { lists: "tests/lists.ts", exceptions: "tests/exceptions.ts", rule: "docs/rule.md" };

/** @param {string} body */
const read = (body) => readDbTestFile("a.db.test.ts", body).tests;
/** @param {string} callback */
const sends = (callback) => read(`it("t", ${callback});`)[0]?.sends;

describe("the reader of a database test file", () => {
  it("sees a test by every spelling", () => {
    const spellings = [`it("a", f);`, `test("b", f);`, `it.only("c", f);`, `it.skip("d", f);`, `it.concurrent("e", f);`, `it.skipIf(x)("f", f);`, `it.each([1])("g", f);`];
    expect(read(spellings.join("\n")).map(({ title }) => title)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(read(`it.todo("later");`)).toEqual([]);
  });

  it("knows the line, wherever it sits", () => {
    const reason = (/** @type {string} */ text) => readDbTestFile("a.db.test.ts", text).reason;
    expect(reason(LINE)).toBe(true);
    expect(reason(`import x from "x";\n\n${LINE}\nit("t", f);`)).toBe(true);
  });

  it("takes no line of under three words, however the code goes on", () => {
    const reason = (/** @type {string} */ text) => readDbTestFile("a.db.test.ts", text).reason;
    expect(reason(`it("t", f);`)).toBe(false);
    expect(reason("// Only a database proves: rows")).toBe(false);
    expect(reason("// Only a database proves: rows\nawait something();\nmore();")).toBe(false);
    expect(reason(`  ${LINE}`)).toBe(false);
    expect(reason(LINE.toLowerCase())).toBe(false);
  });

  it("counts a test that awaits or returns as sending", () => {
    for (const callback of [
      "async () => { await x(); }",
      "async () => { for await (const y of z) y; }",
      "() => x()",
      "() => { return x(); }",
      "() => expect(p).resolves.toBe(1)",
      "() => expect(p).rejects.toThrow()",
      "() => frozen(async () => { await x(); })",
      "async () => expect(await load()).toBe(1)",
      "async () => ({ a: await x() })",
      "() => expect.poll(() => x()).toBe(1)",
      "function () { return x(); }",
    ]) {
      expect(sends(callback), callback).toBe(true);
    }
  });

  it("counts a test that neither awaits nor returns as sending nothing", () => {
    for (const callback of [
      "() => { expect(1).toBe(1); }",
      "async () => { expect(1).toBe(1); }",
      "() => expect(1).toBe(1)",
      "() => { const a = 1; expect(a).toBe(1); }",
      "() => { return 1; }",
      "() => ({ a: 1 })",
      "() => { void (async () => { await x(); })(); }",
      "helper",
    ]) {
      expect(sends(callback), callback).toBe(false);
    }
  });

  it("looks through parens and `as` at what a test returns", () => {
    expect(sends("() => (expect(1).toBe(1))")).toBe(false);
    expect(sends("() => (x() as Promise<void>)")).toBe(true);
  });

  it("reads no await out of a comment or a string", () => {
    expect(sends(`() => { /* await x() */ expect("await y").toBe(1); }`)).toBe(false);
  });

  it("counts a table's rows, and an enclosing table multiplies them", () => {
    const cases = (/** @type {string} */ body) => read(body).map((test) => test.cases);
    expect(cases(`it.each([1, 2, 3])("%s", async () => { await x(); });`)).toEqual([3]);
    expect(cases(`const T = [1, 2];\nit.each(T)("%s", async () => { await x(); });`)).toEqual([2]);
    expect(cases(`it.each(load())("%s", async () => { await x(); });`)).toEqual([1]);
    expect(cases(`it.for([1, 2])("%s", async () => { await x(); });`)).toEqual([2]);
    expect(cases(`describe.each([1, 2])("%s", () => {\n  it("a", f);\n  it.each([1, 2, 3])("b", f);\n});`)).toEqual([2, 6]);
  });

  it("reads a table that is empty as written as one row, and a test's own name only as a test", () => {
    expect(read(`const T: number[] = [];\nit.each(T)("%s", f);`).map((test) => test.cases)).toEqual([1]);
    expect(read(`beforeAll(() => rows.map((it) => it.toJSON()));\nafterAll(() => list.map((test) => test.close()));`)).toEqual([]);
  });

  it("keeps a title as written, and the line it sits on", () => {
    expect(read("\nit(`plain`, f);\nit(`has ${x}`, f);").map(({ title, line }) => [title, line])).toEqual([
      ["plain", 2],
      ["`has ${x}`", 3],
    ]);
  });
});

describe("the reading of many files", () => {
  it("reads each file it is given, sorted, with no change", () => {
    const analysis = analyzeDbTestSources({ "b.db.test.ts": LINE, "a.db.test.ts": `it("t", f);` }, WHERE);
    expect(analysis.files.map(({ path }) => path)).toEqual(["a.db.test.ts", "b.db.test.ts"]);
    expect(analysis.change).toBeNull();
  });
});

describe("the count of a change's new database tests", () => {
  const body = (/** @type {number} */ titles) => Array.from({ length: titles }, (_, n) => `it("t${n}", async () => { await x(); });`).join("\n");
  /** @param {Record<string, string>} today @param {Record<string, string>} base */
  const count = (today, base) =>
    newDbTests(
      [...new Set([...Object.keys(today), ...Object.keys(base)])],
      analyzeDbTestSources(today, WHERE).files,
      (path) => base[path] ?? null
    );

  it("counts a new file's tests", () => {
    expect(count({ "a.db.test.ts": body(3) }, {})).toBe(3);
  });

  it("counts tests added to a file", () => {
    expect(count({ "a.db.test.ts": body(5) }, { "a.db.test.ts": body(2) })).toBe(3);
  });

  it("counts a table's rows", () => {
    const rows = Array.from({ length: 40 }, (_, n) => n).join(", ");
    expect(count({ "a.db.test.ts": `it.each([${rows}])("%s", async () => { await x(); });` }, {})).toBe(40);
  });

  it("nets a move between files to nothing", () => {
    expect(count({ "a.db.test.ts": body(1), "b.db.test.ts": body(31) }, { "a.db.test.ts": body(32) })).toBe(0);
  });

  it("nets a rename to nothing", () => {
    expect(count({ "b.db.test.ts": body(31) }, { "a.db.test.ts": body(31) })).toBe(0);
  });

  it("goes below zero for a cut", () => {
    expect(count({ "a.db.test.ts": body(2) }, { "a.db.test.ts": body(10) })).toBe(-8);
  });

  it("reads no file that is no database test", () => {
    const read = vi.fn(() => null);
    newDbTests(["src/a.ts", "docs/README.md", "b.db.test.ts"], [], read);
    expect(read.mock.calls).toEqual([["b.db.test.ts"]]);
  });
});

describe("the reading of an app's tree", () => {
  const CONFIG = "export default {};\n";
  const SENDS = `${LINE}\nit("t", async () => { await x(); });\n`;
  /** @param {object} [dbTests] */
  const config = (dbTests) => ({
    name: "probe-app",
    check: { steps: /** @type {"tests"[]} */ (["tests"]) },
    verify: { lanes: [{ name: "a", run: "true" }] },
    checks: { dbTests: { ...WHERE, ...dbTests } },
  });
  const EXCEPTIONS = `export const STOP_EXCEPTIONS = [{ tests: 40, issue: "APP-1", reason: "old" }];\n`;
  /** @type {Record<string, string>} */
  const env = {};

  it("takes an app's own files and roots", () => {
    const root = scratchRepo(CONFIG, { "app/a.parity.test.ts": SENDS, "app/a.db.test.ts": SENDS, "src/b.parity.test.ts": SENDS });
    const analysis = analyzeDbTests(config({ files: /\.parity\.test\.ts$/, roots: ["app"] }), { root, env });
    expect(analysis.files.map(({ path }) => path)).toEqual(["app/a.parity.test.ts"]);
  });

  it("leaves out a path under a dot-folder, as a copy of source", () => {
    const root = scratchRepo(CONFIG, { "src/a.db.test.ts": SENDS, "src/.copy/b.db.test.ts": SENDS });
    expect(analyzeDbTests(config(), { root, env }).files.map(({ path }) => path)).toEqual(["src/a.db.test.ts"]);
  });

  it("reads a files pattern with a g flag the same for every path", () => {
    const root = scratchRepo(CONFIG, { "src/a.db.test.ts": SENDS, "src/b.db.test.ts": SENDS, "src/c.db.test.ts": SENDS });
    const analysis = analyzeDbTests(config({ files: /\.db\.test\.ts$/g }), { root, env });
    expect(analysis.files).toHaveLength(3);
  });

  it("refuses to run for an app that hasn't turned it on", () => {
    const off = { ...config(), checks: {} };
    expect(() => analyzeDbTests(off)).toThrow(
      "checks.config.mjs: checks.dbTests is not set: the database tests check is off in this app"
    );
  });

  it("counts a change against the base from git, and reads its exceptions there", () => {
    const root = scratchRepo(CONFIG, { "tests/exceptions.ts": EXCEPTIONS, "src/a.db.test.ts": SENDS });
    const base = git(root, "rev-parse", "HEAD");
    git(root, "checkout", "-q", "-b", "work");
    writeFileSync(join(root, "src/b.db.test.ts"), `${SENDS}${SENDS}`);
    commitAll(root, "two more");
    const analysis = analyzeDbTests(config(), { root, env });
    expect(analysis.change).toEqual({
      base,
      added: 2,
      exceptionsAtBase: [{ tests: 40, issue: "APP-1", reason: "old" }],
    });
    expect(analysis.where).toEqual(WHERE);
  });

  it("counts only what it reads: nothing outside the roots or under a dot-folder comes off the count", () => {
    const root = scratchRepo(CONFIG, { "packages/a.db.test.ts": SENDS, "src/.copy/b.db.test.ts": SENDS });
    git(root, "checkout", "-q", "-b", "work");
    writeFileSync(join(root, "packages/a.db.test.ts"), `${SENDS}// edited\n`);
    writeFileSync(join(root, "src/.copy/b.db.test.ts"), `${SENDS}// edited\n`);
    writeFileSync(join(root, "src/c.db.test.ts"), `${SENDS}${SENDS}`);
    commitAll(root, "two more, and edits out of reach");
    expect(analyzeDbTests(config(), { root, env }).change?.added).toBe(2);
  });

  it("reads no exceptions at a base that has no such file", () => {
    const root = scratchRepo(CONFIG, { "src/a.db.test.ts": SENDS });
    expect(analyzeDbTests(config(), { root, env }).change?.exceptionsAtBase).toEqual([]);
  });

  it("judges no change on a run by hand that names no base", () => {
    const root = scratchRepo(CONFIG, { "src/a.db.test.ts": SENDS });
    const analysis = analyzeDbTests(config(), { root, env: { GITHUB_EVENT_NAME: "workflow_dispatch" } });
    expect(analysis.change).toBeNull();
    expect(analysis.files).toHaveLength(1);
  });
});
