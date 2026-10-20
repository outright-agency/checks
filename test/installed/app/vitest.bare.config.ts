// The VM pool and the package's setup file without the preset's floor on workers: a run with
// VITEST_MAX_WORKERS=1 here shares one context, and the setup file must fail it.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "vmForks",
    include: ["src/sum*.test.ts"],
    setupFiles: ["@outright/checks/vitest/setup"],
    server: { deps: { inline: ["@outright/checks"] } },
  },
});
