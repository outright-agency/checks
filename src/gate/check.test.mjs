import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { git, removeScratchRepos, runChecks, scratchRepo } from "../../test/support/scratch-repo.mjs";

afterEach(removeScratchRepos);

// Each test builds a scratch repository (three or four `git` calls) and runs the command one to
// three times, each a Node process that runs git and the steps or lanes in turn: a second or two
// quiet. On a ten-core machine at a load average of 50 to 100 the receipt test took over 5 s with
// nothing wrong in it. Each gets 20 s, which covers that and a two-core CI runner.
const BUDGET_MS = 20_000;

/** A config whose check runs `steps` and whose verify is never called. @param {string} steps */
const config = (steps, extra = "") => `export default {
  name: "fixture",
  check: { ${extra} steps: ${steps} },
  verify: { lanes: [{ name: "none", run: "true" }] },
};
`;

describe("outright-checks check", () => {
  it("runs every step one after another, each even after one failed, and names every failure", () => {
    const root = scratchRepo(
      config(`[
        { name: "a", run: "sleep 0.3; echo a >> order.txt; echo one" },
        { name: "b", run: "echo b >> order.txt; echo broke; exit 3" },
        { name: "c", run: "echo c >> order.txt; echo three" },
      ]`),
      { ".gitignore": "order.txt\n" }
    );
    const { code, output } = runChecks(root, ["check"]);
    expect(code).toBe(1);
    expect(output).toMatch(/\[check\] a passed in [\d.]+s\n/);
    expect(output).toMatch(/\[check\] c passed in [\d.]+s\n/);
    expect(output).toMatch(/\[check\] b FAILED in [\d.]+s/);
    expect(output.indexOf("broke")).toBeGreaterThan(output.indexOf("[check] c passed"));
    expect(readFileSync(join(root, "order.txt"), "utf8")).toBe("a\nb\nc\n");
  }, BUDGET_MS);

  it("names the command a step chose, and leaves out a step that sits the change out", () => {
    const root = scratchRepo(
      config(`[
        { name: "pick", run: ({ changed }) => changed.includes("x.txt") ? "echo picked" : "echo plain" },
        { name: "only-docs", run: ({ changed }) => changed.some((p) => p.startsWith("docs/")) ? "true" : null },
      ]`)
    );
    writeFileSync(join(root, "x.txt"), "x\n");
    const { code, output } = runChecks(root, ["check"]);
    expect(code).toBe(0);
    expect(output).toMatch(/\[check\] pick passed in [\d.]+s — echo picked\n/);
    expect(output).not.toContain("only-docs");
  }, BUDGET_MS);

  it("stops before running anything when a required file is missing", () => {
    const root = scratchRepo(
      config(`[{ name: "a", run: "touch ran.txt" }]`, `requires: [{ path: "node_modules/x/bin/x", message: "run pnpm install" }],`)
    );
    const { code, output } = runChecks(root, ["check"]);
    expect(code).toBe(1);
    expect(output).toContain("[check] run pnpm install");
    expect(existsSync(join(root, "ran.txt"))).toBe(false);
  }, BUDGET_MS);

  it("stops on a config mistake with exit 2", () => {
    const root = scratchRepo(config(`[{ name: "a", run: "touch ran.txt" }]`, `stpes: [],`));
    const { code, output } = runChecks(root, ["check"]);
    expect(code).toBe(2);
    expect(output).toContain("[check] checks.config.mjs: unknown key check.stpes");
    expect(existsSync(join(root, "ran.txt"))).toBe(false);
  }, BUDGET_MS);

  it("stops with exit 2 when a step's function throws or chooses no command, before any step runs", () => {
    for (const [run, message] of [
      ['() => { throw new Error("x"); }', 'check.steps "b" failed to choose a command: x'],
      ["({ changed }) => changed.includes('nothing') && 'pnpm x'", 'check.steps "b" chose no command: got false'],
    ]) {
      const root = scratchRepo(config(`[{ name: "a", run: "touch ran.txt" }, { name: "b", run: ${run} }]`));
      const { code, output } = runChecks(root, ["check"]);
      expect(code).toBe(2);
      expect(output).toContain(`[check] checks.config.mjs: ${message}`);
      expect(existsSync(join(root, "ran.txt"))).toBe(false);
    }
  }, BUDGET_MS);

  it("names the chosen command on a failing step's line too", () => {
    const root = scratchRepo(config(`[{ name: "pick", run: () => "echo nope; exit 1" }]`));
    const { code, output } = runChecks(root, ["check"]);
    expect(code).toBe(1);
    expect(output).toMatch(/\[check\] pick FAILED in [\d.]+s — echo nope; exit 1\n/);
  }, BUDGET_MS);

  it("says what to do in a repository with no commit", () => {
    const root = scratchRepo(config(`[{ name: "a", run: "touch ran.txt" }]`));
    rmSync(join(root, ".git"), { recursive: true, force: true });
    git(root, "init", "-q", "-b", "main");
    const { code, output } = runChecks(root, ["check"]);
    expect(code).toBe(1);
    expect(output).toContain("[check] the repository has no commit yet");
    expect(existsSync(join(root, "ran.txt"))).toBe(false);
  }, BUDGET_MS);

  it("compares a first commit with itself", () => {
    const root = scratchRepo(config(`[{ name: "a", run: "true" }]`));
    const { code, output } = runChecks(root, ["check"]);
    expect(code).toBe(0);
    expect(output).toMatch(/\[check\] a passed/);
  }, BUDGET_MS);
});
