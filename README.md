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
pnpm add -D github:outright-agency/checks#v0.4.0
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
pnpm add -D github:outright-agency/checks#v0.4.0
```

- Node 22.12 or later: the package is ES modules only, and an app without `"type": "module"`
  loads it through Node's `require(esm)`.
- Peer dependencies: `vitest` 4.1.5 or later (below 5); optionally `typescript` 5 or later (for
  `git-baseline`, the tests check and the two database checks) and `@testing-library/react`.
- No build step: what is in the repository is what runs, with its declarations in `types/`.
- TypeScript finds the declarations through `exports`, so the app's `moduleResolution` is
  `bundler`, `node16` or `nodenext`; importing `checks.config.mjs` from TypeScript needs `allowJs`.
  A Next.js app has both.

- On Windows, the check's steps and verify's lanes run in `sh`: the one on PATH (Git Bash, or Git's
  tools on PATH), or else Git for Windows' own, found beside the `git` on PATH, so the commands
  run from PowerShell and cmd as well. With neither, the command says to install Git for Windows.

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
| `checks.dbTests` | off | Turns on the database tests check, with where the app's own parts of it sit: `lists`, `exceptions` and `rule`, and `files` and `roots` where they aren't `/\.db\.test\.ts$/` and `["src"]`. A check ships switched off: raising the pin turns nothing on. |
| `checks.dbGroups` | off | Turns on the database groups check, with the app's own words: `lists` (required), and `setup`, `helpers`, `aliases`, `installs`, `collects`, `ownList`, `writes`, `declares`, `files` and `roots` where it has them (below). |
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
is held to `check.tests.parentHeapMb`, so many sessions can check at once on one machine. Every
step runs at low priority (`nice -n 10`; on Windows, below normal). A passing step says one line; a
failing one prints its output last. It takes no lock and leaves no receipt.

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
- **On Windows**, which has no process groups or POSIX signals, a lane runs to its own end: a red
  lane stops no other, so a red verify takes as long as its longest lane, and Ctrl-C reaches the
  lanes through the console they share with the verify.
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
- **Workers, and a project that runs one file at a time.** The preset takes `VITEST_MAX_WORKERS`
  into the root's worker count and out of the environment, where Vitest would apply it over every
  project's own setting. So a project whose files must run one at a time (they empty a database
  their neighbours use) says so in Vitest's own words, `fileParallelism: false` (or
  `maxWorkers: 1`), on a process pool (`pool: "forks"`), and keeps it whatever the variable says.
- **A project that shares a process.** A project whose files may share one says so in Vitest's own
  words, `isolate: false` on a process pool (`pool: "forks"`), and the preset marks it, so the setup
  file leaves it alone. Its files then share every module and every global, so what they leave
  behind is the project's to answer for. `isolate: false` with no pool of its own stays on the VM
  pool, where it means nothing, and keeps the setup file's refusal. A second config that does not
  use the preset gets no mark.
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
  `main`), `ratchetBase()` (that, or none on a run by hand that names none), `countBase()` (where a
  change's own count starts: the later fork when a local `main` lags `origin/main`),
  `baselineExistsAtBase()`, `atBase()` (a file as it stood there), `changesSince()` (what a change
  renames and touches), `loadGitBaselineExport()` (a baseline as it stood at the base, data only),
  and `withCurrentPathKeys()` / `toCurrentPathSpelling()`, which spell a historical subject through
  the app's moved folders.
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

## The database tests check

`@outright/checks/db-tests` holds what a database test owes: a file says what only a database
proves, a test in one sends it something, and a change adds no more than the app's limit. It needs
`typescript`.

It ships switched off. An app turns it on in two steps, its existing tests listed so nothing that
runs today goes red: `checks.dbTests` in its config, and a live test, which is what runs it. The key
with no live test runs nothing; a live test with no key throws.

```js
// checks.config.mjs
checks: {
  dbTests: {
    lists: "src/test/db-tests/baseline.ts",
    exceptions: "src/test/db-tests/stop-exceptions.ts",
    rule: "docs/test-rule.md",
  },
},
```

```ts
// src/test/db-tests/live.test.ts
import { analyzeDbTests, evaluateDbTests, formatDbTestsFindings } from "@outright/checks/db-tests";
import { describe, expect, it } from "vitest";
import checks from "../../../checks.config.mjs";
import { DEBT } from "./baseline";
import { MAX_NEW_DB_TESTS, STOP_EXCEPTIONS } from "./stop-exceptions";

const analysis = analyzeDbTests(checks);
const findings = evaluateDbTests(analysis, { debt: DEBT, exceptions: STOP_EXCEPTIONS, limit: MAX_NEW_DB_TESTS });

describe("database tests check (live)", () => {
  it("reads every database test, non-vacuously", () => {
    expect(analysis.files.length).toBeGreaterThan(30);
  });

  it("holds every file and test to the rule", () => {
    expect(formatDbTestsFindings(findings)).toBe("");
  });
});
```

- **`analyzeDbTests(config, { root?, env? })`** reads, as text, every file matching `files` under
  `roots` that git sees, and counts what the change adds, against `countBase()`. A path under a
  dot-folder is a copy, never read. It throws for an app that has not turned the check on.
- **`evaluateDbTests(analysis, { debt, exceptions, limit })`** returns the findings. The limit, the
  debt and the exceptions are the app's: nothing here holds a number of its own.
- **`formatDbTestsFindings(findings)`** prints each finding with its place.

The rules (`DB_TESTS_RULES`):

| Rule | Fires on | Instead |
| --- | --- | --- |
| `db-test-no-reason` | a file with no line `// Only a database proves: <what>`, three words or more, at the start of a line | say what only a database proves, or make it a plain test |
| `db-test-sends-nothing` | a test that neither awaits nor returns a promise | a plain test, or an assertion in a test that sends |
| `stale-debt` | a list's entry that excuses nothing | take it off |
| `unnamed-debt` | a list's entry with no issue key or no reason | name both |
| `stop-exception-unnamed` | an exception with no issue key or no reason | name both |
| `db-tests-past-the-stop` | a change with more new tests than the limit, and no exception of its own | keep what a database alone proves, or add an exception |
| `stop-exception-unused` | an exception a change adds that it doesn't need | take it off |

An entry of the debt is `{ rule: "db-test-no-reason", path, issue, reason }` or
`{ rule: "db-test-sends-nothing", path, test, issue, reason }`, the test held by its title. An
exception is `{ tests, issue, reason }`: it excuses only the change that adds it, and stays as the
record. The file `exceptions` names exports them as `STOP_EXCEPTIONS`, read as it stood at the base,
so it holds data alone. A count nets a move or a rename to nothing, and a table's written rows each
count one. Whether a line is true stays a review's question.

## The database groups check

`@outright/checks/db-groups` holds what lets database test files share a process: a file that fakes
or changes global state keeps a process of its own, a file that truncates runs alone, and no other
file does. The app's lists of those files feed its own Vitest projects, which the package does not
build; this check holds the lists equal to what the source shows, both ways. It needs `typescript`.

It ships switched off. An app turns it on in two steps: `checks.dbGroups` in its config, with its
own words, and a live test, which hands it the lists and is what runs it. The key with no live test
runs nothing; a live test with no key throws.

```js
// checks.config.mjs
checks: {
  dbGroups: {
    lists: "src/test/db-groups/apart.ts",
    setup: "src/app/setup.ts",
    helpers: ["src/test/"],
    aliases: { "@/": "src/" },
    installs: ["install"],
    collects: ["collectPlugins"],
    ownList: "PLUGINS",
    writes: ["registry.register"],
    declares: /^define[A-Z]/,
  },
},
```

```ts
// src/test/db-groups/live.test.ts
import { analyzeDbGroups, evaluateDbGroups, formatDbGroupsFindings } from "@outright/checks/db-groups";
import { describe, expect, it } from "vitest";
import checks from "../../../checks.config.mjs";
import { KEPT_APART, RUNS_ALONE } from "./apart";

const analysis = analyzeDbGroups(checks);

describe("database groups check (live)", () => {
  it("reads every database test, non-vacuously", () => {
    expect(analysis.files.length).toBeGreaterThan(30);
  });

  it("keeps apart exactly the files that fake or change global state", () => {
    expect(formatDbGroupsFindings(evaluateDbGroups(analysis, { apart: KEPT_APART, alone: RUNS_ALONE }))).toBe("");
  });
});
```

| Key | Default | What it is |
| --- | --- | --- |
| `lists` | (required) | The file the app's lists sit in; every finding names it. |
| `setup` | none | The one app module that may install at load: what the shared group's setup file loads. With none, every module that installs at load is named. |
| `helpers` | `[]` | Folders of test helpers, beyond `*.test.ts(x)` files and `__tests__/` folders. |
| `aliases` | `{}` | An import's prefix and the folder it stands for. |
| `installs` | `[]` | Methods that install what they are handed: a call to one changes global state. |
| `collects` | `[]` | Functions that collect from a list and install it: a call changes global state, unless its list is `ownList`. |
| `ownList` | none | The app's own list, which the shared setup installs. |
| `writes` | `[]` | `object.method` calls that write to a registry when handed what to keep (a second argument), or called on their own; with only their first argument, as a value handed on, they declare. |
| `declares` | none | A call at a file's top whose name matches only declares: it adds to a registry and changes nothing already there. |
| `files` | `/\.db\.test\.ts$/` | Which test files are database tests. A `*.test.ts(x)` file is still a test helper whatever this says. |
| `roots` | `["src"]` | The folders read. A path under a dot-folder is a copy, never read. |

What it reads, by syntax tree, in a database test file and every test helper it reaches through
imports, re-exports and `import()` (it ends at app code, and skips what only a type needs):

- **A fake**: any use of Vitest's `vi` but `vi.fn`, `vi.waitFor` and `vi.waitUntil`, however it is
  named or reached, or a way into Vitest it can't read.
- **Global state**: a call of the app's words above; a call at a file's top that is no test, hook or
  declaration; a write to a global or onto an imported object, a change through its own methods,
  `Object` and `Reflect` writers; a listener or any other call on `process` but a read;
  `expect.extend` and its kin, `chai.use`; an `import()` or `require` of a built path.
- **A truncate**: SQL that says `TRUNCATE`, in a string or a template.
- **Install at load**: an app module, outside `setup`, that calls one of `installs` at its top.

- **`analyzeDbGroups(config, { root? })`** reads every code file git sees under `roots`. It throws
  for an app that has not turned the check on.
- **`evaluateDbGroups(analysis, { apart, alone })`** returns the findings: `apart` is the files kept
  apart, a process each, and `alone` the files that run alone.
- **`formatDbGroupsFindings(findings)`** prints each finding as `rule: detail`.

The rules (`DB_GROUPS_RULES`):

| Rule | Fires on | Instead |
| --- | --- | --- |
| `shared-fake` | a shared file that fakes, itself or through a helper | list it apart |
| `shared-global-state` | a shared file that changes global state, itself or through a helper | list it apart |
| `apart-excuses-nothing` | a file listed apart that does neither | take it off, so it shares a process |
| `apart-not-a-file` | a listed path that is no database test file | take it off |
| `truncate-not-alone` | a file that truncates and doesn't run alone | list it to run alone |
| `alone-excuses-nothing` | a file listed to run alone that truncates nothing | take it off |
| `install-at-load` | an app module outside `setup` that installs at load | install it from `setup` |

## The CI steps

```yaml
steps:
  - uses: actions/checkout@v7
    with:
      fetch-depth: 2
  - uses: outright-agency/checks/actions/ci-setup@v0.4.0
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
