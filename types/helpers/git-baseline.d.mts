/**
 * Whether a baseline file exists at the ratchet base — the question a ratchet has to ask on the
 * branch that INTRODUCES it, because there is nothing on the base to compare against yet.
 *
 * The distinction this draws is the whole point. A base commit that cannot be resolved is a fetch
 * problem (a shallow clone), and that must stay loud: it throws here rather than reporting the
 * file as absent, so a broken CI checkout can never be mistaken for a first landing. A resolvable
 * base that simply does not carry the file is the bootstrap case, and the caller may treat it as
 * "no prior baseline" — which is honest, since none exists.
 *
 * This replaces pinning a seed commit by hand. A hardcoded SHA names the base a branch was cut
 * from, so it silently stops matching the moment anything else merges first.
 * @param {string} baseSha
 * @param {string} filePath
 * @param {GitBaselineOptions} [options]
 * @returns {boolean}
 */
export function baselineExistsAtBase(baseSha: string, filePath: string, options?: GitBaselineOptions): boolean;
/**
 * Loads a TypeScript baseline export directly from a git blob. Baseline modules hold only data,
 * local helpers and type-only imports; runtime imports are refused, so the historical file cannot
 * execute arbitrary repository code.
 * @template T
 * @param {string} baseSha
 * @param {string} filePath
 * @param {string} exportName
 * @param {GitBaselineOptions} [options]
 * @returns {T}
 */
export function loadGitBaselineExport<T>(baseSha: string, filePath: string, exportName: string, options?: GitBaselineOptions): T;
/**
 * A historical subject in today's spelling.
 *
 * A baseline is keyed by subject, and a subject is a path — or a compound key built from several
 * (`cycle:a|b`, `a=>b`, `file|table|join`). When an app moves a folder, a base commit from before
 * the move spells those keys the old way, and a monotonic comparison against it would read the
 * whole reviewed list as debt added since the base — the opposite of what it exists to say.
 *
 * What such a comparison asks is whether a subject was REVIEWED at the base, not how it was spelt
 * there, so the historical spelling is mapped forward first. This never relaxes a rule: a
 * genuinely new subject has no record at the base under any spelling. Once a base carries the move
 * the mapping is a no-op.
 *
 * A subject may have lived through more than one move, so the pairs are applied until none
 * matches; each pair must move a path strictly toward today's spelling (no pair's `to` leads back
 * to an earlier pair's `from`), so the loop ends. List a longer `from` before a shorter one it
 * starts with. Only a path that starts at the repository's root moves: a nested `src/` inside a
 * package or `node_modules` is left as it is.
 * @param {string} subject
 * @param {readonly MovedRoot[]} movedRoots
 * @returns {string}
 */
export function toCurrentPathSpelling(subject: string, movedRoots: readonly MovedRoot[]): string;
/**
 * The git baseline helpers, bound to an app by its name and its moved folders.
 * @param {{ name: string }} config the app's `checks.config.mjs`, or anything holding its name
 * @param {{ movedRoots?: readonly MovedRoot[] }} [options]
 */
export function gitBaseline(config: {
    name: string;
}, { movedRoots }?: {
    movedRoots?: readonly MovedRoot[];
}): {
    resolveRatchetBase: (options?: GitBaselineOptions) => string;
    baselineExistsAtBase: typeof baselineExistsAtBase;
    loadGitBaselineExport: typeof loadGitBaselineExport;
    /** @param {string} subject */
    toCurrentPathSpelling: (subject: string) => string;
    /**
     * A baseline family keyed by subject, rekeyed in today's spelling.
     * @template T
     * @param {Readonly<Record<string, T>>} records
     * @returns {Readonly<Record<string, T>>}
     */
    withCurrentPathKeys: <T>(records: Readonly<Record<string, T>>) => Readonly<Record<string, T>>;
};
export type ExecFile = (file: string, args: readonly string[], options: {
    cwd: string;
    encoding: "utf8";
}) => string;
export type GitBaselineOptions = {
    cwd?: string | undefined;
    env?: Readonly<Record<string, string | undefined>> | undefined;
    execFile?: ExecFile | undefined;
};
export type MovedRoot = readonly [string, string];
