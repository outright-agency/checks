// The test runner's settings every app shares, built from its `checks.config.mjs`:
//
//   export default mergeConfig(
//     checksVitestConfig(checks, { configUrl: import.meta.url }),
//     defineConfig({ resolve: { tsconfigPaths: true } })
//   );
//
// What it sets, and why (the numbers and their measurements: limits.mjs):
//
// POOL. The default pool (`forks` with `isolate: true`) destroys and recreates the child process
// after every test file: on an app with about 1,000 test files, Vitest's own accounting gave import
// 1269 s against tests 119 s. `vmForks` keeps the process and gives each file a fresh VM context
// instead, the same isolation without the churn: per-file fixed cost fell from 1.24 s to 0.38 s,
// and the suite from 445 s to 125 s. That isolation holds per task, and only at two workers or
// more (one-file-per-context.mjs), so workers are floored at two and the setup file fails a run
// that still puts two files in one context.
//
// The one thing a VM context changes: built-ins inside it are a different realm's, so a value
// handed over by a HOST built-in — `await Response.json()` — carries prototypes that
// `expect.any(Array)` and `expect.any(Object)` cannot match. `Array.isArray` is realm-safe. If a
// test fails with "expected Object{…} to deeply equal {…: Any<Array>}", this is why.
//
// MEMORY AND WORKERS. Each worker recycles past the suite's limit; the check asks for half
// (check-tests.mjs). Four workers unless `VITEST_MAX_WORKERS` says otherwise, never fewer than two.
//
// TIME. Five seconds a test on a developer's machine, fifteen under `CI`.
//
// RERUNS. `--changed` reruns every test when one of these changed: the root's package.json,
// lockfile, Vitest config, checks config and setup files. Nothing imports them, so no import graph
// relates a test to them. Vitest's own triggers are globs, and a glob's `**` does not enter a
// dot-directory, so in a checkout nested under one (an agent's worktree) they never match; these
// are absolute paths, which match wherever the checkout is. The lockfile is the one Vitest leaves
// out: a dependency bump may change nothing else.
//
// EXCLUSIONS. node_modules, and every dot-directory: source never lives in one, so a test file
// there is a COPY of source — another checkout of the same repository on another branch, or a
// tool's partial snapshot — and running it reports failures in a tree nobody is working in.
//
// PROJECTS. `app`, the application's own tests, which `--changed` can select through the import
// graph; and `ratchets`, the tests the config's `ratchets` globs name, which read the source as
// text, so no import graph connects a ratchet to the file that breaks it and it runs whole. The
// inner loop asks for exactly that, in one process. A bare `vitest run` runs both, and any project
// the app adds (`projects`).
//
// The package's own modules run inside each test file's context, as the app's own files do
// (`server.deps.inline`), and Next's `server-only` guard is stubbed (server-only.mjs).

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults } from "vitest/config";
import { CONFIG_FILE, resolveConfig } from "../config.mjs";
import {
  CI_TEST_TIMEOUT_MS,
  DEFAULT_WORKERS,
  MIN_WORKERS,
  SUITE_WORKER_MEMORY,
  TEST_TIMEOUT_MS,
} from "../limits.mjs";

/** @typedef {import("../config.mjs").ChecksConfig} ChecksConfig */
/** @typedef {import("vitest/config").TestProjectInlineConfiguration} TestProjectInlineConfiguration */

/**
 * @typedef {object} PresetOptions
 * @property {string} configUrl the app's Vitest config, as `import.meta.url`
 * @property {string[]} [exclude] the app's own exclusions, added to node_modules and dot-directories
 * @property {string[]} [setupFiles] the app's own setup files, run after the package's
 * @property {{ include?: string[], exclude?: string[] }} [app] the `app` project's own include and exclusions
 * @property {TestProjectInlineConfiguration[]} [projects] projects beyond `app` and `ratchets`
 */

export const SETUP_FILE = fileURLToPath(new URL("./setup.mjs", import.meta.url));
export const SERVER_ONLY_STUB = fileURLToPath(new URL("./server-only.mjs", import.meta.url));

/** The package's name, as an app installs it: its modules run in each test file's context. */
const PACKAGE = "@outright/checks";

/**
 * The test runner's settings for an app, from its checks config.
 * @param {ChecksConfig} config the app's `checks.config.mjs`
 * @param {PresetOptions} options
 * @returns {import("vitest/config").ViteUserConfig}
 */
export function checksVitestConfig(config, options) {
  const { ratchets } = resolveConfig(config);
  const { configUrl, exclude = [], setupFiles = [], app = {}, projects = [] } = options;
  const configFile = fileURLToPath(configUrl);
  const root = dirname(configFile);

  // Vitest reads `VITEST_MAX_WORKERS` itself, after this file and over `maxWorkers`, so the floor
  // is applied to the variable, not to the option.
  if (Number(process.env.VITEST_MAX_WORKERS) < MIN_WORKERS) {
    process.env.VITEST_MAX_WORKERS = String(MIN_WORKERS);
  }

  const excluded = ["**/node_modules/**", "**/.*/**", ...exclude];
  return {
    resolve: { alias: { "server-only": SERVER_ONLY_STUB } },
    test: {
      pool: "vmForks",
      vmMemoryLimit: SUITE_WORKER_MEMORY,
      maxWorkers: Number(process.env.VITEST_MAX_WORKERS ?? DEFAULT_WORKERS),
      testTimeout: process.env.CI ? CI_TEST_TIMEOUT_MS : TEST_TIMEOUT_MS,
      setupFiles: [SETUP_FILE, ...setupFiles],
      server: { deps: { inline: [PACKAGE] } },
      forceRerunTriggers: [
        ...configDefaults.forceRerunTriggers,
        ...["package.json", "pnpm-lock.yaml", configFile, CONFIG_FILE, ...setupFiles].map((file) =>
          resolve(root, file)
        ),
      ],
      exclude: excluded,
      projects: [
        {
          extends: true,
          test: {
            name: "app",
            ...(app.include ? { include: app.include } : {}),
            exclude: [...excluded, ...ratchets, ...(app.exclude ?? [])],
          },
        },
        { extends: true, test: { name: "ratchets", include: ratchets, exclude: excluded } },
        ...projects,
      ],
    },
  };
}
