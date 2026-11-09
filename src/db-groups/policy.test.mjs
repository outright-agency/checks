import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config.mjs";
import { analyzeDbGroupSources } from "./analyzer.mjs";
import { DB_GROUPS_RULES, evaluateDbGroups, formatDbGroupsFindings } from "./policy.mjs";

// An app's own words, made up: the package names no app's. `mount` installs what it is handed,
// `gather`, `collect`, `harvest` and `glean` collect from a list and install it, `ALL` is the app's
// own list, `registry.offer` writes to a registry when handed what to keep, and a `declare…` call
// only declares.
/** @type {import("../config.mjs").DbGroupsOn} */
const ON = {
  lists: "src/test/groups.ts",
  setup: "src/app/setup.ts",
  helpers: ["src/test/"],
  aliases: { "~/": "src/" },
  installs: ["mount"],
  collects: ["gather", "collect", "harvest", "glean"],
  ownList: "ALL",
  writes: ["registry.offer"],
  declares: /^declare[A-Z]/,
  files: /\.db\.test\.ts$/,
  roots: ["src"],
};
/** @type {import("../config.mjs").DbGroupsOn} */
const BARE = { ...ON, setup: null, helpers: [], aliases: {}, installs: [], collects: [], ownList: null, writes: [], declares: null };

/** The switch as the config resolves it from what an app writes. @param {import("../config.mjs").DbGroupsSwitch} dbGroups */
const resolved = (dbGroups) => {
  const on = resolveConfig({ name: "app", check: { steps: ["tests"] }, verify: { lanes: [{ name: "s", run: "x" }] }, checks: { dbGroups } }).checks.dbGroups;
  return { aliases: on?.aliases ?? {}, helpers: on?.helpers ?? [] };
};

const DB = "src/x/a.db.test.ts";
const HELPER = "src/x/__tests__/h.ts";
const SETUP = /** @type {string} */ (ON.setup);
const IMPORTS = 'import { describe, it, vi } from "vitest";\n';

/** @typedef {Readonly<Record<string, string>>} Sources */

/** @param {Sources} sources @param {readonly string[]} [apart] @param {readonly string[]} [alone] @param {import("../config.mjs").DbGroupsOn} [on] */
const found = (sources, apart = [], alone = [], on = ON) => evaluateDbGroups(analyzeDbGroupSources(sources, on), { apart, alone });
/** @param {Sources} sources @param {readonly string[]} [apart] @param {readonly string[]} [alone] @param {import("../config.mjs").DbGroupsOn} [on] */
const rules = (sources, apart = [], alone = [], on = ON) => found(sources, apart, alone, on).map(({ rule }) => rule);

describe("a shared file that fakes", () => {
  it.each([
    "vi.mock('./x');",
    "vi.doMock('./x');",
    "vi.spyOn(o, 'm');",
    "vi.stubGlobal('fetch', f);",
    "vi.stubEnv('A', 'b');",
    "vi.useFakeTimers();",
    "vi.setSystemTime(0);",
    "vi.importActual('./x');",
    "vi.brandNew();",
  ])("refuses %s", (line) => {
    expect(rules({ [DB]: IMPORTS + line })).toEqual(["shared-fake"]);
  });

  it.each(["const { spyOn } = vi;", "vi['mock']('./x');", "const v = vi; v.mock('./x');"])("refuses a way round the name: %s", (line) => {
    expect(rules({ [DB]: IMPORTS + line })).toEqual(["shared-fake"]);
  });

  it("reads vi by its other names, through a helper's re-export, and in the package under it", () => {
    expect(rules({ [DB]: 'import { vitest } from "vitest";\nvitest.mock("./x");' })).toEqual(["shared-fake"]);
    expect(rules({ [DB]: 'import "./__tests__/h";', [HELPER]: 'export { vi } from "vitest";' })).toEqual(["shared-fake"]);
    expect(rules({ [DB]: 'import "./__tests__/h";', [HELPER]: 'export * from "vitest";' })).toEqual(["shared-fake"]);
    expect(rules({ [DB]: 'import { spyOn } from "@vitest/spy";\nspyOn(o, "m");' })).toEqual(["shared-fake"]);
  });

  it("passes vi as a type, gone at run time", () => {
    expect(rules({ [DB]: `${IMPORTS}const f: vi.Mock = vi.fn();` })).toEqual([]);
  });

  it("reads an alias, a namespace, a dynamic import and a require of vitest", () => {
    expect(rules({ [DB]: 'import { vi as v } from "vitest";\nv.mock("./x");' })).toEqual(["shared-fake"]);
    expect(rules({ [DB]: 'import * as t from "vitest";\nt.vi.mock("./x");' })).toEqual(["shared-fake"]);
    expect(rules({ [DB]: 'const { vi } = await import("vitest");\nvi.mock("./x");' })).toEqual(["shared-fake"]);
    expect(rules({ [DB]: 'const { vi } = require("vitest");\nvi.mock("./x");' })).toEqual(["shared-fake"]);
  });

  it("follows a test helper, and names it", () => {
    const findings = found({ [DB]: 'import "./__tests__/h";', [HELPER]: `${IMPORTS}export const f = () => vi.stubEnv("A", "b");` });
    expect(findings.map(({ rule }) => rule)).toEqual(["shared-fake"]);
    expect(findings[0]?.detail).toContain(`through ${HELPER}`);
  });

  it("follows two levels down, a re-export and an import()", () => {
    const deep = "src/x/__tests__/deep.ts";
    const fake = `${IMPORTS}export const f = () => vi.spyOn(o, "m");`;
    expect(rules({ [DB]: 'import { g } from "./__tests__/h";', [HELPER]: 'import { f } from "./deep";\nexport const g = f;', [deep]: fake })).toEqual(["shared-fake"]);
    expect(rules({ [DB]: 'import { f } from "./__tests__/h";', [HELPER]: 'export { f } from "./deep";', [deep]: fake })).toEqual(["shared-fake"]);
    expect(rules({ [DB]: 'const { f } = await import("./__tests__/deep");', [deep]: fake })).toEqual(["shared-fake"]);
  });

  it("ends at app code and at a type-only import", () => {
    expect(rules({ [DB]: 'import { f } from "./app";', "src/x/app.ts": `${IMPORTS}vi.mock("./y");` })).toEqual([]);
    expect(rules({ [DB]: 'import type { F } from "./__tests__/h";', [HELPER]: `${IMPORTS}vi.mock("./y");` })).toEqual([]);
  });

  it("passes vi.fn, vi.waitFor, and vi.mock in a comment or a string", () => {
    expect(rules({ [DB]: `${IMPORTS}// vi.mock('./x');\nconst text = "vi.mock('./x')";\nit("a", async () => {\n  const f = vi.fn();\n  await vi.waitFor(f);\n  await vi.waitUntil(f);\n});` })).toEqual([]);
  });
});

describe("a shared file that changes global state", () => {
  it.each([
    "x.mount([]);",
    "gather([...ALL, y]);",
    "collect(list);",
    "process.env.A = 'b';",
    "process.env['A'] = 'b';",
    "delete process.env.A;",
    "process.exitCode++;",
    "globalThis.a = 1;",
    "Date.now = () => 0;",
    "console.log = f;",
    "Object.defineProperty(globalThis, 'a', {});",
    "Object.assign(process.env, {});",
    "Reflect.set(globalThis, 'a', 1);",
    "process.on('exit', f);",
    "process.chdir('/');",
    "expect.extend({});",
    "registry.offer(kind, { check });",
    "registry.offer(kind);",
    "declarePart(facts, [registry.offer(kind, { check })]);",
    "await import(`./${name}`);",
    "require(name);",
    "(globalThis as never).a = 1;",
    "(process.env as Record<string, string>).A = 'b';",
    "Object.defineProperty(globalThis as never, 'a', {});",
    "const g = globalThis as never;\ng.a = 1;",
    "const env = process.env;\nenv.A = 'b';",
    "const { env } = process;\nenv.A = 'b';",
    "const p = process;\np.on('exit', f);",
    "globalThis.process.on('exit', f);",
    "process.removeAllListeners('exit');",
    "process.setMaxListeners(0);",
    "Reflect.deleteProperty(process.env, 'A');",
    "crypto.randomUUID = f;",
    "Array.prototype.x = f;",
    "process.env.A %= 2;",
    "x['mount']([]);",
    "ns.gather([y]);",
    "harvest([...ALL, y]);",
    "glean(list);",
    "chai.use(f);",
  ])("refuses %s", (line) => {
    expect(rules({ [DB]: line })).toEqual(["shared-global-state"]);
  });

  it("refuses it inside a test, as at the top of the file", () => {
    expect(rules({ [DB]: 'it("a", () => {\n  try {\n    registry.offer(kind, { check });\n  } finally {\n    registry.offer(kind, { check: null });\n  }\n});' })).toEqual(["shared-global-state"]);
  });

  it("refuses an assignment onto an imported object, but not onto its own", () => {
    expect(rules({ [DB]: 'import { pool } from "./app";\npool.end = f;' })).toEqual(["shared-global-state"]);
    expect(rules({ [DB]: 'import * as app from "./app";\nObject.assign(app.config, {});' })).toEqual(["shared-global-state"]);
    expect(rules({ [DB]: 'import { g } from "./app";\nconst own = { a: 1 };\nown.a = g;\nlet b = 1;\nb = 2;' })).toEqual([]);
  });

  it("reads a name by what it is called where it came from", () => {
    expect(rules({ [DB]: 'import { expect as e } from "vitest";\ne.extend({});' })).toEqual(["shared-global-state"]);
    expect(rules({ [DB]: 'import { registry as k } from "./app";\nk.offer(kind, { check });' })).toEqual(["shared-global-state"]);
    expect(rules({ [DB]: 'import { gather as c } from "./app";\nc(list);' })).toEqual(["shared-global-state"]);
  });

  it("refuses a change to an imported object through its own methods, or through an alias", () => {
    expect(rules({ [DB]: 'import { listeners } from "./app";\nit("a", () => listeners.push(f));' })).toEqual(["shared-global-state"]);
    expect(rules({ [DB]: 'import { cache } from "./app";\nit("a", () => cache.clear());' })).toEqual(["shared-global-state"]);
    expect(rules({ [DB]: 'import { pool } from "./app";\nconst d = pool;\nd.end = f;' })).toEqual(["shared-global-state"]);
  });

  it("passes a local that hides an import or a global, and a query on the client", () => {
    expect(rules({ [DB]: 'import { row } from "./app";\nexport const go = () => items.map((row) => { row.x = 1; });\nexport const g = row;' })).toEqual([]);
    expect(rules({ [DB]: "it('a', () => { const console = { log: 1 }; console.log = 2; });" })).toEqual([]);
    expect(rules({ [DB]: 'import { prisma } from "./app";\nit("a", () => prisma.user.delete({ where: {} }));' })).toEqual([]);
  });

  it("passes reading the environment, the app's own list, a contribution in a declaration, and an import with a literal path", () => {
    expect(rules({ [DB]: 'const a = process.env.A;\nawait gather(ALL);\nawait collect(ALL);\nconst url = process.env.DATABASE_URL;\nconst here = process.cwd();\ndeclarePart(facts, [registry.offer(kind), other.offer("t.c", { rule: "delete" })]);\nawait import("./app");' })).toEqual([]);
  });

  it("refuses what changes state at load, however the call is written, in a helper or a test file", () => {
    for (const line of ["points.add(a, { check });", "void points.add(a);", "await points.add(a);", "for (const a of A) points.add(a);"]) {
      expect(rules({ [DB]: 'import "./__tests__/h";', [HELPER]: line }), line).toEqual(["shared-global-state"]);
      expect(rules({ [DB]: line }), line).toEqual(["shared-global-state"]);
    }
  });

  it("asks nothing of a declaration at load, or a test file's hooks", () => {
    expect(rules({ [DB]: 'import "./__tests__/h";', [HELPER]: "declareStep({ id: 'a' });" })).toEqual([]);
    expect(rules({ [DB]: "describe('a', () => {});\nbeforeAll(() => {});\nit('b', () => {});" })).toEqual([]);
  });
});

describe("the walk", () => {
  it("skips what only a type needs", () => {
    expect(rules({ [DB]: 'import { type F } from "./__tests__/h";', [HELPER]: `${IMPORTS}vi.mock("./y");` })).toEqual([]);
    expect(rules({ [DB]: 'export type { F } from "./__tests__/h";', [HELPER]: `${IMPORTS}vi.mock("./y");` })).toEqual([]);
  });
});

describe("the list", () => {
  it("passes a listed file that fakes, and one that changes global state", () => {
    expect(rules({ [DB]: `${IMPORTS}vi.mock("./x");` }, [DB])).toEqual([]);
    expect(rules({ [DB]: "x.mount([]);" }, [DB])).toEqual([]);
  });

  it("refuses an entry that excuses nothing, and one that is no file", () => {
    expect(rules({ [DB]: "" }, [DB])).toEqual(["apart-excuses-nothing"]);
    expect(rules({ [DB]: "" }, ["src/gone.db.test.ts"])).toEqual(["apart-not-a-file"]);
  });

  it("tells a shared file where to go", () => {
    expect(formatDbGroupsFindings(found({ [DB]: `${IMPORTS}vi.spyOn(o, "m");` }))).toContain(ON.lists);
  });
});

describe("a file that truncates", () => {
  const truncates = 'it("a", () => tx.$executeRaw`TRUNCATE app.t CASCADE`);';

  it("runs alone, whether it says so in a template, a string or a helper", () => {
    expect(rules({ [DB]: truncates })).toEqual(["truncate-not-alone"]);
    expect(rules({ [DB]: 'it("a", () => tx.$executeRawUnsafe(`TRUNCATE "a"."${t}"`));' })).toEqual(["truncate-not-alone"]);
    expect(rules({ [DB]: 'it("a", () => tx.$executeRawUnsafe("TRUNCATE a"));' })).toEqual(["truncate-not-alone"]);
    expect(rules({ [DB]: 'import "./__tests__/h";', [HELPER]: 'export const f = () => db.$executeRawUnsafe("TRUNCATE a");' })).toEqual(["truncate-not-alone"]);
    expect(rules({ [DB]: truncates }, [], [DB])).toEqual([]);
  });

  it("asks nothing of the word in a comment or lower case, and refuses an entry that truncates nothing", () => {
    expect(rules({ [DB]: '// TRUNCATE a\nit("is never truncated", () => {});' })).toEqual([]);
    expect(rules({ [DB]: "" }, [], [DB])).toEqual(["alone-excuses-nothing"]);
    expect(rules({ [DB]: "" }, [], ["src/gone.db.test.ts"])).toEqual(["apart-not-a-file"]);
  });

  it("owes the fakes' list nothing once it runs alone", () => {
    expect(rules({ [DB]: `${IMPORTS}vi.mock("./x");\n${truncates}` }, [], [DB])).toEqual([]);
  });
});

describe("app code", () => {
  it("refuses a module that installs at load, but for the setup", () => {
    expect(rules({ "src/core/y.ts": "points.mount(LIST);" })).toEqual(["install-at-load"]);
    expect(rules({ [SETUP]: "points.mount(LIST);" })).toEqual([]);
    expect(rules({ "src/core/y.ts": "export const go = () => points.mount(LIST);" })).toEqual([]);
  });
});

describe("the app's own words", () => {
  it("takes no word of an app's but those it is handed", () => {
    // Inside a test: a call at a file's top changes state whatever it is called.
    for (const line of ["x.mount([]);", "gather(list);", "registry.offer(kind, { check });"]) {
      expect(rules({ [DB]: `it("a", () => { ${line} });` }, [], [], BARE), line).toEqual([]);
      expect(rules({ [DB]: `it("a", () => { ${line} });` }), line).toEqual(["shared-global-state"]);
    }
    expect(rules({ "src/core/y.ts": "points.mount(LIST);" }, [], [], BARE)).toEqual([]);
    expect(rules({ [DB]: 'import "./__tests__/h";', [HELPER]: "declareStep({ id: 'a' });" }, [], [], BARE)).toEqual(["shared-global-state"]);
  });

  it("follows an alias it is handed, and no other", () => {
    const fake = `${IMPORTS}export const f = () => vi.spyOn(o, "m");`;
    expect(rules({ [DB]: 'import "~/x/__tests__/h";', [HELPER]: fake })).toEqual(["shared-fake"]);
    expect(rules({ [DB]: 'import "~/x/__tests__/h";', [HELPER]: fake }, [], [], { ...ON, aliases: {} })).toEqual([]);
    expect(rules({ [DB]: 'import "~x/__tests__/h";', [HELPER]: fake, "x/__tests__/h.ts": fake })).toEqual([]);
    // Given with no slash, as an app may write it, it still takes in no look-alike.
    const loose = { ...ON, ...resolved({ lists: ON.lists, aliases: { "~": "src" } }) };
    expect(rules({ [DB]: 'import "~x/__tests__/h";', "srcx/__tests__/h.ts": fake }, [], [], loose)).toEqual([]);
    expect(rules({ [DB]: 'import "~/x/__tests__/h";', [HELPER]: fake }, [], [], loose)).toEqual(["shared-fake"]);
  });

  it("follows a helpers folder it is handed, and no other", () => {
    const db = "src/x/y/a.db.test.ts";
    const fake = `${IMPORTS}export const f = () => vi.spyOn(o, "m");`;
    expect(rules({ [db]: 'import "../../test/h";', "src/test/h.ts": fake })).toEqual(["shared-fake"]);
    expect(rules({ [db]: 'import "../../test/h";', "src/test/h.ts": fake }, [], [], { ...ON, helpers: [] })).toEqual([]);
    expect(rules({ [db]: 'import "../../testing/h";', "src/testing/h.ts": fake })).toEqual([]);
    const loose = { ...ON, ...resolved({ lists: ON.lists, helpers: ["src/test"] }) };
    expect(rules({ [db]: 'import "../../testing/h";', "src/testing/h.ts": fake }, [], [], loose)).toEqual([]);
  });

  it("names every module installing at load when the app names no setup", () => {
    expect(rules({ [SETUP]: "points.mount(LIST);" }, [], [], { ...ON, setup: null })).toEqual(["install-at-load"]);
  });

  it("names the app's lists and its setup in what it says", () => {
    expect(formatDbGroupsFindings(found({ [DB]: `${IMPORTS}vi.mock("./x");` }))).toContain(ON.lists);
    expect(formatDbGroupsFindings(found({ "src/core/y.ts": "points.mount(LIST);" }))).toContain(SETUP);
  });

  it("fires every rule it declares", () => {
    /** @type {[Sources, string[], string[]][]} */
    const table = [
      [{ [DB]: `${IMPORTS}vi.mock("./x");` }, [], []],
      [{ [DB]: "process.env.A = 'b';" }, [], []],
      [{ [DB]: "" }, [DB], []],
      [{ [DB]: "" }, ["src/gone.db.test.ts"], []],
      [{ [DB]: 'it("a", () => db.$executeRawUnsafe("TRUNCATE a"));' }, [], []],
      [{ [DB]: "" }, [], [DB]],
      [{ "src/core/y.ts": "points.mount(LIST);" }, [], []],
    ];
    const fired = new Set(table.flatMap(([sources, apart, alone]) => rules(sources, apart, alone)));
    expect([...fired].sort()).toEqual([...DB_GROUPS_RULES].sort());
  });
});
