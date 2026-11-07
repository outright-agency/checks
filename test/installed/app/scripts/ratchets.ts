// The app's ratchets as a command, run by tsx in an app without a module type.
import { readdirSync } from "node:fs";
import { analyzeDbTests, evaluateDbTests } from "@outright/checks/db-tests";
import { gitBaseline } from "@outright/checks/git-baseline";
import { runRatchets } from "@outright/checks/ratchets";
import { analyzeTests, evaluateTests, formatTestsFindings } from "@outright/checks/tests-check";
import checks from "../checks.config.mjs";
import { cachedAnalysis } from "../src/test/checks";

const { toCurrentPathSpelling } = gitBaseline(checks, { movedRoots: [["src/old/", "src/"]] });

process.exitCode = runRatchets({
  files: () => {
    // The same analysis as the ratchet test's: a run after the test reads its cached result.
    const files = cachedAnalysis("files", process.cwd(), null, () =>
      readdirSync("src").filter((file) => file.endsWith(".ts"))
    );
    const spelled = toCurrentPathSpelling("src/old/sum.ts");
    console.log(`Files ratchet passed (${files.length} files, ${spelled}, ${checks.name}).`);
    return spelled === "src/sum.ts";
  },
  tests: () => {
    // The tests check, with TypeScript resolved from the app.
    const { findings, checked } = evaluateTests(analyzeTests({ roots: ["src"] }));
    if (findings.length > 0) {
      console.error(`Tests ratchet failed:\n\n${formatTestsFindings(findings).join("\n")}`);
      return false;
    }
    console.log(`Tests ratchet passed (${checked.files} test files, ${checked.jsdomFiles} in a DOM).`);
    return true;
  },
  "db-tests": () => {
    // Off in this app's config, and turned on here as an app turns it on in its own.
    const dbTests = { lists: "src/test/lists.ts", exceptions: "src/test/exceptions.ts", rule: "README.md" };
    const analysis = analyzeDbTests({ ...checks, checks: { dbTests } });
    const findings = evaluateDbTests(analysis, { debt: [], exceptions: [], limit: 30 });
    console.log(`Database tests ratchet passed (${analysis.files.length} files, ${findings.length} findings).`);
    return findings.length === 0;
  },
});
