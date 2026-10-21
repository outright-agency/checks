#!/usr/bin/env node
// `outright-checks check` — the inner loop, after every task.
// `outright-checks verify [--force]` — the full gate, once per tree and one at a time per machine.
//
// Both read the app's `checks.config.mjs` from the working directory. A mistake in it stops the
// command before anything runs, exit 2, naming the file and the key.

import { CONFIG_FILE, ChecksConfigError, loadConfig } from "../src/config.mjs";

const USAGE = "usage: outright-checks <check | verify [--force]>";

const [command, ...rest] = process.argv.slice(2);
const known = command === "check" ? [] : command === "verify" ? ["--force"] : null;
if (known === null || rest.some((argument) => !known.includes(argument))) {
  console.error(USAGE);
  process.exit(2);
}

/** @param {unknown} error */
function configMistake(error) {
  if (error instanceof ChecksConfigError) return error.message;
  return `${CONFIG_FILE} failed to load: ${error instanceof Error ? error.message : String(error)}`;
}

const cwd = process.cwd();
let config;
try {
  config = await loadConfig(cwd);
} catch (error) {
  console.log(`[${command}] ${configMistake(error)}`);
  process.exit(2);
}

const { main } = await import(command === "check" ? "../src/gate/check.mjs" : "../src/gate/verify.mjs");
try {
  process.exit(await main({ cwd, config, force: rest.includes("--force") }));
} catch (error) {
  if (!(error instanceof ChecksConfigError)) throw error;
  console.log(`[${command}] ${error.message}`);
  process.exit(2);
}
