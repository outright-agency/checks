/**
 * What a pass is a pass OF. The git tree hash covers every tracked byte — source, lockfile,
 * configs — and is the same in every checkout of the repository, so a pass in one checkout is a
 * pass in any other holding the same tree. Node's major rides along because the suite's behaviour
 * can move with it.
 * @param {{ tree: string, nodeMajor: string | number }} parts
 */
export function receiptKey({ tree, nodeMajor }: {
    tree: string;
    nodeMajor: string | number;
}): string;
/** `git status --porcelain` output: anything at all, untracked included, is dirty. @param {string} porcelain */
export function isCleanTree(porcelain: string): boolean;
/**
 * The folder that holds the gate's receipts and lock, in the git common directory every checkout
 * of the repository shares. `git rev-parse --git-common-dir` answers relative to the working
 * directory in the main checkout, and absolute in a linked worktree.
 * @param {string} commonDir
 * @param {string} cwd
 * @param {string} folder the app's gate folder (`<name>-gate`)
 */
export function gateDirectory(commonDir: string, cwd: string, folder: string): string;
/** @param {string} cwd */
export function checkoutName(cwd: string): string;
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
export function isStaleLock({ owner, lockAgeMs, isAlive }: {
    owner: LockOwner | null;
    lockAgeMs: number;
    isAlive: (pid: number) => boolean;
}): boolean;
/** @param {LockOwner | null} owner @param {number} now */
export function describeWait(owner: LockOwner | null, now: number): string;
/** @param {{ finishedAt: string, checkout: string, seconds: number }} receipt */
export function describeReceipt(receipt: {
    finishedAt: string;
    checkout: string;
    seconds: number;
}): string;
/**
 * `git diff --name-only` and `git status --porcelain` output, as one path list.
 * @param {string} diffNames
 * @param {string} porcelain
 */
export function changedPaths(diffNames: string, porcelain: string): string[];
/**
 * @typedef {{ name: string, command: string, chosen: boolean }} CommandStep
 * @typedef {{ name: "tests", tests: true }} TestsStep
 */
/**
 * The steps this change runs, in the app's order. A step whose `run` is a function is asked which
 * command the change needs (`chosen`, and the pass line names it), and sits the change out when
 * it answers `null`; any answer that is not a command is a mistake in the config.
 * @param {ResolvedConfig} config
 * @param {string[]} changed
 * @returns {(CommandStep | TestsStep)[]}
 */
export function checkSteps(config: ResolvedConfig, changed: string[]): (CommandStep | TestsStep)[];
/**
 * What the one test process did, per project: how many test files ran and how many failed.
 * `modules` is each test module's project name and state, as vitest's run result gives them.
 * @param {{ project: string, state: string }[]} modules
 * @returns {Record<string, { files: number, failed: number }>}
 */
export function projectVerdicts(modules: {
    project: string;
    state: string;
}[]): Record<string, {
    files: number;
    failed: number;
}>;
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
export function testStepResults({ reportText, code, seconds, output }: {
    reportText: string;
    code: number;
    seconds: string;
    output: string;
}): StepResult[];
/**
 * Which receipt files to delete when writing a new one.
 * @param {{ name: string, mtimeMs: number }[]} entries
 * @param {number} now
 */
export function expiredReceipts(entries: {
    name: string;
    mtimeMs: number;
}[], now: number): string[];
/** @typedef {import("../config.mjs").ResolvedConfig} ResolvedConfig */
/** Receipts older than this are pruned when a new one is written. */
export const RECEIPT_MAX_AGE_MS: number;
/** A lock directory with no owner file yet is mid-acquire — unless it has sat this long. */
export const OWNERLESS_LOCK_GRACE_MS: 30000;
/**
 * The two projects the check's one test process runs: `app`, narrowed to the tests the change
 * relates to, and `ratchets`, whole.
 */
export const CHECK_TEST_PROJECTS: string[];
export type LockOwner = {
    pid: number;
    checkout: string;
    startedAt: string;
};
export type CommandStep = {
    name: string;
    command: string;
    chosen: boolean;
};
export type TestsStep = {
    name: "tests";
    tests: true;
};
export type StepResult = {
    name: string;
    code: number;
    seconds: string;
    output: string;
    files?: number | undefined;
    command?: string | undefined;
};
export type ResolvedConfig = import("../config.mjs").ResolvedConfig;
