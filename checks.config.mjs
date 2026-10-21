// The package's own checks, run through its own command and preset: `pnpm check` and
// `pnpm verify`, as an app runs them.

import { defineConfig } from "./src/config.mjs";

export default defineConfig({
  name: "checks",
  // The tests that read the whole package as text.
  ratchets: ["test/*.test.mjs"],
  check: {
    steps: [{ name: "types", run: "pnpm typecheck" }, "tests"],
  },
  verify: {
    lanes: [
      { name: "types", run: "pnpm typecheck && pnpm types:current" },
      { name: "suite", run: "VITEST_MAX_WORKERS=${VERIFY_MAX_WORKERS:-6} pnpm test", long: true },
    ],
  },
});
