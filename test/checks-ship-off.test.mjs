// A check of the package's ships switched off: an app that raises its pin sees nothing turned on,
// because nothing the package runs by itself imports a check. The gate, the preset, the setup file
// and the config run in every app; a check runs only from an app's own live test.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The files of a folder that run in an app. @param {string} folder */
const sources = (folder) =>
  readdirSync(join(ROOT, folder))
    .filter((file) => file.endsWith(".mjs") && !file.endsWith(".test.mjs"))
    .map((file) => `${folder}/${file}`);

const RUNS_BY_ITSELF = [...sources("bin"), ...sources("src/gate"), ...sources("src/vitest"), "src/config.mjs"];

describe("a check ships switched off", () => {
  it("reads the files it judges", () => {
    expect(RUNS_BY_ITSELF.length).toBeGreaterThan(8);
  });

  it("runs no check by itself, so raising the pin turns none on", () => {
    const importing = RUNS_BY_ITSELF.filter((path) =>
      /(?:tests-check|db-tests|db-groups)[/"']/.test(readFileSync(join(ROOT, path), "utf8"))
    );
    expect(importing).toEqual([]);
  });
});
