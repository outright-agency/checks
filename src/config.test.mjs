import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ChecksConfigError, loadConfig, namesOf, resolveConfig } from "./config.mjs";

const FIXTURES = fileURLToPath(new URL("../test/fixtures/", import.meta.url));

/** A config that passes, to break one key at a time. @param {object} [over] */
function config(over = {}) {
  return {
    name: "my-app",
    check: { steps: [{ name: "types", run: "tsc" }, "tests"] },
    verify: { lanes: [{ name: "suite", run: "pnpm test", long: true }] },
    ...over,
  };
}

describe("resolveConfig", () => {
  it("derives the gate folder and both environment names from the one name", () => {
    for (const names of [resolveConfig(/** @type {any} */ (config())), namesOf("my-app")]) {
      expect(names.gateFolder).toBe("my-app-gate");
      expect(names.env.noCache).toBe("MY_APP_GATE_NO_CACHE");
      expect(names.env.ratchetBase).toBe("MY_APP_RATCHET_BASE_SHA");
    }
  });

  it("fills every default", () => {
    const resolved = resolveConfig(/** @type {any} */ (config()));
    expect(resolved.ratchets).toEqual(["src/test/**/*.test.ts"]);
    expect(resolved.check.requires).toEqual([]);
    expect(resolved.check.tests).toEqual({ workerMemory: "512MB", parentHeapMb: 768 });
    expect(resolved.verify.first).toEqual([]);
    expect(resolved.verify.chain).toBe("pnpm verify:chain");
    expect(resolved.verify.summary.source).toBe("ratchet passed|Test Files|Tests {2}");
  });

  it("refuses each mistake, naming the file and the key", () => {
    const steps = [{ name: "types", run: "tsc" }, "tests"];
    const lanes = [{ name: "suite", run: "pnpm test" }];
    /** @type {[object, string][]} */
    const cases = [
      [config({ check: { stpes: steps, steps } }), "unknown key check.stpes"],
      [config({ verify: { lanes: [{ name: "a", run: "x", lnog: true }] } }), "unknown key verify.lanes[0].lnog"],
      [config({ name: "My App" }), 'name must be lower-case letters, digits and dashes, starting with a letter: got "My App"'],
      [config({ name: undefined }), "name must be lower-case letters, digits and dashes, starting with a letter: got undefined"],
      [config({ ratchets: [] }), "ratchets must list at least one glob"],
      [config({ check: { requires: [{ path: "x" }], steps } }), "check.requires[0] needs a path and a message"],
      [config({ check: { steps: [] } }), "check.steps must list at least one step"],
      [config({ check: { steps: [{ name: "types" }] } }), "check.steps[0] needs a name and a run"],
      [config({ check: { steps: ["tests", "tests"] } }), '"tests" appears more than once in check.steps'],
      [config({ verify: { lanes: [] } }), "verify.lanes must list at least one lane"],
      [config({ verify: { first: [{ name: "p" }], lanes } }), "verify.first[0] needs a name and a run"],
      [config({ verify: { lanes: [{ run: "x" }] } }), "verify.lanes[0] needs a name and a run"],
      [config({ check: { steps: [{ name: "a", run: "x" }, { name: "a", run: "y" }] } }), 'check.steps names "a" twice'],
      [config({ verify: { first: [{ name: "a", run: "x" }], lanes: [{ name: "a", run: "y" }] } }), 'verify names "a" twice'],
      [config({ check: { steps: [{ name: "app", run: "x" }, "tests"] } }), 'check.steps names "app", the name of one of the tests step\'s lines'],
      [config({ check: { requires: "x", steps } }), "check.requires must be a list"],
      [config({ check: { steps, tests: { workerMemory: "" } } }), 'check.tests.workerMemory must be a size, as "512MB"'],
      [config({ check: { steps, tests: { parentHeapMb: 0.5 } } }), "check.tests.parentHeapMb must be a whole number of megabytes"],
      [config({ verify: { first: "x", lanes } }), "verify.first must be a list"],
      [config({ verify: { lanes, chain: "" } }), "verify.chain must be a command"],
      [config({ verify: { lanes, summary: "Tests" } }), "verify.summary must be a regular expression"],
    ];
    for (const [broken, message] of cases) {
      expect(() => resolveConfig(/** @type {any} */ (broken))).toThrow(
        new ChecksConfigError(message)
      );
      expect(() => resolveConfig(/** @type {any} */ (broken))).toThrow(`checks.config.mjs: ${message}`);
    }
    expect(() => resolveConfig(/** @type {any} */ ("x"))).toThrow(
      "checks.config.mjs: the default export must be the config object"
    );
  });

  it("drops the flags that would make the summary pattern skip lines", () => {
    const resolved = resolveConfig(/** @type {any} */ (config({ verify: { lanes: [{ name: "a", run: "x" }], summary: /passed/gi } })));
    expect(resolved.verify.summary.flags).toBe("i");
    expect(["a passed", "b passed"].filter((line) => resolved.verify.summary.test(line))).toHaveLength(2);
  });

  it("lets a step be named app or ratchets when the check has no tests step", () => {
    expect(() =>
      resolveConfig(/** @type {any} */ (config({ check: { steps: [{ name: "app", run: "x" }] } })))
    ).not.toThrow();
  });
});

describe("a check of the package's", () => {
  const dbTests = { lists: "a/lists.ts", exceptions: "a/exceptions.ts", rule: "docs/rule.md" };
  /** @param {unknown} checks */
  const resolved = (checks) => resolveConfig(/** @type {any} */ (config({ checks })));

  it("leaves every check off when the config names none", () => {
    expect(resolveConfig(/** @type {any} */ (config())).checks).toEqual({ dbTests: null, dbGroups: null });
  });

  it("fills a check's defaults when an app turns it on", () => {
    const on = resolved({ dbTests }).checks.dbTests;
    expect(on).toMatchObject({ ...dbTests, roots: ["src"] });
    expect(on?.files.source).toBe("\\.db\\.test\\.ts$");
  });

  it("keeps an app's own files and roots", () => {
    const on = resolved({ dbTests: { ...dbTests, files: /\.parity\.test\.ts$/, roots: ["app"] } }).checks.dbTests;
    expect(on?.files.source).toBe("\\.parity\\.test\\.ts$");
    expect(on?.roots).toEqual(["app"]);
  });

  it("strips the flags that make a pattern remember where it stopped", () => {
    const files = resolved({ dbTests: { ...dbTests, files: /\.db\.test\.ts$/gy } }).checks.dbTests?.files;
    expect(files?.flags).toBe("");
  });

  it("refuses checks that aren't an object, so nothing reads as off by mistake", () => {
    for (const checks of [[], "dbTests", true, null]) {
      expect(() => resolved(checks), JSON.stringify(checks)).toThrow("checks must be an object");
    }
  });

  it("refuses a check it doesn't know, so a typo can't leave one off", () => {
    expect(() => resolved({ dbTest: dbTests })).toThrow("unknown key checks.dbTest");
  });

  it("refuses an unknown key inside a check", () => {
    expect(() => resolved({ dbTests: { ...dbTests, limit: 30 } })).toThrow("unknown key checks.dbTests.limit");
  });

  it("refuses a check missing what is the app's own", () => {
    expect(() => resolved({ dbTests: { lists: "a", exceptions: "b" } })).toThrow(
      "checks.dbTests needs lists, exceptions and rule"
    );
  });

  it("refuses files that are no regular expression", () => {
    expect(() => resolved({ dbTests: { ...dbTests, files: "*.db.test.ts" } })).toThrow(
      "checks.dbTests.files must be a regular expression"
    );
  });

  it("refuses empty roots", () => {
    expect(() => resolved({ dbTests: { ...dbTests, roots: [] } })).toThrow(
      "checks.dbTests.roots must list at least one folder"
    );
  });
});

describe("the database groups check's switch", () => {
  const dbGroups = { lists: "a/groups.ts" };
  /** @param {unknown} checks */
  const resolved = (checks) => resolveConfig(/** @type {any} */ (config({ checks })));

  it("leaves it off when the config names none", () => {
    expect(resolveConfig(/** @type {any} */ (config())).checks.dbGroups).toBeNull();
    expect(resolved({ dbTests: { lists: "a", exceptions: "b", rule: "c" } }).checks.dbGroups).toBeNull();
  });

  it("fills its defaults when an app turns it on", () => {
    expect(resolved({ dbGroups }).checks.dbGroups).toEqual({
      lists: "a/groups.ts",
      setup: null,
      helpers: [],
      aliases: {},
      installs: [],
      collects: [],
      ownList: null,
      writes: [],
      declares: null,
      files: /\.db\.test\.ts$/,
      roots: ["src"],
    });
  });

  it("keeps an app's own words", () => {
    const own = {
      lists: "a/groups.ts",
      setup: "src/app/setup.ts",
      helpers: ["src/test/"],
      aliases: { "~/": "src/" },
      installs: ["mount"],
      collects: ["gather"],
      ownList: "ALL",
      writes: ["registry.offer"],
      declares: /^declare[A-Z]/,
      files: /\.parity\.test\.ts$/,
      roots: ["app"],
    };
    expect(resolved({ dbGroups: own }).checks.dbGroups).toEqual(own);
  });

  it("ends each folder and prefix with a slash", () => {
    const on = resolved({ dbGroups: { ...dbGroups, helpers: ["src/test"], aliases: { "~": "src" } } }).checks.dbGroups;
    expect(on?.helpers).toEqual(["src/test/"]);
    expect(on?.aliases).toEqual({ "~/": "src/" });
  });

  it("strips the flags that make a pattern remember where it stopped", () => {
    const on = resolved({ dbGroups: { ...dbGroups, files: /\.db\.test\.ts$/g, declares: /^define/y } }).checks.dbGroups;
    expect(on?.files.flags).toBe("");
    expect(on?.declares?.flags).toBe("");
  });

  it("refuses a check missing its lists", () => {
    expect(() => resolved({ dbGroups: { setup: "a.ts" } })).toThrow("checks.dbGroups needs lists");
  });

  it("refuses an unknown key inside it", () => {
    expect(() => resolved({ dbGroups: { ...dbGroups, install: ["x"] } })).toThrow("unknown key checks.dbGroups.install");
  });

  it.each([
    [{ setup: "" }, "checks.dbGroups.setup must be a path"],
    [{ helpers: "src/test/" }, "checks.dbGroups.helpers must list folders"],
    [{ aliases: { "~/": 1 } }, "checks.dbGroups.aliases must map each prefix to a folder"],
    [{ installs: ["a b"] }, "checks.dbGroups.installs must list names"],
    [{ collects: [1] }, "checks.dbGroups.collects must list names"],
    [{ ownList: "A.B" }, "checks.dbGroups.ownList must be a name"],
    [{ writes: ["offer"] }, "checks.dbGroups.writes must list calls as object.method"],
    [{ declares: "^define" }, "checks.dbGroups.declares must be a regular expression"],
    [{ files: "*.db.test.ts" }, "checks.dbGroups.files must be a regular expression"],
    [{ roots: [] }, "checks.dbGroups.roots must list at least one folder"],
  ])("refuses %j", (given, message) => {
    expect(() => resolved({ dbGroups: { ...dbGroups, ...given } })).toThrow(message);
  });
});

describe("loadConfig", () => {
  it("loads both fixture apps", async () => {
    const monorepo = await loadConfig(join(FIXTURES, "monorepo"));
    expect(monorepo.verify.first).toHaveLength(1);
    expect(monorepo.check.requires).toHaveLength(1);
    const single = await loadConfig(join(FIXTURES, "single"));
    expect(single.gateFolder).toBe("single-gate");
  });

  it("says where to declare the checks when the file is missing", async () => {
    const empty = mkdtempSync(join(tmpdir(), "checks-config-"));
    try {
      await expect(loadConfig(empty)).rejects.toThrow(
        `checks.config.mjs: no checks.config.mjs in ${empty}: an app declares its checks there (see the package's README)`
      );
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
