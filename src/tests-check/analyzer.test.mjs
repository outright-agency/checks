import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { analyzeTests, environmentOf, isSuiteTest } from "./analyzer.mjs";

// Built in two halves: Vitest takes a file's environment from the first such docblock anywhere in
// it, string or not, so spelled whole here it would run this file under jsdom.
const VITEST_ENV = "@vitest-" + "environment";
const JEST_ENV = "@jest-" + "environment";

/** @type {string[]} */
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A scratch git repository holding `files`; nothing is committed, so every file is untracked.
 * @param {Record<string, string>} files
 */
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "tests-check-"));
  roots.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return root;
}

const TREE = {
  ".gitignore": "ignored/\n",
  "src/a.test.ts": "it('a', () => {});",
  "src/b.test.tsx": `// ${VITEST_ENV} jsdom\nit('b', () => {});`,
  "src/c.ts": "export const c = 1;",
  "src/d.db.test.ts": "it('d', () => {});",
  "src/ignored/f.test.ts": "it('f', () => {});",
  "src/.snapshot/g.test.ts": "it('g', () => {});",
  "app/h.test.js": "it('h', () => {});",
  "scripts/j.test.mjs": "it('j', () => {});",
  "scripts/k.test.cjs": "it('k', () => {});",
  "src/l.test.jsx": "it('l', () => {});",
  "e2e/m.test.ts": "it('m', () => {});",
};

describe("the tests check's discovery", () => {
  it("reads the suite's tests under the app's roots, tracked or not, and nothing else", () => {
    const root = tree(TREE);
    const { files } = analyzeTests({ root, roots: ["src", "scripts", "app"], skip: /\.db\.test\.ts$/ });
    expect(files.map(({ path, environment }) => `${path} ${environment}`)).toEqual([
      "app/h.test.js node",
      "scripts/j.test.mjs node",
      "scripts/k.test.cjs node",
      "src/a.test.ts node",
      "src/b.test.tsx jsdom",
      "src/l.test.jsx node",
    ]);
  });

  it("reads src and scripts when the app names no roots", () => {
    const root = tree(TREE);
    const paths = analyzeTests({ root }).files.map(({ path }) => path);
    expect(paths).toContain("src/d.db.test.ts");
    expect(paths).toContain("scripts/j.test.mjs");
    expect(paths).not.toContain("app/h.test.js");
    expect(paths).not.toContain("e2e/m.test.ts");
  });

  it("skips a file the index holds but the working tree has deleted", () => {
    const root = tree({
      "src/kept.test.ts": "it('k', () => {});",
      "src/gone.test.ts": "it('g', () => {});",
    });
    execFileSync("git", ["add", "src"], { cwd: root });
    rmSync(join(root, "src/gone.test.ts"));
    expect(analyzeTests({ root }).files.map(({ path }) => path)).toEqual(["src/kept.test.ts"]);
  });

  it("reads the environment as Vitest does: the first docblock anywhere in the file", () => {
    expect(environmentOf(`// ${VITEST_ENV} jsdom\nimport x from 'y';`)).toBe("jsdom");
    expect(environmentOf(`/**\n * ${VITEST_ENV} jsdom\n */`)).toBe("jsdom");
    expect(environmentOf(`// ${JEST_ENV} jsdom`)).toBe("jsdom");
    expect(environmentOf(`// ${VITEST_ENV} happy-dom`)).toBe("jsdom");
    expect(environmentOf(`// ${VITEST_ENV} node`)).toBe("node");
    expect(environmentOf(`// ${VITEST_ENV} node\n// ${VITEST_ENV} jsdom`)).toBe("node");
    // Far down the file, inside a string: Vitest still takes it.
    expect(environmentOf(`${"x".repeat(3_000)}\nconst s = "${VITEST_ENV} jsdom";`)).toBe("jsdom");
    expect(environmentOf("import { render } from '@testing-library/react';")).toBe("node");
  });

  it("knows a suite test by its path", () => {
    expect(isSuiteTest("src/a.test.ts")).toBe(true);
    expect(isSuiteTest("src/a.test.tsx")).toBe(true);
    expect(isSuiteTest("scripts/gate/lib.test.mjs")).toBe(true);
    expect(isSuiteTest("src/a.test.js")).toBe(true);
    expect(isSuiteTest("src/a.ts")).toBe(false);
    expect(isSuiteTest("src/a.db.test.ts")).toBe(true);
    expect(isSuiteTest("src/a.db.test.ts", { skip: /\.db\.test\.ts$/ })).toBe(false);
    expect(isSuiteTest(".worktrees/x/src/a.test.ts")).toBe(false);
    expect(isSuiteTest("src/.cache/a.test.ts")).toBe(false);
  });
});
