import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeScratchRepos, runChecks, scratchRepo } from "../../test/support/scratch-repo.mjs";

afterEach(removeScratchRepos);

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
  });

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
  });

  it("stops before running anything when a required file is missing", () => {
    const root = scratchRepo(
      config(`[{ name: "a", run: "touch ran.txt" }]`, `requires: [{ path: "node_modules/x/bin/x", message: "run pnpm install" }],`)
    );
    const { code, output } = runChecks(root, ["check"]);
    expect(code).toBe(1);
    expect(output).toContain("[check] run pnpm install");
    expect(existsSync(join(root, "ran.txt"))).toBe(false);
  });

  it("stops on a config mistake with exit 2", () => {
    const root = scratchRepo(config(`[{ name: "a", run: "touch ran.txt" }]`, `stpes: [],`));
    const { code, output } = runChecks(root, ["check"]);
    expect(code).toBe(2);
    expect(output).toContain("[check] checks.config.mjs: unknown key check.stpes");
    expect(existsSync(join(root, "ran.txt"))).toBe(false);
  });

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
  });

  it("names the chosen command on a failing step's line too", () => {
    const root = scratchRepo(config(`[{ name: "pick", run: () => "echo nope; exit 1" }]`));
    const { code, output } = runChecks(root, ["check"]);
    expect(code).toBe(1);
    expect(output).toMatch(/\[check\] pick FAILED in [\d.]+s — echo nope; exit 1\n/);
  });

  it("compares a first commit with itself", () => {
    const root = scratchRepo(config(`[{ name: "a", run: "true" }]`));
    const { code, output } = runChecks(root, ["check"]);
    expect(code).toBe(0);
    expect(output).toMatch(/\[check\] a passed/);
  });
});
