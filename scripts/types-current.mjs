// Whether the committed declarations (`types/`) are what the source's JSDoc declares today: emits
// them afresh into `.types-check/` and compares file by file. Exit 0 when they match; otherwise
// it names each file that differs and exits 1 — `pnpm types` writes them.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FRESH = join(ROOT, ".types-check");
const COMMITTED = join(ROOT, "types");

/** Every file under `directory`, as paths relative to it. @param {string} directory @returns {string[]} */
function files(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort();
}

rmSync(FRESH, { recursive: true, force: true });
const tsc = spawnSync(
  process.execPath,
  [join(ROOT, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.types.json", "--outDir", FRESH],
  { cwd: ROOT, encoding: "utf8" }
);
if (tsc.status !== 0) {
  console.error(`${tsc.stdout}${tsc.stderr}`);
  process.exit(1);
}

const differ = [...new Set([...files(FRESH), ...files(COMMITTED)])].filter((path) => {
  const fresh = join(FRESH, path);
  const committed = join(COMMITTED, path);
  return !existsSync(fresh) || !existsSync(committed) || readFileSync(fresh, "utf8") !== readFileSync(committed, "utf8");
});
rmSync(FRESH, { recursive: true, force: true });

if (differ.length > 0) {
  console.error(`types/ is not what the source declares — run \`pnpm types\`:\n${differ.map((path) => `  types/${path}`).join("\n")}`);
  process.exit(1);
}
console.log("types/ is current.");
