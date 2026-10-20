/**
 * The names an app's `name` derives. The helpers need only these, never the app's steps.
 * @param {string} name
 * @returns {Names}
 */
export function namesOf(name: string): Names;
/** Identity: it only gives an app's config file its types. @param {ChecksConfig} config */
export function defineConfig(config: ChecksConfig): ChecksConfig;
/**
 * An app's config, checked and with every default filled.
 * @param {ChecksConfig} config
 * @returns {ResolvedConfig}
 */
export function resolveConfig(config: ChecksConfig): ResolvedConfig;
/**
 * The app's config, from `<root>/checks.config.mjs`.
 * @param {string} root
 * @returns {Promise<ResolvedConfig>}
 */
export function loadConfig(root: string): Promise<ResolvedConfig>;
export const CONFIG_FILE: "checks.config.mjs";
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
export const DEFAULT_RATCHETS: string[];
export const DEFAULT_CHAIN: "pnpm verify:chain";
export const DEFAULT_SUMMARY: RegExp;
/** A mistake in an app's `checks.config.mjs`. The runners print it and exit 2. */
export class ChecksConfigError extends Error {
    /** @param {string} message */
    constructor(message: string);
}
/**
 * A step of the inner loop. `run` is a shell command, or a function that picks one from the paths
 * the change touched and returns `null` when the step sits this change out.
 */
export type Step = {
    name: string;
    run: string | ((context: {
        changed: string[];
    }) => string | null);
};
/**
 * A lane of the full gate: a shell command. A `long` lane is stopped when another lane fails.
 */
export type Lane = {
    name: string;
    run: string;
    long?: boolean | undefined;
};
export type CheckConfig = {
    /**
     * files that must exist before anything runs; the message says what to do
     */
    requires?: {
        path: string;
        message: string;
    }[] | undefined;
    /**
     * in order; `"tests"` is the built-in test step's place
     */
    steps: (Step | "tests")[];
    /**
     * the test step's memory caps
     */
    tests?: {
        workerMemory?: string;
        parentHeapMb?: number;
    } | undefined;
};
export type VerifyConfig = {
    /**
     * run alone, in order, before the lanes; a red one stops the gate
     */
    first?: Lane[] | undefined;
    /**
     * run side by side
     */
    lanes: Lane[];
    /**
     * what a CI run executes instead of the lanes
     */
    chain?: string | undefined;
    /**
     * the lines of a passing lane's output that a pass reprints
     */
    summary?: RegExp | undefined;
};
export type ChecksConfig = {
    /**
     * lower-case letters, digits and dashes, starting with a letter
     */
    name: string;
    /**
     * globs of the tests that read the source as text and run whole
     */
    ratchets?: string[] | undefined;
    check: CheckConfig;
    verify: VerifyConfig;
};
export type Names = {
    gateFolder: string;
    env: {
        noCache: string;
        ratchetBase: string;
    };
};
export type ResolvedConfig = {
    name: string;
    ratchets: string[];
    check: {
        requires: {
            path: string;
            message: string;
        }[];
        steps: (Step | "tests")[];
        tests: {
            workerMemory: string;
            parentHeapMb: number;
        };
    };
    verify: {
        first: Lane[];
        lanes: Lane[];
        chain: string;
        summary: RegExp;
    };
    gateFolder: string;
    env: {
        noCache: string;
        ratchetBase: string;
    };
};
