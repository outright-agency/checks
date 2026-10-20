// @vitest-environment jsdom
import { getConfig } from "@testing-library/react/pure";
import { expect, it } from "vitest";

it("waits as long as the setup file says, and has a working Storage", () => {
  expect(getConfig().asyncUtilTimeout).toBe(process.env.CI ? 3000 : 1000);
  window.localStorage.setItem("key", "value");
  expect(window.localStorage.getItem("key")).toBe("value");
});
