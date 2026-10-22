/**
 * @typedef {object} ShellWhere
 * @property {NodeJS.Platform} platform
 * @property {string} path the PATH the commands run with
 * @property {() => string | null} gitExecPath `git --exec-path`, asked only when it is needed
 * @property {(file: string) => boolean} exists
 */
/**
 * The `sh` to spawn: `sh` itself, or on Windows the path of Git's own; `null` when there is none.
 * @param {ShellWhere} where
 * @returns {string | null}
 */
export function findShell({ platform, path, gitExecPath, exists }: ShellWhere): string | null;
/** The `sh` for this process's PATH and git, or `null`. @returns {string | null} */
export function gateShell(): string | null;
/** What the check and the verify say, and exit 1 on, when there is no sh. */
export const NO_SHELL: "found no sh to run the commands in: install Git for Windows (https://git-scm.com/download/win), or put an sh on PATH";
export type ShellWhere = {
    platform: NodeJS.Platform;
    /**
     * the PATH the commands run with
     */
    path: string;
    /**
     * `git --exec-path`, asked only when it is needed
     */
    gitExecPath: () => string | null;
    exists: (file: string) => boolean;
};
