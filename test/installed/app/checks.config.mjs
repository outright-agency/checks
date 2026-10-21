// An app's checks, as an app writes them: one name, its ratchet tests, its check's steps and its
// verify's lanes.

import { defineConfig } from "@outright/checks";

export default defineConfig({
  name: "fixture-app",
  ratchets: ["src/test/**/*.test.ts"],
  check: {
    steps: [{ name: "types", run: "pnpm exec tsc --noEmit -p ." }, "tests"],
  },
  verify: {
    lanes: [
      { name: "types", run: "pnpm exec tsc --noEmit -p ." },
      { name: "suite", run: "pnpm exec vitest run", long: true },
    ],
  },
});
