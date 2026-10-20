import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const BIN = fileURLToPath(new URL("./outright-checks.mjs", import.meta.url));

describe("outright-checks", () => {
  it("prints its usage and exits 2 on an unknown command or argument", () => {
    for (const args of [["lint"], [], ["verify", "--forcee"], ["check", "--force"]]) {
      const run = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8" });
      expect(run.status).toBe(2);
      expect(run.stderr).toContain("usage: outright-checks <check | verify [--force]>");
    }
  });
});
