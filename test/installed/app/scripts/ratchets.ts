// The app's ratchets as a command, run by tsx in an app without a module type.
import { gitBaseline } from "@outright/checks/git-baseline";
import { runRatchets } from "@outright/checks/ratchets";
import checks from "../checks.config.mjs";
import { cachedAnalysis } from "../src/test/checks";

const { toCurrentPathSpelling } = gitBaseline(checks, { movedRoots: [["src/old/", "src/"]] });

process.exitCode = runRatchets({
  files: () => {
    const files = cachedAnalysis("files", process.cwd(), null, () => ["sum.ts"]);
    const spelled = toCurrentPathSpelling("src/old/sum.ts");
    console.log(`Files ratchet passed (${files.length} file, ${spelled}, ${checks.name}).`);
    return spelled === "src/sum.ts";
  },
});
