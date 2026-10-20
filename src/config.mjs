// An app's checks, declared in one file at its root: `checks.config.mjs`. Everything that is the
// app's own lives there — its name, its ratchet tests, the steps of its inner loop, the lanes of
// its full gate — and nothing that is one app's lives in this package.
//
// One `name` derives the rest of what is the app's: the folder in the git common directory that
// holds the gate's receipts and lock (`<name>-gate`), and the environment variables that turn the
// analysis cache off (`<NAME>_GATE_NO_CACHE`) and carry CI's base commit
// (`<NAME>_RATCHET_BASE_SHA`). An app that already had such names keeps them by choosing the name
// they were made from.

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
 * @typedef {object} ChecksConfig
 * @property {string} name lower-case letters, digits and dashes, starting with a letter
 * @property {string[]} [ratchets] globs of the tests that read the source as text and run whole
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
 * @property {{ requires: { path: string, message: string }[], steps: (Step | "tests")[], tests: { workerMemory: string, parentHeapMb: number } }} check
 * @property {{ first: Lane[], lanes: Lane[], chain: string, summary: RegExp }} verify
 * @property {string} gateFolder
 * @property {{ noCache: string, ratchetBase: string }} env
 */

export const DEFAULT_RATCHETS = ["src/test/**/*.test.ts"];
export const DEFAULT_CHAIN = "pnpm verify:chain";
export const DEFAULT_SUMMARY = /ratchet passed|Test Files|Tests {2}/;

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
  "": ["name", "ratchets", "check", "verify"],
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
  const summary = verify.summary ?? DEFAULT_SUMMARY;
  if (!(summary instanceof RegExp)) refuse("verify.summary must be a regular expression");

  return {
    name: config.name,
    ratchets,
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
