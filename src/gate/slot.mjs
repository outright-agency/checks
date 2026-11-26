// A slot (`outright-checks slot`, and the waits in `check` and `verify`). On a machine many
// sessions share, a slot service hands out a few slots to every heavy run, over every repository
// and checkout, in one line; its client is `~/.system/bin/slot` (`slot [--all] -- <command…>`, and
// `slot status`, `slot mine` to see the line and one's own runs). `check` takes one slot, `verify`
// every slot, and an app's suites and build take one through `outright-checks slot -- <command…>`.
//
// The client runs a command, never a part of one: so takeSlot() runs this same process again
// through it, says nothing of its own, and exits with the client's code. The client prints where
// the run waits and its end on stderr, and the run's output on stdout; the session that started
// the run is woken when it ends. The run again, under SLOT_TICKET, goes on past takeSlot() as if
// it had never waited, and what it starts inherits SLOT_TICKET and passes under its slot. When the
// client passes through (its queue off, a repository that doesn't take part, its service down) it
// runs the command with no SLOT_TICKET, so the run also carries OUTRIGHT_CHECKS_UNDER_SLOT and
// never goes through the client twice.
//
// It passes straight through under CI, under a slot already, and wherever the client doesn't
// exist, which is every machine without the service. OUTRIGHT_SLOT_CLIENT names another client,
// for a test.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { constants, homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { NO_SHELL, gateShell } from "./shell.mjs";

const UNDER_SLOT = "OUTRIGHT_CHECKS_UNDER_SLOT";

/** What `outright-checks slot` says, and exits 2 on, when it isn't given a command. */
export const SLOT_USAGE = "usage: outright-checks slot [--all] -- <command…>";

/** The slot client: `~/.system/bin/slot`, or OUTRIGHT_SLOT_CLIENT. @param {NodeJS.ProcessEnv} env */
export const slotClient = (env) => env.OUTRIGHT_SLOT_CLIENT || join(homedir(), ".system/bin/slot");

/**
 * Why a run goes on with no slot, or `null` when it asks the client for one.
 * @param {NodeJS.ProcessEnv} env
 * @param {(file: string) => boolean} [exists]
 * @returns {string | null}
 */
export function passReason(env, exists = existsSync) {
  if (env.CI) return "CI is set";
  if (env.SLOT_TICKET) return "already under a slot";
  if (env[UNDER_SLOT]) return "the slot client passed it through";
  if (!exists(slotClient(env))) return "no slot client on this machine";
  return null;
}

/** Whether a command names a test file: a single file takes no slot. @param {string[]} args */
export const namesTestFile = (args) => args.some((arg) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(arg));

/**
 * The command that runs this process again under the slot: the pnpm script that ran it, when it is
 * the bin's own (`outright-checks <command>`), so `slot status` reads `pnpm check`; otherwise this
 * process's own command line, its script by its path from the folder when it lies inside it.
 * @param {{ argv: string[], env: NodeJS.ProcessEnv, cwd: string, execPath: string }} at
 * @returns {string[]}
 */
export function rerunCommand({ argv, env, cwd, execPath }) {
  const [, script, command, ...rest] = argv;
  const event = env.npm_lifecycle_event;
  if (event && env.npm_config_user_agent?.startsWith("pnpm/") && env.npm_lifecycle_script?.trim() === `outright-checks ${command}`) {
    return ["pnpm", event, ...rest];
  }
  const fromHere = relative(cwd, script);
  const shown = fromHere && !fromHere.startsWith("..") && !isAbsolute(fromHere) ? fromHere : script;
  return [execPath, shown, command, ...rest];
}

/**
 * Starts a command with the terminal's stdio and resolves with its exit code, or `null` when it
 * didn't start. A Ctrl-C reaches the child too, which decides what it means (the client cancels the
 * run and says so): this process waits for its word.
 * @param {string} file @param {string[]} args @param {NodeJS.ProcessEnv} env
 * @returns {Promise<number | null>}
 */
function follow(file, args, env) {
  const hold = () => {};
  process.on("SIGINT", hold);
  return new Promise((resolveExit) => {
    const child = spawn(file, args, { stdio: "inherit", env });
    child.on("error", (error) => {
      process.off("SIGINT", hold);
      process.stderr.write(`slot · ${file} didn't start (${/** @type {NodeJS.ErrnoException} */ (error).code ?? error.message})\n`);
      resolveExit(null);
    });
    child.on("exit", (code, signal) => {
      process.off("SIGINT", hold);
      resolveExit(code ?? 128 + (signal ? constants.signals[signal] ?? 0 : 0));
    });
  });
}

/**
 * Takes a slot for this process, every slot with `all`. Returns at once when the run goes
 * on here; otherwise runs this process again through the client and exits with its code.
 * @param {{ all?: boolean, env?: NodeJS.ProcessEnv, cwd?: string }} [options]
 */
export async function takeSlot({ all = false, env = process.env, cwd = process.cwd() } = {}) {
  if (passReason(env) !== null) return;
  const command = rerunCommand({ argv: process.argv, env, cwd, execPath: process.execPath });
  const code = await follow(slotClient(env), [...(all ? ["--all"] : []), "--", ...command], { ...env, [UNDER_SLOT]: "1" });
  // A client that can't start leaves the run to go on here, as no client would.
  if (code === null) return void process.stderr.write("slot · running without a slot\n");
  process.exit(code);
}

/**
 * `outright-checks slot [--all] -- <command…>`: runs the command under a slot, or at once
 * where takeSlot() would go on, and when it names a test file. Resolves with its exit code.
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<number>}
 */
export async function runUnderSlot(args, env = process.env) {
  const dash = args.indexOf("--");
  const flags = dash < 0 ? args : args.slice(0, dash);
  const command = dash < 0 ? [] : args.slice(dash + 1);
  if (command.length === 0 || flags.some((flag) => flag !== "--all")) {
    console.error(SLOT_USAGE);
    return 2;
  }
  if (passReason(env) === null && !namesTestFile(command)) {
    const code = await follow(slotClient(env), [...flags, "--", ...command], { ...env, [UNDER_SLOT]: "1" });
    if (code !== null) return code;
    process.stderr.write("slot · running without a slot\n");
  }
  if (process.platform !== "win32") return (await follow(command[0], command.slice(1), env)) ?? 127;
  // Windows: an app's bins are `.cmd` files, which only a shell starts; Git's sh runs the command as given.
  const shell = gateShell();
  if (shell === null) {
    console.error(`[slot] ${NO_SHELL}`);
    return 1;
  }
  return (await follow(shell, ["-c", 'exec "$@"', "sh", ...command], env)) ?? 127;
}
