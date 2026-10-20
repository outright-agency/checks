import { readdirSync } from "node:fs";
import { expect, it } from "vitest";
import { cachedAnalysis } from "./checks";

it("finds the source files, once per repository state", () => {
  const files = cachedAnalysis("files", process.cwd(), null, () =>
    readdirSync("src").filter((file) => file.endsWith(".ts"))
  );
  expect(files).toContain("sum.ts");
});
