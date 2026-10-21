/**
 * The fewest workers any run gets. Vitest's VM pools hand every file of a one-worker run to one
 * task: one VM context, one module cache, so a module the first file loaded against its mock keeps
 * that mock for every file after it. Two workers give each file a context of its own.
 */
export const MIN_WORKERS: 2;
/**
 * Workers when `VITEST_MAX_WORKERS` is unset. A machine that runs several sessions' checks, or
 * other work beside them, is starved by one run taking every core; four lets two runs share a
 * ten-core machine. A run that holds the machine alone (`outright-checks verify`, under its lock)
 * asks for more through its own lane.
 */
export const DEFAULT_WORKERS: 4;
/**
 * Where the suite recycles a worker. Uncapped, `vmForks` reuses one process for many files and
 * their VM contexts accumulate: workers reached about 4 GB each. At 1 GB they held under 800 MB.
 */
export const SUITE_WORKER_MEMORY: "1GB";
/**
 * Where the check recycles a worker: half the suite's. Vitest compares the limit with a worker's
 * used heap only after a file ends, so at 1 GB each worker fills to 1 GB while a test file's median
 * heap is about 311 MB and its largest about 689 MB. Many sessions check at once, so a check's
 * memory is what limits how many of them fit. Measured on an app with about 1,800 test files: the
 * ratchets alone peaked at 2.8 GB at 512 MB against 3.9 GB at 1 GB, in 49 s against 46 s.
 *
 * It goes no lower. A worker's heap only grows (Node keeps every file's VM context alive for the
 * worker's life), so a lower limit recycles more often and throws away the compiled code the next
 * worker rebuilds: at 384 MB the every-test check peaked no lower in 32% more CPU time, and at
 * 256 MB in 60% more.
 */
export const CHECK_WORKER_MEMORY: "512MB";
/**
 * The check's own vitest process, held by `--max-old-space-size`, which reaches no worker. Asked
 * for the tests a change relates to, vitest walks the import graph of every test file and
 * transforms each module it meets. Unbounded, V8 lets that heap grow to about 1 GB of mostly
 * garbage before it collects, and keeps the pages for the rest of the run. What it keeps alive is
 * far less (at most 385 MB on a check that ran every test, on the app above); 768 MB is twice
 * that. A check that ends in "JavaScript heap out of memory" has outgrown it: measure again before
 * raising it.
 */
export const CHECK_PARENT_HEAP_MB: 768;
/**
 * A test's time limit. Five seconds is Vitest's own default, kept on a developer's machine so a
 * test that grows past it goes red and earns a budget of its own, with its reason beside it.
 */
export const TEST_TIMEOUT_MS: 5000;
/**
 * A test's time limit under `CI`. A two-core CI runner runs a test about four times slower than a
 * ten-core machine: render tests that took 1.4–1.9 s locally took 5–7.7 s there, with nothing
 * wrong in them.
 */
export const CI_TEST_TIMEOUT_MS: 15000;
/** Testing Library's `findBy*` and `waitFor` give up after one second; on CI, for the same reason, three. */
export const CI_ASYNC_UTIL_TIMEOUT_MS: 3000;
