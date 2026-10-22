// `pnpm test:installed`: the package installed from git into a fixture app (test/installed), the
// project the suite leaves out unless CHECKS_INSTALLED_TESTS asks for it (vitest.config.mjs). A
// script, not `CHECKS_INSTALLED_TESTS=1 vitest …`, which cmd.exe, pnpm's script shell on Windows,
// cannot run.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const VITEST = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));

const run = spawnSync(process.execPath, [VITEST, "run", "--project", "installed", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, CHECKS_INSTALLED_TESTS: "1" },
});
process.exit(run.status ?? 1);
