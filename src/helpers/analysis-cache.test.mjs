import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analysisCache, porcelainPaths, repositoryStateKey } from "./analysis-cache.mjs";

const { cachedAnalysis } = analysisCache({ name: "fixture" });

// Every test that builds a repository runs `git` a dozen to two dozen times: 5 calls to build it,
// 3 for each state key (the stability test asks six times, 23 processes in all). Quiet, the
// slowest takes about a second; on a ten-core machine at a load average of 96 it took 8 s, past
// the 5 s default with nothing wrong in it. Each gets 20 s, which covers that and a two-core CI
// runner.
const BUDGET_MS = 20_000;

/** @type {string[]} */
const roots = [];

/** A repository with one committed source file. */
function repository() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "analysis-cache-")));
  roots.push(root);
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, ".gitignore"), "node_modules\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("porcelainPaths", () => {
  it("reads both paths of a rename and every other entry's one", () => {
    expect(porcelainPaths(" M src/a.ts\0?? src/new file.ts\0R  src/c.ts\0src/b.ts\0")).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/new file.ts",
    ]);
  });
});

describe("repositoryStateKey", () => {
  it("is stable for an unchanged repository and moves with any byte git can see", () => {
    const root = repository();
    const clean = repositoryStateKey(root);
    expect(clean).toMatch(/^[0-9a-f]{64}$/);
    expect(repositoryStateKey(root)).toBe(clean);

    writeFileSync(join(root, "src/a.ts"), "export const a = 2;\n");
    const modified = repositoryStateKey(root);
    expect(modified).not.toBe(clean);

    writeFileSync(join(root, "src/a.ts"), "export const a = 3;\n");
    expect(repositoryStateKey(root), "a second edit to an already-dirty file").not.toBe(modified);

    writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
    expect(repositoryStateKey(root), "reverting restores the key").toBe(clean);

    writeFileSync(join(root, "src/untracked.ts"), "export {};\n");
    expect(repositoryStateKey(root), "an untracked file is a different state").not.toBe(clean);
  }, BUDGET_MS);

  it("refuses a root that is not the top of a work tree — fixtures are never cached", () => {
    const root = repository();
    expect(repositoryStateKey(join(root, "src"))).toBeNull();
    const plain = realpathSync(mkdtempSync(join(tmpdir(), "analysis-cache-plain-")));
    roots.push(plain);
    expect(repositoryStateKey(plain)).toBeNull();
  }, BUDGET_MS);
});

describe("cachedAnalysis", () => {
  it("turns off for one run under the app's own variable", () => {
    const root = repository();
    let runs = 0;
    const compute = () => (runs += 1);
    vi.stubEnv("FIXTURE_GATE_NO_CACHE", "1");
    try {
      cachedAnalysis("probe-off", root, null, compute);
      cachedAnalysis("probe-off", root, null, compute);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(runs).toBe(2);
    cachedAnalysis("probe-off", root, null, compute);
    cachedAnalysis("probe-off", root, null, compute);
    expect(runs).toBe(3);
    expect(existsSync(join(root, "node_modules/.cache/fixture-gate/analysis"))).toBe(true);
  }, BUDGET_MS);

  it("computes once per state, again when the state or the inputs move", () => {
    const root = repository();
    let runs = 0;
    const shared = { path: "src/a.ts" };
    const compute = () => ({ runs: (runs += 1), all: [shared], production: [shared] });

    const first = cachedAnalysis("probe", root, { a: 1 }, compute, { disabled: false });
    const second = cachedAnalysis("probe", root, { a: 1 }, compute, { disabled: false });
    expect(first.runs).toBe(1);
    expect(second.runs).toBe(1);
    expect(second.all).toEqual([{ path: "src/a.ts" }]);
    expect(second.all[0], "one module in two lists is still one object").toBe(second.production[0]);

    expect(cachedAnalysis("probe", root, { a: 2 }, compute, { disabled: false }).runs).toBe(2);

    writeFileSync(join(root, "src/violation.ts"), "export {};\n");
    // A fresh process would recompute the state key; this one memoises it per
    // root, so ask through an injected exec, which bypasses the memo.
    /** @type {import("./analysis-cache.mjs").ExecFile} */
    const execFile = (file, args, options) => execFileSync(file, [...args], { ...options, stdio: "pipe" });
    expect(
      cachedAnalysis("probe", root, { a: 1 }, compute, { disabled: false, execFile }).runs,
      "a new file is a new state"
    ).toBe(3);
  }, BUDGET_MS);

  it("never caches a fixture root, and can be switched off", () => {
    const plain = realpathSync(mkdtempSync(join(tmpdir(), "analysis-cache-plain-")));
    roots.push(plain);
    let runs = 0;
    const compute = () => (runs += 1);
    cachedAnalysis("probe", plain, null, compute, { disabled: false });
    cachedAnalysis("probe", plain, null, compute, { disabled: false });
    expect(runs).toBe(2);

    const root = repository();
    cachedAnalysis("probe", root, null, compute, { disabled: true });
    cachedAnalysis("probe", root, null, compute, { disabled: true });
    expect(runs).toBe(4);
  }, BUDGET_MS);
});
