import { describe, expect, it } from "vitest";

import {
  declaredRules,
  exactCountsInScanTests,
  expandScript,
  isLiveTest,
  scopedGatesReachingTheSuite,
  unprovenRules,
} from "./check-hygiene.mjs";

/* ── each meta-check is made to fire before an app trusts it ─────────────── */

describe("check hygiene — the rules can fire", () => {
  it("finds an exact count inside a scan test, and leaves the debt test beside it alone", () => {
    const source = [
      'describe("live ratchet", () => {',
      '  it("discovers the tree non-vacuously", () => {',
      "    expect(analysis.modules).toHaveLength(660);",
      "    expect(total).toBe(80_045);",
      "    expect(byLayer).toEqual({ ui: 86, shared: 489 });",
      "    expect(analysis.consumers.length).toBeGreaterThan(0);",
      "    expect(analysis.files.some((file) => file.imports.length > 0)).toBe(true);",
      "  });",
      "",
      '  it("keeps the reviewed debt exact and visible", () => {',
      "    expect(analysis.oversized).toHaveLength(3);",
      "  });",
      "});",
    ].join("\n");
    expect(exactCountsInScanTests([{ path: "x/live.test.ts", source }]).map((f) => f.line)).toEqual(
      [3, 4, 5]
    );
  });

  it("finds a scoped gate that reaches the suite, through any depth of script", () => {
    expect(
      scopedGatesReachingTheSuite({
        test: "nice -n 10 vitest run",
        "verify:checks": "pnpm exec next typegen && pnpm typecheck && pnpm test",
        "verify:api": "pnpm lint:api && pnpm verify:checks",
        "verify:components": "pnpm lint:components && nice -n 10 vitest run src/test/component-ratchet",
        "verify:chain": "pnpm lint:api && pnpm verify:checks",
        "lint:api": "eslint src/app/api",
        typecheck: "tsc --noEmit",
      })
    ).toEqual([
      { script: "verify:checks", command: "vitest run" },
      { script: "verify:api", command: "vitest run" },
    ]);
  });

  it("leaves alone a gate the app names as not scoped", () => {
    expect(
      scopedGatesReachingTheSuite(
        {
          test: "vitest run",
          "verify:checks": "pnpm test",
          "verify:chain": "pnpm verify:checks",
          "verify:architecture": "vitest run src/test/architecture",
        },
        { notScoped: ["verify:chain", "verify:checks"] }
      )
    ).toEqual([]);
  });

  it("counts a path under the app's own roots", () => {
    const scripts = { "verify:x": "vitest run app/x" };
    expect(scopedGatesReachingTheSuite(scripts)).toEqual([
      { script: "verify:x", command: "vitest run app/x" },
    ]);
    expect(scopedGatesReachingTheSuite(scripts, { pathRoots: ["app"] })).toEqual([]);
  });

  it("reads no argument as a path when the app names no roots", () => {
    expect(scopedGatesReachingTheSuite({ "verify:x": "vitest run /abs/x" }, { pathRoots: [] })).toEqual([
      { script: "verify:x", command: "vitest run /abs/x" },
    ]);
  });

  it("counts no rule a test file declares, whatever its extension", () => {
    expect(
      declaredRules({
        name: "x",
        files: [
          { path: "src/test/x/policy.ts", source: 'push({ rule: "real" });' },
          { path: "src/test/x/policy.test.mjs", source: 'push({ rule: "fixture-only" });' },
          { path: "src/test/x/policy.test.tsx", source: 'push({ rule: "also-fixture" });' },
        ],
      })
    ).toEqual(["real"]);
  });

  it("writes out every script a script calls", () => {
    expect(expandScript("a", { a: "pnpm b && echo a", b: "pnpm run c", c: "echo c" })).toBe(
      "( ( echo c ) ) && echo a"
    );
  });

  it("finds a rule only a live test names, and accepts a loop whose marker is present", () => {
    /** @param {string} loopTest @returns {import("./check-hygiene.mjs").RatchetFolder} */
    const folder = (loopTest) => ({
      name: "x-ratchet",
      files: [
        {
          path: "src/test/x-ratchet/policy.ts",
          source: 'push({ rule: "proven" }); push({ rule: "only-live" }); push({ rule: "nowhere" });',
        },
        {
          path: "src/test/x-ratchet/policy.test.ts",
          source: `const dir = tree({}); expect(rules).toEqual(["proven"]); ${loopTest}`,
        },
        {
          path: "src/test/x-ratchet/live.test.ts",
          source:
            'const analysis = analyzeX(process.cwd()); expect(v.filter((f) => f.rule === "only-live")).toEqual([]);',
        },
      ],
    });
    expect(declaredRules(folder(""))).toEqual(["nowhere", "only-live", "proven"]);
    expect(unprovenRules([folder("")], {})).toEqual(["x-ratchet:nowhere", "x-ratchet:only-live"]);

    const loop = { "x-ratchet": { file: "policy.test.ts", marker: "toEqual([...allRules].sort())" } };
    expect(unprovenRules([folder("expect(seen).toEqual([...allRules].sort());")], loop)).toEqual([]);
    // An exemption whose evidence has gone is a finding, not a pass.
    expect(unprovenRules([folder("")], loop)).toContain(
      "x-ratchet:(the loop marker is gone from policy.test.ts)"
    );
  });

  it("tells a live test from a fixture test by what it analyses", () => {
    expect(isLiveTest("const analysis = analyzeArchitecture();")).toBe(true);
    expect(isLiveTest("const analysis = analyzeComponents({ roots });")).toBe(true);
    expect(isLiveTest("const analysis = analyzeTopology(REPO_ROOT);")).toBe(true);
    expect(isLiveTest("const analysis = analyzeTopology(process.cwd());")).toBe(true);
    expect(isLiveTest("const dir = mkdtempSync(p); analyzeTopology(dir);")).toBe(false);
    expect(isLiveTest("const dir = tree({}); analyzeAdoption(join(dir));")).toBe(false);
    expect(isLiveTest("analyzeArchitectureSources({ ...CLEAN });")).toBe(false);
  });
});
