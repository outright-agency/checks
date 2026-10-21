import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { git, removeScratchRepos, runChecks, scratchRepo, startChecks } from "../../test/support/scratch-repo.mjs";
import { gateDirectory } from "./lib.mjs";

afterEach(removeScratchRepos);

// Each test builds a scratch repository (three or four `git` calls) and runs the command one to
// three times, each a Node process that runs git and the steps or lanes in turn: a second or two
// quiet. On a ten-core machine at a load average of 50 to 100 the receipt test took over 5 s with
// nothing wrong in it. Each gets 20 s, which covers that and a two-core CI runner.
const BUDGET_MS = 20_000;

/** A config whose verify runs `lanes` (and `first`). @param {string} lanes @param {string} [extra] */
const config = (lanes, extra = "") => `export default {
  name: "fixture",
  check: { steps: [{ name: "none", run: "true" }] },
  verify: { ${extra} lanes: ${lanes} },
};
`;

/** @param {string} root */
const receipts = (root) => {
  const directory = join(gateDirectory(".git", root, "fixture-gate"), "receipts");
  return existsSync(directory) ? readdirSync(directory) : [];
};

describe("a verify waiting for the lock", () => {
  it.each(/** @type {const} */ ([
    ["SIGHUP", 129],
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]))("exits on %s with %i, without taking the lock", async (signal, expected) => {
    // The lock is held by this test process: a verify is never made to wait on a real one.
    const root = scratchRepo(config(`[{ name: "a", run: "true" }]`));
    const lockDir = join(gateDirectory(".git", root, "fixture-gate"), "lock");
    mkdirSync(lockDir, { recursive: true });
    const ownerPath = join(lockDir, "owner.json");
    writeFileSync(
      ownerPath,
      JSON.stringify({ pid: process.pid, checkout: "holder", startedAt: new Date().toISOString() })
    );

    const child = startChecks(root, ["verify"]);
    onTestFinished(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    });
    const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
    let output = "";
    await new Promise((resolve) => {
      child.on("exit", resolve);
      child.stderr?.on("data", (chunk) => (output += chunk));
      child.stdout?.on("data", (chunk) => {
        output += chunk;
        if (output.includes("waiting for the verify in holder")) resolve(undefined);
      });
    });
    expect(output).toContain("waiting for the verify in holder");
    child.kill(signal);

    expect(await exited).toBe(expected);
    expect(JSON.parse(readFileSync(ownerPath, "utf8")).pid).toBe(process.pid);
  }, BUDGET_MS);
});

describe("the tree after the lock", () => {
  it("tests and records the tree on disk when the lock comes free, not the one it waited with", async () => {
    // The lock is held by this test process. While the verify waits, a commit moves the tree; the
    // receipt must name the tree its lanes ran on.
    const root = scratchRepo(config(`[{ name: "a", run: "true" }]`));
    const lockDir = join(gateDirectory(".git", root, "fixture-gate"), "lock");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      join(lockDir, "owner.json"),
      JSON.stringify({ pid: process.pid, checkout: "holder", startedAt: new Date().toISOString() })
    );
    const waitedWith = git(root, "rev-parse", "HEAD^{tree}");

    const child = startChecks(root, ["verify"]);
    onTestFinished(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    });
    const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
    let output = "";
    await new Promise((resolve) => {
      child.stdout?.on("data", (chunk) => {
        output += chunk;
        if (output.includes("waiting for the verify in holder")) resolve(undefined);
      });
    });
    writeFileSync(join(root, "later.txt"), "later\n");
    git(root, "add", "later.txt");
    git(root, "commit", "-q", "-m", "later");
    const tested = git(root, "rev-parse", "HEAD^{tree}");
    rmSync(lockDir, { recursive: true, force: true });

    expect(await exited).toBe(0);
    const major = process.versions.node.split(".")[0];
    expect(receipts(root)).toEqual([`${tested}-node${major}.json`]);
    expect(tested).not.toBe(waitedWith);
  }, BUDGET_MS);
});

describe("the receipt", () => {
  it("leaves a receipt for a clean tree that passed, and skips the same tree next time", () => {
    const root = scratchRepo(config(`[{ name: "a", run: "true" }, { name: "b", run: "true", long: true }]`));
    const first = runChecks(root, ["verify"]);
    expect(first.code).toBe(0);
    const tree = git(root, "rev-parse", "HEAD^{tree}");
    expect(receipts(root)).toEqual([`${tree}-node${process.versions.node.split(".")[0]}.json`]);

    const second = runChecks(root, ["verify"]);
    expect(second.code).toBe(0);
    expect(second.output).toContain("same tree, skipping");

    const forced = runChecks(root, ["verify", "--force"]);
    expect(forced.output).toContain("[verify] a passed");
  }, BUDGET_MS);

  it("leaves no receipt when the tree moved during the run", () => {
    const moves =
      "echo moved > moved.txt && git add moved.txt && git -c user.name=t -c user.email=t@example.com -c commit.gpgsign=false commit -qm moved";
    const root = scratchRepo(config(`[{ name: "moves", run: ${JSON.stringify(moves)}, long: true }]`));
    const { code } = runChecks(root, ["verify"]);
    expect(code).toBe(0);
    expect(receipts(root)).toEqual([]);
  }, BUDGET_MS);

  it("leaves no receipt when the run left the tree dirty", () => {
    const root = scratchRepo(config(`[{ name: "dirties", run: "echo x > left-behind.txt" }]`));
    const { code } = runChecks(root, ["verify"]);
    expect(code).toBe(0);
    expect(receipts(root)).toEqual([]);
  }, BUDGET_MS);

  it("says a dirty tree will leave no receipt", () => {
    const root = scratchRepo(config(`[{ name: "a", run: "true" }]`));
    writeFileSync(join(root, "draft.txt"), "draft\n");
    const { code, output } = runChecks(root, ["verify"]);
    expect(code).toBe(0);
    expect(output).toContain("uncommitted changes — this run will not leave a receipt");
    expect(receipts(root)).toEqual([]);
  }, BUDGET_MS);
});

describe("the lanes", () => {
  it("runs the first lanes alone and stops the gate when one fails", () => {
    const root = scratchRepo(
      config(`[{ name: "later", run: "touch marker.txt" }]`, `first: [{ name: "packages", run: "exit 4" }],`)
    );
    const { code, output } = runChecks(root, ["verify"]);
    expect(code).toBe(1);
    expect(output).toContain("[verify] packages FAILED");
    expect(existsSync(join(root, "marker.txt"))).toBe(false);
  }, BUDGET_MS);

  it("stops the long lane when a short one fails, and reports it stopped, not failed", () => {
    const root = scratchRepo(
      config(`[{ name: "short", run: "echo short broke; exit 1" }, { name: "suite", run: "sleep 30", long: true }]`)
    );
    const startedAt = Date.now();
    const { code, output } = runChecks(root, ["verify"]);
    expect(code).toBe(1);
    expect(output).toContain("[verify] suite stopped");
    expect(output).toContain("[verify] ── short ──");
    expect(output).not.toContain("── suite ──");
    expect(Date.now() - startedAt).toBeLessThan(15_000);
  }, BUDGET_MS);

  it("reprints the summary lines of a pass, as the app's pattern picks them", () => {
    const root = scratchRepo(
      config(`[{ name: "a", run: "echo 'Widget check passed (3 widgets)'; echo noise" }]`, `summary: /check passed/,`)
    );
    const { output } = runChecks(root, ["verify"]);
    expect(output).toContain("  Widget check passed (3 widgets)");
    expect(output).not.toContain("noise");
  }, BUDGET_MS);

  it("runs the chain under CI", () => {
    const root = scratchRepo(config(`[{ name: "a", run: "touch marker.txt" }]`, `chain: "echo chained",`));
    const passed = runChecks(root, ["verify"], { CI: "1" });
    expect(passed.code).toBe(0);
    expect(passed.output).toContain("chained");
    expect(existsSync(join(root, "marker.txt"))).toBe(false);

    const failing = scratchRepo(config(`[{ name: "a", run: "true" }]`, `chain: "exit 3",`));
    expect(runChecks(failing, ["verify"], { CI: "1" }).code).toBe(3);
  }, BUDGET_MS);
});
