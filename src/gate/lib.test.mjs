import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ChecksConfigError, loadConfig } from "../config.mjs";
import {
  OWNERLESS_LOCK_GRACE_MS,
  RECEIPT_MAX_AGE_MS,
  changedPaths,
  checkSteps,
  describeWait,
  expiredReceipts,
  gateDirectory,
  isCleanTree,
  isStaleLock,
  projectVerdicts,
  receiptKey,
  testStepResults,
} from "./lib.mjs";

const TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const FIXTURES = fileURLToPath(new URL("../../test/fixtures/", import.meta.url));

describe("changedPaths", () => {
  it("joins the last commit's files with the working tree's, once each", () => {
    expect(
      changedPaths(
        "src/a.ts\nsrc/b.ts\n",
        " M src/b.ts\n?? src/new.ts\nR  src/old.ts -> src/moved.ts\n"
      )
    ).toEqual(["src/a.ts", "src/b.ts", "src/moved.ts", "src/new.ts", "src/old.ts"]);
  });
});

describe("checkSteps", () => {
  it("runs a step's command as written, and asks a function which command this change needs", async () => {
    const config = await loadConfig(join(FIXTURES, "monorepo"));
    expect(checkSteps(config, ["src/app/page.tsx"])).toEqual([
      { name: "types", command: "pnpm typecheck:root", chosen: true },
      { name: "tests", tests: true },
    ]);
    expect(checkSteps(config, ["packages/workflows/src/x.ts"])).toEqual([
      { name: "types", command: "pnpm typecheck", chosen: true },
      { name: "tests", tests: true },
      { name: "workflows", command: "pnpm --filter @example/workflows test", chosen: true },
    ]);
    const single = await loadConfig(join(FIXTURES, "single"));
    expect(checkSteps(single, [])).toEqual([
      { name: "types", command: "pnpm exec tsc --noEmit", chosen: false },
      { name: "tests", tests: true },
    ]);
  });

  it("keeps the declared order and leaves out a step that sits the change out", async () => {
    const config = await loadConfig(join(FIXTURES, "monorepo"));
    const steps = /** @type {any[]} */ (config.check.steps);
    const reordered = { ...config, check: { ...config.check, steps: [steps[2], "tests", steps[0]] } };
    expect(checkSteps(reordered, ["packages/workflows/a.ts"]).map((step) => step.name)).toEqual([
      "workflows",
      "tests",
      "types",
    ]);
    expect(checkSteps(reordered, ["docs/a.md"]).map((step) => step.name)).toEqual(["tests", "types"]);
  });

  it("refuses an answer that is not a command, and lets null sit the change out", async () => {
    const config = await loadConfig(join(FIXTURES, "single"));
    for (const [answer, shown] of [[false, "false"], ["", '""'], [0, "0"], ["  ", '"  "']]) {
      const broken = { ...config, check: { ...config.check, steps: [{ name: "types", run: () => answer }] } };
      expect(() => checkSteps(/** @type {any} */ (broken), [])).toThrow(
        new ChecksConfigError(
          `check.steps "types" chose no command: got ${shown} (return a command, or null to sit the change out)`
        )
      );
    }
    const sitsOut = { ...config, check: { ...config.check, steps: [{ name: "types", run: () => null }] } };
    expect(checkSteps(sitsOut, [])).toEqual([]);
  });

  it("names the step whose function threw", async () => {
    const config = await loadConfig(join(FIXTURES, "single"));
    const thrower = () => {
      throw new Error("no such input");
    };
    const broken = { ...config, check: { ...config.check, steps: [{ name: "types", run: thrower }] } };
    expect(() => checkSteps(broken, [])).toThrow(
      new ChecksConfigError('check.steps "types" failed to choose a command: no such input')
    );
  });
});

describe("receiptKey", () => {
  it("is the tree and the Node major, so two checkouts of one tree share a receipt", () => {
    expect(receiptKey({ tree: TREE, nodeMajor: "25" })).toBe(`${TREE}-node25`);
  });

  it("refuses anything that is not a tree hash — a ref name would never match again", () => {
    expect(() => receiptKey({ tree: "HEAD", nodeMajor: "25" })).toThrow();
    expect(() => receiptKey({ tree: "", nodeMajor: "25" })).toThrow();
  });
});

describe("isCleanTree", () => {
  it("treats an untracked file as dirty — it is not in the tree the receipt names", () => {
    expect(isCleanTree("")).toBe(true);
    expect(isCleanTree("\n")).toBe(true);
    expect(isCleanTree("?? scratch.ts\n")).toBe(false);
    expect(isCleanTree(" M package.json\n")).toBe(false);
  });
});

describe("gateDirectory", () => {
  it("resolves the relative answer git gives in the main checkout", () => {
    expect(gateDirectory(".git", "/repo", "fixture-gate")).toBe("/repo/.git/fixture-gate");
  });

  it("keeps the absolute answer git gives in a worktree — the same directory", () => {
    expect(gateDirectory("/repo/.git", "/repo/.worktrees/second", "fixture-gate")).toBe(
      "/repo/.git/fixture-gate"
    );
  });
});

describe("isStaleLock", () => {
  const owner = { pid: 42, checkout: "second-checkout", startedAt: "2026-09-20T20:00:00.000Z" };

  it("holds while the owner's process lives, however long it has run", () => {
    expect(isStaleLock({ owner, lockAgeMs: 3_600_000, isAlive: () => true })).toBe(false);
  });

  it("is dead the moment the owner's process is gone", () => {
    expect(isStaleLock({ owner, lockAgeMs: 10, isAlive: () => false })).toBe(true);
  });

  it("gives an ownerless lock a grace period — the acquirer is between mkdir and write", () => {
    const isAlive = () => true;
    expect(isStaleLock({ owner: null, lockAgeMs: 100, isAlive })).toBe(false);
    expect(isStaleLock({ owner: null, lockAgeMs: OWNERLESS_LOCK_GRACE_MS + 1, isAlive })).toBe(
      true
    );
  });
});

describe("describeWait", () => {
  it("names the checkout being waited on and how long it has run", () => {
    const owner = { pid: 42, checkout: "second-checkout", startedAt: "2026-09-20T20:00:00.000Z" };
    expect(describeWait(owner, Date.parse("2026-09-20T20:00:40.000Z"))).toBe(
      "waiting for the verify in second-checkout (pid 42, running 40s)"
    );
  });
});

describe("projectVerdicts", () => {
  it("counts each project's test files and its failed ones", () => {
    expect(
      projectVerdicts([
        { project: "app", state: "passed" },
        { project: "app", state: "failed" },
        { project: "ratchets", state: "passed" },
        { project: "ratchets", state: "skipped" },
      ])
    ).toEqual({ app: { files: 2, failed: 1 }, ratchets: { files: 2, failed: 0 } });
  });

  it("names a project that ran nothing — no related app test is not a missing line", () => {
    expect(projectVerdicts([{ project: "ratchets", state: "passed" }]).app).toEqual({
      files: 0,
      failed: 0,
    });
  });
});

describe("testStepResults", () => {
  const step = { seconds: "41.0", output: "vitest output" };
  /** @param {object} app @param {object} ratchets */
  const report = (app, ratchets, unhandledErrors = 0) =>
    JSON.stringify({ projects: { app, ratchets }, unhandledErrors });
  /** @param {{ name: string, code: number }[]} results */
  const verdicts = (results) => results.map(({ name, code }) => [name, code === 0 ? "passed" : "FAILED"]);

  it("passes both projects, each with its own line", () => {
    const results = testStepResults({
      ...step,
      code: 0,
      reportText: report({ files: 9, failed: 0 }, { files: 122, failed: 0 }),
    });
    expect(verdicts(results)).toEqual([
      ["app", "passed"],
      ["ratchets", "passed"],
    ]);
    expect(results.map((result) => result.files)).toEqual([9, 122]);
  });

  it("names app when an app test fails, and keeps the ratchets green", () => {
    const results = testStepResults({
      ...step,
      code: 1,
      reportText: report({ files: 9, failed: 1 }, { files: 122, failed: 0 }),
    });
    expect(verdicts(results)).toEqual([
      ["app", "FAILED"],
      ["ratchets", "passed"],
    ]);
    expect(results[0].output).toBe("vitest output");
  });

  it("names ratchets when a ratchet fails, and keeps app green", () => {
    expect(
      verdicts(
        testStepResults({
          ...step,
          code: 1,
          reportText: report({ files: 9, failed: 0 }, { files: 122, failed: 2 }),
        })
      )
    ).toEqual([
      ["app", "passed"],
      ["ratchets", "FAILED"],
    ]);
  });

  it("is red as a whole when the process ended without a report", () => {
    for (const reportText of ["", "{not json", "null"]) {
      expect(verdicts(testStepResults({ ...step, code: 1, reportText })), reportText).toEqual([
        ["app and ratchets", "FAILED"],
      ]);
    }
    // Even an exit code of 0 is not a pass without the report that says what ran.
    expect(verdicts(testStepResults({ ...step, code: 0, reportText: "" }))).toEqual([
      ["app and ratchets", "FAILED"],
    ]);
  });

  it("is red on an error no test file owns, or a failed process whose files all passed", () => {
    /** @type {[object, object]} */
    const green = [{ files: 9, failed: 0 }, { files: 122, failed: 0 }];
    expect(
      verdicts(testStepResults({ ...step, code: 1, reportText: report(...green, 1) }))
    ).toEqual([
      ["app", "passed"],
      ["ratchets", "passed"],
      ["an error outside any test file", "FAILED"],
    ]);
    expect(verdicts(testStepResults({ ...step, code: 1, reportText: report(...green) }))).toEqual([
      ["app", "passed"],
      ["ratchets", "passed"],
      ["vitest", "FAILED"],
    ]);
  });
});

describe("expiredReceipts", () => {
  it("names only the receipts past the age limit", () => {
    const now = 1_000_000_000_000;
    expect(
      expiredReceipts(
        [
          { name: "old.json", mtimeMs: now - RECEIPT_MAX_AGE_MS - 1 },
          { name: "fresh.json", mtimeMs: now - 1_000 },
        ],
        now
      )
    ).toEqual(["old.json"]);
  });
});
