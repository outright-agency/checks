/**
 * Exact assertions inside a test whose title says it only proves the scan was not vacuous. Such a
 * test exists so a walker that silently finds half the tree cannot pass every rule by having
 * nothing to judge; `toBeGreaterThan` proves that. An exact count proves it too, and also goes red
 * on every ordinary edit and conflicts between any two branches.
 * @param {readonly SourceText[]} files
 * @returns {ExactCountFinding[]}
 */
export function exactCountsInScanTests(files: readonly SourceText[]): ExactCountFinding[];
/** @typedef {{ script: string, command: string }} SuiteReachFinding */
/**
 * A script with every `pnpm <script>` it calls written out in place, to a depth of six.
 * @param {string} name
 * @param {Readonly<Record<string, string>>} scripts
 * @param {number} [depth]
 * @returns {string}
 */
export function expandScript(name: string, scripts: Readonly<Record<string, string>>, depth?: number): string;
/**
 * Scoped gates (`verify:<x>`) whose expansion contains a `vitest run` with no path — the whole
 * suite. A scoped gate that quietly ends in the suite makes every "run verify:<x> after touching
 * x" cost a full run, and a plan that names two of them pays for two suites.
 *
 * `notScoped` names the app's `verify:<x>` scripts that are not a surface's scoped gate (its full
 * chain, and any other that runs the suite on purpose); `pathRoots` names the folders a test path
 * starts with.
 * @param {Readonly<Record<string, string>>} scripts
 * @param {{ notScoped?: readonly string[], pathRoots?: readonly string[] }} [options]
 * @returns {SuiteReachFinding[]}
 */
export function scopedGatesReachingTheSuite(scripts: Readonly<Record<string, string>>, { notScoped, pathRoots }?: {
    notScoped?: readonly string[];
    pathRoots?: readonly string[];
}): SuiteReachFinding[];
/**
 * A LIVE test analyses the real repository, where a healthy rule finds nothing. Naming a rule
 * there — filtering the findings by its id and expecting none — says the tree is clean; it says
 * nothing about whether the rule CAN fire.
 * @param {string} source
 * @returns {boolean}
 */
export function isLiveTest(source: string): boolean;
/**
 * Every `rule: "<id>"` a folder's non-test files declare.
 * @param {RatchetFolder} folder
 * @returns {string[]}
 */
export function declaredRules(folder: RatchetFolder): string[];
/**
 * `folder:rule` for every declared rule no fixture test names. A rule that cannot fire looks
 * exactly like a rule that is passing: a rule that matches one spelling of an import matches
 * nothing once that spelling is gone, and its live test stays green forever.
 *
 * `provenInALoop` names folders whose fixture test proves every rule without spelling each id — it
 * collects what fired and compares it with the declared set. That is the better pattern, and the
 * marker is checked, not trusted.
 * @param {readonly RatchetFolder[]} folders
 * @param {Readonly<Record<string, { file: string, marker: string }>>} provenInALoop
 * @returns {string[]}
 */
export function unprovenRules(folders: readonly RatchetFolder[], provenInALoop: Readonly<Record<string, {
    file: string;
    marker: string;
}>>): string[];
export type SuiteReachFinding = {
    script: string;
    command: string;
};
export type SourceText = {
    path: string;
    source: string;
};
export type ExactCountFinding = {
    path: string;
    title: string;
    line: number;
    text: string;
};
export type RatchetFolder = {
    name: string;
    files: readonly SourceText[];
};
