// The `sh` the gate runs an app's commands in. The commands are the app's own, written for sh
// (`&&`, `VAR=value command`, `${X:-6}`), so the check's steps and verify's lanes go to one.
//
// On macOS and Linux that is `sh`. On Windows it is `sh` when one is on PATH (Git Bash, or Git's
// tools on PATH), and otherwise Git for Windows' own, which every Windows checkout already has:
// the installer's default puts only Git's `cmd` folder on PATH, and that git answers
// `git --exec-path` with `<Git>/<mingw64|ucrt64|clangarm64>/libexec/git-core`, three folders below
// the installation. Its `bin\sh.exe` puts Git's tools on PATH before it runs the command.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 } from "node:path";

/** What the check and the verify say, and exit 1 on, when there is no sh. */
export const NO_SHELL =
  "found no sh to run the commands in: install Git for Windows (https://git-scm.com/download/win), or put an sh on PATH";

/**
 * @typedef {object} ShellWhere
 * @property {NodeJS.Platform} platform
 * @property {string} path the PATH the commands run with
 * @property {() => string | null} gitExecPath `git --exec-path`, asked only when it is needed
 * @property {(file: string) => boolean} exists
 */

/**
 * The `sh` to spawn: `sh` itself, or on Windows the path of Git's own; `null` when there is none.
 * @param {ShellWhere} where
 * @returns {string | null}
 */
export function findShell({ platform, path, gitExecPath, exists }) {
  if (platform !== "win32") return "sh";
  const onPath = path
    .split(win32.delimiter)
    .some((folder) => folder !== "" && exists(win32.join(folder, "sh.exe")));
  if (onPath) return "sh";
  const execPath = gitExecPath();
  if (execPath === null) return null;
  const installation = win32.resolve(execPath, "..", "..", "..");
  const candidates = [win32.join(installation, "bin", "sh.exe"), win32.join(installation, "usr", "bin", "sh.exe")];
  return candidates.find((file) => exists(file)) ?? null;
}

/** The `sh` for this process's PATH and git, or `null`. @returns {string | null} */
export function gateShell() {
  return findShell({
    platform: process.platform,
    path: process.env.PATH ?? "",
    gitExecPath: () => {
      try {
        return execFileSync("git", ["--exec-path"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      } catch {
        return null;
      }
    },
    exists: existsSync,
  });
}
