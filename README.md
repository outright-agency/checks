# @outright/checks

The checks' engine every Outright app installs: the gate runner, the test runner's preset, the
helpers its ratchets share, and the CI setup steps. Each app keeps its own rules (its ratchets, its
lanes, its docs); what is the app's own goes in one config file, and nothing in this package names
an app.

An improvement to the checks is made here once and reaches an app when it raises its version,
through its own gate, so a bad version breaks nothing everywhere at once.

## Quick start

`@outright/checks` runs an app's checks: `outright-checks check` after every task, `outright-checks
verify` before a change lands, a Vitest preset, and the CI steps. An app installs it from GitHub,
pinned to a tag:

```bash
pnpm add -D github:outright-agency/checks#v0.2.0
```

and declares its own checks in `checks.config.mjs` at its root:

```js
import { defineConfig } from "@outright/checks";

export default defineConfig({
  name: "my-app",
  check: { steps: [{ name: "types", run: "pnpm exec tsc --noEmit" }, "tests"] },
  verify: { lanes: [{ name: "suite", run: "pnpm test", long: true }] },
});
```

The sections below cover each part in full.

## Install

```bash
pnpm add -D github:outright-agency/checks#v0.2.0
```

- Node 22.12 or later: the package is ES modules only, and an app without `"type": "module"`
  loads it through Node's `require(esm)`.
- Peer dependencies: `vitest` 4.1.5 or later (below 5); optionally `typescript` 5 or later (for
  `git-baseline` and the tests check) and `@testing-library/react`.
- No build step: what is in the repository is what runs, with its declarations in `types/`.
- TypeScript finds the declarations through `exports`, so the app's `moduleResolution` is
  `bundler`, `node16` or `nodenext`; importing `checks.config.mjs` from TypeScript needs `allowJs`.
  A Next.js app has both.

To take a new version, raise the tag in `package.json` and let the app's own gate pass on it.

## The config: `checks.config.mjs`

At the app's root:

```js
import { defineConfig } from "@outright/checks";

export default defineConfig({
  name: "my-app",
  ratchets: ["src/test/**/*.test.ts"],
  check: {
    steps: [{ name: "types", run: "pnpm exec tsc --noEmit" }, "tests"],
  },
  verify: {
    lanes: [
      { name: "lints", run: "pnpm lint" },
      { name: "types", run: "pnpm exec tsc --noEmit" },
      { name: "suite", run: "VITEST_MAX_WORKERS=${VERIFY_MAX_WORKERS:-6} pnpm test", long: true },
    ],
  },
});
```

| Key | Default | What it is |
| --- | --- | --- |
| `name` | (required) | Lower-case letters, digits and dashes, starting with a letter. It names the gate folder and the environment variables below. |
| `ratchets` | `["src/test/**/*.test.ts"]` | Globs of the tests that read the source as text: no import graph relates them to a change, so they run whole (the `ratchets` project). Every other test is in the `app` project. |
| `check.requires` | `[]` | `{ path, message }`: files that must exist before the check runs anything (a dependency a step needs). A missing one prints its message and exits 1. |
| `check.steps` | (required) | The inner loop's steps, in order. A step is `{ name, run }`: `run` is a shell command, or a function `({ changed }) => command \| null` that picks a command from the paths the change touched (`null`: the step sits this change out). `"tests"` marks the built-in test step's place. |
| `check.tests.workerMemory` | `"512MB"` | Where the check's test workers recycle. |
| `check.tests.parentHeapMb` | `768` | The check's test process's own heap. |
| `verify.first` | `[]` | Lanes run alone, in order, before the others (one that rebuilds a folder the others read). A red one stops the gate. |
| `verify.lanes` | (required) | `{ name, run, long? }`: lanes run side by side. A red lane stops the `long` ones. |
| `verify.chain` | `"pnpm verify:chain"` | What `verify` runs instead, under `CI`. |
| `verify.summary` | `/ratchet passed\|Test Files\|Tests {2}/` | The lines of a passing lane's output that a pass reprints. |

What `name` derives:

| From `name: "my-app"` | |
| --- | --- |
| `.git/my-app-gate/` | the verify's receipts and lock, in the git common directory every checkout shares |
| `node_modules/.cache/my-app-gate/analysis/` | the analysis cache |
| `MY_APP_GATE_NO_CACHE=1` | turns the analysis cache off for one run |
| `MY_APP_RATCHET_BASE_SHA` | the base commit CI hands the ratchets (`ci-base` writes it) |

The paths a step function receives are relative to the repository's root. The `"tests"` step runs
the `app` and `ratchets` projects, so the app's Vitest config is built on the preset (below).

A mistake in the config (an unknown key, a missing name, a step with no `run`, a step function
that throws or answers anything but a command or `null`) stops the command before it runs
anything, with exit 2, naming the file and the key.

## The command

```json
{ "scripts": { "check": "outright-checks check", "verify": "outright-checks verify" } }
```

**`outright-checks check`** is the inner loop, after every task. It runs the app's steps one after
another, each even after one failed, so one run names every failure. The `tests` step is one Vitest
process for two projects: the `app` tests the import graph relates to the last commit and the
working tree, and every ratchet. Its workers recycle at `check.tests.workerMemory` and its own heap
is held to `check.tests.parentHeapMb`, so many sessions can check at once on one machine. A passing
step says one line; a failing one prints its output last. It takes no lock and leaves no receipt.

**`outright-checks verify [--force]`** is the full gate, once per tree and one at a time per
machine:

- **Lanes.** `verify.first`, then `verify.lanes` side by side. A red lane stops the long ones, and
  every red lane's output is printed last.
- **A receipt.** A pass is recorded against the git tree hash, so any checkout holding the same
  tree skips it. Only a tree clean before and after the run gets one, and the tree is read again
  after the lock and after the run, so a commit made meanwhile never gets a receipt it did not
  earn. `--force` runs it anyway.
- **A lock.** A second verify on the machine waits for the first and says whom it is waiting on.
  SIGINT, SIGTERM and SIGHUP stop every lane's process group and release the lock.
- Under `CI` it runs `verify.chain` instead: a runner has no neighbours and no memory.

## The test runner's preset

```ts
// vitest.config.ts
import { checksVitestConfig } from "@outright/checks/vitest";
import { defineConfig, mergeConfig } from "vitest/config";
import checks from "./checks.config.mjs";

export default mergeConfig(
  checksVitestConfig(checks, {
    configUrl: import.meta.url,
    exclude: ["e2e/**"],
    app: { exclude: ["src/**/*.db.test.ts"] },
    projects: process.env.MY_APP_DB_TESTS === "1" ? [dbProject] : [],
  }),
  defineConfig({ resolve: { tsconfigPaths: true }, test: { clearMocks: true } })
);
```

`checksVitestConfig(config, options)` sets:

- **The pool.** `vmForks`: one VM context per test file inside a few long-lived workers. Workers
  are floored at two (a `VITEST_MAX_WORKERS` below two is raised), four by default, and recycle at
  1 GB. The setup file fails a run that still puts two files in one context
  (`--no-file-parallelism`, `--maxWorkers=1`) and says why.
- **Time.** 5 s a test, 15 s under `CI`. Testing Library's waits get 3 s under `CI` (1 s, its
  own default, elsewhere).
- **Reruns.** `--changed` reruns every test when `package.json`, the lockfile, the Vitest config,
  `checks.config.mjs` or an app setup file changed. They are named by absolute path, so a checkout
  inside a dot-directory matches too.
- **Exclusions.** `node_modules` and every dot-directory, plus `options.exclude`.
- **Projects.** `app` and `ratchets` from the config's `ratchets` globs, then `options.projects`.
- Next's `server-only` guard is stubbed, and jsdom's Storage repaired where Node's own shadows it.

| Option | |
| --- | --- |
| `configUrl` | the Vitest config's `import.meta.url` (required) |
| `exclude` | the app's own exclusions |
| `setupFiles` | the app's own setup files, after the package's |
| `app` | `{ include?, exclude? }` for the `app` project |
| `projects` | projects beyond `app` and `ratchets` |

A second Vitest config that does not use the preset can load the pieces directly:
`@outright/checks/vitest/setup` and `@outright/checks/vitest/server-only`.

## The helpers

An app binds the helpers that need its name once, in a module of its own, and its ratchets import
that module:

```ts
// src/test/checks.ts
import { analysisCache } from "@outright/checks/analysis-cache";
import { gitBaseline } from "@outright/checks/git-baseline";
import checks from "../../checks.config.mjs";

export const { cachedAnalysis } = analysisCache(checks);
export const { resolveRatchetBase, loadGitBaselineExport, withCurrentPathKeys } = gitBaseline(checks, {
  movedRoots: [["src/lib/", "src/shared/lib/"]],
});
```

- **`@outright/checks/analysis-cache`**: `analysisCache(config).cachedAnalysis(name, repoRoot,
  inputs, compute)` computes a ratchet's analysis once per repository state (keyed by content,
  never time) and shares it between processes.
- **`@outright/checks/git-baseline`**: `resolveRatchetBase()` (CI's base, else the merge base with
  `main`), `baselineExistsAtBase()`, `loadGitBaselineExport()` (a baseline as it stood at the
  base, data only), and `withCurrentPathKeys()` / `toCurrentPathSpelling()`, which spell a
  historical subject through the app's moved folders.
- **`@outright/checks/check-hygiene`**: checks for the checks — exact counts in a scan test, scoped
  gates that reach the whole suite (`scopedGatesReachingTheSuite(scripts, { notScoped, pathRoots })`),
  rules no fixture makes fire. The app's live test calls them on its own tree.
- **`@outright/checks/ratchets`**: `runRatchets(ratchets)` runs every ratchet even after one fails,
  or one with `--only <name>`. The app's ratchets command ends
  `process.exitCode = runRatchets({ … })`.

## The tests check

`@outright/checks/tests-check` reads every test an app's suite runs and holds the parts of a
fast-test standard a machine can: tests that sleep, wait their own way, leave the process changed,
or carry a budget with no reason beside it. The rest of such a standard (which kind of test proves
a behaviour, what a test imports) is judgment and stays the app's prose.

```ts
// src/test/tests/live.test.ts
import { analyzeTests, evaluateTests, formatTestsFindings } from "@outright/checks/tests-check";
import { describe, expect, it } from "vitest";

const analysis = analyzeTests({ roots: ["src", "scripts"], skip: /\.e2e\.test\.ts$/ });
const { findings, checked } = evaluateTests(analysis);

describe("tests check (live)", () => {
  it("reads every test the suite runs, non-vacuously", () => {
    expect(checked.files).toBeGreaterThan(30);
  });

  it("keeps the tests standard", () => {
    expect(formatTestsFindings(findings)).toEqual([]);
  });
});
```

- **`analyzeTests({ root?, roots?, skip? })`** reads, as text, every test file
  (`*.test.{ts,tsx,mts,cts,js,jsx,mjs,cjs}`) under `roots` (default `["src", "scripts"]`) that git sees,
  tracked or untracked and not ignored, so a planted test goes red before it is committed. A path
  under a dot-folder is a copy, never read; `skip` names tests the app runs under another config.
  Each file carries its environment, read as Vitest reads it: the first `@vitest-environment`
  docblock anywhere in the file; a file with none is `node`, the preset's environment.
- **`evaluateTests(analysis, baseline?)`** parses only the files whose text could hold a finding,
  and returns `{ findings, checked }`; `checked` counts the files, the DOM files, the parsed
  files, the budgets and the waits, for the live test's floors.
- **`formatTestsFindings(findings)`** prints one `path:line rule: text` line per finding.

The rules (`TESTS_RULES`), each read from the syntax tree, not one spelling of it:

| Rule | Fires on | Instead |
| --- | --- | --- |
| `env-written` | `process.env` assigned, deleted, or written by `Object.assign` / `Reflect` | `vi.stubEnv(name, value)`, `vi.stubEnv(name, undefined)` to unset |
| `env-unrestored` | a file that stubs the environment and never calls `vi.unstubAllEnvs` | `afterEach(() => vi.unstubAllEnvs())` |
| `process-chdir` | `process.chdir(…)` | hand the directory to what runs (`cwd`) |
| `real-clock-sleep` | a promise resolved by a real timer with a delay, `timers/promises`' `setTimeout` included | wait for the event, or drive fake timers |
| `wait-own-timeout` | a wait (`waitFor`, `findBy*`, `vi.waitFor`) with a timeout of its own | the suite's timeout; make the work before the event faster |
| `vi-wait-in-dom` | `vi.waitFor` / `vi.waitUntil` in a DOM test | Testing Library's `waitFor`, whose timeout the preset lengthens on CI |
| `wait-for-absence` | a wait for a mock not to have been called | assert the absence after the event that would have caused it |
| `budget-without-reason` | a test's, a suite's or a hook's own budget with no comment above it, opening its body, or naming its number | a comment saying what it builds and how the number was sized |
| `stale-debt` | a debt entry the tree has fewer findings of than it names | lower the entry, or remove it |

Reviewed debt is exact: `{ debt: [{ path, rule, count, issue, reason }] }`, `count` findings of
`rule` in `path`. A file with more findings than its entry names reports them all, so the new one
shows; an app with no debt passes no baseline.

## The CI steps

```yaml
steps:
  - uses: actions/checkout@v7
    with:
      fetch-depth: 2
  - uses: outright-agency/checks/actions/ci-setup@v0.2.0
    with:
      name: my-app
  - run: pnpm exec vitest run --project app --changed "$MY_APP_RATCHET_BASE_SHA"
```

- **`ci-base`** (`name`): writes the commit the change is compared with, as
  `<NAME>_RATCHET_BASE_SHA`: a pull request's test merge's first parent, or a merge queue entry's
  base. Any other event, or a base it cannot name or fetch, stops the job.
- **`ci-setup`** (`name`, `node-version`, default `22`, `ratchet-base`, default `"true"`): the
  base, as `ci-base` writes it, then pnpm, Node and `pnpm install --frozen-lockfile`. A job on an
  event other than a pull request or the merge queue (a push, a dispatch) has no base to find:
  give it `ratchet-base: "false"`.
