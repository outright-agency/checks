import checks from "./checks.config.mjs";
import { checksVitestConfig } from "./src/vitest/preset.mjs";

export default checksVitestConfig(checks, {
  configUrl: import.meta.url,
  app: { exclude: ["test/installed/**"] },
  // The package installed from git into a fixture app, as an app installs it: it needs the
  // registry and takes a minute, so it runs only when asked (`pnpm test:installed`) and on CI.
  projects:
    process.env.CHECKS_INSTALLED_TESTS === "1"
      ? [{ extends: true, test: { name: "installed", include: ["test/installed/*.test.mjs"] } }]
      : [],
});
