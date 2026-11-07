import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { ChecksConfigError, DEFAULT_DB_TESTS_FILES, resolveConfig } from "../config.mjs";
import { analysisCache } from "../helpers/analysis-cache.mjs";
import { atBase, changesSince, gitBaseline } from "../helpers/git-baseline.mjs";

/**
 * THE DATABASE TESTS CHECK'S DISCOVERY: every database test git sees under the app's roots, read
 * once, and what a change adds. Each file is parsed once, by `readDbTestFile`, and every rule reads
 * that one result. No opinions: policy.mjs judges.
 *
 * The check ships switched off: `analyzeDbTests` refuses an app whose config has no `checks.dbTests`.
 */

/**
 * `sends`: its own body awaits, or it returns what may be a promise. `cases`: its table's rows, by
 * every table around it.
 * @typedef {{ title: string, line: number, sends: boolean, cases: number }} DbTest
 */
/** @typedef {{ path: string, reason: boolean, tests: DbTest[] }} DbTestFile */
/** An exception to the stop: `tests` new database tests let through, and why. @typedef {{ tests: number, issue: string, reason: string }} StopException */
/**
 * `added`: the tests in the files the change touches, today less at the base. A cut goes below zero.
 * @typedef {{ base: string, added: number, exceptionsAtBase: readonly StopException[] }} DbTestsChange
 */
/** Where an app's own parts of the check sit, for what a finding says. @typedef {{ lists: string, exceptions: string, rule: string }} DbTestsWhere */
/** @typedef {{ files: DbTestFile[], change: DbTestsChange | null, where: DbTestsWhere }} DbTestsAnalysis */

const DOT_FOLDER = /(?:^|\/)\./;
const REASON = /^\/\/ Only a database proves: \S+(?:[ \t]+\S+){2,}[ \t]*$/m;
const TEST_ROOTS = new Set(["it", "test"]);
/** What may follow `it` or `test`: anything else is a value that happens to carry the name (`rows.map((it) => it.toJSON())`). */
const TEST_NAMES = new Set(["only", "skip", "concurrent", "sequential", "fails", "each", "for", "skipIf", "runIf"]);
const TABLE = new Set(["each", "for"]);

/**
 * A call's chain back to its root: `it.skipIf(x)("t", f)` is `it`, with `skipIf`; a table's argument
 * comes with it.
 * @param {ts.CallExpression} call
 * @returns {{ root: string, names: string[], table: ts.Expression | null } | null}
 */
function chainOf(call) {
  /** @type {string[]} */
  const names = [];
  /** @type {ts.Expression | null} */
  let table = null;
  /** @type {ts.Expression} */
  let at = call.expression;
  for (;;) {
    if (ts.isIdentifier(at)) return { root: at.text, names, table };
    if (ts.isPropertyAccessExpression(at)) {
      names.push(at.name.text);
      at = at.expression;
    } else if (ts.isCallExpression(at)) {
      if (ts.isPropertyAccessExpression(at.expression) && TABLE.has(at.expression.name.text)) {
        table = at.arguments[0] ?? null;
      }
      at = at.expression;
    } else if (ts.isTaggedTemplateExpression(at)) {
      at = at.tag;
    } else {
      return null;
    }
  }
}

/** @param {ts.Expression} expression */
function unwrapped(expression) {
  let at = expression;
  while (
    ts.isParenthesizedExpression(at) ||
    ts.isAsExpression(at) ||
    ts.isSatisfiesExpression(at) ||
    ts.isNonNullExpression(at)
  ) {
    at = at.expression;
  }
  return at;
}

/**
 * Whether an `expect(…)` chain holds `.resolves` or `.rejects`, or null when the expression is no
 * such chain.
 * @param {ts.Expression} expression
 * @returns {boolean | null}
 */
function expectSettles(expression) {
  let settles = false;
  let at = expression;
  for (;;) {
    if (ts.isIdentifier(at)) return at.text === "expect" ? settles : null;
    if (ts.isPropertyAccessExpression(at)) {
      if (["resolves", "rejects", "poll"].includes(at.name.text)) settles = true;
      at = at.expression;
    } else if (ts.isCallExpression(at)) {
      at = at.expression;
    } else {
      return null;
    }
  }
}

/**
 * Anything but what plainly isn't one: a literal, an object, an array, a function, or an `expect`
 * that doesn't settle.
 * @param {ts.Expression} returned
 */
function mayBePromise(returned) {
  const expression = unwrapped(returned);
  if (
    ts.isLiteralExpression(expression) ||
    ts.isObjectLiteralExpression(expression) ||
    ts.isArrayLiteralExpression(expression)
  ) {
    return false;
  }
  if (
    ts.isFunctionLike(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression) ||
    ts.isTemplateExpression(expression)
  ) {
    return false;
  }
  if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(expression.kind)) {
    return false;
  }
  return expectSettles(expression) !== false;
}

/**
 * Its own body, nested functions skipped: it awaits, or it returns what may be a promise. One not
 * written in place can't be read.
 * @param {ts.CallExpression} call
 */
function callbackSends(call) {
  const callback = /** @type {ts.ArrowFunction | ts.FunctionExpression | undefined} */ (
    [...call.arguments].reverse().find((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))
  );
  if (callback === undefined) return false;
  let sends = false;
  /** @param {ts.Node} node */
  const walk = (node) => {
    if (sends || ts.isFunctionLike(node)) return;
    if (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier !== undefined)) sends = true;
    else if (ts.isReturnStatement(node) && node.expression !== undefined && mayBePromise(node.expression)) sends = true;
    if (!sends) ts.forEachChild(node, walk);
  };
  if (ts.isBlock(callback.body)) ts.forEachChild(callback.body, walk);
  else walk(callback.body);
  return sends || (!ts.isBlock(callback.body) && mayBePromise(callback.body));
}

/**
 * A file's own `const NAME = [ … ]` tables, by name.
 * @param {ts.SourceFile} source
 */
function tablesOf(source) {
  /** @type {Map<string, number>} */
  const tables = new Map();
  /** @param {ts.Node} node */
  const walk = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      const value = unwrapped(node.initializer);
      if (ts.isArrayLiteralExpression(value)) tables.set(node.name.text, value.elements.length);
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  return tables;
}

/** @param {ts.Expression | null} table @param {ReadonlyMap<string, number>} tables */
function rowsOf(table, tables) {
  if (table === null) return 1;
  const value = unwrapped(table);
  const rows = ts.isArrayLiteralExpression(value)
    ? value.elements.length
    : ts.isIdentifier(value)
      ? (tables.get(value.text) ?? 1)
      : 1;
  return Math.max(rows, 1);
}

/**
 * The one parse of a database test file.
 * @param {string} path
 * @param {string} text
 * @returns {DbTestFile}
 */
export function readDbTestFile(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const tables = tablesOf(source);
  /** @type {DbTest[]} */
  const tests = [];
  /** @param {ts.Node} node @param {number} around */
  const walk = (node, around) => {
    if (!ts.isCallExpression(node)) {
      ts.forEachChild(node, (child) => walk(child, around));
      return;
    }
    const chain = chainOf(node);
    if (chain?.root === "describe" && chain.table !== null) {
      for (const argument of node.arguments) walk(argument, around * rowsOf(chain.table, tables));
      return;
    }
    if (chain !== null && TEST_ROOTS.has(chain.root) && chain.names.every((name) => TEST_NAMES.has(name))) {
      const first = node.arguments[0];
      tests.push({
        title: first === undefined ? "" : ts.isStringLiteralLike(first) ? first.text : first.getText(source),
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        sends: callbackSends(node),
        cases: around * rowsOf(chain.table, tables),
      });
      // A test inside a test is no test here; its callback holds nothing this reads.
      return;
    }
    ts.forEachChild(node, (child) => walk(child, around));
  };
  walk(source, 1);
  return { path, reason: REASON.test(text), tests };
}

/**
 * @param {Readonly<Record<string, string>>} sources
 * @param {DbTestsWhere} where
 * @param {DbTestsChange | null} [change]
 * @returns {DbTestsAnalysis}
 */
export function analyzeDbTestSources(sources, where, change = null) {
  const files = Object.entries(sources)
    .map(([path, text]) => readDbTestFile(path, text))
    .sort((one, other) => one.path.localeCompare(other.path));
  return { files, change, where };
}

/** @param {string} root @param {readonly string[]} roots @param {RegExp} files */
function listed(root, roots, files) {
  const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...roots], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return [...new Set(paths.split("\0"))].filter(
    (path) => files.test(path) && !DOT_FOLDER.test(path) && existsSync(join(root, path))
  );
}

/** @param {DbTestFile} file */
const casesIn = ({ tests }) => tests.reduce((sum, { cases }) => sum + cases, 0);

/**
 * Over the database test files a change touches, their tests today less their tests at the base.
 * @param {readonly string[]} touched
 * @param {readonly DbTestFile[]} today
 * @param {(path: string) => string | null} textAtBase
 * @param {RegExp} [files]
 */
export function newDbTests(touched, today, textAtBase, files = DEFAULT_DB_TESTS_FILES) {
  const paths = touched.filter((path) => files.test(path));
  const held = new Map(today.map((file) => [file.path, file]));
  let added = 0;
  for (const path of paths) {
    const now = held.get(path);
    const then = textAtBase(path);
    added += (now === undefined ? 0 : casesIn(now)) - (then === null ? 0 : casesIn(readDbTestFile(path, then)));
  }
  return added;
}

/**
 * The tree's database tests, and what the change adds against its base.
 * @param {import("../config.mjs").ChecksConfig} config the app's `checks.config.mjs`
 * @param {{ root?: string, env?: Readonly<Record<string, string | undefined>> }} [options]
 * @returns {DbTestsAnalysis}
 */
export function analyzeDbTests(config, { root = process.cwd(), env = process.env } = {}) {
  const on = resolveConfig(config).checks.dbTests;
  if (on === null) throw new ChecksConfigError("checks.dbTests is not set: the database tests check is off in this app");
  const { lists, exceptions, rule, files, roots } = on;
  const { countBase, loadGitBaselineExport } = gitBaseline(config);
  const base = countBase({ env, cwd: root });
  return analysisCache(config).cachedAnalysis("db-tests", root, { base }, () => {
    const sources = Object.fromEntries(
      listed(root, roots, files).map((path) => [path, readFileSync(join(root, path), "utf8")])
    );
    const analysis = analyzeDbTestSources(sources, { lists, exceptions, rule });
    if (base === null) return analysis;
    const added = newDbTests(
      changesSince(base, { cwd: root }).touched,
      analysis.files,
      (path) => atBase(base, path, { cwd: root }),
      files
    );
    const held = atBase(base, exceptions, { cwd: root }) !== null;
    /** @type {readonly StopException[]} */
    const exceptionsAtBase = held ? loadGitBaselineExport(base, exceptions, "STOP_EXCEPTIONS", { cwd: root }) : [];
    return { ...analysis, change: { base, added, exceptionsAtBase } };
  });
}
