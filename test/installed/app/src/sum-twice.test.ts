import { expect, it } from "vitest";
import { sum } from "./sum";

it("adds twice", () => {
  expect(sum(sum(1, 1), 1)).toBe(3);
});
