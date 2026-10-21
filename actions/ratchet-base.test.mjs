import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { namesOf } from "../src/config.mjs";
import { cleanEnv, git } from "../test/support/scratch-repo.mjs";

const SCRIPT = fileURLToPath(new URL("./ci-base/ratchet-base.sh", import.meta.url));
const ACTIONS = fileURLToPath(new URL(".", import.meta.url));

/** @type {string[]} */
const made = [];
afterEach(() => {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
});

function folder() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "checks-ci-base-")));
  made.push(root);
  return root;
}

/** @param {string} root @param {string} name */
function commit(root, name) {
  writeFileSync(join(root, name), `${name}\n`);
  git(root, "add", name);
  git(root, "commit", "-q", "-m", name);
  return git(root, "rev-parse", "HEAD");
}

/** A repository whose HEAD is a test merge of a branch onto `main`. */
function testMerge() {
  const root = folder();
  git(root, "init", "-q", "-b", "main");
  const base = commit(root, "base.txt");
  git(root, "switch", "-q", "-c", "change");
  commit(root, "change.txt");
  git(root, "switch", "-q", "main");
  const moved = commit(root, "moved.txt");
  git(root, "merge", "-q", "--no-ff", "-m", "test merge", "change");
  return { root, base, moved };
}

/**
 * Runs the script as a job would, and hands back what it wrote to the job's environment.
 * @param {string} cwd
 * @param {Record<string, string>} env
 */
function ratchetBase(cwd, env) {
  const githubEnv = join(folder(), "github-env");
  writeFileSync(githubEnv, "");
  const run = spawnSync("bash", [SCRIPT], {
    cwd,
    env: cleanEnv({ CHECKS_NAME: "my-app", GITHUB_ENV: githubEnv, ...env }),
    encoding: "utf8",
  });
  return { code: run.status, output: `${run.stdout}${run.stderr}`, written: readFileSync(githubEnv, "utf8") };
}

// Each case builds a repository of its own (four to eight `git` calls) and runs the script, which
// calls git again: about half a second quiet, several seconds on a loaded machine; 20 s covers both.
const BUDGET_MS = 20_000;

describe("ratchet-base.sh", () => {
  it("writes the test merge's first parent on a pull request", () => {
    const { root, moved } = testMerge();
    const run = ratchetBase(root, { GITHUB_EVENT_NAME: "pull_request", PULL_REQUEST_BASE: moved });
    expect(run.code).toBe(0);
    expect(run.written).toBe(`MY_APP_RATCHET_BASE_SHA=${moved}\n`);
    expect(run.output).toContain(`Ratchet base ${moved}: in the checkout`);
  }, BUDGET_MS);

  it("says so when the test merge was built on another base than the event names", () => {
    const { root, base, moved } = testMerge();
    const run = ratchetBase(root, { GITHUB_EVENT_NAME: "pull_request", PULL_REQUEST_BASE: base });
    expect(run.written).toBe(`MY_APP_RATCHET_BASE_SHA=${moved}\n`);
    expect(run.output).toContain(`::notice::the test merge was built on ${moved}, not the event's base ${base}`);
  }, BUDGET_MS);

  it("refuses a pull request checkout that is not a merge commit", () => {
    const root = folder();
    git(root, "init", "-q", "-b", "main");
    commit(root, "a.txt");
    commit(root, "b.txt");
    const run = ratchetBase(root, { GITHUB_EVENT_NAME: "pull_request" });
    expect(run.code).toBe(1);
    expect(run.output).toContain("::error::the pull request's checkout is not its test merge commit");
    expect(run.written).toBe("");
  }, BUDGET_MS);

  it("writes the queue's base on a merge_group event", () => {
    const { root, base } = testMerge();
    const run = ratchetBase(root, { GITHUB_EVENT_NAME: "merge_group", MERGE_GROUP_BASE: base });
    expect(run.code).toBe(0);
    expect(run.written).toBe(`MY_APP_RATCHET_BASE_SHA=${base}\n`);
  }, BUDGET_MS);

  it("refuses any other event", () => {
    const { root } = testMerge();
    const run = ratchetBase(root, { GITHUB_EVENT_NAME: "push" });
    expect(run.code).toBe(1);
    expect(run.output).toContain("::error::no ratchet base for a push event");
  }, BUDGET_MS);

  it("refuses an empty or all-zero base", () => {
    const { root } = testMerge();
    for (const base of ["", "0000000000000000000000000000000000000000"]) {
      const run = ratchetBase(root, { GITHUB_EVENT_NAME: "merge_group", MERGE_GROUP_BASE: base });
      expect(run.code).toBe(1);
      expect(run.output).toContain("::error::the merge_group event names no base commit");
      expect(run.written).toBe("");
    }
  }, BUDGET_MS);

  it("fetches a base that is not in the checkout", () => {
    const origin = folder();
    git(origin, "init", "-q", "-b", "main");
    git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
    const old = commit(origin, "old.txt");
    commit(origin, "new.txt");
    const clone = join(folder(), "clone");
    spawnSync("git", ["clone", "-q", "--depth=1", `file://${origin}`, clone]);
    const run = ratchetBase(clone, { GITHUB_EVENT_NAME: "merge_group", MERGE_GROUP_BASE: old });
    expect(run.code).toBe(0);
    expect(run.output).toContain(`Ratchet base ${old}: fetched alone`);
    expect(run.written).toBe(`MY_APP_RATCHET_BASE_SHA=${old}\n`);
  }, BUDGET_MS);

  it("refuses a name the config would refuse", () => {
    const { root, base } = testMerge();
    const run = ratchetBase(root, { GITHUB_EVENT_NAME: "merge_group", MERGE_GROUP_BASE: base, CHECKS_NAME: "My.App" });
    expect(run.code).toBe(1);
    expect(run.output).toContain("::error::the app's name must be lower-case letters, digits and dashes");
    expect(run.written).toBe("");
  }, BUDGET_MS);

  it("refuses to run without the app's name", () => {
    const { root, base } = testMerge();
    const run = ratchetBase(root, { GITHUB_EVENT_NAME: "merge_group", MERGE_GROUP_BASE: base, CHECKS_NAME: "" });
    expect(run.code).toBe(1);
    expect(run.output).toContain("::error::ci-base needs the app's name");
  }, BUDGET_MS);

  it("derives the variable as the config does", () => {
    const { root, base } = testMerge();
    const run = ratchetBase(root, { GITHUB_EVENT_NAME: "merge_group", MERGE_GROUP_BASE: base });
    expect(run.written.split("=")[0]).toBe(namesOf("my-app").env.ratchetBase);
  }, BUDGET_MS);
});

describe("the actions", () => {
  it("ci-setup passes both event bases and the name through to the script", () => {
    for (const [file, script] of [
      ["ci-base/action.yml", 'bash "$GITHUB_ACTION_PATH/ratchet-base.sh"'],
      ["ci-setup/action.yml", 'bash "$GITHUB_ACTION_PATH/../ci-base/ratchet-base.sh"'],
    ]) {
      const action = readFileSync(join(ACTIONS, file), "utf8");
      expect(action, file).toContain(`run: ${script}`);
      expect(action, file).toContain("CHECKS_NAME: ${{ inputs.name }}");
      expect(action, file).toContain("PULL_REQUEST_BASE: ${{ github.event.pull_request.base.sha }}");
      expect(action, file).toContain("MERGE_GROUP_BASE: ${{ github.event.merge_group.base_sha }}");
      expect(action, file).toMatch(/inputs:\n  name:\n    description: .+\n    required: true\n/);
    }
  });

  it("ci-setup finds the base unless a job on another event turns it off", () => {
    const action = readFileSync(join(ACTIONS, "ci-setup/action.yml"), "utf8");
    expect(action).toMatch(/  ratchet-base:\n    description: >-\n[\s\S]+?\n    default: "true"\n/);
    expect(action).toContain("- name: Ratchet base\n      if: ${{ inputs.ratchet-base != 'false' }}\n");
  });
});
