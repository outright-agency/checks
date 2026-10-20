/**
 * Paths from `git status --porcelain -z`: NUL-separated, a rename carrying its old path after it.
 * @param {string} output
 * @returns {string[]}
 */
export function porcelainPaths(output: string): string[];
/**
 * `null` when `repoRoot` is not the top of a git work tree.
 * @param {string} repoRoot
 * @param {AnalysisCacheOptions} [options]
 * @returns {string | null}
 */
export function repositoryStateKey(repoRoot: string, options?: AnalysisCacheOptions): string | null;
/**
 * The analysis cache, bound to an app by its name.
 * @param {{ name: string }} config the app's `checks.config.mjs`, or anything holding its name
 */
export function analysisCache(config: {
    name: string;
}): {
    cachedAnalysis: <T>(name: string, repoRoot: string, inputs: unknown, compute: () => T, options?: AnalysisCacheOptions) => T;
    repositoryStateKey: typeof repositoryStateKey;
};
export type ExecFile = (file: string, args: readonly string[], options: {
    cwd: string;
}) => Buffer;
export type AnalysisCacheOptions = {
    /**
     * injected in tests
     */
    execFile?: ExecFile | undefined;
    /**
     * the app's `<NAME>_GATE_NO_CACHE=1` sets it for one run
     */
    disabled?: boolean | undefined;
};
