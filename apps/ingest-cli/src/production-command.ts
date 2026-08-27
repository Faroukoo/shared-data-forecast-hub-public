import {
  runProductionIngestion,
  writeProductionOutputs,
  type RunProductionOptions,
  type WriteProductionOutputsInput,
} from "./run-production.js";
import { createSafeLogger } from "./safe-log.js";
import {
  CliUsageError,
  parseCliOptions,
  requiredOption,
} from "./command-options.js";

type RunProduction = (
  options: RunProductionOptions,
) => ReturnType<typeof runProductionIngestion>;
type WriteOutputs = (
  input: WriteProductionOutputsInput,
) => ReturnType<typeof writeProductionOutputs>;

export interface ProductionCommandDependencies {
  runProduction?: RunProduction;
  writeOutputs?: WriteOutputs;
}

const PRODUCTION_OPTIONS = new Set([
  "--data-dir",
  "--summary-file",
  "--markdown-file",
  "--code-sha",
]);

export async function executeProductionCommand(
  args: string[],
  dependencies: ProductionCommandDependencies = {},
): Promise<number> {
  try {
    const values = parseCliOptions(args, PRODUCTION_OPTIONS);
    const dataDir = requiredOption(values, "--data-dir");
    const jsonPath = requiredOption(values, "--summary-file");
    const markdownPath = requiredOption(values, "--markdown-file");
    const codeSha = requiredOption(values, "--code-sha");
    if (!/^[a-f0-9]{40}$/.test(codeSha)) {
      throw new CliUsageError("invalid_code_sha");
    }
    const summary = await (dependencies.runProduction ?? runProductionIngestion)({
      dataDir,
      codeSha,
    });
    await (dependencies.writeOutputs ?? writeProductionOutputs)({
      summary,
      jsonPath,
      markdownPath,
    });
    console.log(
      JSON.stringify({
        event: "production_run_completed",
        decision: summary.decision,
        source_count: summary.sources.length,
      }),
    );
    return summary.decision === "blocked" ? 2 : 0;
  } catch (error) {
    const usage = error instanceof CliUsageError;
    createSafeLogger().runFailed({
      sourceId: "production",
      runId: "not-started",
      state: "failed_terminal",
      failureCode:
        error instanceof Error ? error.message : "unknown_failure",
      requestTarget: null,
    });
    return usage ? 64 : 4;
  }
}
