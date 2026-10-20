// The parts of the gate that decide something, kept free of I/O so they can be tested: what
// identifies a verified tree, when a lock is dead, what a waiter is told, which steps a change
// runs, and what the check's one test process did. `check.mjs` and `verify.mjs` do the spawning
// and the file system.

import { basename, isAbsolute, join, resolve } from "node:path";
import { ChecksConfigError } from "../config.mjs";

/** @typedef {import("../config.mjs").ResolvedConfig} ResolvedConfig */

/** Receipts older than this are pruned when a new one is written. */
export const RECEIPT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** A lock directory with no owner file yet is mid-acquire — unless it has sat this long. */
export const OWNERLESS_LOCK_GRACE_MS = 30_000;

/**
 * The two projects the check's one test process runs: `app`, narrowed to the tests the change
 * relates to, and `ratchets`, whole.
 */
export const CHECK_TEST_PROJECTS = ["app", "ratchets"];

/**
 * What a pass is a pass OF. The git tree hash covers every tracked byte — source, lockfile,
 * configs — and is the same in every checkout of the repository, so a pass in one checkout is a
 * pass in any other holding the same tree. Node's major rides along because the suite's behaviour
 * can move with it.
 * @param {{ tree: string, nodeMajor: string | number }} parts
 */
export function receiptKey({ tree, nodeMajor }) {
  if (!/^[0-9a-f]{40,64}$/.test(tree)) throw new Error(`not a tree hash: ${tree}`);
  return `${tree}-node${nodeMajor}`;
}

/** `git status --porcelain` output: anything at all, untracked included, is dirty. @param {string} porcelain */
export function isCleanTree(porcelain) {
  return porcelain.trim() === "";
}

/**
 * The folder that holds the gate's receipts and lock, in the git common directory every checkout
 * of the repository shares. `git rev-parse --git-common-dir` answers relative to the working
 * directory in the main checkout, and absolute in a linked worktree.
 * @param {string} commonDir
 * @param {string} cwd
 * @param {string} folder the app's gate folder (`<name>-gate`)
 */
export function gateDirectory(commonDir, cwd, folder) {
  const absolute = isAbsolute(commonDir) ? commonDir : resolve(cwd, commonDir);
  return join(absolute, folder);
}

/** @param {string} cwd */
export function checkoutName(cwd) {
  return basename(cwd);
}

/**
 * @typedef {object} LockOwner
 * @property {number} pid
 * @property {string} checkout
 * @property {string} startedAt
 */

/**
 * A lock is dead when its owner's process is gone, or when it never got an owner file and has
 * outlived the grace period (the acquirer died between the mkdir and the write).
 * @param {{ owner: LockOwner | null, lockAgeMs: number, isAlive: (pid: number) => boolean }} state
 */
export function isStaleLock({ owner, lockAgeMs, isAlive }) {
  if (owner === null) return lockAgeMs > OWNERLESS_LOCK_GRACE_MS;
  return !isAlive(owner.pid);
}

/** @param {LockOwner | null} owner @param {number} now */
export function describeWait(owner, now) {
  if (owner === null) return "another verify is starting";
  const seconds = Math.max(0, Math.round((now - Date.parse(owner.startedAt)) / 1000));
  return `waiting for the verify in ${owner.checkout} (pid ${owner.pid}, running ${seconds}s)`;
}

/** @param {{ finishedAt: string, checkout: string, seconds: number }} receipt */
export function describeReceipt(receipt) {
  return `verified ${receipt.finishedAt} in ${receipt.checkout} (${receipt.seconds}s) — same tree, skipping. --force runs it anyway.`;
}

/**
 * `git diff --name-only` and `git status --porcelain` output, as one path list.
 * @param {string} diffNames
 * @param {string} porcelain
 */
export function changedPaths(diffNames, porcelain) {
  const fromStatus = porcelain
    .split("\n")
    .filter((line) => line.length > 3)
    .flatMap((line) => line.slice(3).split(" -> "));
  return [...new Set([...diffNames.split("\n"), ...fromStatus].filter(Boolean))].sort();
}

/**
 * @typedef {{ name: string, command: string, chosen: boolean }} CommandStep
 * @typedef {{ name: "tests", tests: true }} TestsStep
 */

/**
 * The steps this change runs, in the app's order. A step whose `run` is a function is asked which
 * command the change needs (`chosen`, and the pass line names it), and sits the change out when
 * it answers `null`.
 * @param {ResolvedConfig} config
 * @param {string[]} changed
 * @returns {(CommandStep | TestsStep)[]}
 */
export function checkSteps(config, changed) {
  /** @type {(CommandStep | TestsStep)[]} */
  const steps = [];
  for (const step of config.check.steps) {
    if (step === "tests") {
      steps.push({ name: "tests", tests: true });
      continue;
    }
    if (typeof step.run === "string") {
      steps.push({ name: step.name, command: step.run, chosen: false });
      continue;
    }
    let command;
    try {
      command = step.run({ changed });
    } catch (error) {
      throw new ChecksConfigError(
        `check.steps "${step.name}" failed to choose a command: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (command !== null && command !== undefined) {
      steps.push({ name: step.name, command, chosen: true });
    }
  }
  return steps;
}

/**
 * What the one test process did, per project: how many test files ran and how many failed.
 * `modules` is each test module's project name and state, as vitest's run result gives them.
 * @param {{ project: string, state: string }[]} modules
 * @returns {Record<string, { files: number, failed: number }>}
 */
export function projectVerdicts(modules) {
  return Object.fromEntries(
    CHECK_TEST_PROJECTS.map((name) => {
      const own = modules.filter((module) => module.project === name);
      return [
        name,
        { files: own.length, failed: own.filter((module) => module.state === "failed").length },
      ];
    })
  );
}

/**
 * @typedef {object} StepResult
 * @property {string} name
 * @property {number} code
 * @property {string} seconds
 * @property {string} output
 * @property {number} [files]
 * @property {string} [command]
 */

/**
 * The check's test step is one vitest process for two projects. This turns its outcome back into
 * one result per project, so a red check still names app or ratchets. `reportText` is what
 * `check-tests.mjs` sent — `{ projects, unhandledErrors }` as JSON — and is empty when the process
 * ended before sending it; the step is then red as a whole.
 * @param {{ reportText: string, code: number, seconds: string, output: string }} outcome
 * @returns {StepResult[]}
 */
export function testStepResults({ reportText, code, seconds, output }) {
  let report = null;
  try {
    report = JSON.parse(reportText);
  } catch {
    // no report: the process died, or never reached the end of the run
  }
  if (!report?.projects) {
    return [{ name: CHECK_TEST_PROJECTS.join(" and "), code: code === 0 ? 1 : code, seconds, output }];
  }
  /** @type {StepResult[]} */
  const results = CHECK_TEST_PROJECTS.map((name) => ({
    name,
    files: report.projects[name]?.files ?? 0,
    code: (report.projects[name]?.failed ?? 0) > 0 ? 1 : 0,
    seconds,
    output,
  }));
  // Red outside any one project's files: an error no test file owns, or the process failing after
  // every file passed.
  if (report.unhandledErrors > 0) {
    results.push({ name: "an error outside any test file", code: 1, seconds, output });
  } else if (code !== 0 && results.every((result) => result.code === 0)) {
    results.push({ name: "vitest", code, seconds, output });
  }
  return results;
}

/**
 * Which receipt files to delete when writing a new one.
 * @param {{ name: string, mtimeMs: number }[]} entries
 * @param {number} now
 */
export function expiredReceipts(entries, now) {
  return entries.filter((entry) => now - entry.mtimeMs > RECEIPT_MAX_AGE_MS).map((e) => e.name);
}
