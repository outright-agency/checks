/**
 * CHECKS FOR THE CHECKS — the parts of an app's checks standard a machine can hold. The rest of
 * that standard is judgment and stays prose.
 *
 * A badly built check is not caught by the suite, because it IS the suite: it goes red on correct
 * work or stays green on broken work, and either way people stop reading it.
 *
 * Pure: every function takes text and returns findings, so each can be made to fire on a fixture
 * before an app trusts it on its live tree. The live half — the app's own folders, scripts and
 * reviewed lists — is the app's test, calling these.
 */

/** @typedef {{ path: string, source: string }} SourceText */

/* ── 1. a scan check is a floor, never an exact count ─────────────────────── */

/** @typedef {{ path: string, title: string, line: number, text: string }} ExactCountFinding */

const SCAN_TEST = /^\s*it\(\s*(["'`])([^"'`]*vacuous[^"'`]*)\1/i;
const EXACT_COUNT = /\.(?:toHaveLength|toBe|toEqual|toStrictEqual)\(\s*[\d{[]/;

/**
 * Exact assertions inside a test whose title says it only proves the scan was not vacuous. Such a
 * test exists so a walker that silently finds half the tree cannot pass every rule by having
 * nothing to judge; `toBeGreaterThan` proves that. An exact count proves it too, and also goes red
 * on every ordinary edit and conflicts between any two branches.
 * @param {readonly SourceText[]} files
 * @returns {ExactCountFinding[]}
 */
export function exactCountsInScanTests(files) {
  /** @type {ExactCountFinding[]} */
  const findings = [];
  for (const { path, source } of files) {
    const lines = source.split("\n");
    /** @type {string | null} */
    let title = null;
    let indent = "";
    lines.forEach((text, index) => {
      const opening = SCAN_TEST.exec(text);
      if (opening) {
        title = opening[2];
        indent = /^\s*/.exec(text)?.[0] ?? "";
        return;
      }
      if (title === null) return;
      if (text.startsWith(`${indent}});`) || text.startsWith(`${indent}it(`)) {
        title = null;
        return;
      }
      if (EXACT_COUNT.test(text) && !/\.toBe\(\s*(?:true|false)\s*\)/.test(text)) {
        findings.push({ path, title, line: index + 1, text: text.trim() });
      }
    });
  }
  return findings;
}

/* ── 2. a scoped gate never runs the suite ────────────────────────────────── */

/** @typedef {{ script: string, command: string }} SuiteReachFinding */

/**
 * A script with every `pnpm <script>` it calls written out in place, to a depth of six.
 * @param {string} name
 * @param {Readonly<Record<string, string>>} scripts
 * @param {number} [depth]
 * @returns {string}
 */
export function expandScript(name, scripts, depth = 0) {
  const body = scripts[name] ?? "";
  if (depth > 6) return body;
  return body.replace(/\bpnpm\s+(?:run\s+)?([\w:.-]+)/g, (whole, /** @type {string} */ callee) =>
    callee in scripts ? `( ${expandScript(callee, scripts, depth + 1)} )` : whole
  );
}

/**
 * Scoped gates (`verify:<x>`) whose expansion contains a `vitest run` with no path — the whole
 * suite. A scoped gate that quietly ends in the suite makes every "run verify:<x> after touching
 * x" cost a full run, and a plan that names two of them pays for two suites.
 *
 * `notScoped` names the app's `verify:<x>` scripts that are not a surface's scoped gate (its full
 * chain, and any other that runs the suite on purpose); `pathRoots` names the folders a test path
 * starts with.
 * @param {Readonly<Record<string, string>>} scripts
 * @param {{ notScoped?: readonly string[], pathRoots?: readonly string[] }} [options]
 * @returns {SuiteReachFinding[]}
 */
export function scopedGatesReachingTheSuite(
  scripts,
  { notScoped = ["verify:chain"], pathRoots = ["src", "scripts", "packages"] } = {}
) {
  const roots = new RegExp(`^(?:${pathRoots.map(escapeRegExp).join("|")})/`);
  /** @type {SuiteReachFinding[]} */
  const findings = [];
  for (const script of Object.keys(scripts)) {
    if (!script.startsWith("verify:") || notScoped.includes(script)) continue;
    const expanded = expandScript(script, scripts);
    for (const match of expanded.matchAll(/\bvitest\s+run\b([^&|;()]*)/g)) {
      const hasPath = match[1].split(/\s+/).some((argument) => roots.test(argument));
      if (!hasPath) findings.push({ script, command: `vitest run${match[1]}`.trim() });
    }
  }
  return findings;
}

/** @param {string} text */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ── 3. every rule has a fixture that makes it fire ───────────────────────── */

/** @typedef {{ name: string, files: readonly SourceText[] }} RatchetFolder */

/** @param {string} path */
const isTestFile = (path) => /\.test\.[cm]?[jt]sx?$/.test(path);

/**
 * A LIVE test analyses the real repository, where a healthy rule finds nothing. Naming a rule
 * there — filtering the findings by its id and expecting none — says the tree is clean; it says
 * nothing about whether the rule CAN fire.
 * @param {string} source
 * @returns {boolean}
 */
export function isLiveTest(source) {
  return (
    /analy[sz]e\w*\(\s*(?:\)|\{|REPO_ROOT|process\.cwd\(\))/.test(source) &&
    !/mkdtemp|\btree\(|Sources\(/.test(source)
  );
}

/**
 * Every `rule: "<id>"` a folder's non-test files declare.
 * @param {RatchetFolder} folder
 * @returns {string[]}
 */
export function declaredRules(folder) {
  /** @type {Set<string>} */
  const rules = new Set();
  for (const { path, source } of folder.files) {
    if (isTestFile(path)) continue;
    for (const match of source.matchAll(/\brule:\s*"([A-Za-z0-9][A-Za-z0-9-]*)"/g)) {
      rules.add(match[1]);
    }
  }
  return [...rules].sort();
}

/**
 * `folder:rule` for every declared rule no fixture test names. A rule that cannot fire looks
 * exactly like a rule that is passing: a rule that matches one spelling of an import matches
 * nothing once that spelling is gone, and its live test stays green forever.
 *
 * `provenInALoop` names folders whose fixture test proves every rule without spelling each id — it
 * collects what fired and compares it with the declared set. That is the better pattern, and the
 * marker is checked, not trusted.
 * @param {readonly RatchetFolder[]} folders
 * @param {Readonly<Record<string, { file: string, marker: string }>>} provenInALoop
 * @returns {string[]}
 */
export function unprovenRules(folders, provenInALoop) {
  /** @type {string[]} */
  const unproven = [];
  for (const folder of folders) {
    const loop = provenInALoop[folder.name];
    if (loop) {
      const file = folder.files.find(({ path }) => path.endsWith(`/${loop.file}`));
      if (file?.source.includes(loop.marker)) continue;
      unproven.push(`${folder.name}:(the loop marker is gone from ${loop.file})`);
    }
    const fixtures = folder.files
      .filter(({ path, source }) => isTestFile(path) && !isLiveTest(source))
      .map(({ source }) => source)
      .join("\n");
    for (const rule of declaredRules(folder)) {
      if (!fixtures.includes(`"${rule}"`)) unproven.push(`${folder.name}:${rule}`);
    }
  }
  return unproven.sort();
}
