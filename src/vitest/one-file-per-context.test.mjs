import { describe, expect, it } from "vitest";

import { ONE_FILE_PER_CONTEXT_MESSAGE, claimContextForOneFile } from "./one-file-per-context.mjs";

// The setup file claims each VM context for one test file, so a run that puts two files in one
// context — Vitest's VM pools at one worker — fails instead of sharing every module.

describe("one test file per VM context", () => {
  it("lets the first file claim a fresh context", () => {
    expect(() => claimContextForOneFile({})).not.toThrow();
  });

  it("refuses a second file in the same context, naming why", () => {
    const context = {};
    claimContextForOneFile(context);
    expect(() => claimContextForOneFile(context)).toThrow(ONE_FILE_PER_CONTEXT_MESSAGE);
    expect(ONE_FILE_PER_CONTEXT_MESSAGE).toContain("one VM context");
    expect(ONE_FILE_PER_CONTEXT_MESSAGE).toContain("two workers or more");
  });

  it("keeps contexts apart", () => {
    claimContextForOneFile({});
    expect(() => claimContextForOneFile({})).not.toThrow();
  });
});
