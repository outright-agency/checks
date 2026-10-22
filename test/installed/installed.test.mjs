// The package installed from git into a fixture app, the way an app installs it from GitHub: the
// commit at HEAD (commit before running this), packed by pnpm by its `files`, into an app with no
// module type, a TypeScript Vitest config and tsx scripts.

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanEnv, git } from "../support/scratch-repo.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./app", import.meta.url));

/** @type {string} */
let app;

/**
 * Runs a command in the app, never under CI unless asked: under CI the verify runs the chain and
 * leaves no receipt.
 * @param {string} command
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 */
function inApp(command, args, env = {}) {
  const options = { cwd: app, env: cleanEnv(env), encoding: /** @type {const} */ ("utf8") };
  // On Windows pnpm is `pnpm.cmd`, which only a shell runs: one command line, each argument quoted
  // for cmd.exe (Node deprecates an argument list beside a shell). The command itself is not: a
  // batch file called by a quoted name from PATH misreads its own folder.
  const run =
    process.platform === "win32"
      ? spawnSync([command, ...args.map((arg) => `"${arg}"`)].join(" "), { ...options, shell: true })
      : spawnSync(command, args, options);
  return { code: run.status, output: `${run.stdout}${run.stderr}` };
}

// A cold `pnpm install` of Vitest, TypeScript, tsx, jsdom, React and Testing Library from the
// registry, then the package from git: about 10 s with a warm store, up to a minute on a cold CI
// runner. Each run of the check or the verify starts a Vitest and a TypeScript of its own: a few
// seconds quiet, ten or more on a loaded machine.
const INSTALL_BUDGET_MS = 120_000;
const RUN_BUDGET_MS = 60_000;

beforeAll(() => {
  // `.native`: on Windows the temporary folder is spelled by its 8.3 short name (`C:\PROGRA~1`),
  // which Vite and Vitest spell out, so an app opened by it would see its own files under two
  // names. A developer's checkout is opened by its own.
  app = join(realpathSync.native(mkdtempSync(join(tmpdir(), "checks-installed-"))), "app");
  cpSync(FIXTURE, app, { recursive: true });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: PACKAGE_ROOT, encoding: "utf8" }).trim();
  const install = inApp("pnpm", [
    "add",
    "-D",
    `git+${pathToFileURL(PACKAGE_ROOT).href}#${head}`,
    "vitest@4.1.11",
    "typescript@5.9.3",
    "tsx@^4.23.12",
    "@types/node@^22",
    "jsdom@^27",
    "react@^19",
    "react-dom@^19",
    "@testing-library/react@^16",
    "@testing-library/dom@^10",
  ]);
  if (install.code !== 0) throw new Error(`pnpm add failed:\n${install.output}`);
  git(app, "init", "-q", "-b", "main");
  git(app, "add", "-A");
  git(app, "commit", "-q", "-m", "the app");
}, INSTALL_BUDGET_MS);

afterAll(() => {
  if (app) rmSync(join(app, ".."), { recursive: true, force: true });
});

describe("the package, installed from git", () => {
  it("installs only what files names", () => {
    const installed = join(app, "node_modules/@outright/checks");
    const listing = readdirSync(installed, { recursive: true }).map(String);
    expect(listing.some((path) => path.endsWith(".test.mjs"))).toBe(false);
    expect(existsSync(join(installed, "test"))).toBe(false);
    expect(existsSync(join(installed, "types/config.d.mts"))).toBe(true);
    expect(existsSync(join(app, "node_modules/.bin/outright-checks"))).toBe(true);
  });

  it("runs the check through the installed command", () => {
    const { code, output } = inApp("pnpm", ["exec", "outright-checks", "check"]);
    expect(output).toMatch(/\[check\] types passed in/);
    expect(output).toMatch(/\[check\] app passed in [\d.]+s — \d+ test files?/);
    expect(output).toMatch(/\[check\] ratchets passed in [\d.]+s — 1 test file/);
    expect(code).toBe(0);
  }, RUN_BUDGET_MS);

  it("loads the helpers and the config under tsx in an app without a module type", () => {
    const { code, output } = inApp("pnpm", ["exec", "tsx", "scripts/ratchets.ts"]);
    expect(output).toContain("Files ratchet passed (3 files, src/sum.ts, fixture-app).");
    expect(output).toContain("Tests ratchet passed (4 test files, 1 in a DOM).");
    expect(code).toBe(0);
  }, RUN_BUDGET_MS);

  it("waits 3 s for Testing Library on CI, and 1 s elsewhere", () => {
    for (const env of /** @type {Record<string, string>[]} */ ([{ CI: "true" }, {}])) {
      const { code, output } = inApp("pnpm", ["exec", "vitest", "run", "src/view.test.tsx"], env);
      expect(output, JSON.stringify(env)).toContain("1 passed");
      expect(code, JSON.stringify(env)).toBe(0);
    }
  }, RUN_BUDGET_MS);

  it("fails a one-worker run from the setup file in node_modules", () => {
    const { code, output } = inApp(
      "pnpm",
      ["exec", "vitest", "run", "--config", "vitest.bare.config.ts"],
      { VITEST_MAX_WORKERS: "1" }
    );
    expect(output).toContain("Two test files ran in one VM context");
    expect(code).not.toBe(0);
  }, RUN_BUDGET_MS);

  it("leaves a receipt through the installed verify", () => {
    const { code, output } = inApp("pnpm", ["exec", "outright-checks", "verify"]);
    expect(output).toContain("[verify] types passed");
    expect(output).toContain("[verify] suite passed");
    expect(code).toBe(0);
    const receipts = readdirSync(join(app, ".git/fixture-app-gate/receipts"));
    expect(receipts).toEqual([`${git(app, "rev-parse", "HEAD^{tree}")}-node${process.versions.node.split(".")[0]}.json`]);
  }, RUN_BUDGET_MS);

  it("names app when an app test fails", () => {
    writeFileSync(join(app, "src/sum.ts"), "export const sum = (a: number, b: number): number => a - b;\n");
    git(app, "commit", "-q", "-am", "break sum");
    const { code, output } = inApp("pnpm", ["exec", "outright-checks", "check"]);
    expect(output).toContain("[check] app FAILED");
    expect(output).toMatch(/\[check\] ratchets passed/);
    expect(code).toBe(1);
    expect(readFileSync(join(app, "src/sum.ts"), "utf8")).toContain("a - b");
  }, RUN_BUDGET_MS);
});
