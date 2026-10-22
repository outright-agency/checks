// Scratch git repositories for the tests that run the command the way an app does: a folder with
// a `checks.config.mjs`, committed, and the command spawned in it.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const BIN = fileURLToPath(new URL("../../bin/outright-checks.mjs", import.meta.url));

/** @type {string[]} */
const made = [];

/**
 * The environment a command runs in: never CI's, unless a test sets it, and none of the
 * running suite's own.
 * @param {Record<string, string>} [extra]
 */
export function cleanEnv(extra = {}) {
  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env, ...extra };
  if (!("CI" in extra)) delete env.CI;
  delete env.VITEST;
  delete env.VITEST_WORKER_ID;
  delete env.VITEST_POOL_ID;
  delete env.OUTRIGHT_CHECKS_MAX_WORKERS; // the preset's own copy of VITEST_MAX_WORKERS
  delete env.NODE_OPTIONS;
  return env;
}

/** @param {string} cwd @param {string[]} args */
export function git(cwd, ...args) {
  return execFileSync(
    "git",
    ["-c", "user.name=checks-test", "-c", "user.email=checks-test@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  ).trim();
}

/**
 * A repository holding `checks.config.mjs` (its source text) and `files`, committed once.
 * @param {string} config
 * @param {Record<string, string>} [files]
 */
export function scratchRepo(config, files = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "checks-repo-")));
  made.push(root);
  git(root, "init", "-q", "-b", "main");
  for (const [path, text] of Object.entries({ "checks.config.mjs": config, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

/** Commits everything in the repository. @param {string} root @param {string} message */
export function commitAll(root, message) {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
}

/**
 * Runs the command to its end.
 * @param {string} cwd
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 */
export function runChecks(cwd, args, env = {}) {
  const run = spawnSync(process.execPath, [BIN, ...args], { cwd, env: cleanEnv(env), encoding: "utf8" });
  return { code: run.status, output: `${run.stdout}${run.stderr}` };
}

/**
 * Starts the command and hands back the child.
 * @param {string} cwd
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 */
export function startChecks(cwd, args, env = {}) {
  return spawn(process.execPath, [BIN, ...args], { cwd, env: cleanEnv(env), stdio: ["ignore", "pipe", "pipe"] });
}

export function removeScratchRepos() {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
}
