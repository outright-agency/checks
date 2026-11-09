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
export const DEFAULT_RATCHETS: string[];
export const DEFAULT_CHAIN: "pnpm verify:chain";
export const DEFAULT_SUMMARY: RegExp;
export const DEFAULT_DB_TESTS_FILES: RegExp;
export const DEFAULT_DB_TESTS_ROOTS: string[];
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
/**
 * The database tests check, turned on: where an app's own parts of it sit.
 */
export type DbTestsSwitch = {
    /**
     * the file an app's existing tests are listed in
     */
    lists: string;
    /**
     * the file holding the stop's exceptions; it exports `STOP_EXCEPTIONS`
     */
    exceptions: string;
    /**
     * the doc a finding points to
     */
    rule: string;
    /**
     * which test files are database tests; `/\.db\.test\.ts$/` by default
     */
    files?: RegExp | undefined;
    /**
     * the folders they live under; `["src"]` by default
     */
    roots?: string[] | undefined;
};
/**
 * The database groups check, turned on: what is the app's own of it. The app's words reach the
 * check only through here, so the package names none of them.
 */
export type DbGroupsSwitch = {
    /**
     * the file the app's lists of files kept apart and run alone sit in; a finding names it
     */
    lists: string;
    /**
     * the one app module that may install at load: what the shared group's setup loads
     */
    setup?: string | undefined;
    /**
     * folders of test helpers, beyond `*.test.*` files and `__tests__/` folders
     */
    helpers?: string[] | undefined;
    /**
     * an import's prefix and the folder it stands for, as `{ "~/": "src/" }`
     */
    aliases?: Record<string, string> | undefined;
    /**
     * methods that install what they are handed: a call to one changes global state
     */
    installs?: string[] | undefined;
    /**
     * functions that collect from a list and install it: a call changes global state, but for `ownList`
     */
    collects?: string[] | undefined;
    /**
     * the app's own list, which the shared setup installs: collecting it changes nothing
     */
    ownList?: string | undefined;
    /**
     * `object.method` calls that write to a registry when handed what to keep, or called as a statement
     */
    writes?: string[] | undefined;
    /**
     * a call at load whose name matches only declares (adds to a registry, changes nothing there): harmless at load
     */
    declares?: RegExp | undefined;
    /**
     * which test files are database tests; `/\.db\.test\.ts$/` by default
     */
    files?: RegExp | undefined;
    /**
     * the folders the check reads; `["src"]` by default
     */
    roots?: string[] | undefined;
};
export type DbGroupsOn = Required<Omit<DbGroupsSwitch, "setup" | "ownList" | "declares">> & {
    setup: string | null;
    ownList: string | null;
    declares: RegExp | null;
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
    /**
     * the package's checks this app turns on; each ships off
     */
    checks?: {
        dbTests?: DbTestsSwitch;
        dbGroups?: DbGroupsSwitch;
    } | undefined;
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
    checks: {
        dbTests: Required<DbTestsSwitch> | null;
        dbGroups: DbGroupsOn | null;
    };
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
