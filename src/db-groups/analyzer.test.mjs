import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scratchRepo } from "../../test/support/scratch-repo.mjs";
import { analyzeDbGroups } from "./analyzer.mjs";

const FAKES = 'import { vi } from "vitest";\nvi.mock("./x");\n';
const CONFIG = "export default {};\n";
const APP = {
  name: "my-app",
  check: { steps: ["tests"] },
  verify: { lanes: [{ name: "suite", run: "pnpm test" }] },
};
const ON = { lists: "src/test/groups.ts", setup: "src/app/setup.ts" };

describe("the database groups check's discovery", () => {
  it("refuses to run in an app that hasn't turned it on", () => {
    expect(() => analyzeDbGroups(/** @type {any} */ (APP), { root: process.cwd() })).toThrow(
      "checks.dbGroups is not set: the database groups check is off in this app"
    );
  });

  it("reads what git sees under the roots, and nothing in a dot-folder", () => {
    const root = scratchRepo(CONFIG, { ".gitignore": "src/c.db.test.ts\n", "src/a.db.test.ts": FAKES, "src/.copy/d.db.test.ts": FAKES });
    writeFileSync(join(root, "src/b.db.test.ts"), FAKES);
    writeFileSync(join(root, "src/c.db.test.ts"), FAKES);
    mkdirSync(join(root, "lib"), { recursive: true });
    writeFileSync(join(root, "lib/e.db.test.ts"), FAKES);
    const analysis = analyzeDbGroups(/** @type {any} */ ({ ...APP, checks: { dbGroups: ON } }), { root });
    expect(analysis.files.map(({ path }) => path)).toEqual(["src/a.db.test.ts", "src/b.db.test.ts"]);
    expect(analysis.files.every(({ touches }) => touches.some(({ kind }) => kind === "fake"))).toBe(true);
  });

  it("says where the app's lists and setup sit", () => {
    const root = scratchRepo(CONFIG, { "src/a.db.test.ts": "" });
    expect(analyzeDbGroups(/** @type {any} */ ({ ...APP, checks: { dbGroups: ON } }), { root }).where).toEqual(ON);
  });
});
