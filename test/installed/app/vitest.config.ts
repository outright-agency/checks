import { checksVitestConfig } from "@outright/checks/vitest";
import { defineConfig, mergeConfig } from "vitest/config";
import checks from "./checks.config.mjs";

export default mergeConfig(
  checksVitestConfig(checks, { configUrl: import.meta.url }),
  defineConfig({ test: { clearMocks: true } })
);
