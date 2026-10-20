import { describe, expect, it } from "vitest";
import {
  baselineExistsAtBase,
  gitBaseline,
  loadGitBaselineExport,
  toCurrentPathSpelling,
} from "./git-baseline.mjs";

/** @param {Readonly<Record<string, string>>} responses @returns {import("./git-baseline.mjs").ExecFile} */
function fakeGit(responses) {
  return (_file, args) => {
    const key = args.join(" ");
    const response = responses[key];
    if (response === undefined) throw new Error(`missing ${key}`);
    return response;
  };
}

/** A fixture app's moves: a folder, a file, a folder moved twice, and a longer prefix listed first. */
/** @type {readonly (readonly [string, string])[]} */
const MOVED_ROOTS = [
  ["src/components/ui/", "src/shared/ui/"],
  ["src/components/", "src/shared/components/"],
  ["src/lib/billing/totals.", "src/modules/billing/_shared/totals."],
  ["src/lib/notice.", "src/shared/runtime/notice."],
  ["src/lib/", "src/shared/lib/"],
  ["src/old-features/", "src/features/"],
  ["src/features/todo/", "src/abilities/todo/"],
];

const fixture = gitBaseline({ name: "fixture" }, { movedRoots: MOVED_ROOTS });

describe("ratchet git baseline support", () => {
  it("prefers the app's explicit CI base and verifies it is a commit", () => {
    const execFile = fakeGit({ "rev-parse --verify base123^{commit}": "base123\n" });
    expect(fixture.resolveRatchetBase({ env: { FIXTURE_RATCHET_BASE_SHA: "base123" }, execFile })).toBe(
      "base123"
    );
  });

  it("reads only the app's own base variable", () => {
    const execFile = fakeGit({
      "rev-parse HEAD": "head\n",
      "rev-parse main": "main\n",
      "merge-base HEAD main": "base\n",
    });
    expect(fixture.resolveRatchetBase({ env: { OTHER_RATCHET_BASE_SHA: "elsewhere" }, execFile })).toBe(
      "base"
    );
  });

  it("uses the local merge base only when no explicit CI base is supplied", () => {
    const execFile = fakeGit({
      "rev-parse HEAD": "head\n",
      "rev-parse main": "main\n",
      "merge-base HEAD main": "base\n",
    });
    expect(fixture.resolveRatchetBase({ env: {}, execFile })).toBe("base");
    const onMain = fakeGit({ "rev-parse HEAD": "same\n", "rev-parse main": "same\n" });
    expect(fixture.resolveRatchetBase({ env: {}, execFile: onMain })).toBe("same");
  });

  it("loads a type-only historical baseline export without running repository imports", () => {
    const execFile = fakeGit({
      "show base:src/test/example-baseline.ts": [
        'import type { Thing } from "./types";',
        "const values = { item: 2 } satisfies Record<string, number>;",
        "export const EXAMPLE = { values } as const;",
      ].join("\n"),
    });
    expect(
      loadGitBaselineExport("base", "src/test/example-baseline.ts", "EXAMPLE", { execFile })
    ).toEqual({ values: { item: 2 } });
  });

  it("refuses a historical baseline with a runtime import", () => {
    const execFile = fakeGit({
      "show base:src/test/x.ts": 'import { a } from "./a";\nexport const X = a;',
    });
    expect(() => loadGitBaselineExport("base", "src/test/x.ts", "X", { execFile })).toThrow(
      "Historical baseline src/test/x.ts must not have runtime imports."
    );
  });

  it("reports a baseline the base does carry", () => {
    const execFile = fakeGit({
      "rev-parse --verify base^{commit}": "base\n",
      "cat-file -e base:src/test/example-baseline.ts": "",
    });
    expect(baselineExistsAtBase("base", "src/test/example-baseline.ts", { execFile })).toBe(true);
  });

  // The ratchet's own first landing: the base is fine, it just predates the file.
  it("reports a baseline the base does not carry, so a new ratchet can seed itself", () => {
    const execFile = fakeGit({ "rev-parse --verify base^{commit}": "base\n" });
    expect(baselineExistsAtBase("base", "src/test/example-baseline.ts", { execFile })).toBe(false);
  });

  // A shallow clone must never read as a first landing, or the ratchet silently stops comparing.
  it("throws when the base itself is unreachable rather than calling the baseline absent", () => {
    expect(() =>
      baselineExistsAtBase("base", "src/test/example-baseline.ts", { execFile: fakeGit({}) })
    ).toThrow(/Cannot resolve ratchet base commit/);
  });
});

describe("historical path spelling", () => {
  it("maps a moved folder and a moved file forward, longest prefix first", () => {
    expect(fixture.toCurrentPathSpelling("src/components/ui/button.tsx")).toBe("src/shared/ui/button.tsx");
    expect(fixture.toCurrentPathSpelling("src/components/list/row.tsx")).toBe(
      "src/shared/components/list/row.tsx"
    );
    expect(fixture.toCurrentPathSpelling("src/lib/notice.test.ts")).toBe("src/shared/runtime/notice.test.ts");
  });

  it("spells a subject forward through every move it lived through", () => {
    expect(fixture.toCurrentPathSpelling("src/old-features/todo/data.ts")).toBe(
      "src/abilities/todo/data.ts"
    );
  });

  it("leaves a path that did not move, and a look-alike prefix, exactly as it was", () => {
    expect(fixture.toCurrentPathSpelling("src/modules/billing/data.ts")).toBe("src/modules/billing/data.ts");
    expect(fixture.toCurrentPathSpelling("src/library/x.ts")).toBe("src/library/x.ts");
    expect(fixture.toCurrentPathSpelling("src/libel.ts")).toBe("src/libel.ts");
  });

  // Only a repository-relative path is the app's. A package with its own src/lib is not.
  it("does not reach into a nested src/ that belongs to a package", () => {
    expect(fixture.toCurrentPathSpelling("packages/kit/src/lib/x.ts")).toBe("packages/kit/src/lib/x.ts");
    expect(fixture.toCurrentPathSpelling("node_modules/thing/src/lib/y.ts")).toBe(
      "node_modules/thing/src/lib/y.ts"
    );
  });

  // Once a base carries the move the mapping must be inert.
  it("is idempotent — a subject already in today's spelling is untouched", () => {
    const current = "src/modules/billing/_shared/totals.ts";
    expect(fixture.toCurrentPathSpelling(current)).toBe(current);
    expect(fixture.toCurrentPathSpelling(fixture.toCurrentPathSpelling("src/lib/billing/totals.ts"))).toBe(
      current
    );
  });

  it("maps every path inside a composite subject", () => {
    expect(fixture.toCurrentPathSpelling("src/lib/billing/totals.ts|accounts|in")).toBe(
      "src/modules/billing/_shared/totals.ts|accounts|in"
    );
    expect(fixture.toCurrentPathSpelling("cycle:src/lib/a.ts|src/components/ui/b.tsx")).toBe(
      "cycle:src/shared/lib/a.ts|src/shared/ui/b.tsx"
    );
    expect(fixture.toCurrentPathSpelling("src/modules/billing/x.ts=>src/lib/y.ts")).toBe(
      "src/modules/billing/x.ts=>src/shared/lib/y.ts"
    );
  });

  it("moves paths under any root the moved folders start from", () => {
    expect(toCurrentPathSpelling("app/old/x.ts|src/lib/y.ts", [["app/old/", "app/new/"]])).toBe(
      "app/new/x.ts|src/lib/y.ts"
    );
  });

  it("spells nothing when the app has no moved roots", () => {
    expect(gitBaseline({ name: "fixture" }).toCurrentPathSpelling("src/lib/x.ts")).toBe("src/lib/x.ts");
    expect(toCurrentPathSpelling("src/lib/x.ts", [])).toBe("src/lib/x.ts");
  });

  it("rekeys a baseline family by subject and keeps each record", () => {
    expect(
      fixture.withCurrentPathKeys({
        "src/lib/notice.ts": { reviewed: true },
        "src/modules/billing/data.ts": { reviewed: false },
      })
    ).toEqual({
      "src/shared/runtime/notice.ts": { reviewed: true },
      "src/modules/billing/data.ts": { reviewed: false },
    });
  });

  // Mapping the BASE side forward can only ever say "this was reviewed before": a subject with no
  // record at the base has none under either spelling, so a new risk has nothing to inherit.
  it("gives a genuinely new subject nothing to inherit", () => {
    const base = fixture.withCurrentPathKeys({ "src/lib/notice.ts": 1 });
    expect(base["src/shared/lib/brand-new.ts"]).toBeUndefined();
    expect(base["src/shared/runtime/notice.ts"]).toBe(1);
  });
});
