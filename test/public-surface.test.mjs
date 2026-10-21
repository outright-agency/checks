// What goes public with this package, read as text: every tracked file, and every untracked one
// git does not ignore. The package is the engine of any app's checks, so nothing in it names one
// app, a person, a machine or an issue tracker's key, and nothing in it is a secret. An app's own
// names live in its `checks.config.mjs`, never here.
//
// The names it refuses are held as hashes, so this file names none of them either: every word of
// every line is hashed and looked up. A word is lower-case letters and digits, and a run of them
// joined by dashes counts too (`some-app`), so a dashed name is caught whole.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The first 16 hex digits of a word's SHA-256. @param {string} word */
const wordHash = (word) => createHash("sha256").update(word).digest("hex").slice(0, 16);

/** Words that would tie the package to one app, one person or one machine. */
const NAME_HASHES = new Set([
  "d0960501f8971be8",
  "d8348177e6e42cfa",
  "96a4bc2602655473",
  "63882f335c412976",
  "4e2295dd929e424a",
  "da0daaba4b156961",
]);

/** The prefixes of issue keys (`<prefix>-<number>`) in the trackers the package must not name. */
const KEY_PREFIX_HASHES = new Set([
  "3ea6bc47a6277afe",
  "762069bc07a6e1b5",
  "a543997d84f12798",
  "0f336a037e1f6130",
  "719a1857d9520dfa",
  "b49b6976120c927c",
  "f653dea3110d499b",
  "7cb79b07b950db89",
]);

/** Paths that would name a machine's own folders. */
const PATHS = [/\/Users\//, /\bdesk\s?\d\b/i];

/** The shapes a leaked credential takes. */
const SECRETS = [
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/**
 * Whether a line holds a refused name or issue key: each word, each part of a dashed word and
 * each two adjacent parts are hashed, and a `<prefix>-<number>` is looked up by its prefix.
 * @param {string} line
 * @param {{ names: Set<string>, keyPrefixes: Set<string> }} hashes
 */
function namesSomething(line, { names, keyPrefixes }) {
  for (const word of line.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []) {
    const parts = word.split("-");
    const pairs = parts.slice(1).map((part, index) => `${parts[index]}-${part}`);
    if ([word, ...parts, ...pairs].some((candidate) => names.has(wordHash(candidate)))) return true;
    for (let index = 1; index < parts.length; index += 1) {
      if (/^\d+$/.test(parts[index]) && keyPrefixes.has(wordHash(parts[index - 1]))) return true;
    }
  }
  return false;
}

const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\0")
  .filter((path) => path.length > 0 && path !== "pnpm-lock.yaml")
  .map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") }));

/**
 * `path:line  text` for every line `refuses` refuses.
 * @param {(line: string) => boolean} refuses
 */
function matches(refuses) {
  return files.flatMap(({ path, text }) =>
    text
      .split("\n")
      .flatMap((line, index) => (refuses(line) ? [`${path}:${index + 1}  ${line.trim()}`] : []))
  );
}

describe("the public surface", () => {
  it("reads the files it judges", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it("catches a hashed name, whole, inside a dashed word, and as a key's prefix", () => {
    const hashes = {
      names: new Set([wordHash("xyzzy"), wordHash("plugh-base")]),
      keyPrefixes: new Set([wordHash("qq")]),
    };
    expect(namesSomething("the Xyzzy app", hashes)).toBe(true);
    expect(namesSomething("in xyzzy-box1", hashes)).toBe(true);
    expect(namesSomething("cut from plugh-base", hashes)).toBe(true);
    expect(namesSomething("see QQ-12", hashes)).toBe(true);
    expect(namesSomething("xyzzyx, plugh, qq-a, qqq-1", hashes)).toBe(false);
  });

  it("names no app, person, machine or issue key in any file", () => {
    const hashes = { names: NAME_HASHES, keyPrefixes: KEY_PREFIX_HASHES };
    expect(matches((line) => namesSomething(line, hashes) || PATHS.some((path) => path.test(line)))).toEqual([]);
  });

  it("carries no secret", () => {
    expect(matches((line) => SECRETS.some((pattern) => pattern.test(line)))).toEqual([]);
  });
});
