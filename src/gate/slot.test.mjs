import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BIN, removeScratchRepos, runChecks, scratchRepo } from "../../test/support/scratch-repo.mjs";
import { namesTestFile, passReason, rerunCommand, slotClient } from "./slot.mjs";

afterEach(removeScratchRepos);

// As check.test.mjs: each command test runs the bin in a scratch repository, a second or two
// quiet and far more on a loaded machine.
const BUDGET_MS = 20_000;

describe("passReason", () => {
  const client = (/** @type {boolean} */ exists) => () => exists;
  it("passes under CI, under a slot, after the client passed it through, and with no client", () => {
    expect(passReason({ CI: "true" }, client(true))).toBe("CI is set");
    expect(passReason({ SLOT_TICKET: "t-1" }, client(true))).toBe("already under a slot");
    expect(passReason({ OUTRIGHT_CHECKS_UNDER_SLOT: "1" }, client(true))).toBe("the slot client passed it through");
    expect(passReason({}, client(false))).toBe("no slot client on this machine");
  });
  it("asks for a slot otherwise", () => {
    expect(passReason({}, client(true))).toBeNull();
  });
});

describe("slotClient", () => {
  it("is ~/.system/bin/slot unless OUTRIGHT_SLOT_CLIENT names another", () => {
    expect(slotClient({})).toBe(join(homedir(), ".system/bin/slot"));
    expect(slotClient({ OUTRIGHT_SLOT_CLIENT: "/x/slot" })).toBe("/x/slot");
  });
});

describe("namesTestFile", () => {
  it("is true for a run that names a test file, which takes no slot", () => {
    expect(namesTestFile(["nice", "-n", "10", "vitest", "run", "src/a/b.test.ts"])).toBe(true);
    expect(namesTestFile(["vitest", "run", "--project", "db-*", "src/x.db.test.ts"])).toBe(true);
    expect(namesTestFile(["vitest", "run", "src/y.spec.tsx"])).toBe(true);
  });
  it("is false for a whole suite, a folder or a build", () => {
    expect(namesTestFile(["nice", "-n", "10", "vitest", "run"])).toBe(false);
    expect(namesTestFile(["vitest", "run", "src/platform"])).toBe(false);
    expect(namesTestFile(["next", "build"])).toBe(false);
  });
});

describe("rerunCommand", () => {
  const pnpm = { npm_config_user_agent: "pnpm/10.30.2 npm/? node/v22.20.0 darwin arm64" };
  const script = "/repo/node_modules/.pnpm/x/node_modules/@outright/checks/bin/outright-checks.mjs";
  it("is the pnpm script when pnpm ran the bin's own script, so slot status reads pnpm check", () => {
    const env = { ...pnpm, npm_lifecycle_event: "check", npm_lifecycle_script: "outright-checks check" };
    expect(rerunCommand({ argv: ["/n/node", script, "check"], env, cwd: "/repo", execPath: "/n/node" })).toEqual(["pnpm", "check"]);
    const verify = { ...pnpm, npm_lifecycle_event: "gate", npm_lifecycle_script: "outright-checks verify" };
    expect(rerunCommand({ argv: ["/n/node", script, "verify", "--force"], env: verify, cwd: "/repo", execPath: "/n/node" })).toEqual([
      "pnpm",
      "gate",
      "--force",
    ]);
  });
  it("is this process again otherwise, its script by its path from the folder", () => {
    const other = { ...pnpm, npm_lifecycle_event: "check", npm_lifecycle_script: "pnpm lint && outright-checks check" };
    expect(rerunCommand({ argv: ["/n/node", "/repo/bin/outright-checks.mjs", "check"], env: other, cwd: "/repo", execPath: "/n/node" })).toEqual([
      "/n/node",
      join("bin", "outright-checks.mjs"),
      "check",
    ]);
    expect(rerunCommand({ argv: ["/n/node", script, "check"], env: {}, cwd: "/elsewhere", execPath: "/n/node" })).toEqual(["/n/node", script, "check"]);
  });
});

// A client that records what it was asked and runs the command under a ticket, as the real one does.
const FAKE_CLIENT = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_SLOT_LOG, JSON.stringify({ args, marker: process.env.OUTRIGHT_CHECKS_UNDER_SLOT ?? null }) + "\\n");
const [command, ...rest] = args.slice(args.indexOf("--") + 1);
const run = spawnSync(command, rest, { stdio: "inherit", env: { ...process.env, SLOT_TICKET: "t-fake" } });
process.exit(run.status ?? 1);
`;

/** @type {string[]} */
const clients = [];
afterEach(() => {
  for (const dir of clients.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fake client and the environment that points the command at it. */
function fakeClient() {
  const dir = mkdtempSync(join(tmpdir(), "checks-slot-"));
  clients.push(dir);
  const client = join(dir, "slot");
  writeFileSync(client, FAKE_CLIENT);
  chmodSync(client, 0o755);
  const log = join(dir, "asked.jsonl");
  /** @returns {{ args: string[], marker: string | null }[]} */
  const asked = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []);
  return { env: { OUTRIGHT_SLOT_CLIENT: client, FAKE_SLOT_LOG: log }, asked };
}

/** @param {string} steps @param {string} [lanes] */
const config = (steps, lanes = `[{ name: "lane", run: "echo laned >> ran.txt" }]`) => `export default {
  name: "fixture",
  check: { steps: ${steps} },
  verify: { lanes: ${lanes} },
};
`;

// The client is a script with a shebang, which Windows can't start; and on Windows there is no client.
describe.skipIf(process.platform === "win32")("with a slot client", () => {
  it("check asks for one slot, runs its steps once under it, and exits with their code", () => {
    const root = scratchRepo(config(`[{ name: "a", run: "echo a >> ran.txt; exit 3" }]`), { ".gitignore": "ran.txt\n" });
    const { env, asked } = fakeClient();
    const { code, output } = runChecks(root, ["check"], env);
    expect(code).toBe(1);
    expect(output).toMatch(/\[check\] a FAILED/);
    expect(asked()).toEqual([{ args: ["--", process.execPath, BIN, "check"], marker: "1" }]);
    expect(readFileSync(join(root, "ran.txt"), "utf8")).toBe("a\n");
  }, BUDGET_MS);

  it("verify asks for every slot, and a tree it already verified asks for none", () => {
    const root = scratchRepo(config(`[{ name: "a", run: "true" }]`), { ".gitignore": "ran.txt\n" });
    const { env, asked } = fakeClient();
    expect(runChecks(root, ["verify"], env).code).toBe(0);
    expect(asked().map(({ args }) => args)).toEqual([["--all", "--", process.execPath, BIN, "verify"]]);
    const again = runChecks(root, ["verify"], env);
    expect(again.code).toBe(0);
    expect(again.output).toContain("same tree, skipping");
    expect(asked()).toHaveLength(1);
    expect(readFileSync(join(root, "ran.txt"), "utf8")).toBe("laned\n");
  }, BUDGET_MS);

  it("under CI or a slot already, check and verify ask nothing", () => {
    const root = scratchRepo(config(`[{ name: "a", run: "true" }]`, `[{ name: "lane", run: "true" }]`));
    const { env, asked } = fakeClient();
    expect(runChecks(root, ["check"], { ...env, CI: "true" }).code).toBe(0);
    expect(runChecks(root, ["check"], { ...env, SLOT_TICKET: "t-1" }).code).toBe(0);
    expect(runChecks(root, ["verify"], { ...env, SLOT_TICKET: "t-1" }).code).toBe(0);
    const chained = scratchRepo(config(`[{ name: "a", run: "true" }]`).replace("verify: {", `verify: { chain: "true",`));
    expect(runChecks(chained, ["verify"], { ...env, CI: "true" }).code).toBe(0);
    expect(asked()).toEqual([]);
  }, BUDGET_MS);

  it("slot runs a command through the client, every slot with --all, and exits with its code", () => {
    const root = scratchRepo(config(`[{ name: "a", run: "true" }]`));
    const { env, asked } = fakeClient();
    expect(runChecks(root, ["slot", "--", "sh", "-c", "exit 7"], env).code).toBe(7);
    expect(runChecks(root, ["slot", "--all", "--", "true"], env).code).toBe(0);
    expect(asked()).toEqual([
      { args: ["--", "sh", "-c", "exit 7"], marker: "1" },
      { args: ["--all", "--", "true"], marker: "1" },
    ]);
  }, BUDGET_MS);

  it("slot runs a command naming a test file, or one under a slot already, at once", () => {
    const root = scratchRepo(config(`[{ name: "a", run: "true" }]`));
    const { env, asked } = fakeClient();
    const file = runChecks(root, ["slot", "--", "echo", "src/a.test.ts"], env);
    expect(file.code).toBe(0);
    expect(file.output).toContain("src/a.test.ts");
    expect(runChecks(root, ["slot", "--", "true"], { ...env, SLOT_TICKET: "t-1" }).code).toBe(0);
    expect(asked()).toEqual([]);
  }, BUDGET_MS);
});

describe("with no slot client", () => {
  it("check, verify and slot run at once", () => {
    const root = scratchRepo(config(`[{ name: "a", run: "true" }]`, `[{ name: "lane", run: "true" }]`));
    expect(runChecks(root, ["check"]).output).toMatch(/\[check\] a passed/);
    expect(runChecks(root, ["verify"]).code).toBe(0);
    expect(runChecks(root, ["slot", "--", "sh", "-c", "exit 4"]).code).toBe(4);
  }, BUDGET_MS);

  it("slot without a command prints its usage and exits 2", () => {
    const root = scratchRepo(config(`[{ name: "a", run: "true" }]`));
    for (const args of [["slot"], ["slot", "--"], ["slot", "--every", "--", "true"], ["slot", "true"]]) {
      const { code, output } = runChecks(root, args);
      expect(code).toBe(2);
      expect(output).toContain("usage: outright-checks slot [--all] -- <command…>");
    }
  }, BUDGET_MS);
});
