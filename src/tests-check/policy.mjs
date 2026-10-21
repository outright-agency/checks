import ts from "typescript";

/**
 * THE TESTS CHECK — the parts of a fast-test standard a machine can hold.
 *
 *   env-written            a test writes `process.env` itself (assigns, deletes, Object.assign)
 *                          instead of `vi.stubEnv`, so nothing puts it back for the next file
 *   env-unrestored         a file stubs the environment and never calls `vi.unstubAllEnvs`
 *   process-chdir          a test changes the process's working directory
 *   real-clock-sleep       a promise resolved by a real timer with a delay: a sleep
 *   wait-own-timeout       a wait that names its own timeout, overriding the suite's
 *   vi-wait-in-dom         `vi.waitFor` or `vi.waitUntil` in a DOM test, which ignores the longer
 *                          wait the setup gives Testing Library on CI
 *   wait-for-absence       a wait for a mock not to have been called: it passes on its first try
 *   budget-without-reason  a test's own budget with no comment beside it saying why
 *   stale-debt             a debt entry the tree has fewer of than it names: lower it, or remove it
 *
 * The rules read the syntax tree, not one spelling of it. A file is parsed only when its text
 * could hold a finding, so reading every test stays cheap.
 */

/** @typedef {import("./analyzer.mjs").TestFile} TestFile */
/** @typedef {import("./analyzer.mjs").TestsAnalysis} TestsAnalysis */

export const TESTS_RULES = /** @type {const} */ ([
  "budget-without-reason",
  "env-unrestored",
  "env-written",
  "process-chdir",
  "real-clock-sleep",
  "stale-debt",
  "vi-wait-in-dom",
  "wait-for-absence",
  "wait-own-timeout",
]);

/** @typedef {(typeof TESTS_RULES)[number]} TestsRule */
/** @typedef {{ rule: TestsRule, path: string, line: number, text: string }} TestsFinding */
/**
 * Reviewed debt, exactly: `count` findings of `rule` in `path`, cleared by `issue`.
 * @typedef {{ path: string, rule: TestsRule, count: number, issue: string, reason: string }} TestsDebt
 */
/** @typedef {{ debt: readonly TestsDebt[] }} TestsBaseline */
/** @typedef {{ files: number, jsdomFiles: number, parsed: number, budgets: number, waits: number }} TestsChecked */
/** @typedef {{ findings: TestsFinding[], checked: TestsChecked }} TestsResult */

/**
 * A file is parsed only when its text could hold a finding: one of the names the rules read, or
 * the end of a call that may be a budget (`15_000)`, `* 1000)`, `}, HEAVY)`).
 */
const CANDIDATE =
  /process\.(?:env|chdir)|stubEnv|setTimeout|waitFor|waitUntil|find(?:All)?By|timeout\s*:|\d_?\d{3}\s*\)|\}\s*,\s*[A-Z][A-Z0-9_]*\s*\)/;

/** The calls a budget can sit on: a test, a suite, a hook. */
const TEST_CALLS = new Set(["it", "test", "describe", "beforeAll", "beforeEach", "afterAll", "afterEach"]);
const TEST_MODIFIERS = new Set([
  "only",
  "skip",
  "todo",
  "each",
  "for",
  "concurrent",
  "sequential",
  "fails",
  "skipIf",
  "runIf",
]);
/** Assertions that hold before anything has happened. */
const NEVER_CALLED = new Set([
  "toHaveBeenCalled",
  "toHaveBeenCalledWith",
  "toHaveBeenCalledTimes",
  "toHaveBeenCalledOnce",
  "toHaveBeenLastCalledWith",
  "toHaveBeenNthCalledWith",
  "toBeCalled",
  "toBeCalledWith",
  "toBeCalledTimes",
]);
/** @type {ReadonlySet<ts.SyntaxKind>} */
const ASSIGNMENTS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
]);

/**
 * The names a call is made by, outermost first: `it.each(…)(…)` is it, each;
 * `within(x).findByRole` is within, findByRole; `expect(a).not.toBe` is expect, not, toBe.
 * @param {ts.Expression} expression
 * @returns {string[]}
 */
function calleeChain(expression) {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression)) {
    return [...calleeChain(expression.expression), expression.name.text];
  }
  if (
    ts.isCallExpression(expression) ||
    ts.isParenthesizedExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return calleeChain(expression.expression);
  }
  return [];
}

/** @param {readonly string[]} chain */
function isTestCall(chain) {
  return (
    chain.length > 0 && TEST_CALLS.has(chain[0]) && chain.slice(1).every((name) => TEST_MODIFIERS.has(name))
  );
}

/** @param {readonly string[]} chain */
function isWaitCall(chain) {
  const last = chain.at(-1) ?? "";
  if (chain[0] === "vi" && chain.length === 2) return last === "waitFor" || last === "waitUntil";
  return last === "waitFor" || last === "waitForElementToBeRemoved" || /^find(?:All)?By[A-Z]/.test(last);
}

/**
 * `process.chdir(…)`, or `globalThis.process.chdir(…)`.
 * @param {readonly string[]} chain
 */
function isChdir(chain) {
  const at = chain[0] === "globalThis" ? 1 : 0;
  return chain.length === at + 2 && chain[at] === "process" && chain[at + 1] === "chdir";
}

/**
 * The expression inside parentheses, a cast, a `satisfies` or a `!`: what it is, not how it is
 * typed.
 * @param {ts.Node} node
 * @returns {ts.Node}
 */
function unwrap(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * `process.env`, or `globalThis.process.env`, however it is cast.
 * @param {ts.Node} node
 */
function isProcessEnv(node) {
  const env = unwrap(node);
  if (!ts.isPropertyAccessExpression(env) || env.name.text !== "env") return false;
  const owner = unwrap(env.expression);
  if (ts.isIdentifier(owner)) return owner.text === "process";
  return (
    ts.isPropertyAccessExpression(owner) &&
    owner.name.text === "process" &&
    ts.isIdentifier(owner.expression) &&
    owner.expression.text === "globalThis"
  );
}

/** @param {ts.Node} node */
function isEnvEntry(node) {
  const entry = unwrap(node);
  return (
    (ts.isPropertyAccessExpression(entry) || ts.isElementAccessExpression(entry)) &&
    isProcessEnv(entry.expression)
  );
}

/**
 * The calls that write the object handed to them first.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const OBJECT_WRITES = {
  Object: ["assign", "defineProperty", "defineProperties"],
  Reflect: ["set", "deleteProperty", "defineProperty"],
};

/** @param {ts.Node} node */
function writesEnv(node) {
  if (ts.isBinaryExpression(node) && ASSIGNMENTS.has(node.operatorToken.kind)) {
    return isEnvEntry(node.left) || isProcessEnv(node.left);
  }
  if (ts.isDeleteExpression(node)) return isEnvEntry(node.expression);
  if (ts.isCallExpression(node) && node.arguments[0] && isProcessEnv(node.arguments[0])) {
    const [owner, method] = calleeChain(node.expression);
    return OBJECT_WRITES[owner]?.includes(method) ?? false;
  }
  return false;
}

/** @param {ts.NumericLiteral} literal */
const numberOf = (literal) => Number(literal.text.replace(/_/g, ""));

/**
 * A number written as a literal or a product of literals (`15_000`, `15 * 1000`), else null.
 * @param {ts.Node} node
 * @returns {number | null}
 */
function constantOf(node) {
  const value = unwrap(node);
  if (ts.isNumericLiteral(value)) return numberOf(value);
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.AsteriskToken) {
    const left = constantOf(value.left);
    const right = constantOf(value.right);
    return left === null || right === null ? null : left * right;
  }
  return null;
}

/** @param {ts.Expression | undefined} node */
const isZero = (node) => node === undefined || constantOf(node) === 0;

/**
 * How timers/promises is imported: the local names of its `setTimeout` (`import { setTimeout as
 * sleep }`), where the call is itself a sleep, and the names of the module itself (`import * as
 * timers`, or its default), whose `.setTimeout` is.
 * @param {ts.SourceFile} source
 * @returns {{ names: Set<string>, modules: Set<string> }}
 */
function promiseTimers(source) {
  /** @type {Set<string>} */
  const names = new Set();
  /** @type {Set<string>} */
  const modules = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!/^(?:node:)?timers\/promises$/.test(statement.moduleSpecifier.text)) continue;
    const clause = statement.importClause;
    if (clause?.name) modules.add(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) modules.add(bindings.name.text);
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === "setTimeout") names.add(element.name.text);
    }
  }
  return { names, modules };
}

/**
 * @param {ts.Node} node
 * @returns {node is ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | ts.MethodDeclaration}
 */
function isFunctionNode(node) {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node)
  );
}

/**
 * Whether the nearest function around `node` is the executor of a `new Promise(…)`.
 * @param {ts.Node} node
 */
function inPromiseExecutor(node) {
  /** @type {ts.Node | undefined} */
  let current = node.parent;
  while (current && !isFunctionNode(current)) current = current.parent;
  const holder = current?.parent;
  return (
    !!current &&
    !!holder &&
    ts.isNewExpression(holder) &&
    ts.isIdentifier(holder.expression) &&
    holder.expression.text === "Promise" &&
    holder.arguments?.[0] === current
  );
}

/**
 * @param {ts.CallExpression} node
 * @param {readonly string[]} chain
 * @param {{ names: Set<string>, modules: Set<string> }} timers
 */
function isSleep(node, chain, timers) {
  const name = chain.at(-1) ?? "";
  // timers/promises' setTimeout resolves after its first argument.
  if (chain.length === 1 && timers.names.has(name)) return !isZero(node.arguments[0]);
  if (chain.length === 2 && timers.modules.has(chain[0]) && name === "setTimeout") {
    return !isZero(node.arguments[0]);
  }
  const onTheGlobal =
    chain.length === 1 || (chain.length === 2 && (chain[0] === "globalThis" || chain[0] === "window"));
  return onTheGlobal && name === "setTimeout" && !isZero(node.arguments[1]) && inPromiseExecutor(node);
}

/**
 * An options object's `timeout` entry, if it has one.
 * @param {ts.Expression} argument
 * @returns {ts.ObjectLiteralElementLike | undefined}
 */
function timeoutEntryOf(argument) {
  if (!ts.isObjectLiteralExpression(argument)) return undefined;
  return argument.properties.find(
    (property) => property.name !== undefined && ts.isIdentifier(property.name) && property.name.text === "timeout"
  );
}

/**
 * A wait's own timeout: a `timeout` option, or Vitest's number in place of the options.
 * @param {ts.CallExpression} node
 * @param {readonly string[]} chain
 */
function namesItsOwnTimeout(node, chain) {
  const [, second] = node.arguments;
  if (chain[0] === "vi" && second && !ts.isObjectLiteralExpression(second)) return true;
  return node.arguments.some((argument) => timeoutEntryOf(argument) !== undefined);
}

/**
 * `expect(spy).not.toHaveBeenCalled…(…)`, or `expect(spy).toHaveBeenCalledTimes(0)`.
 * @param {ts.CallExpression} call
 */
function assertsNeverCalled(call) {
  const chain = calleeChain(call.expression);
  if (chain[0] !== "expect") return false;
  if (chain.length === 3 && chain[1] === "not") return NEVER_CALLED.has(chain[2]);
  return (
    chain.length === 2 &&
    (chain[1] === "toHaveBeenCalledTimes" || chain[1] === "toBeCalledTimes") &&
    call.arguments.length === 1 &&
    constantOf(call.arguments[0]) === 0
  );
}

/** @param {ts.CallExpression} node */
function waitsForAbsence(node) {
  const callback = node.arguments[0];
  if (!callback || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) return false;
  /** @type {ts.Expression | undefined} */
  let expression;
  if (ts.isBlock(callback.body)) {
    const [only, ...rest] = callback.body.statements;
    if (!only || rest.length > 0) return false;
    if (ts.isExpressionStatement(only)) expression = only.expression;
    else if (ts.isReturnStatement(only)) expression = only.expression;
  } else {
    expression = callback.body;
  }
  while (expression && (ts.isParenthesizedExpression(expression) || ts.isAwaitExpression(expression))) {
    expression = expression.expression;
  }
  return !!expression && ts.isCallExpression(expression) && assertsNeverCalled(expression);
}

/** @typedef {{ call: ts.CallExpression, ms: number | null }} Budget */

/**
 * A test's own budget: an argument after its function that is neither a function, an options
 * object nor a name (`}, 15_000)`, `}, 15 * 1000)`, `}, HEAVY)`), or an options object's `timeout`.
 * @param {ts.CallExpression} node
 * @returns {Budget | null}
 */
function budgetOf(node) {
  const { arguments: args } = node;
  const last = args.at(-1);
  const callbackAt = args.findIndex((argument) => isFunctionNode(argument));
  if (
    last &&
    args.length >= 2 &&
    !isFunctionNode(last) &&
    !ts.isObjectLiteralExpression(last) &&
    !ts.isStringLiteralLike(last) &&
    (constantOf(last) !== null || (callbackAt >= 0 && callbackAt < args.length - 1))
  ) {
    return { call: node, ms: constantOf(last) };
  }
  for (const argument of args) {
    const timeout = timeoutEntryOf(argument);
    if (!timeout) continue;
    const ms = ts.isPropertyAssignment(timeout) ? constantOf(timeout.initializer) : null;
    return { call: node, ms };
  }
  return null;
}

/** @typedef {{ pos: number, end: number, text: string }} Comment */

/**
 * Every comment in the file, in order: the leading and trailing trivia of every node and every
 * token (`getChildren`, not `forEachChild`, so a comment alone in an empty block, which only its
 * closing brace's trivia holds, is found too). Built only for a file that has a budget.
 * @param {ts.SourceFile} source
 * @returns {Comment[]}
 */
function commentsOf(source) {
  const text = source.getFullText();
  /** @type {Map<number, Comment>} */
  const seen = new Map();
  /** @param {readonly ts.CommentRange[] | undefined} ranges */
  const collect = (ranges) => {
    for (const { pos, end } of ranges ?? []) seen.set(pos, { pos, end, text: text.slice(pos, end) });
  };
  /** @param {ts.Node} node */
  const visit = (node) => {
    collect(ts.getLeadingCommentRanges(text, node.pos));
    collect(ts.getTrailingCommentRanges(text, node.end));
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);
  return [...seen.values()].sort((a, b) => a.pos - b.pos);
}

/**
 * The statement a call stands in: the node whose parent is a block or the file.
 * @param {ts.Node} node
 */
function statementOf(node) {
  let current = node;
  while (current.parent && !ts.isBlock(current.parent) && !ts.isSourceFile(current.parent)) {
    current = current.parent;
  }
  return current;
}

/**
 * Where a comment that opens a test's body sits: from its `{` to its first statement, or its `}`.
 * @param {ts.CallExpression} call
 * @returns {{ from: number, to: number } | null}
 */
function bodyOpening(call) {
  const callback = call.arguments.find(
    /** @returns {argument is ts.ArrowFunction | ts.FunctionExpression} */
    (argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)
  );
  if (!callback || !ts.isBlock(callback.body)) return null;
  const { body } = callback;
  const first = body.statements[0];
  return { from: body.getStart() + 1, to: first ? first.getStart() : body.getEnd() - 1 };
}

/**
 * How a comment names a budget of `ms`: 15000, 15_000, 15 s, 15s, 15-second, 15 seconds.
 * @param {number} ms
 */
function spellingsOf(ms) {
  const forms = [String(ms)];
  if (ms >= 1_000) forms.push(`${Math.floor(ms / 1_000)}_${String(ms % 1_000).padStart(3, "0")}`);
  if (ms % 1_000 === 0) {
    const seconds = ms / 1_000;
    forms.push(`${seconds}\\s?s\\b`, `${seconds}-second`, `${seconds} seconds`);
  }
  return new RegExp(`(?<![\\d_.])(?:${forms.join("|")})(?![\\d_])`);
}

/** A comment that instructs a tool (`eslint-disable-next-line`, `@ts-expect-error`): never a reason. */
const DIRECTIVE =
  /^\/[/*]\s*(?:eslint|@ts-|prettier-ignore|istanbul\b|c8\b|v8\b|biome-ignore|@vitest-environment)/;

/**
 * A budget's reason is beside it: a comment on the lines just above its statement, a comment that
 * opens its body, or a comment that names its number, inside the call or earlier in the file (a
 * family of tests that share one reason shares one comment, which names the number). Any other
 * comment inside the body is about something else, and a tool's directive is no reason at all.
 * @param {Budget} budget
 * @param {ts.SourceFile} source
 * @param {readonly Comment[]} comments
 */
function hasReason({ call, ms }, source, comments) {
  const text = source.getFullText();
  /** @param {{ pos: number, end: number }} comment */
  const isReason = (comment) => !DIRECTIVE.test(text.slice(comment.pos, comment.end));
  // Leading comment ranges skip a comment on the previous statement's own line.
  const above = ts.getLeadingCommentRanges(text, statementOf(call).getFullStart()) ?? [];
  if (above.some(isReason)) return true;
  const opening = bodyOpening(call);
  if (
    opening &&
    comments.some((comment) => comment.pos >= opening.from && comment.end <= opening.to && isReason(comment))
  ) {
    return true;
  }
  if (ms === null) return false;
  const names = spellingsOf(ms);
  return comments.some((comment) => comment.end <= call.getEnd() && names.test(comment.text));
}

/** @param {string} path */
function scriptKindOf(path) {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  return /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

/**
 * @param {TestFile} file
 * @param {TestsChecked} checked
 * @returns {TestsFinding[]}
 */
function findingsIn(file, checked) {
  const source = ts.createSourceFile(file.path, file.source, ts.ScriptTarget.Latest, true, scriptKindOf(file.path));
  const lines = file.source.split("\n");
  const timers = promiseTimers(source);
  /** @type {TestsFinding[]} */
  const findings = [];
  /** @param {TestsRule} rule @param {ts.Node} node */
  const found = (rule, node) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    findings.push({ rule, path: file.path, line: line + 1, text: (lines[line] ?? "").trim() });
  };
  /** @type {Comment[] | null} */
  let comments = null;
  /** @type {ts.Node | null} */
  let firstStub = null;
  let unstubs = false;

  /** @param {ts.Node} node */
  const visit = (node) => {
    if (writesEnv(node)) found("env-written", node);
    // Called, or handed over as the hook itself: `afterEach(vi.unstubAllEnvs)`.
    if (ts.isPropertyAccessExpression(node) && calleeChain(node).join(".") === "vi.unstubAllEnvs") {
      unstubs = true;
    }
    if (ts.isCallExpression(node)) {
      const chain = calleeChain(node.expression);
      const onVi = chain.length === 2 && chain[0] === "vi";
      if (onVi && chain[1] === "stubEnv") firstStub ??= node;
      if (isChdir(chain)) found("process-chdir", node);
      if (isSleep(node, chain, timers)) found("real-clock-sleep", node);
      if (isWaitCall(chain)) {
        checked.waits += 1;
        if (namesItsOwnTimeout(node, chain)) found("wait-own-timeout", node);
        if (file.environment === "jsdom" && onVi) found("vi-wait-in-dom", node);
        if (waitsForAbsence(node)) found("wait-for-absence", node);
      } else if (isTestCall(chain)) {
        const budget = budgetOf(node);
        if (budget) {
          checked.budgets += 1;
          comments ??= commentsOf(source);
          if (!hasReason(budget, source, comments)) found("budget-without-reason", node);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (firstStub && !unstubs) found("env-unrestored", firstStub);
  return findings;
}

/** @param {string} path @param {string} rule */
const key = (path, rule) => `${path}\0${rule}`;

/**
 * Takes the reviewed debt out, exactly; a debt entry the tree has fewer of is `stale-debt`.
 * @param {readonly TestsFinding[]} raw
 * @param {TestsBaseline} baseline
 * @param {TestsAnalysis} analysis
 * @returns {TestsFinding[]}
 */
function settle(raw, baseline, analysis) {
  /** @type {Map<string, TestsFinding[]>} */
  const groups = new Map();
  for (const finding of raw) {
    const group = key(finding.path, finding.rule);
    groups.set(group, [...(groups.get(group) ?? []), finding]);
  }
  const debts = new Map(baseline.debt.map((entry) => [key(entry.path, entry.rule), entry]));
  /** @type {TestsFinding[]} */
  const findings = [];
  for (const [group, members] of groups) {
    const debt = debts.get(group);
    if (debt && members.length <= debt.count) continue;
    findings.push(...members);
  }
  const paths = new Set(analysis.files.map(({ path }) => path));
  for (const entry of baseline.debt) {
    const actual = groups.get(key(entry.path, entry.rule))?.length ?? 0;
    if (actual >= entry.count) continue;
    findings.push({
      rule: "stale-debt",
      path: entry.path,
      line: 0,
      text: `${entry.rule}: ${entry.count} in the baseline, ${actual} in the tree${
        paths.has(entry.path) ? "" : " (the file is gone)"
      }`,
    });
  }
  return findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.rule.localeCompare(b.rule));
}

/**
 * Judges every test the analysis read, and settles the findings against the reviewed debt (none
 * when no baseline is given). `checked` counts what was read, for the live test's floors.
 * @param {TestsAnalysis} analysis
 * @param {TestsBaseline} [baseline]
 * @returns {TestsResult}
 */
export function evaluateTests(analysis, baseline = { debt: [] }) {
  /** @type {TestsChecked} */
  const checked = { files: analysis.files.length, jsdomFiles: 0, parsed: 0, budgets: 0, waits: 0 };
  /** @type {TestsFinding[]} */
  const raw = [];
  for (const file of analysis.files) {
    if (file.environment === "jsdom") checked.jsdomFiles += 1;
    if (!CANDIDATE.test(file.source)) continue;
    checked.parsed += 1;
    raw.push(...findingsIn(file, checked));
  }
  return { findings: settle(raw, baseline, analysis), checked };
}

/**
 * One line per finding: `path:line rule: text`.
 * @param {readonly TestsFinding[]} findings
 * @returns {string[]}
 */
export function formatTestsFindings(findings) {
  return findings.map(({ rule, path, line, text }) => `${path}:${line} ${rule}: ${text}`);
}
