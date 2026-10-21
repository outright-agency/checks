// `outright-checks verify` — the full gate, run once per tree and one at a time per machine.
//
// Three things the bare chain (`verify.chain`, `pnpm verify:chain` by default) does not do:
//
// LANES. The app's lanes (`verify.lanes`) run side by side, a red short lane stops the long one,
// and every red lane's output is printed last. A lane that must run alone, before the others
// (`verify.first`: one that deletes and rebuilds a folder the others read), runs first.
//
// A RECEIPT. A pass is recorded against the git tree hash, in the repository's common git
// directory, which every checkout of the repository shares. A checkout that verified a tree has
// verified it for every other checkout holding the same tree, so their run finds the receipt and
// exits. Only a clean tree gets one — uncommitted work is not a tree anybody else can have.
//
// A LOCK. Several sessions verifying at once on one machine slow every one of them down. A second
// full verify waits for the first and says whom it is waiting on. The inner loop
// (`outright-checks check`) never takes the lock.
//
// CI has neither: a runner has no neighbours and no memory. Under `CI` this runs the chain,
// streamed.

import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  checkoutName,
  describeReceipt,
  describeWait,
  expiredReceipts,
  gateDirectory,
  isCleanTree,
  isStaleLock,
  receiptKey,
} from "./lib.mjs";

/** @typedef {import("../config.mjs").ResolvedConfig} ResolvedConfig */
/** @typedef {import("../config.mjs").Lane} Lane */
/** @typedef {import("node:child_process").ChildProcess} ChildProcess */
/** @typedef {{ name: string, stopped: boolean, code: number, seconds: number, output: string }} LaneResult */

const POLL_MS = 2_000;
const SIGNAL_EXIT_CODES = /** @type {const} */ ({ SIGHUP: 129, SIGINT: 130, SIGTERM: 143 });

/**
 * @param {{ cwd: string, config: ResolvedConfig, force?: boolean }} options
 * @returns {Promise<number>}
 */
export async function main({ cwd, config, force = false }) {
  /** @param {string[]} args */
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  // Every child runs in its own process group and is signalled as a group: a lane is
  // pnpm → sh → pnpm → tsc/vitest, and a signal sent to the pnpm at the top alone leaves the rest
  // running — an interrupted verify kept type-checking and then started the suite, with nobody
  // holding the lock. A terminal's Ctrl-C reaches only this process once a child is detached, so
  // this is the one path; a closed terminal (SIGHUP) takes it too.
  //
  // A listener replaces Node's own exit on that signal, so with no lane running (waiting for the
  // lock, or between the lock and the lanes) the run ends here: a verify stopped while it waited
  // would otherwise keep polling, take the lock and run the whole gate for nobody. The lock, when
  // this run holds it, is released on exit.
  /** @type {Set<ChildProcess>} */
  const children = new Set();
  for (const [signal, exitCode] of Object.entries(SIGNAL_EXIT_CODES)) {
    process.on(signal, () => {
      if (children.size === 0) process.exit(exitCode);
      for (const child of children) {
        try {
          process.kill(-(/** @type {number} */ (child.pid)), signal);
        } catch {
          // already gone
        }
      }
    });
  }

  /**
   * @param {string} script
   * @param {import("node:child_process").StdioOptions} stdio
   */
  function spawnGrouped(script, stdio) {
    const child = spawn("sh", ["-c", script], { cwd, stdio, detached: true });
    children.add(child);
    child.on("exit", () => children.delete(child));
    return child;
  }

  if (process.env.CI) {
    return new Promise((resolveExit) => {
      spawnGrouped(config.verify.chain, "inherit").on("exit", (code, signal) =>
        resolveExit(signal ? 1 : (code ?? 1))
      );
    });
  }

  // A red lane stops the LONG one: the gate has failed, and more suite would only delay saying
  // so. The short lanes run to the end, so one run reports a lint failure and a type error
  // together instead of one per attempt. A stopped lane is not reported as failed.
  /** @type {Set<ChildProcess>} */
  const longChildren = new Set();
  let stopping = false;

  function stopLongLanes() {
    stopping = true;
    for (const child of longChildren) {
      try {
        process.kill(-(/** @type {number} */ (child.pid)), "SIGTERM");
      } catch {
        // already gone
      }
    }
  }

  /** @param {Lane} lane @returns {Promise<LaneResult>} */
  function runLane({ name, run, long = false }) {
    return new Promise((resolveLane) => {
      const startedAt = Date.now();
      /** @type {Buffer[]} */
      const chunks = [];
      const child = spawnGrouped(run, ["ignore", "pipe", "pipe"]);
      if (long) longChildren.add(child);
      child.stdout?.on("data", (chunk) => chunks.push(chunk));
      child.stderr?.on("data", (chunk) => chunks.push(chunk));
      child.on("exit", (code, signal) => {
        longChildren.delete(child);
        const stopped = long && stopping && (signal !== null || code !== 0);
        const result = {
          name,
          stopped,
          code: signal ? 1 : (code ?? 1),
          seconds: Math.round((Date.now() - startedAt) / 1000),
          output: Buffer.concat(chunks).toString("utf8"),
        };
        const verdict = stopped ? "stopped" : result.code === 0 ? "passed" : "FAILED";
        console.log(`[verify] ${name} ${verdict} in ${result.seconds}s`);
        if (!stopped && result.code !== 0) stopLongLanes();
        resolveLane(result);
      });
    });
  }

  /** A passing lane says one line as it finishes; a failing one says everything, last. */
  async function runLanes() {
    /** @type {LaneResult[]} */
    const results = [];
    for (const lane of config.verify.first) {
      const result = await runLane(lane);
      results.push(result);
      if (result.code !== 0) break;
    }
    if (results.every((result) => result.code === 0)) {
      results.push(...(await Promise.all(config.verify.lanes.map(runLane))));
    }
    const failed = results.filter((result) => result.code !== 0 && !result.stopped);
    for (const result of failed) {
      console.log(`\n[verify] ── ${result.name} ──\n\n${result.output.trimEnd()}\n`);
    }
    if (failed.length === 0) {
      // The suite's totals and the ratchets' own summaries are the record of a pass.
      for (const result of results) {
        const summary = result.output
          .split("\n")
          .filter((line) => config.verify.summary.test(line))
          .map((line) => `  ${line.trim()}`);
        if (summary.length > 0) console.log(summary.join("\n"));
      }
    }
    return failed.length === 0 ? 0 : 1;
  }

  const gateDir = gateDirectory(git("rev-parse", "--git-common-dir"), cwd, config.gateFolder);
  const receiptsDir = join(gateDir, "receipts");
  const lockDir = join(gateDir, "lock");
  mkdirSync(receiptsDir, { recursive: true });

  // What is on disk now. Read again after the lock and after the run: a wait can last minutes and
  // a run tens of seconds, and a commit or a branch switch in between would otherwise let a
  // receipt stand for a tree that was never tested.
  const state = () => {
    const key = receiptKey({
      tree: git("rev-parse", "HEAD^{tree}"),
      nodeMajor: process.versions.node.split(".")[0],
    });
    return {
      clean: isCleanTree(git("status", "--porcelain")),
      key,
      receiptPath: join(receiptsDir, `${key}.json`),
    };
  };
  /** @param {{ clean: boolean, receiptPath: string }} at */
  const alreadyPassed = ({ clean, receiptPath }) => clean && !force && existsSync(receiptPath);
  /** @param {{ receiptPath: string }} at */
  const sayPassed = ({ receiptPath }) =>
    console.log(`[verify] ${describeReceipt(JSON.parse(readFileSync(receiptPath, "utf8")))}`);

  const before = state();
  if (alreadyPassed(before)) {
    sayPassed(before);
    return 0;
  }
  if (!before.clean) console.log("[verify] uncommitted changes — this run will not leave a receipt");

  await acquireLock(lockDir, cwd);
  const release = () => {
    if (readOwner(lockDir)?.pid === process.pid) rmSync(lockDir, { recursive: true, force: true });
  };
  process.on("exit", release);

  // The run we waited on may have been this very tree.
  const tested = state();
  if (alreadyPassed(tested)) {
    sayPassed(tested);
    return 0;
  }

  const startedAt = Date.now();
  const code = await runLanes();
  const after = state();
  if (code === 0 && tested.clean && after.clean && after.key === tested.key) {
    writeFileSync(
      tested.receiptPath,
      JSON.stringify(
        {
          tree: tested.key,
          head: git("rev-parse", "HEAD"),
          checkout: checkoutName(cwd),
          finishedAt: new Date().toISOString(),
          seconds: Math.round((Date.now() - startedAt) / 1000),
        },
        null,
        2
      )
    );
    pruneReceipts(receiptsDir);
  }
  return code;
}

/** @param {number} pid */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === "EPERM";
  }
}

/** @param {string} lockDir @returns {import("./lib.mjs").LockOwner | null} */
function readOwner(lockDir) {
  try {
    return JSON.parse(readFileSync(join(lockDir, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

/** @param {string} lockDir @param {string} cwd */
async function acquireLock(lockDir, cwd) {
  let lastMessage = "";
  for (;;) {
    try {
      mkdirSync(lockDir);
      writeFileSync(
        join(lockDir, "owner.json"),
        JSON.stringify({
          pid: process.pid,
          checkout: checkoutName(cwd),
          startedAt: new Date().toISOString(),
        })
      );
      return;
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") throw error;
    }
    const owner = readOwner(lockDir);
    let lockAgeMs = 0;
    try {
      lockAgeMs = Date.now() - statSync(lockDir).mtimeMs;
    } catch {
      continue; // released between the mkdir and the stat
    }
    if (isStaleLock({ owner, lockAgeMs, isAlive })) {
      rmSync(lockDir, { recursive: true, force: true });
      continue;
    }
    const message = describeWait(owner, Date.now());
    if (message.split(", running")[0] !== lastMessage.split(", running")[0]) {
      console.log(`[verify] ${message}`);
    }
    lastMessage = message;
    await new Promise((wake) => setTimeout(wake, POLL_MS));
  }
}

/** @param {string} receiptsDir */
function pruneReceipts(receiptsDir) {
  const entries = readdirSync(receiptsDir).map((name) => ({
    name,
    mtimeMs: statSync(join(receiptsDir, name)).mtimeMs,
  }));
  for (const name of expiredReceipts(entries, Date.now())) {
    rmSync(join(receiptsDir, name), { force: true });
  }
}
