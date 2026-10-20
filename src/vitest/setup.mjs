// The preset's setup file, run before each test file in that file's own context.

import { CI_ASYNC_UTIL_TIMEOUT_MS } from "../limits.mjs";
import { claimContextForOneFile } from "./one-file-per-context.mjs";

// A run that puts a second file in the same VM context shares every module between them, so it
// fails here and says why.
claimContextForOneFile(globalThis);

// Node 25 ships Web Storage on by default, so `globalThis.localStorage` exists before jsdom loads.
// Vitest's jsdom environment aliases `window` to `globalThis` and leaves already-present globals
// alone, so Node's copy shadows jsdom's real Storage. Node's is inert unless the process was
// started with a valid `--localstorage-file`, which under Vitest it never is: it surfaces as an
// object whose `getItem` and `clear` are undefined, so tests fail on the first call instead of at
// import. This installs a spec-shaped in-memory Storage whenever the ambient one cannot do the job.
// Node-environment test files have no `window` and are left untouched.
/**
 * @param {typeof globalThis} target
 * @param {"localStorage" | "sessionStorage"} key
 */
function installMemoryStorage(target, key) {
  const existing = /** @type {Storage | undefined} */ (/** @type {Record<string, unknown>} */ (target)[key]);
  if (existing && typeof existing.getItem === "function") return;

  /** @type {Map<string, string>} */
  const store = new Map();
  /** @type {Storage} */
  const storage = {
    get length() {
      return store.size;
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    getItem: (name) => store.get(name) ?? null,
    setItem: (name, value) => void store.set(String(name), String(value)),
    removeItem: (name) => void store.delete(name),
    clear: () => store.clear(),
  };

  Object.defineProperty(target, key, { configurable: true, writable: true, value: storage });
}

if ("window" in globalThis) {
  installMemoryStorage(globalThis, "localStorage");
  installMemoryStorage(globalThis, "sessionStorage");
}

// Testing Library's `findBy*` and `waitFor` give up after one second. A two-core CI runner runs a
// test about four times slower than a developer's machine, and an edit the test waits for lands
// after that second with nothing wrong in it. CI alone waits longer; a developer's machine keeps
// one, so a wait that grows slow shows there first. Only test files with a `window`, on CI, load
// anything for it, and `pure` configures without adding Testing Library's cleanup hooks to every
// file. An app without Testing Library has nothing to configure.
if ("window" in globalThis && process.env.CI) {
  /** @type {{ configure: (options: { asyncUtilTimeout: number }) => void } | null} */
  let testingLibrary = null;
  try {
    // @ts-ignore — an optional peer dependency: present only in an app that renders in its tests
    testingLibrary = await import("@testing-library/react/pure");
  } catch {
    // no Testing Library in this app
  }
  testingLibrary?.configure({ asyncUtilTimeout: CI_ASYNC_UTIL_TIMEOUT_MS });
}

// A module, so the import above can be awaited at the top level.
export {};
