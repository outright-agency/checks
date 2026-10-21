/**
 * @param {{ cwd: string, config: ResolvedConfig }} options
 * @returns {Promise<number>}
 */
export function main({ cwd, config }: {
    cwd: string;
    config: ResolvedConfig;
}): Promise<number>;
export type ResolvedConfig = import("../config.mjs").ResolvedConfig;
export type StepResult = import("./lib.mjs").StepResult;
