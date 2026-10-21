import { describe, expect, it } from "vitest";

import { environmentOf } from "./analyzer.mjs";
import { TESTS_RULES, evaluateTests, formatTestsFindings } from "./policy.mjs";

/** @typedef {import("./analyzer.mjs").TestFile} TestFile */
/** @typedef {import("./policy.mjs").TestsBaseline} TestsBaseline */

/** @param {string} path @param {string} source @returns {TestFile} */
const file = (path, source) => ({
  path,
  source,
  environment: environmentOf(source),
});
/** @type {TestsBaseline} */
const NONE = { debt: [] };
// Built in two halves: Vitest takes a file's environment from the first such docblock anywhere in
// it, string or not, so spelled whole here it would run this file under jsdom.
const JSDOM = `// @vitest-${"environment"} jsdom`;
/** @param {TestFile[]} files @param {TestsBaseline} [baseline] @returns {string[]} */
const found = (files, baseline = NONE) =>
  evaluateTests({ files }, baseline).findings.map(({ rule, line }) => `${rule}@${line}`);

const ENV_WRITTEN = file(
  "src/env-written.test.ts",
  [
    'import { it } from "vitest";',
    'it("writes the environment by hand", () => {',
    '  process.env.TOKEN = "x";',
    '  process.env["OTHER"] = "y";',
    "  delete process.env.TOKEN;",
    '  Object.assign(process.env, { A: "1" });',
    '  globalThis.process.env.B ??= "2";',
    '  (process.env as Record<string, string>).NODE_ENV = "production";',
    '  Reflect.defineProperty(process.env, "C", { value: "3" });',
    "});",
  ].join("\n")
);

const ENV_UNRESTORED = file(
  "src/env-unrestored.test.ts",
  [
    'import { beforeEach, it, vi } from "vitest";',
    'beforeEach(() => vi.stubEnv("TOKEN", "x"));',
    'it("reads it", () => {});',
  ].join("\n")
);

const UNSTUB_BY_REFERENCE = file(
  "src/unstub-by-reference.test.ts",
  [
    'import { afterEach, beforeEach, it, vi } from "vitest";',
    'beforeEach(() => vi.stubEnv("TOKEN", "x"));',
    "afterEach(vi.unstubAllEnvs);",
    'it("reads it", () => {});',
  ].join("\n")
);

const CHDIR = file(
  "src/chdir.test.ts",
  [
    'import { it } from "vitest";',
    'it("moves the process", () => {',
    "  const cwd = process.cwd();",
    '  process.chdir("/tmp");',
    "  globalThis.process.chdir(cwd);",
    "});",
  ].join("\n")
);

const SLEEPS = file(
  "src/sleeps.test.tsx",
  [
    'import { setTimeout as sleep } from "node:timers/promises";',
    'import * as timers from "node:timers/promises";',
    "const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));",
    'it("sleeps four ways", async () => {',
    "  await new Promise((resolve) => { setTimeout(resolve, 260); });",
    "  await new Promise<void>((resolve) => setTimeout(() => resolve(), 50));",
    "  await sleep(20);",
    "  await timers.setTimeout(5);",
    "  await wait(10);",
    "});",
  ].join("\n")
);

const WAITS = file(
  "src/waits.test.tsx",
  [
    JSDOM,
    'import { screen, waitFor, within } from "@testing-library/react";',
    'it("waits its own way", async () => {',
    "  await waitFor(() => expect(1).toBe(1), { timeout: 2000 });",
    '  await screen.findByText("x", undefined, { timeout: 3_000 });',
    '  await within(document.body).findAllByRole("button", { name: "x" }, { timeout });',
    "  await vi.waitFor(() => expect(spy).toHaveBeenCalled());",
    "  await waitFor(() => expect(spy).not.toHaveBeenCalled());",
    "  await vi.waitFor(() => { expect(spy).not.toHaveBeenCalledWith(1); });",
    "  await vi.waitFor(() => expect(spy).toHaveBeenCalled(), 5_000);",
    "  await vi.waitUntil(() => ready);",
    "  await waitFor(() => expect(spy).toHaveBeenCalledTimes(0));",
    "});",
  ].join("\n")
);

const BUDGETS = file(
  "src/budgets.test.ts",
  [
    "// Reads 150000 rows, which names no budget.",
    'describe("budgets", () => {',
    '  it("builds a program", () => {}, 15_000);',
    '  it("reads the tree", { timeout: 30_000 }, () => {});',
    "  beforeAll(() => {}, 20_000);",
    '  it("hides its comment mid-body", () => {',
    "    const a = 1;",
    "    // a note about the assertion",
    "    expect(a).toBe(1);",
    "  }, 12_000);",
    "  const ready = true; // unrelated",
    '  it("is not excused by the line above", () => {}, 18_000);',
    '  it("names its budget by a constant", () => {}, HEAVY);',
    '  it("multiplies its budget", () => {}, 16 * 1000);',
    "  // eslint-disable-next-line vitest/expect-expect",
    '  it("has only a directive above it", () => {}, 17_000);',
    "});",
  ].join("\n")
);

const CLEAN = file(
  "src/clean.test.tsx",
  [
    JSDOM,
    'import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";',
    'import { waitFor } from "@testing-library/react";',
    "",
    "// The heavy tests below end `}, 15_000);`: the form takes about 9 s at load 100.",
    "afterEach(() => vi.unstubAllEnvs());",
    "",
    'describe("clean", () => {',
    "  beforeAll(() => {",
    "    // Reads every file once: a second quiet, longer under load.",
    "  }, 30_000);",
    "",
    "  // Builds a whole TypeScript program per case.",
    '  it("has its reason above it", () => {}, 20_000);',
    "",
    '  it("has its reason opening its body", () => {',
    "    // Drives the whole form.",
    "    void 0;",
    "  }, 25_000);",
    "",
    '  it("shares the file\'s reason", () => {}, 15_000);',
    "",
    '  it("names its number mid-body", () => {',
    "    const a = 1;",
    "    // the probe below is why this test carries 40 s",
    "    expect(a).toBe(1);",
    "  }, 40_000);",
    "",
    "  // Builds the whole graph: HEAVY is its measured budget.",
    '  it("has a constant budget with its reason", () => {}, HEAVY);',
    "",
    '  it("retries, which is no budget", () => {}, { retry: 2 });',
    "",
    '  it("stubs, reads, waits and runs the house way", async () => {',
    '    vi.stubEnv("TOKEN", "x");',
    '    vi.stubEnv("GONE", undefined);',
    "    const token = process.env.TOKEN;",
    "    const copy = { ...process.env };",
    "    const here = process.cwd();",
    '    runCli(["--check"], here);',
    "    expect(process.env.TOKEN).toBe(token ?? copy.TOKEN);",
    "    await new Promise((resolve) => setTimeout(resolve));",
    "    await new Promise((resolve) => setTimeout(resolve, 0));",
    "    setTimeout(() => undefined, 100);",
    "    await waitFor(() => expect(spy).toHaveBeenCalled(), { interval: 5 });",
    "    await waitFor(() => expect(node).not.toBeNull());",
    "    await waitFor(() => expect(node).not.toBeInTheDocument());",
    "    const text = \"process.env.TOKEN = 'x'; delete process.env.TOKEN; process.chdir('/')\";",
    "    void text;",
    "  });",
    "});",
  ].join("\n")
);

const NODE_WAIT = file(
  "src/node-wait.test.ts",
  [
    'import { it, vi } from "vitest";',
    'it("waits in node", async () => {',
    "  await vi.waitFor(() => expect(spy).toHaveBeenCalled());",
    "});",
  ].join("\n")
);

describe("the tests check — every rule can fire", () => {
  it("finds a hand-written environment, in every spelling, cast or not", () => {
    expect(found([ENV_WRITTEN])).toEqual([
      "env-written@3",
      "env-written@4",
      "env-written@5",
      "env-written@6",
      "env-written@7",
      "env-written@8",
      "env-written@9",
    ]);
  });

  it("finds a file that stubs the environment and never puts it back", () => {
    expect(found([ENV_UNRESTORED])).toEqual(["env-unrestored@2"]);
  });

  it("finds a test that changes the process's working directory", () => {
    expect(found([CHDIR])).toEqual(["process-chdir@4", "process-chdir@5"]);
  });

  it("finds a sleep on the real clock, a helper's included, and not its calls", () => {
    expect(found([SLEEPS])).toEqual([
      "real-clock-sleep@3",
      "real-clock-sleep@5",
      "real-clock-sleep@6",
      "real-clock-sleep@7",
      "real-clock-sleep@8",
    ]);
  });

  it("finds a wait with its own timeout, vi's waits in a jsdom test, and a wait for an absence", () => {
    expect(found([WAITS])).toEqual([
      "wait-own-timeout@4",
      "wait-own-timeout@5",
      "wait-own-timeout@6",
      "vi-wait-in-dom@7",
      "wait-for-absence@8",
      "vi-wait-in-dom@9",
      "wait-for-absence@9",
      "vi-wait-in-dom@10",
      "wait-own-timeout@10",
      "vi-wait-in-dom@11",
      "wait-for-absence@12",
    ]);
  });

  it("finds a budget with no reason beside it, in each form", () => {
    expect(found([BUDGETS])).toEqual([
      "budget-without-reason@3",
      "budget-without-reason@4",
      "budget-without-reason@5",
      "budget-without-reason@6",
      "budget-without-reason@12",
      "budget-without-reason@13",
      "budget-without-reason@14",
      "budget-without-reason@16",
    ]);
  });

  it("settles reviewed debt exactly, and says when an entry is stale", () => {
    /** @param {number} count @param {string} [path] */
    const debt = (count, path = ENV_UNRESTORED.path) => ({
      path,
      rule: /** @type {const} */ ("env-unrestored"),
      count,
      issue: "KEY-1",
      reason: "a reviewed exception",
    });
    expect(found([ENV_UNRESTORED], { debt: [debt(1)] })).toEqual([]);
    expect(found([ENV_UNRESTORED], { debt: [debt(2)] })).toEqual(["stale-debt@0"]);
    expect(found([ENV_UNRESTORED], { debt: [debt(1, "src/gone.test.ts"), debt(1)] })).toEqual([
      "stale-debt@0",
    ]);
    // More findings than the entry names: every finding is reported, so the new one shows.
    expect(
      found([ENV_WRITTEN], {
        debt: [
          {
            path: ENV_WRITTEN.path,
            rule: "env-written",
            count: 6,
            issue: "KEY-1",
            reason: "six reviewed",
          },
        ],
      })
    ).toHaveLength(7);
  });

  it("makes every rule fire", () => {
    const seen = new Set(
      [
        ...evaluateTests(
          { files: [ENV_WRITTEN, ENV_UNRESTORED, CHDIR, SLEEPS, WAITS, BUDGETS] },
          NONE
        ).findings,
        ...evaluateTests(
          { files: [ENV_UNRESTORED] },
          {
            debt: [
              {
                path: "src/gone.test.ts",
                rule: "env-unrestored",
                count: 1,
                issue: "KEY-1",
                reason: "a gone file",
              },
            ],
          }
        ).findings,
      ].map(({ rule }) => rule)
    );
    expect([...seen].sort()).toEqual([...TESTS_RULES].sort());
  });
});

describe("the tests check — what it leaves alone", () => {
  it("passes a file that keeps the standard", () => {
    expect(formatTestsFindings(evaluateTests({ files: [CLEAN] }, NONE).findings)).toEqual([]);
  });

  it("lets a node test use vi.waitFor", () => {
    expect(found([NODE_WAIT])).toEqual([]);
  });

  it("takes vi.unstubAllEnvs handed to the hook as the restore", () => {
    expect(found([UNSTUB_BY_REFERENCE])).toEqual([]);
  });

  it("counts what it read", () => {
    const { checked } = evaluateTests({ files: [CLEAN, NODE_WAIT, BUDGETS] }, NONE);
    expect(checked).toEqual({ files: 3, jsdomFiles: 1, parsed: 3, budgets: 14, waits: 4 });
  });

  it("evaluates with no debt when given no baseline", () => {
    expect(evaluateTests({ files: [ENV_UNRESTORED] }).findings.map(({ rule }) => rule)).toEqual([
      "env-unrestored",
    ]);
  });
});
