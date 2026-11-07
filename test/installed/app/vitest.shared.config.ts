// A project that says it shares a process: its files land in one fork, and the preset's setup file,
// from node_modules, leaves them alone.
import { checksVitestConfig } from "@outright/checks/vitest";
import checks from "./checks.config.mjs";

export default checksVitestConfig(checks, {
  configUrl: import.meta.url,
  projects: [
    {
      extends: true,
      test: { name: "shared", include: ["src/sum*.test.ts"], pool: "forks", isolate: false, maxWorkers: 1 },
    },
  ],
});
