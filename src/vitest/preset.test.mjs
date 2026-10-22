import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeConfig } from "vitest/config";
import { SERVER_ONLY_STUB, SETUP_FILE, checksVitestConfig } from "./preset.mjs";

const FIXTURES = fileURLToPath(new URL("../../test/fixtures/", import.meta.url));

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The fixture's raw config, as its `checks.config.mjs` exports it. @param {string} name */
async function fixture(name) {
  return (await import(pathToFileURL(join(FIXTURES, name, "checks.config.mjs")).href)).default;
}

/**
 * A Vitest config's URL, from a path made absolute on this system: `/apps/…` gains the drive on
 * Windows, where a file URL without one is not absolute.
 * @param {string} path
 */
const configAt = (path) => pathToFileURL(resolve(path)).href;
const SINGLE = configAt("/apps/single/vitest.config.mts");

/** @param {any} config @param {string} name */
const project = (config, name) => config.test.projects.find((/** @type {any} */ p) => p.test?.name === name);

describe("checksVitestConfig", () => {
  it("carries the suite's settings and the check's numbers from one module", async () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("VITEST_MAX_WORKERS", undefined);
    vi.stubEnv("OUTRIGHT_CHECKS_MAX_WORKERS", undefined);
    const config = /** @type {any} */ (
      checksVitestConfig(await fixture("single"), { configUrl: SINGLE })
    );
    expect(config.test.pool).toBe("vmForks");
    expect(config.test.vmMemoryLimit).toBe("1GB");
    expect(config.test.testTimeout).toBe(5000);
    expect(config.test.maxWorkers).toBe(4);
    expect(config.test.setupFiles).toEqual([SETUP_FILE]);
    expect(config.test.server.deps.inline).toEqual(["@outright/checks"]);
    expect(config.resolve.alias["server-only"]).toBe(SERVER_ONLY_STUB);

    vi.stubEnv("CI", "true");
    const onCi = /** @type {any} */ (
      checksVitestConfig(await fixture("single"), { configUrl: SINGLE })
    );
    expect(onCi.test.testTimeout).toBe(15000);
  });

  it("takes VITEST_MAX_WORKERS into the root's workers, floored at two, out of the variable Vitest applies to every project", async () => {
    const single = await fixture("single");
    const build = () => /** @type {any} */ (checksVitestConfig(single, { configUrl: SINGLE }));

    vi.stubEnv("OUTRIGHT_CHECKS_MAX_WORKERS", undefined);
    vi.stubEnv("VITEST_MAX_WORKERS", "1");
    expect(build().test.maxWorkers).toBe(2);
    expect(process.env.VITEST_MAX_WORKERS).toBeUndefined();

    vi.stubEnv("OUTRIGHT_CHECKS_MAX_WORKERS", undefined);
    vi.stubEnv("VITEST_MAX_WORKERS", "6");
    expect(build().test.maxWorkers).toBe(6);
    expect(process.env.VITEST_MAX_WORKERS).toBeUndefined();
    // Vitest loads the config again for each project, and again when it changes in watch mode.
    expect(build().test.maxWorkers, "the next load").toBe(6);

    vi.stubEnv("OUTRIGHT_CHECKS_MAX_WORKERS", undefined);
    vi.stubEnv("VITEST_MAX_WORKERS", undefined);
    expect(build().test.maxWorkers).toBe(4);
  });

  it("names the rerun triggers by absolute path, so a checkout inside a dot-directory still reruns", async () => {
    const ABSOLUTE_SETUP = resolve("/tmp/x/shared/setup.ts");
    const config = /** @type {any} */ (
      checksVitestConfig(await fixture("single"), {
        configUrl: configAt("/tmp/x/.hidden/app/vitest.config.ts"),
        setupFiles: ["./test/setup.ts", "@testing-library/jest-dom/vitest", ABSOLUTE_SETUP],
      })
    );
    expect(config.test.forceRerunTriggers).toEqual(
      expect.arrayContaining(
        [
          "/tmp/x/.hidden/app/package.json",
          "/tmp/x/.hidden/app/pnpm-lock.yaml",
          "/tmp/x/.hidden/app/vitest.config.ts",
          "/tmp/x/.hidden/app/checks.config.mjs",
          "/tmp/x/.hidden/app/test/setup.ts",
        ].map((path) => resolve(path))
      )
    );
    expect(config.test.forceRerunTriggers, "a setup file given by an absolute path").toContain(ABSOLUTE_SETUP);
    expect(config.test.forceRerunTriggers).toEqual(expect.arrayContaining(["**/package.json/**"]));
    expect(config.test.forceRerunTriggers.some((/** @type {string} */ t) => t.includes("jest-dom"))).toBe(false);
    expect(config.test.setupFiles).toEqual([SETUP_FILE, "./test/setup.ts", "@testing-library/jest-dom/vitest", ABSOLUTE_SETUP]);
  });

  it("splits app and ratchets by the config's ratchet globs", async () => {
    const config = /** @type {any} */ (
      checksVitestConfig(await fixture("single"), { configUrl: SINGLE })
    );
    expect(project(config, "app").test.exclude).toContain("src/test/**/*.test.ts");
    expect(project(config, "app").test.include).toBeUndefined();
    expect(project(config, "ratchets").test.include).toEqual(["src/test/**/*.test.ts"]);
    expect(project(config, "ratchets").test.exclude).not.toContain("src/test/**/*.test.ts");
    expect(config.test.projects.map((/** @type {any} */ p) => p.test.name)).toEqual(["app", "ratchets"]);
  });

  it("keeps everything the single-project app adds", async () => {
    const options = {
      configUrl: SINGLE,
      app: {
        include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
        exclude: ["src/**/*.db.test.ts"],
      },
    };
    /** The database project, only when its variable asks for it. */
    const db = () =>
      process.env.FIXTURE_DB_TESTS === "1"
        ? [
            {
              extends: /** @type {const} */ (true),
              test: {
                name: "db",
                include: ["src/**/*.db.test.ts"],
                setupFiles: ["./src/test/db/load-env.ts"],
                pool: /** @type {const} */ ("forks"),
                fileParallelism: false,
              },
            },
          ]
        : [];
    const single = await fixture("single");
    const build = () =>
      /** @type {any} */ (
        mergeConfig(
          checksVitestConfig(single, { ...options, projects: db() }),
          {
            resolve: { tsconfigPaths: true },
            test: { environment: "node", globals: false, clearMocks: true },
          }
        )
      );

    const without = build();
    expect(without.resolve.tsconfigPaths).toBe(true);
    expect(without.resolve.alias["server-only"]).toBe(SERVER_ONLY_STUB);
    expect(without.test.clearMocks).toBe(true);
    expect(without.test.globals).toBe(false);
    expect(without.test.environment).toBe("node");
    expect(project(without, "app").test.include).toEqual(["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"]);
    expect(project(without, "app").test.exclude).toEqual(
      expect.arrayContaining(["src/**/*.db.test.ts", "src/test/**/*.test.ts", "**/.*/**"])
    );
    expect(project(without, "db")).toBeUndefined();

    vi.stubEnv("FIXTURE_DB_TESTS", "1");
    const withDb = build();
    expect(project(withDb, "db").test).toEqual({
      name: "db",
      include: ["src/**/*.db.test.ts"],
      setupFiles: ["./src/test/db/load-env.ts"],
      pool: "forks",
      fileParallelism: false,
    });
    expect(withDb.test.projects.map((/** @type {any} */ p) => p.test.name)).toEqual(["app", "ratchets", "db"]);
  });

  it("keeps the monorepo app's own exclusions and aliases", async () => {
    const config = /** @type {any} */ (
      mergeConfig(
        checksVitestConfig(await fixture("monorepo"), {
          configUrl: configAt("/apps/monorepo/vitest.config.ts"),
          exclude: ["dist/**", "packages/*/*/dist/**", "e2e/**", "packages/workflows/**"],
        }),
        { resolve: { alias: { "@": "/apps/monorepo/src", "@example/fields": "/apps/monorepo/packages/fields/src/index.ts" } } }
      )
    );
    for (const excluded of [config.test.exclude, project(config, "app").test.exclude, project(config, "ratchets").test.exclude]) {
      expect(excluded).toEqual(expect.arrayContaining(["packages/*/*/dist/**", "e2e/**", "**/node_modules/**"]));
    }
    expect(config.resolve.alias).toEqual({
      "server-only": SERVER_ONLY_STUB,
      "@": "/apps/monorepo/src",
      "@example/fields": "/apps/monorepo/packages/fields/src/index.ts",
    });
  });

  it("refuses a broken config before building anything", () => {
    expect(() =>
      checksVitestConfig(/** @type {any} */ ({ name: "x", check: { steps: [] }, verify: { lanes: [] } }), {
        configUrl: configAt("/apps/x/vitest.config.ts"),
      })
    ).toThrow("checks.config.mjs: check.steps must list at least one step");
  });
});
