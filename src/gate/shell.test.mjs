import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BIN, cleanEnv, removeScratchRepos, scratchRepo } from "../../test/support/scratch-repo.mjs";
import { findShell } from "./shell.mjs";

afterEach(removeScratchRepos);

/** What `git --exec-path` answers on a Windows machine with Git for Windows' default install. */
const EXEC_PATH = "C:/Program Files/Git/ucrt64/libexec/git-core";
const GIT_SH = "C:\\Program Files\\Git\\bin\\sh.exe";
const USR_SH = "C:\\Program Files\\Git\\usr\\bin\\sh.exe";

const neverAsked = () => {
  throw new Error("git was asked");
};

describe("findShell", () => {
  it("is sh off Windows, asking nothing", () => {
    expect(findShell({ platform: "linux", path: "", gitExecPath: neverAsked, exists: () => false })).toBe("sh");
    expect(findShell({ platform: "darwin", path: "", gitExecPath: neverAsked, exists: () => false })).toBe("sh");
  });

  it("is sh on Windows when one is on PATH, without asking git", () => {
    const path = "C:\\Windows;;C:\\Program Files\\Git\\usr\\bin";
    expect(findShell({ platform: "win32", path, gitExecPath: neverAsked, exists: (file) => file === USR_SH })).toBe("sh");
  });

  it("is Git for Windows' own beside git's exec path, its bin first", () => {
    const files = new Set([GIT_SH, USR_SH]);
    const where = {
      platform: /** @type {const} */ ("win32"),
      path: "C:\\Windows;C:\\Program Files\\Git\\cmd",
      gitExecPath: () => EXEC_PATH,
      exists: (/** @type {string} */ file) => files.has(file),
    };
    expect(findShell(where)).toBe(GIT_SH);
    files.delete(GIT_SH);
    expect(findShell(where)).toBe(USR_SH);
  });

  it("is null on Windows with no sh on PATH and none beside git", () => {
    const path = "C:\\Windows";
    expect(findShell({ platform: "win32", path, gitExecPath: () => null, exists: () => false })).toBeNull();
    expect(findShell({ platform: "win32", path, gitExecPath: () => EXEC_PATH, exists: () => false })).toBeNull();
  });
});

// A scratch repository and two runs of the command, each a Node process that runs git and Git's
// sh: a second or two quiet, more on a two-core Windows runner. 20 s covers both under load.
const BUDGET_MS = 20_000;

// The Git installer's default: only its `cmd` folder (git itself) on PATH, as in a bare PowerShell.
describe.runIf(process.platform === "win32")("on Windows, with Git's tools off PATH", () => {
  it("runs the check's steps and verify's lanes in Git's own sh", () => {
    const env = cleanEnv();
    const path = (process.env.PATH ?? "")
      .split(delimiter)
      .filter((folder) => !["sh.exe", "nice.exe"].some((file) => existsSync(join(folder, file))))
      .join(delimiter);
    for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
    env.PATH = path;
    const root = scratchRepo(
      `export default {
  name: "fixture",
  check: { steps: [{ name: "step", run: "touch step.txt" }] },
  verify: { lanes: [{ name: "lane", run: "touch lane.txt" }] },
};
`,
      { ".gitignore": "*.txt\n" }
    );
    /** @param {string} command */
    const run = (command) => {
      const result = spawnSync(process.execPath, [BIN, command], { cwd: root, env, encoding: "utf8" });
      return { code: result.status, output: `${result.stdout}${result.stderr}` };
    };

    const check = run("check");
    expect(check.output).toContain("[check] step passed");
    expect(check.code).toBe(0);
    const verify = run("verify");
    expect(verify.output).toContain("[verify] lane passed");
    expect(verify.code).toBe(0);
    expect(existsSync(join(root, "step.txt"))).toBe(true);
    expect(existsSync(join(root, "lane.txt"))).toBe(true);
  }, BUDGET_MS);
});
