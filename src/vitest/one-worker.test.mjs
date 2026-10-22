import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanEnv } from "../../test/support/scratch-repo.mjs";
import { SETUP_FILE } from "./preset.mjs";

const VITEST = fileURLToPath(new URL("../../node_modules/vitest/vitest.mjs", import.meta.url));
const PRESET = fileURLToPath(new URL("./preset.mjs", import.meta.url));

/** @type {string[]} */
const made = [];
afterEach(() => {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A folder with two test files that share a module, and a Vitest config: the bare VM pool with
 * the package's setup file, or the preset itself.
 * @param {"bare" | "preset"} config
 */
function twoFiles(config) {
  const root = mkdtempSync(join(tmpdir(), "checks-one-worker-"));
  made.push(root);
  writeFileSync(join(root, "shared.mjs"), "export const seen = [];\n");
  for (const name of ["a", "b"]) {
    writeFileSync(
      join(root, `${name}.test.mjs`),
      `import { seen } from "./shared.mjs";\ntest("${name}", () => { seen.push("${name}"); expect(seen).toEqual(["${name}"]); });\n`
    );
  }
  writeFileSync(
    join(root, "checks.config.mjs"),
    'export default { name: "probe", ratchets: ["ratchets/**/*.test.mjs"], check: { steps: ["tests"] }, verify: { lanes: [{ name: "a", run: "true" }] } };\n'
  );
  writeFileSync(
    join(root, "vitest.config.mjs"),
    config === "bare"
      ? `export default { test: { globals: true, pool: "vmForks", setupFiles: [${JSON.stringify(SETUP_FILE)}] } };\n`
      : `import { checksVitestConfig } from ${JSON.stringify(PRESET)};\nimport checks from "./checks.config.mjs";\nconst config = checksVitestConfig(checks, { configUrl: import.meta.url });\nconfig.test.globals = true;\nexport default config;\n`
  );
  return root;
}

/**
 * A folder whose `serial` project asks for one file at a time, on a process pool, under the
 * preset. Each of its three files claims a marker file that only one may hold, and keeps it
 * 300 ms: two files running side by side would both start inside that time.
 */
function serialProject() {
  const root = mkdtempSync(join(tmpdir(), "checks-serial-"));
  made.push(root);
  for (const name of ["a", "b", "c"]) {
    writeFileSync(
      join(root, `${name}.test.mjs`),
      `import { rmSync, writeFileSync } from "node:fs";\ntest("${name} runs alone", async () => {\n  const busy = new URL("./busy", import.meta.url);\n  writeFileSync(busy, "${name}", { flag: "wx" });\n  await new Promise((resolve) => setTimeout(resolve, 300));\n  rmSync(busy);\n});\n`
    );
  }
  writeFileSync(
    join(root, "checks.config.mjs"),
    'export default { name: "probe", ratchets: ["ratchets/**/*.test.mjs"], check: { steps: ["tests"] }, verify: { lanes: [{ name: "a", run: "true" }] } };\n'
  );
  writeFileSync(
    join(root, "vitest.config.mjs"),
    `import { checksVitestConfig } from ${JSON.stringify(PRESET)};\nimport checks from "./checks.config.mjs";\nconst config = checksVitestConfig(checks, {\n  configUrl: import.meta.url,\n  app: { exclude: ["*.test.mjs"] },\n  projects: [{ extends: true, test: { name: "serial", include: ["*.test.mjs"], pool: "forks", fileParallelism: false } }],\n});\nconfig.test.globals = true;\nexport default config;\n`
  );
  return root;
}

// Each case starts a Vitest of its own, about a second on a quiet machine and two or three on a
// two-core CI runner; 20 s covers both under load.
describe("one worker", () => {
  it("shares one context without the floor, and the setup file fails the run saying why", () => {
    const root = twoFiles("bare");
    const run = spawnSync(process.execPath, [VITEST, "run", "--root", root], {
      env: cleanEnv({ VITEST_MAX_WORKERS: "1" }),
      encoding: "utf8",
    });
    expect(run.status).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toContain("Two test files ran in one VM context");
  }, 20_000);

  it("fails a run the preset cannot floor, naming the flag", () => {
    const root = twoFiles("preset");
    const env = cleanEnv();
    delete env.VITEST_MAX_WORKERS;
    const run = spawnSync(process.execPath, [VITEST, "run", "--root", root, "--no-file-parallelism"], {
      env,
      encoding: "utf8",
    });
    expect(run.status).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toContain("this comes from --no-file-parallelism");
  }, 20_000);

  it("never shares a context under the preset, which raises the workers to two", () => {
    const root = twoFiles("preset");
    const run = spawnSync(process.execPath, [VITEST, "run", "--root", root], {
      env: cleanEnv({ VITEST_MAX_WORKERS: "1" }),
      encoding: "utf8",
    });
    expect(`${run.stdout}${run.stderr}`).toContain("2 passed");
    expect(run.status).toBe(0);
  }, 20_000);

  it("runs a project's files one at a time when it asks, with VITEST_MAX_WORKERS=2", () => {
    const root = serialProject();
    const run = spawnSync(process.execPath, [VITEST, "run", "--root", root], {
      env: cleanEnv({ VITEST_MAX_WORKERS: "2" }),
      encoding: "utf8",
    });
    expect(`${run.stdout}${run.stderr}`).toContain("3 passed");
    expect(run.status).toBe(0);
  }, 20_000);
});
