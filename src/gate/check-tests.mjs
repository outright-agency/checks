// The tests step of `outright-checks check`: ONE vitest process for two projects —
//
//   app       the application tests the import graph relates to the change since <base>
//   ratchets  every ratchet test, whole: they read the source as text, so nothing relates them to
//             a change
//
// One process, because a `vitest run` per project holds a parent and a pool of workers each: on a
// change with many related tests that peaked a check at 9.6 GB, against 5.5 GB for one process
// sharing one pool, measured on an app with about 1,800 test files. The command line cannot say
// "--changed for one project, all of the other", so this asks vitest's Node API for both lists and
// runs them together.
//
// What each project did goes back to `check.mjs` on file descriptor 3 (lib.mjs, `testStepResults`),
// so a red check still names app or ratchets.
//
// Its workers recycle at the check's limit, half the suite's, and this process's own heap is held
// by `--max-old-space-size`, which reaches no worker (vitest hands its workers only its profiling
// flags). Why each number is what it is: limits.mjs.
//
// usage: node --max-old-space-size=<MB> check-tests.mjs <base> <worker memory>

import { writeSync } from "node:fs";
import { createVitest } from "vitest/node";
import { CHECK_TEST_PROJECTS, projectVerdicts } from "./lib.mjs";

// Started through the Node API, vitest keeps running on SIGTERM; its pool's workers end with this
// process.
for (const [signal, code] of /** @type {const} */ ([
  ["SIGINT", 130],
  ["SIGTERM", 143],
  ["SIGHUP", 129],
])) {
  process.on(signal, () => process.exit(code));
}

const [base, workerMemory] = process.argv.slice(2);
const vitest = await createVitest("test", {
  watch: false,
  changed: base,
  passWithNoTests: true,
  project: CHECK_TEST_PROJECTS,
  vmMemoryLimit: workerMemory,
});
await vitest.standalone(); // starts the reporters, as `vitest run` does

// `changed` narrows every project to what the change relates to; the ratchets are taken whole
// from the full list instead.
const app = (await vitest.getRelevantTestSpecifications()).filter(
  (spec) => spec.project.name === "app"
);
const ratchets = (await vitest.globTestSpecifications()).filter(
  (spec) => spec.project.name === "ratchets"
);
const result = await vitest.runTestSpecifications([...app, ...ratchets], false);
await vitest.close();

const report = {
  projects: projectVerdicts(
    result.testModules.map((module) => ({ project: module.project.name, state: module.state() }))
  ),
  unhandledErrors: result.unhandledErrors.length,
};
try {
  writeSync(3, JSON.stringify(report));
} catch {
  console.log(JSON.stringify(report)); // run by hand: there is no descriptor 3
}
const failed =
  report.unhandledErrors > 0 || Object.values(report.projects).some((p) => p.failed > 0);
process.exit(failed ? 1 : 0);
