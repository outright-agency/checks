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
    ];
    for (const [broken, message] of cases) {
      expect(() => resolveConfig(/** @type {any} */ (broken))).toThrow(
        new ChecksConfigError(message)
      );
      expect(() => resolveConfig(/** @type {any} */ (broken))).toThrow(`checks.config.mjs: ${message}`);
    }
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
