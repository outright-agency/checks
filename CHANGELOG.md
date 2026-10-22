# Changelog

## 0.2.1

A project that runs one file at a time, and the package on Windows:

- The preset takes `VITEST_MAX_WORKERS` into the root's worker count, floored at two, and out of
  the environment, where Vitest applied it over every project's own setting: a project's
  `fileParallelism: false` (or `maxWorkers: 1`) on a process pool now holds wherever the variable
  is set. Every project the config's later loads build gets the same count.
- The analysis cache compares native real paths, so a Windows checkout under an 8.3 short name (or
  any root spelled in another case) is recognised as itself and cached.
- The gate folder resolves git's answer on Windows.
- `check` and `verify` run the app's commands in `sh` on PATH, or else in Git for Windows' own, so
  they run from PowerShell and cmd; with neither, one line says to install Git for Windows.
- On Windows the check's steps run without `nice` (which dropped the tests step's report, so every
  check said its tests FAILED) and at below-normal priority; verify's lanes start without a
  process group, which Windows has not, and each runs to its own end.
- A setup file given by an absolute Windows path is a rerun trigger.
- The repository checks out with LF line endings everywhere; its CI runs the verify and the
  installed proof on Windows as well as Linux.

## 0.2.0

The tests check, `@outright/checks/tests-check`:

- `analyzeTests({ root, roots, skip })`: every test file under the app's roots that git sees, with
  its environment read as Vitest reads it (`environmentOf`, `isSuiteTest`).
- `evaluateTests(analysis, baseline?)`, `formatTestsFindings` and nine rules (`TESTS_RULES`): `env-written`, `env-unrestored`,
  `process-chdir`, `real-clock-sleep`, `wait-own-timeout`, `vi-wait-in-dom`, `wait-for-absence`,
  `budget-without-reason` and `stale-debt`, each with a fixture that makes it fire. Reviewed debt
  is exact; no baseline means no debt.
- `typescript` (an optional peer) is needed for the tests check too.

## 0.1.0

The engine of two apps' checks, made one package:

- `outright-checks check`: the app's steps one after another, its tests in one Vitest process (the
  related app tests and every ratchet) at the check's memory caps.
- `outright-checks verify`: lanes, a receipt per git tree (the tree read again after the lock and
  after the run), a machine-wide lock, SIGHUP handled beside SIGINT and SIGTERM; the chain under CI.
- `checksVitestConfig`: the VM pool with workers floored at two, the CI test limit, the rerun
  triggers by absolute path, the `app` and `ratchets` projects, and a setup file that fails a run
  sharing one VM context.
- The helpers `analysis-cache`, `git-baseline`, `check-hygiene` and `runRatchets`, each taking what
  is the app's as an argument.
- The CI steps `ci-base` and `ci-setup`.
- One config file per app, `checks.config.mjs`, whose `name` derives the gate folder and the
  environment names.
