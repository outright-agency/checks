/**
 * The test runner's settings for an app, from its checks config.
 * @param {ChecksConfig} config the app's `checks.config.mjs`
 * @param {PresetOptions} options
 * @returns {import("vitest/config").ViteUserConfig}
 */
export function checksVitestConfig(config: ChecksConfig, options: PresetOptions): import("vitest/config").ViteUserConfig;
/** @typedef {import("../config.mjs").ChecksConfig} ChecksConfig */
/** @typedef {import("vitest/config").TestProjectInlineConfiguration} TestProjectInlineConfiguration */
/**
 * @typedef {object} PresetOptions
 * @property {string} configUrl the app's Vitest config, as `import.meta.url`
 * @property {string[]} [exclude] the app's own exclusions, added to node_modules and dot-directories
 * @property {string[]} [setupFiles] the app's own setup files, run after the package's; a path (`./…`) is also a rerun trigger
 * @property {{ include?: string[], exclude?: string[] }} [app] the `app` project's own include and exclusions
 * @property {TestProjectInlineConfiguration[]} [projects] projects beyond `app` and `ratchets`
 */
export const SETUP_FILE: string;
export const SERVER_ONLY_STUB: string;
export type ChecksConfig = import("../config.mjs").ChecksConfig;
export type TestProjectInlineConfiguration = import("vitest/config").TestProjectInlineConfiguration;
export type PresetOptions = {
    /**
     * the app's Vitest config, as `import.meta.url`
     */
    configUrl: string;
    /**
     * the app's own exclusions, added to node_modules and dot-directories
     */
    exclude?: string[] | undefined;
    /**
     * the app's own setup files, run after the package's; a path (`./…`) is also a rerun trigger
     */
    setupFiles?: string[] | undefined;
    /**
     * the `app` project's own include and exclusions
     */
    app?: {
        include?: string[];
        exclude?: string[];
    } | undefined;
    /**
     * projects beyond `app` and `ratchets`
     */
    projects?: import("vitest/config").TestProjectInlineConfiguration[] | undefined;
};
