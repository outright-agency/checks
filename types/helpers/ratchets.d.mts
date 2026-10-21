/**
 * Runs the ratchets — every one even after one fails, since a gate that stops at the first red
 * hides the second until the first is fixed — and returns the exit code: 0 when all passed, 1
 * otherwise, 2 for an unknown `--only` name (and then runs none).
 * @param {Readonly<Record<string, () => boolean>>} ratchets each returns whether it passed, and says what it found either way
 * @param {readonly string[]} [argv]
 * @returns {number}
 */
export function runRatchets(ratchets: Readonly<Record<string, () => boolean>>, argv?: readonly string[]): number;
