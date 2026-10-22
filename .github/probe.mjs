// Temporary: facts about child processes on a Windows runner.
import { spawn, spawnSync } from "node:child_process";
import { getPriority, setPriority } from "node:os";

const child = `try { require("fs").writeSync(3, "fd3-ok"); } catch (e) { console.log("fd3-missing", e.code); }
console.log("priority", require("os").getPriority());`;

/** @param {string} file @param {string[]} args */
function fd3(label, file, args) {
  return new Promise((done) => {
    const c = spawn(file, args, { stdio: ["pipe", "pipe", "pipe", "pipe"] });
    let out = "";
    let report = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.stdio[3].on("data", (d) => (report += d));
    c.on("error", (e) => console.log(label, "error", e.code));
    c.on("close", () => {
      console.log(label, "| out:", out.trim().replace(/\s+/g, " "), "| fd3:", report || "(none)");
      done();
    });
  });
}

await fd3("direct", process.execPath, ["-e", child]);
await fd3("via nice", "nice", ["-n", "10", process.execPath, "-e", child]);

// setPriority right after spawn: does a grandchild inherit it?
await new Promise((done) => {
  const c = spawn(
    process.execPath,
    ["-e", `setTimeout(() => { console.log("child", require("os").getPriority()); console.log(require("child_process").execFileSync(process.execPath, ["-e", "console.log('grandchild', require('os').getPriority())"], { encoding: "utf8" }).trim()); }, 300);`],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  setPriority(c.pid, 10);
  console.log("set on", c.pid, "reads", getPriority(c.pid));
  c.stdout.on("data", (d) => process.stdout.write(`  ${d}`));
  c.on("close", done);
});

// A lane: sh -c that starts a long grandchild. What stops the tree?
for (const how of ["kill(-pid)", "child.kill", "taskkill /T /F"]) {
  await new Promise((done) => {
    const started = Date.now();
    const c = spawn("sh", ["-c", "sleep 20; echo finished"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    setTimeout(() => {
      try {
        if (how === "kill(-pid)") process.kill(-c.pid, "SIGTERM");
        else if (how === "child.kill") c.kill("SIGTERM");
        else console.log(spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { encoding: "utf8" }).stdout.trim());
      } catch (e) {
        console.log(how, "threw", e.code);
      }
    }, 1500);
    c.on("exit", (code, signal) => {
      console.log(how, "| exit", code, signal, "after", Date.now() - started, "ms");
    });
    c.on("close", () => {
      console.log(how, "| close after", Date.now() - started, "ms", out.trim());
      done();
    });
  });
}
const sleeps = spawnSync("tasklist", ["/FI", "IMAGENAME eq sleep.exe"], { encoding: "utf8" }).stdout;
console.log("sleep.exe left:", sleeps.includes("sleep.exe") ? sleeps.trim() : "none");
