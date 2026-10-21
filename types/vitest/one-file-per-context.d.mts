/**
 * Claims `scope` (a test file's `globalThis`) for one test file, and throws when a file before it
 * already did.
 * @param {object} scope
 */
export function claimContextForOneFile(scope: object): void;
export const ONE_FILE_PER_CONTEXT_MESSAGE: string;
