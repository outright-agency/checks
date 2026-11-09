import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import ts from "typescript";
import { ChecksConfigError, resolveConfig } from "../config.mjs";

/**
 * WHAT EACH DATABASE TEST FILE DOES TO A PROCESS IT WOULD SHARE.
 *
 * Reads a database test file and the test helpers it reaches, by syntax tree, so a comment or a
 * string never counts. A test helper is any file ending `.test.ts` or `.test.tsx` (whatever the
 * app's `files` says: that picks which test files are database tests, and a test file is still a
 * test file), or under a `__tests__/` folder, or under one of the app's `helpers`. The walk follows
 * static imports, re-exports and `import()`, skips what only a type needs, and ends at app code:
 * nothing there holds `vi`, and what app code does at load is `installsAtLoad`.
 *
 *   fake          any use of Vitest's `vi` but the members below, whatever it is called and however
 *                 it is reached, or a way into Vitest this can't read. A member it doesn't know is a
 *                 fake, so a new API can't slip past.
 *   global-state  a call the app names as installing, collecting from a list but its own, or writing
 *                 to a registry; a helper's call at the top of its file; a write to a global or onto
 *                 an imported object; a listener on the process, a matcher, an `import()` of a built
 *                 path.
 *   truncate      SQL that says TRUNCATE, in a string or a template.
 *
 * The app's own words (what installs, what collects, its own list, what writes, what only
 * declares, its helpers' folders, its import prefixes, its setup module) come from its
 * `checks.dbGroups`: this names none of them.
 *
 * What fails closed: a `vi` member it doesn't know, a `process` call it doesn't know, a write to any
 * name the file doesn't declare. A local alias (`const g = globalThis as never`) is read as what it
 * stands for. What a helper does through a value it exports (`export const off = points.add(a)`) is
 * not read.
 *
 * What a registry only adds to stays shared: each file declares its own, once in a process. A clash
 * throws only in a process that holds both files, so the one-process run is what shows it.
 *
 * The check ships switched off: `analyzeDbGroups` refuses an app whose config has no
 * `checks.dbGroups`.
 */

/** @typedef {import("../config.mjs").DbGroupsOn} DbGroupsOn */
/** @typedef {{ kind: "fake" | "global-state" | "truncate", file: string, what: string }} Touch */
/** Where an app's own parts of the check sit, for what a finding says. @typedef {{ lists: string, setup: string | null }} DbGroupsWhere */
/**
 * `files`: each database test file, with what it and the test helpers it reaches do.
 * `installsAtLoad`: app modules, outside the setup, that install at load.
 * @typedef {{ files: { path: string, touches: Touch[] }[], installsAtLoad: string[], where: DbGroupsWhere }} DbGroupsAnalysis
 */
/** @typedef {Readonly<Record<string, string>>} Sources */

const VI_ALLOWED = new Set(["fn", "waitFor", "waitUntil"]);
/** What `process` may be asked: everything else on it changes it. */
const PROCESS_READS = new Set(["cwd", "uptime", "hrtime", "memoryUsage", "nextTick", "emitWarning"]);
const EXPECT_CALLS = new Set(["extend", "addEqualityTesters", "addSnapshotSerializer"]);
/** A call that changes the object it is called on, read on an imported object itself. */
const MUTATORS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "clear", "set", "add", "delete"]);
/** @type {Readonly<Record<string, ReadonlySet<string>>>} */
const WRITERS = {
  Object: new Set(["assign", "defineProperty", "defineProperties", "setPrototypeOf"]),
  Reflect: new Set(["set", "defineProperty", "deleteProperty", "setPrototypeOf"]),
};
/** What a test file calls at its top by design. */
const FILE_CALLS = new Set(["describe", "suite", "it", "test", "beforeAll", "afterAll", "beforeEach", "afterEach"]);
const UNREAD_VITEST = "reaches Vitest some way this check can't read";
const CODE = /\.(?:tsx?|mjs|cjs|jsx?)$/;
const DOT_FOLDER = /(?:^|\/)\./;
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];

/** @param {string} path */
const isTestFile = (path) => /\.test\.tsx?$/.test(path);

/** @param {string} path @param {string} source */
function parse(path, source) {
  const kind = path.endsWith(".tsx") || path.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
}

/** An expression without what only types add: `a` of `(a as never)!`. @param {ts.Expression} node @returns {ts.Expression} */
function bare(node) {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** The identifier a chain of property reads starts from. @param {ts.Expression} node @returns {ts.Identifier | null} */
function rootOf(node) {
  let current = bare(node);
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) current = bare(current.expression);
  return ts.isIdentifier(current) ? current : null;
}

/**
 * The names of one file: what it imports, under what name there, what it declares, and what stands
 * for what.
 * @typedef {{ imported: Map<string, string>, declared: Set<string>, aliases: Map<string, string> }} Names
 */

/** @param {ts.SourceFile} file @returns {Names} */
function namesOf(file) {
  /** @type {Names} */
  const names = { imported: new Map(), declared: new Set(), aliases: new Map() };
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) names.imported.set(clause.name.text, "default");
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.imported.set(bindings.name.text, "*");
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly) names.imported.set(element.name.text, (element.propertyName ?? element.name).text);
      }
    }
  }
  /** @param {ts.BindingName} name @param {string | null} stands */
  const declare = (name, stands) => {
    if (ts.isIdentifier(name)) {
      names.declared.add(name.text);
      if (stands !== null) names.aliases.set(name.text, stands);
      return;
    }
    for (const element of name.elements) if (ts.isBindingElement(element)) declare(element.name, stands);
  };
  /** @param {ts.Node} node */
  const visit = (node) => {
    if (ts.isVariableDeclaration(node)) {
      const value = node.initializer && bare(node.initializer);
      const stands = value && (ts.isIdentifier(value) ? value.text : value.getText() === "process.env" ? "process" : null);
      declare(node.name, stands ?? null);
    } else if (ts.isParameter(node) || ts.isBindingElement(node)) {
      declare(node.name, null);
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      names.declared.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

/** What a name stands for here, followed through local aliases and an import's own name. @param {string} name @param {Names} names */
function meaning(name, names) {
  const seen = new Set();
  let current = name;
  while (names.aliases.has(current) && !seen.has(current)) {
    seen.add(current);
    current = /** @type {string} */ (names.aliases.get(current));
  }
  return names.imported.get(current) ?? current;
}

/** Whether a name is one the file imports, and no local of its own hides it. @param {string} name @param {Names} names */
function isImported(name, names) {
  const stood = names.aliases.get(name) ?? name;
  return names.imported.has(stood) && !names.declared.has(stood);
}

/** Whether a name is a global: the file neither declares nor imports what it stands for. @param {string} name @param {Names} names */
function isGlobal(name, names) {
  const stood = names.aliases.get(name) ?? name;
  return !names.imported.has(stood) && !names.declared.has(stood);
}

/** The local names of Vitest's `vi` in this file: it also exports it as `vitest`. @param {ts.SourceFile} file */
function viNames(file) {
  const names = new Set();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "vitest") continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const own = (element.propertyName ?? element.name).text;
      if (own === "vi" || own === "vitest") names.add(element.name.text);
    }
  }
  return names;
}

/** Whether a `vi` is only a name here, as a key or a member, and no reference to Vitest's. @param {ts.Identifier} node */
function isOnlyAName(node) {
  const { parent } = node;
  return (
    ts.isImportSpecifier(parent) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.propertyName === node) ||
    // A type, as `vi.Mock`, is gone at run time.
    ts.isQualifiedName(parent)
  );
}

/** How a reference to `vi` uses it, or null when that is one of the allowed members. @param {ts.Identifier} node */
function viUse(node) {
  const { parent } = node;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
    return VI_ALLOWED.has(parent.name.text) ? null : `calls vi.${parent.name.text}`;
  }
  return "uses vi some way this check can't read";
}

/**
 * The name a call goes by, and what it is called on: `{ object: a, name: "b" }` of `a.b()` or
 * `a["b"]()`, no object for `b()`.
 * @param {ts.CallExpression} call
 * @returns {{ object: ts.Expression | null, name: string } | null}
 */
function calleeOf(call) {
  const callee = bare(call.expression);
  if (ts.isIdentifier(callee)) return { object: null, name: callee.text };
  if (ts.isPropertyAccessExpression(callee)) return { object: callee.expression, name: callee.name.text };
  if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)) {
    return { object: callee.expression, name: callee.argumentExpression.text };
  }
  return null;
}

/**
 * A call's object as one name, a global's own: `process` of `globalThis.process`, an alias's
 * meaning; null past one name.
 * @param {ts.Expression} object
 * @param {Names} names
 */
function objectName(object, names) {
  const plain = bare(object);
  if (ts.isIdentifier(plain)) return meaning(plain.text, names);
  if (ts.isPropertyAccessExpression(plain) && ts.isIdentifier(plain.expression) && meaning(plain.expression.text, names) === "globalThis") {
    return plain.name.text;
  }
  return null;
}

/** Whether `target` is global state or something imported. @param {ts.Expression} target @param {Names} names */
function isSharedTarget(target, names) {
  const root = rootOf(target);
  if (!root) return false;
  // A name given a new value is that name's own business, unless no file declares it.
  if (bare(target) === root) return !names.declared.has(root.text) && isGlobal(root.text, names);
  return isGlobal(root.text, names) || isImported(root.text, names);
}

/** What a call does to the process, or null. @param {ts.CallExpression} call @param {Names} names @param {DbGroupsOn} on */
function callTouch(call, names, on) {
  if (call.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(call.expression) && call.expression.text === "require")) {
    const [path] = call.arguments;
    return path && ts.isStringLiteralLike(path) ? null : "imports a path this check can't read";
  }
  const callee = calleeOf(call);
  if (!callee) return null;
  const own = callee.object === null ? meaning(callee.name, names) : callee.name;
  if (on.collects.includes(own)) {
    const [list] = call.arguments;
    return on.ownList !== null && list && ts.isIdentifier(list) && list.text === on.ownList ? null : `calls ${own} with its own list`;
  }
  if (callee.object === null) return null;
  const object = objectName(callee.object, names);
  if (on.installs.includes(callee.name)) return `calls ${callee.object.getText()}.${callee.name}`;
  // A registry's write: handed what to keep, or called on its own; with its first argument alone, as a value handed on, it declares.
  const writes = call.arguments.length > 1 || ts.isExpressionStatement(call.parent);
  if (writes && object !== null && on.writes.includes(`${object}.${callee.name}`)) return `calls ${object}.${callee.name} with what it keeps`;
  if (object === "process" && !PROCESS_READS.has(callee.name)) return `calls process.${callee.name}`;
  if (object === "expect" && EXPECT_CALLS.has(callee.name)) return `calls expect.${callee.name}`;
  if (object === "chai" && callee.name === "use") return "calls chai.use";
  if (object !== null && WRITERS[object]?.has(callee.name) && call.arguments[0] && isSharedTarget(call.arguments[0], names)) {
    return `writes through ${object}.${callee.name}`;
  }
  const plain = bare(callee.object);
  if (ts.isIdentifier(plain) && MUTATORS.has(callee.name) && isImported(plain.text, names)) return `changes ${plain.text}, which it imports`;
  return null;
}

/** The target of a write, when `node` is one. @param {ts.Node} node @returns {ts.Expression | null} */
function writeTarget(node) {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    return node.left;
  }
  if (ts.isDeleteExpression(node)) return node.expression;
  if (
    (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return node.operand;
  }
  return null;
}

/** The calls a statement at the top of a file makes as it loads, awaited, voided or in a loop. @param {ts.Statement} statement */
function calledAtLoad(statement) {
  if (ts.isExpressionStatement(statement)) {
    const { expression } = statement;
    const inner = ts.isAwaitExpression(expression) || ts.isVoidExpression(expression) ? expression.expression : expression;
    return ts.isCallExpression(inner) ? [inner] : [];
  }
  if (
    ts.isForStatement(statement) ||
    ts.isForOfStatement(statement) ||
    ts.isForInStatement(statement) ||
    ts.isIfStatement(statement) ||
    ts.isBlock(statement)
  ) {
    /** @type {ts.CallExpression[]} */
    const calls = [];
    /** @param {ts.Node} node */
    const visit = (node) => {
      if (ts.isCallExpression(node)) calls.push(node);
      ts.forEachChild(node, visit);
    };
    visit(statement);
    return calls;
  }
  return [];
}

/**
 * Whether a call at the top of a file changes nothing the next file finds: a test file's own, or a
 * declaration.
 * @param {ts.CallExpression} call
 * @param {string} path
 * @param {Names} names
 * @param {DbGroupsOn} on
 */
function harmlessAtLoad(call, path, names, on) {
  if (call.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  const callee = calleeOf(call);
  /** @type {ts.Expression} */
  let start = call.expression;
  while (ts.isCallExpression(start) || ts.isPropertyAccessExpression(start)) start = start.expression;
  if (ts.isIdentifier(start) && isTestFile(path) && FILE_CALLS.has(meaning(start.text, names))) return true;
  if (callee === null) return false;
  // A collector's own list is callTouch's to read.
  return (on.declares !== null && on.declares.test(callee.name)) || on.collects.includes(callee.name);
}

/**
 * The file an import names: one of the app's prefixes, or a relative path; null for a package.
 * @param {string} from
 * @param {string} specifier
 * @param {Sources} sources
 * @param {DbGroupsOn} on
 */
function resolveModule(from, specifier, sources, on) {
  /** @type {string | null} */
  let base = null;
  for (const [prefix, folder] of Object.entries(on.aliases)) {
    if (specifier.startsWith(prefix)) {
      base = `${folder}${specifier.slice(prefix.length)}`;
      break;
    }
  }
  if (base === null && specifier.startsWith(".")) base = posix.normalize(posix.join(posix.dirname(from), specifier));
  if (base === null) return null;
  for (const extension of EXTENSIONS) {
    if (sources[`${base}${extension}`] !== undefined) return `${base}${extension}`;
  }
  return null;
}

/**
 * What one file does, and the modules it reaches.
 * @param {string} path
 * @param {ts.SourceFile} file
 * @param {Sources} sources
 * @param {DbGroupsOn} on
 * @param {(path: string) => boolean} isTestLand
 */
function readFile(path, file, sources, on, isTestLand) {
  /** @type {Touch[]} */
  const touches = [];
  /** @type {string[]} */
  const reaches = [];
  /** @param {Touch["kind"]} kind @param {string} what */
  const touch = (kind, what) => touches.push({ kind, file: path, what });
  /** @param {string} specifier */
  const follow = (specifier) => {
    const resolved = resolveModule(path, specifier, sources, on);
    if (resolved && isTestLand(resolved)) reaches.push(resolved);
  };

  const names = namesOf(file);
  const vi = viNames(file);
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      const specifier = statement.moduleSpecifier.text;
      const typesOnly =
        clause?.isTypeOnly === true ||
        (!clause?.name &&
          bindings !== undefined &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((element) => element.isTypeOnly));
      if (specifier === "vitest" && bindings && ts.isNamespaceImport(bindings)) touch("fake", UNREAD_VITEST);
      if (specifier.startsWith("@vitest/") && !typesOnly) touch("fake", UNREAD_VITEST);
      if (!typesOnly) follow(specifier);
    }
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      if (statement.moduleSpecifier.text === "vitest") touch("fake", UNREAD_VITEST);
      follow(statement.moduleSpecifier.text);
    }
    for (const call of calledAtLoad(statement)) {
      if (!harmlessAtLoad(call, path, names, on)) touch("global-state", `calls ${calleeOf(call)?.name ?? "something"} when it loads`);
    }
  }

  /** @param {ts.Node} node */
  const visit = (node) => {
    if (ts.isIdentifier(node) && vi.has(node.text) && !isOnlyAName(node)) {
      const use = viUse(node);
      if (use) touch("fake", use);
    }
    if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      const loads = node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require");
      if (loads && first && ts.isStringLiteralLike(first)) {
        if (first.text === "vitest") touch("fake", UNREAD_VITEST);
        else follow(first.text);
      }
      const what = callTouch(node, names, on);
      if (what) touch("global-state", what);
    }
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node)) && /\bTRUNCATE\b/.test(node.text)) touch("truncate", "truncates a table");
    const target = writeTarget(node);
    if (target && isSharedTarget(target, names)) touch("global-state", `writes to ${target.getText()}`);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { touches, reaches };
}

/**
 * The analysis of a tree, as text: every path the app's `files` matches is a database test file.
 * @param {Sources} sources
 * @param {DbGroupsOn} on
 * @returns {DbGroupsAnalysis}
 */
export function analyzeDbGroupSources(sources, on) {
  /** @param {string} path */
  const isTestLand = (path) => isTestFile(path) || path.includes("/__tests__/") || on.helpers.some((folder) => path.startsWith(folder));
  /** @type {Map<string, ts.SourceFile>} */
  const parsed = new Map();
  /** @param {string} path */
  const parseOnce = (path) => {
    let file = parsed.get(path);
    if (!file) parsed.set(path, (file = parse(path, sources[path])));
    return file;
  };
  /** @type {Map<string, ReturnType<typeof readFile>>} */
  const read = new Map();
  /** @param {string} path */
  const of = (path) => {
    let known = read.get(path);
    if (!known) read.set(path, (known = readFile(path, parseOnce(path), sources, on, isTestLand)));
    return known;
  };

  const paths = Object.keys(sources);
  const files = paths
    .filter((path) => on.files.test(path))
    .sort()
    .map((path) => {
      const seen = new Set([path]);
      const queue = [path];
      /** @type {Touch[]} */
      const touches = [];
      for (const next of queue) {
        const { touches: own, reaches } = of(next);
        touches.push(...own);
        for (const reached of reaches) {
          if (seen.has(reached)) continue;
          seen.add(reached);
          queue.push(reached);
        }
      }
      return { path, touches };
    });

  const installsAtLoad = paths
    .filter((path) => path !== on.setup && !isTestLand(path) && on.installs.some((name) => sources[path].includes(`.${name}(`)))
    .filter((path) =>
      parseOnce(path).statements.some((statement) =>
        calledAtLoad(statement).some((call) => on.installs.includes(calleeOf(call)?.name ?? ""))
      )
    )
    .sort();

  return { files, installsAtLoad, where: { lists: on.lists, setup: on.setup } };
}

/**
 * The code files git sees under the roots: tracked, plus untracked ones that are not ignored, none
 * under a dot-folder (a copy).
 * @param {string} root
 * @param {readonly string[]} roots
 * @returns {Record<string, string>}
 */
function listed(root, roots) {
  const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...roots], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  /** @type {Record<string, string>} */
  const sources = {};
  for (const path of new Set(paths.split("\0"))) {
    if (!CODE.test(path) || path.endsWith(".d.ts") || DOT_FOLDER.test(path)) continue;
    const absolute = join(root, path);
    // A tracked file deleted in the working tree is still listed.
    if (!existsSync(absolute)) continue;
    sources[path] = readFileSync(absolute, "utf8");
  }
  return sources;
}

/**
 * The tree's database test files, and what each does to a process it would share.
 * @param {import("../config.mjs").ChecksConfig} config the app's `checks.config.mjs`
 * @param {{ root?: string }} [options]
 * @returns {DbGroupsAnalysis}
 */
export function analyzeDbGroups(config, { root = process.cwd() } = {}) {
  const on = resolveConfig(config).checks.dbGroups;
  if (on === null) throw new ChecksConfigError("checks.dbGroups is not set: the database groups check is off in this app");
  return analyzeDbGroupSources(listed(root, on.roots), on);
}
