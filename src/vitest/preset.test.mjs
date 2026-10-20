import { join } from "node:path";
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

/** @param {any} config @param {string} name */
const project = (config, name) => config.test.projects.find((/** @type {any} */ p) => p.test?.name === name);

describe("checksVitestConfig", () => {
  it("carries the suite's settings and the check's numbers from one module", async () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("VITEST_MAX_WORKERS", undefined);
    const config = /** @type {any} */ (
      checksVitestConfig(await fixture("single"), { configUrl: "file:///apps/single/vitest.config.mts" })
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
      checksVitestConfig(await fixture("single"), { configUrl: "file:///apps/single/vitest.config.mts" })
    );
    expect(onCi.test.testTimeout).toBe(15000);
  });

  it("raises one worker to two, on the variable Vitest reads", async () => {
    vi.stubEnv("VITEST_MAX_WORKERS", "1");
    const raised = /** @type {any} */ (
      checksVitestConfig(await fixture("single"), { configUrl: "file:///apps/single/vitest.config.mts" })
    );
    expect(process.env.VITEST_MAX_WORKERS).toBe("2");
    expect(raised.test.maxWorkers).toBe(2);

    vi.stubEnv("VITEST_MAX_WORKERS", "6");
    const kept = /** @type {any} */ (
      checksVitestConfig(await fixture("single"), { configUrl: "file:///apps/single/vitest.config.mts" })
    );
    expect(process.env.VITEST_MAX_WORKERS).toBe("6");
    expect(kept.test.maxWorkers).toBe(6);
  });

  it("names the rerun triggers by absolute path, so a checkout inside a dot-directory still reruns", async () => {
    const config = /** @type {any} */ (
      checksVitestConfig(await fixture("single"), {
        configUrl: "file:///tmp/x/.hidden/app/vitest.config.ts",
        setupFiles: ["./test/setup.ts"],
      })
    );
    expect(config.test.forceRerunTriggers).toEqual(
      expect.arrayContaining([
        "/tmp/x/.hidden/app/package.json",
        "/tmp/x/.hidden/app/pnpm-lock.yaml",
        "/tmp/x/.hidden/app/vitest.config.ts",
        "/tmp/x/.hidden/app/checks.config.mjs",
        "/tmp/x/.hidden/app/test/setup.ts",
      ])
    );
    expect(config.test.forceRerunTriggers).toEqual(expect.arrayContaining(["**/package.json/**"]));
    expect(config.test.setupFiles).toEqual([SETUP_FILE, "./test/setup.ts"]);
  });

  it("splits app and ratchets by the config's ratchet globs", async () => {
    const config = /** @type {any} */ (
      checksVitestConfig(await fixture("single"), { configUrl: "file:///apps/single/vitest.config.mts" })
    );
    expect(project(config, "app").test.exclude).toContain("src/test/**/*.test.ts");
    expect(project(config, "app").test.include).toBeUndefined();
    expect(project(config, "ratchets").test.include).toEqual(["src/test/**/*.test.ts"]);
    expect(project(config, "ratchets").test.exclude).not.toContain("src/test/**/*.test.ts");
    expect(config.test.projects.map((/** @type {any} */ p) => p.test.name)).toEqual(["app", "ratchets"]);
  });

  it("keeps everything the single-project app adds", async () => {
    const options = {
      configUrl: "file:///apps/single/vitest.config.mts",
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
          configUrl: "file:///apps/monorepo/vitest.config.ts",
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
        configUrl: "file:///apps/x/vitest.config.ts",
      })
    ).toThrow("checks.config.mjs: check.steps must list at least one step");
  });
});
