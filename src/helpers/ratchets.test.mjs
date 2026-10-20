import { afterEach, describe, expect, it, vi } from "vitest";
import { runRatchets } from "./ratchets.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Ratchets that record that they ran. @param {string[]} ran */
const ratchets = (ran) => ({
  red: () => (ran.push("red"), false),
  green: () => (ran.push("green"), true),
});

describe("runRatchets", () => {
  it("runs every ratchet even after one fails", () => {
    /** @type {string[]} */
    const ran = [];
    expect(runRatchets(ratchets(ran), ["node", "ratchets.ts"])).toBe(1);
    expect(ran).toEqual(["red", "green"]);
    expect(runRatchets({ a: () => true, b: () => true }, ["node", "ratchets.ts"])).toBe(0);
  });

  it("runs one with --only", () => {
    /** @type {string[]} */
    const ran = [];
    expect(runRatchets(ratchets(ran), ["node", "ratchets.ts", "--only", "green"])).toBe(0);
    expect(ran).toEqual(["green"]);
  });

  it("refuses an unknown name and runs none", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    /** @type {string[]} */
    const ran = [];
    expect(runRatchets(ratchets(ran), ["node", "ratchets.ts", "--only", "blue"])).toBe(2);
    expect(ran).toEqual([]);
    expect(error).toHaveBeenCalledWith('Unknown ratchet "blue". One of: red, green.');
  });
});
