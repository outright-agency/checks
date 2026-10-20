# Changelog

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
