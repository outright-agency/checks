// An app with one project: `tsc`, then its tests, in the inner loop; its lints, types and suite
// side by side in the full gate.

export default {
  name: "single",
  check: {
    steps: [{ name: "types", run: "pnpm exec tsc --noEmit" }, "tests"],
  },
  verify: {
    lanes: [
      { name: "lints", run: "pnpm lint && pnpm lint:ratchets" },
      { name: "types", run: "pnpm exec next typegen && nice -n 10 tsc --noEmit" },
      { name: "suite", run: "VITEST_MAX_WORKERS=${VERIFY_MAX_WORKERS:-6} pnpm test", long: true },
    ],
  },
};
