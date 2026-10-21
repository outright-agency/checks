// The app's binding of the package's helpers to its config.
import { analysisCache } from "@outright/checks/analysis-cache";
import checks from "../../checks.config.mjs";

export const { cachedAnalysis } = analysisCache(checks);
