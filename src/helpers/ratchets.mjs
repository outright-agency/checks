// The ratchets as a command: an app's `scripts/gate/ratchets.ts` holds its ratchets and ends
//
//   process.exitCode = runRatchets({ architecture, pieces });
//
// so `tsx scripts/gate/ratchets.ts` runs them all and `--only <name>` runs one (each
// `lint:<name>` script). The same analyzers fail the suite as tests; here they SPEAK: a passing
// test that logs a warning is invisible, so what a ratchet found is printed by its command.

/**
 * Runs the ratchets — every one even after one fails, since a gate that stops at the first red
 * hides the second until the first is fixed — and returns the exit code: 0 when all passed, 1
 * otherwise, 2 for an unknown `--only` name (and then runs none).
 * @param {Readonly<Record<string, () => boolean>>} ratchets each returns whether it passed, and says what it found either way
 * @param {readonly string[]} [argv]
 * @returns {number}
 */
export function runRatchets(ratchets, argv = process.argv) {
  const onlyIndex = argv.indexOf("--only");
  const only = onlyIndex === -1 ? null : argv[onlyIndex + 1];
  if (only !== null && !(only in ratchets)) {
    console.error(`Unknown ratchet "${only}". One of: ${Object.keys(ratchets).join(", ")}.`);
    return 2;
  }
  const names = only === null ? Object.keys(ratchets) : [only];
  const passed = names.map((name) => ratchets[name]());
  return passed.every(Boolean) ? 0 : 1;
}
