/**
 * Why a run goes on with no slot, or `null` when it asks the client for one.
 * @param {NodeJS.ProcessEnv} env
 * @param {(file: string) => boolean} [exists]
 * @returns {string | null}
 */
export function passReason(env: NodeJS.ProcessEnv, exists?: (file: string) => boolean): string | null;
/**
 * The command that runs this process again under the slot: the pnpm script that ran it, when it is
 * the bin's own (`outright-checks <command>`), so `slot status` reads `pnpm check`; otherwise this
 * process's own command line, its script by its path from the folder when it lies inside it.
 * @param {{ argv: string[], env: NodeJS.ProcessEnv, cwd: string, execPath: string }} at
 * @returns {string[]}
 */
export function rerunCommand({ argv, env, cwd, execPath }: {
    argv: string[];
    env: NodeJS.ProcessEnv;
    cwd: string;
    execPath: string;
}): string[];
/**
 * Takes a slot for this process, every slot with `all`. Returns at once when the run goes
 * on here; otherwise runs this process again through the client and exits with its code.
 * @param {{ all?: boolean, env?: NodeJS.ProcessEnv, cwd?: string }} [options]
 */
export function takeSlot({ all, env, cwd }?: {
    all?: boolean;
    env?: NodeJS.ProcessEnv;
    cwd?: string;
}): Promise<undefined>;
/**
 * `outright-checks slot [--all] -- <command…>`: runs the command under a slot, or at once
 * where takeSlot() would go on, and when it names a test file. Resolves with its exit code.
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<number>}
 */
export function runUnderSlot(args: string[], env?: NodeJS.ProcessEnv): Promise<number>;
/** What `outright-checks slot` says, and exits 2 on, when it isn't given a command. */
export const SLOT_USAGE: "usage: outright-checks slot [--all] -- <command\u2026>";
export function slotClient(env: NodeJS.ProcessEnv): string;
export function namesTestFile(args: string[]): boolean;
