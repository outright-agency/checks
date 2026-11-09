// An app's checks, declared in one file at its root: `checks.config.mjs`. Everything that is the
// app's own lives there — its name, its ratchet tests, the steps of its inner loop, the lanes of
// its full gate — and nothing that is one app's lives in this package.
//
// One `name` derives the rest of what is the app's: the folder in the git common directory that
// holds the gate's receipts and lock (`<name>-gate`), and the environment variables that turn the
// analysis cache off (`<NAME>_GATE_NO_CACHE`) and carry CI's base commit
// (`<NAME>_RATCHET_BASE_SHA`). An app that already had such names keeps them by choosing the name
// they were made from.
//
// A check of the package's ships switched off: raising the pin turns nothing on. An app turns one
// on under `checks`, with what is its own, and its live test hands the engine its lists.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CHECK_PARENT_HEAP_MB, CHECK_WORKER_MEMORY } from "./limits.mjs";

export const CONFIG_FILE = "checks.config.mjs";

/**
 * A step of the inner loop. `run` is a shell command, or a function that picks one from the paths
 * the change touched and returns `null` when the step sits this change out.
 * @typedef {object} Step
 * @property {string} name
 * @property {string | ((context: { changed: string[] }) => string | null)} run
 */

/**
 * A lane of the full gate: a shell command. A `long` lane is stopped when another lane fails.
 * @typedef {object} Lane
 * @property {string} name
 * @property {string} run
 * @property {boolean} [long]
 */

/**
 * @typedef {object} CheckConfig
 * @property {{ path: string, message: string }[]} [requires] files that must exist before anything runs; the message says what to do
 * @property {(Step | "tests")[]} steps in order; `"tests"` is the built-in test step's place
 * @property {{ workerMemory?: string, parentHeapMb?: number }} [tests] the test step's memory caps
 */

/**
 * @typedef {object} VerifyConfig
 * @property {Lane[]} [first] run alone, in order, before the lanes; a red one stops the gate
 * @property {Lane[]} lanes run side by side
 * @property {string} [chain] what a CI run executes instead of the lanes
 * @property {RegExp} [summary] the lines of a passing lane's output that a pass reprints
 */

/**
 * The database tests check, turned on: where an app's own parts of it sit.
 * @typedef {object} DbTestsSwitch
 * @property {string} lists the file an app's existing tests are listed in
 * @property {string} exceptions the file holding the stop's exceptions; it exports `STOP_EXCEPTIONS`
 * @property {string} rule the doc a finding points to
 * @property {RegExp} [files] which test files are database tests; `/\.db\.test\.ts$/` by default
 * @property {string[]} [roots] the folders they live under; `["src"]` by default
 */

/**
 * The database groups check, turned on: what is the app's own of it. The app's words reach the
 * check only through here, so the package names none of them.
 * @typedef {object} DbGroupsSwitch
 * @property {string} lists the file the app's lists of files kept apart and run alone sit in; a finding names it
 * @property {string} [setup] the one app module that may install at load: what the shared group's setup loads
 * @property {string[]} [helpers] folders of test helpers, beyond `*.test.*` files and `__tests__/` folders
 * @property {Record<string, string>} [aliases] an import's prefix and the folder it stands for, as `{ "~/": "src/" }`
 * @property {string[]} [installs] methods that install what they are handed: a call to one changes global state
 * @property {string[]} [collects] functions that collect from a list and install it: a call changes global state, but for `ownList`
 * @property {string} [ownList] the app's own list, which the shared setup installs: collecting it changes nothing
 * @property {string[]} [writes] `object.method` calls that write to a registry when handed what to keep, or called as a statement
 * @property {RegExp} [declares] a call at load whose name matches only declares (adds to a registry, changes nothing there): harmless at load
 * @property {RegExp} [files] which test files are database tests; `/\.db\.test\.ts$/` by default
 * @property {string[]} [roots] the folders the check reads; `["src"]` by default
 */

/** @typedef {Required<Omit<DbGroupsSwitch, "setup" | "ownList" | "declares">> & { setup: string | null, ownList: string | null, declares: RegExp | null }} DbGroupsOn */

/**
 * @typedef {object} ChecksConfig
 * @property {string} name lower-case letters, digits and dashes, starting with a letter
 * @property {string[]} [ratchets] globs of the tests that read the source as text and run whole
 * @property {{ dbTests?: DbTestsSwitch, dbGroups?: DbGroupsSwitch }} [checks] the package's checks this app turns on; each ships off
 * @property {CheckConfig} check
 * @property {VerifyConfig} verify
 */

/**
 * @typedef {object} Names
 * @property {string} gateFolder
 * @property {{ noCache: string, ratchetBase: string }} env
 */

/**
 * @typedef {object} ResolvedConfig
 * @property {string} name
 * @property {string[]} ratchets
 * @property {{ dbTests: Required<DbTestsSwitch> | null, dbGroups: DbGroupsOn | null }} checks
 * @property {{ requires: { path: string, message: string }[], steps: (Step | "tests")[], tests: { workerMemory: string, parentHeapMb: number } }} check
 * @property {{ first: Lane[], lanes: Lane[], chain: string, summary: RegExp }} verify
 * @property {string} gateFolder
 * @property {{ noCache: string, ratchetBase: string }} env
 */

export const DEFAULT_RATCHETS = ["src/test/**/*.test.ts"];
export const DEFAULT_CHAIN = "pnpm verify:chain";
export const DEFAULT_SUMMARY = /ratchet passed|Test Files|Tests {2}/;
export const DEFAULT_DB_TESTS_FILES = /\.db\.test\.ts$/;
export const DEFAULT_DB_TESTS_ROOTS = ["src"];

/** A mistake in an app's `checks.config.mjs`. The runners print it and exit 2. */
export class ChecksConfigError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(`${CONFIG_FILE}: ${message}`);
    this.name = "ChecksConfigError";
  }
}

/** @param {string} message @returns {never} */
function refuse(message) {
  throw new ChecksConfigError(message);
}

/**
 * The names an app's `name` derives. The helpers need only these, never the app's steps.
 * @param {string} name
 * @returns {Names}
 */
export function namesOf(name) {
  if (typeof name !== "string" || !/^[a-z][a-z0-9-]*$/.test(name)) {
    refuse(
      `name must be lower-case letters, digits and dashes, starting with a letter: got ${JSON.stringify(name)}`
    );
  }
  const prefix = name.toUpperCase().replaceAll("-", "_");
  return {
    gateFolder: `${name}-gate`,
    env: { noCache: `${prefix}_GATE_NO_CACHE`, ratchetBase: `${prefix}_RATCHET_BASE_SHA` },
  };
}

/** Identity: it only gives an app's config file its types. @param {ChecksConfig} config */
export function defineConfig(config) {
  return config;
}

/** The keys the schema names, level by level. */
const SHAPE = {
  "": ["name", "ratchets", "checks", "check", "verify"],
  checks: ["dbTests", "dbGroups"],
  "checks.dbTests": ["lists", "exceptions", "rule", "files", "roots"],
  "checks.dbGroups": ["lists", "setup", "helpers", "aliases", "installs", "collects", "ownList", "writes", "declares", "files", "roots"],
  check: ["requires", "steps", "tests"],
  "check.tests": ["workerMemory", "parentHeapMb"],
  verify: ["first", "lanes", "chain", "summary"],
};

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every key at a level the schema does not name, as dotted paths.
 * @param {unknown} config
 * @returns {string[]}
 */
function unknownKeys(config) {
  /** @type {string[]} */
  const unknown = [];
  for (const [level, keys] of Object.entries(SHAPE)) {
    /** @type {unknown} */
    let node = config;
    for (const part of level ? level.split(".") : []) node = isRecord(node) ? node[part] : undefined;
    if (!isRecord(node)) continue;
    for (const key of Object.keys(node)) {
      if (!keys.includes(key)) unknown.push(level ? `${level}.${key}` : key);
    }
  }
  const { check, verify } = isRecord(config) ? config : {};
  const entries = [
    ["check.requires", isRecord(check) ? check.requires : undefined, ["path", "message"]],
    ["check.steps", isRecord(check) ? check.steps : undefined, ["name", "run"]],
    ["verify.first", isRecord(verify) ? verify.first : undefined, ["name", "run", "long"]],
    ["verify.lanes", isRecord(verify) ? verify.lanes : undefined, ["name", "run", "long"]],
  ];
  for (const [path, list, keys] of /** @type {[string, unknown, string[]][]} */ (entries)) {
    if (!Array.isArray(list)) continue;
    list.forEach((entry, index) => {
      if (!isRecord(entry)) return;
      for (const key of Object.keys(entry)) {
        if (!keys.includes(key)) unknown.push(`${path}[${index}].${key}`);
      }
    });
  }
  return unknown;
}

/** @param {unknown} value @returns {value is string} */
const isText = (value) => typeof value === "string" && value.trim().length > 0;

/**
 * A pattern `test()` can use for one path after another: `g` and `y` make it remember where it
 * stopped.
 * @param {RegExp} pattern
 */
const stateless = (pattern) => new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));

/**
 * The database tests check's switch, checked and with its defaults filled; null when it is off.
 * @param {unknown} checks
 * @returns {Required<DbTestsSwitch> | null}
 */
function resolveDbTests(checks) {
  if (checks === undefined) return null;
  if (!isRecord(checks)) refuse("checks must be an object");
  const on = checks.dbTests;
  if (on === undefined) return null;
  if (!isRecord(on) || !isText(on.lists) || !isText(on.exceptions) || !isText(on.rule)) {
    refuse("checks.dbTests needs lists, exceptions and rule");
  }
  const files = on.files ?? DEFAULT_DB_TESTS_FILES;
  if (!(files instanceof RegExp)) refuse("checks.dbTests.files must be a regular expression");
  const roots = on.roots ?? DEFAULT_DB_TESTS_ROOTS;
  if (!Array.isArray(roots) || roots.length === 0 || !roots.every(isText)) {
    refuse("checks.dbTests.roots must list at least one folder");
  }
  return { lists: on.lists, exceptions: on.exceptions, rule: on.rule, files: stateless(files), roots };
}

const NAME = /^[A-Za-z_$][\w$]*$/;
const CALL = /^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/;

/** @param {string} folder */
const slashed = (folder) => (folder.endsWith("/") ? folder : `${folder}/`);

/**
 * A list of names, or the default when absent.
 * @param {unknown} value
 * @param {RegExp} shape
 * @param {string} message
 * @returns {string[]}
 */
function namesIn(value, shape, message) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((name) => typeof name === "string" && shape.test(name))) refuse(message);
  return value;
}

/**
 * The database groups check's switch, checked and with its defaults filled; null when it is off.
 * @param {unknown} checks
 * @returns {DbGroupsOn | null}
 */
function resolveDbGroups(checks) {
  if (!isRecord(checks)) return null;
  const on = checks.dbGroups;
  if (on === undefined) return null;
  if (!isRecord(on) || !isText(on.lists)) refuse("checks.dbGroups needs lists");
  if (on.setup !== undefined && !isText(on.setup)) refuse("checks.dbGroups.setup must be a path");
  const helpers = on.helpers ?? [];
  if (!Array.isArray(helpers) || !helpers.every(isText)) refuse("checks.dbGroups.helpers must list folders");
  const aliases = on.aliases ?? {};
  if (!isRecord(aliases) || !Object.entries(aliases).every(([prefix, folder]) => isText(prefix) && isText(folder))) {
    refuse("checks.dbGroups.aliases must map each prefix to a folder");
  }
  const installs = namesIn(on.installs, NAME, "checks.dbGroups.installs must list names");
  const collects = namesIn(on.collects, NAME, "checks.dbGroups.collects must list names");
  if (on.ownList !== undefined && !(typeof on.ownList === "string" && NAME.test(on.ownList))) {
    refuse("checks.dbGroups.ownList must be a name");
  }
  const writes = namesIn(on.writes, CALL, "checks.dbGroups.writes must list calls as object.method");
  if (on.declares !== undefined && !(on.declares instanceof RegExp)) refuse("checks.dbGroups.declares must be a regular expression");
  const files = on.files ?? DEFAULT_DB_TESTS_FILES;
  if (!(files instanceof RegExp)) refuse("checks.dbGroups.files must be a regular expression");
  const roots = on.roots ?? DEFAULT_DB_TESTS_ROOTS;
  if (!Array.isArray(roots) || roots.length === 0 || !roots.every(isText)) {
    refuse("checks.dbGroups.roots must list at least one folder");
  }
  return {
    lists: on.lists,
    setup: on.setup ?? null,
    helpers: helpers.map(slashed),
    aliases: Object.fromEntries(
      Object.entries(/** @type {Record<string, string>} */ (aliases)).map(([prefix, folder]) => [slashed(prefix), slashed(folder)])
    ),
    installs,
    collects,
    ownList: /** @type {string | undefined} */ (on.ownList) ?? null,
    writes,
    declares: on.declares instanceof RegExp ? stateless(on.declares) : null,
    files: stateless(files),
    roots,
  };
}

/**
 * An app's config, checked and with every default filled.
 * @param {ChecksConfig} config
 * @returns {ResolvedConfig}
 */
export function resolveConfig(config) {
  if (!isRecord(config)) refuse("the default export must be the config object");
  const [unknown] = unknownKeys(config);
  if (unknown) refuse(`unknown key ${unknown}`);

  const names = namesOf(config.name);

  const ratchets = config.ratchets ?? DEFAULT_RATCHETS;
  if (!Array.isArray(ratchets) || ratchets.length === 0 || !ratchets.every(isText)) {
    refuse("ratchets must list at least one glob");
  }

  const check = isRecord(config.check) ? config.check : /** @type {CheckConfig} */ ({});
  const requires = check.requires ?? [];
  if (!Array.isArray(requires)) refuse("check.requires must be a list");
  requires.forEach((entry, index) => {
    if (!isRecord(entry) || !isText(entry.path) || !isText(entry.message)) {
      refuse(`check.requires[${index}] needs a path and a message`);
    }
  });

  const steps = check.steps;
  if (!Array.isArray(steps) || steps.length === 0) refuse("check.steps must list at least one step");
  steps.forEach((step, index) => {
    if (step === "tests") return;
    if (!isRecord(step) || !isText(step.name) || !(isText(step.run) || typeof step.run === "function")) {
      refuse(`check.steps[${index}] needs a name and a run`);
    }
  });
  if (steps.filter((step) => step === "tests").length > 1) {
    refuse(`"tests" appears more than once in check.steps`);
  }

  const tests = {
    workerMemory: check.tests?.workerMemory ?? CHECK_WORKER_MEMORY,
    parentHeapMb: check.tests?.parentHeapMb ?? CHECK_PARENT_HEAP_MB,
  };
  if (!isText(tests.workerMemory)) refuse("check.tests.workerMemory must be a size, as \"512MB\"");
  if (!Number.isInteger(tests.parentHeapMb) || tests.parentHeapMb <= 0) {
    refuse("check.tests.parentHeapMb must be a whole number of megabytes");
  }

  const verify = isRecord(config.verify) ? config.verify : /** @type {VerifyConfig} */ ({});
  const lanes = verify.lanes;
  if (!Array.isArray(lanes) || lanes.length === 0) refuse("verify.lanes must list at least one lane");
  const first = verify.first ?? [];
  if (!Array.isArray(first)) refuse("verify.first must be a list");
  for (const [key, list] of /** @type {[string, unknown[]][]} */ ([["first", first], ["lanes", lanes]])) {
    list.forEach((lane, index) => {
      if (!isRecord(lane) || !isText(lane.name) || !isText(lane.run)) {
        refuse(`verify.${key}[${index}] needs a name and a run`);
      }
    });
  }

  const stepNames = steps.map((step) => (step === "tests" ? "tests" : step.name));
  const twiceStep = stepNames.find((name, index) => stepNames.indexOf(name) !== index);
  if (twiceStep) refuse(`check.steps names "${twiceStep}" twice`);
  // The tests step reports one line per project, under the project's name.
  const reserved = stepNames.find((name) => name === "app" || name === "ratchets");
  if (reserved && stepNames.includes("tests")) {
    refuse(`check.steps names "${reserved}", the name of one of the tests step's lines`);
  }
  const laneNames = [...first, ...lanes].map((lane) => lane.name);
  const twiceLane = laneNames.find((name, index) => laneNames.indexOf(name) !== index);
  if (twiceLane) refuse(`verify names "${twiceLane}" twice`);

  const chain = verify.chain ?? DEFAULT_CHAIN;
  if (!isText(chain)) refuse("verify.chain must be a command");
  const given = verify.summary ?? DEFAULT_SUMMARY;
  if (!(given instanceof RegExp)) refuse("verify.summary must be a regular expression");
  const summary = stateless(given);

  return {
    name: config.name,
    ratchets,
    checks: { dbTests: resolveDbTests(config.checks), dbGroups: resolveDbGroups(config.checks) },
    check: { requires, steps, tests },
    verify: { first, lanes, chain, summary },
    ...names,
  };
}

/**
 * The app's config, from `<root>/checks.config.mjs`.
 * @param {string} root
 * @returns {Promise<ResolvedConfig>}
 */
export async function loadConfig(root) {
  const path = join(root, CONFIG_FILE);
  if (!existsSync(path)) {
    refuse(`no ${CONFIG_FILE} in ${root}: an app declares its checks there (see the package's README)`);
  }
  const module = await import(pathToFileURL(path).href);
  return resolveConfig(module.default);
}
