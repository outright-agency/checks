/**
 * @param {{ cwd: string, config: ResolvedConfig, force?: boolean }} options
 * @returns {Promise<number>}
 */
export function main({ cwd, config, force }: {
    cwd: string;
    config: ResolvedConfig;
    force?: boolean;
}): Promise<number>;
export type ResolvedConfig = import("../config.mjs").ResolvedConfig;
export type Lane = import("../config.mjs").Lane;
export type ChildProcess = import("node:child_process").ChildProcess;
export type LaneResult = {
    name: string;
    stopped: boolean;
    code: number;
    seconds: number;
    output: string;
};
