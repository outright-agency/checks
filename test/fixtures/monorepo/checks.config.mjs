// An app with a workspace of packages: its own types run on a second, faster compiler in the inner
// loop, its side type projects only when something that feeds them changed, one package's tests
// only when that package changed, and its packages lane alone, first, in the full gate.

/** What feeds the side type projects. */
const SIDE_PROJECT_INPUTS = [
  /^packages\//,
  /^src\/shared\/fields\//,
  /^tsconfig[^/]*\.json$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
];

/** @param {string[]} changed */
const sideProjectsNeeded = (changed) =>
  changed.some((path) => SIDE_PROJECT_INPUTS.some((input) => input.test(path)));

export default {
  name: "monorepo",
  ratchets: ["src/test/**/*.test.ts"],
  check: {
    requires: [
      {
        path: "node_modules/typescript-next/bin/tsc",
        message:
          "node_modules predates pnpm-lock.yaml (no node_modules/typescript-next): run `pnpm install`, then check again.",
      },
    ],
    steps: [
      {
        name: "types",
        /** @param {{ changed: string[] }} context */
        run: ({ changed }) => `pnpm ${sideProjectsNeeded(changed) ? "typecheck" : "typecheck:root"}`,
      },
      "tests",
      {
        name: "workflows",
        /** @param {{ changed: string[] }} context */
        run: ({ changed }) =>
          changed.some((path) => path.startsWith("packages/workflows/"))
            ? "pnpm --filter @example/workflows test"
            : null,
      },
    ],
  },
  verify: {
    first: [{ name: "packages", run: "pnpm lane:packages" }],
    lanes: [
      { name: "lints", run: "pnpm lane:lints" },
      { name: "types", run: "nice -n 10 pnpm lane:types" },
      { name: "suite", run: "VITEST_MAX_WORKERS=${VERIFY_MAX_WORKERS:-6} pnpm test", long: true },
    ],
    summary: /ratchet passed|check passed|artifact passed|Test Files|Tests {2}/,
  },
};
