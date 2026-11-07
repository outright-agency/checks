/**
 * Claims `scope` (a test file's `globalThis`) for one test file, and throws when a file before it
 * already did, unless the file's project shares a process.
 * @param {object} scope
 * @param {Readonly<Record<string, string | undefined>>} [env]
 */
export function claimContextForOneFile(scope: object, env?: Readonly<Record<string, string | undefined>>): void;
/** The variable the preset gives a project that shares a process. */
export const SHARES_A_PROCESS: "OUTRIGHT_CHECKS_SHARES_A_PROCESS";
export const ONE_FILE_PER_CONTEXT_MESSAGE: string;
