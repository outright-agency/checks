// The app's ratchets as a command, run by tsx in an app without a module type.
import { readdirSync } from "node:fs";
import { gitBaseline } from "@outright/checks/git-baseline";
import { runRatchets } from "@outright/checks/ratchets";
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
});
