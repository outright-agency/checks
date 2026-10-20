// What goes public with this package, read as text: every tracked file, and every untracked one
// git does not ignore. The package is the engine of any app's checks, so nothing in it names one
// app, a person, a machine or an issue tracker's key, and nothing in it is a secret. An app's own
// names live in its `checks.config.mjs`, never here.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SELF = "test/public-surface.test.mjs";

/** Words that would tie the package to one app, one person or one machine. */
const NAMES = [
  /\bportal\b/i,
  /outright-base/i,
  /\b(?:POR|OUT|SIG|STU|EVG|MUS|ATL|CWK)-\d+\b/,
  /\/Users\//,
  /openclaw|mihai|obsidian/i,
  /\bStudio\b/,
  /\bdesk\s?\d\b/i,
];

/** The shapes a leaked credential takes. */
const SECRETS = [
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const files = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { cwd: ROOT, encoding: "utf8" }
)
  .split("\0")
  .filter((path) => path.length > 0 && path !== SELF && path !== "pnpm-lock.yaml")
  .map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") }));

/**
 * `path:line  text` for every line any pattern matches.
 * @param {RegExp[]} patterns
 */
function matches(patterns) {
  return files.flatMap(({ path, text }) =>
    text
      .split("\n")
      .flatMap((line, index) =>
        patterns.some((pattern) => pattern.test(line)) ? [`${path}:${index + 1}  ${line.trim()}`] : []
      )
  );
}

describe("the public surface", () => {
  it("reads the files it judges", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it("names no app, person, machine or issue key in any file", () => {
    expect(matches(NAMES)).toEqual([]);
  });

  it("carries no secret", () => {
    expect(matches(SECRETS)).toEqual([]);
  });
});
