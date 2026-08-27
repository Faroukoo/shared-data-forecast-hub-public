import { readFile } from "node:fs/promises";

import { ProductionRunSummarySchema } from "@data-hub/contracts";

import {
  syncHealthIssues,
  type HealthSyncResult,
  type SyncHealthIssuesInput,
  type WorkflowResult,
} from "./github-health.js";
import {
  CliUsageError,
  parseCliOptions,
  requiredOption,
} from "./command-options.js";
import { createSafeLogger } from "./safe-log.js";

export interface HealthCommandDependencies {
  environment?: NodeJS.ProcessEnv;
  syncHealth?: (input: SyncHealthIssuesInput) => Promise<HealthSyncResult>;
}

const HEALTH_OPTIONS = new Set([
  "--summary-file",
  "--repository",
  "--workflow-result",
  "--run-url",
]);

function workflowResult(value: string): WorkflowResult {
  if (
    value === "success" ||
    value === "failure" ||
    value === "cancelled" ||
    value === "skipped"
  ) {
    return value;
  }
  throw new CliUsageError("invalid_workflow_result");
}

export async function executeHealthCommand(
  args: string[],
  dependencies: HealthCommandDependencies = {},
): Promise<number> {
  try {
    const values = parseCliOptions(args, HEALTH_OPTIONS);
    const summaryFile = requiredOption(values, "--summary-file");
    const token = (dependencies.environment ?? process.env).GITHUB_TOKEN;
    if (!token) throw new Error("github_token_missing");
    const summary =
      summaryFile === "none"
        ? null
        : ProductionRunSummarySchema.parse(
            JSON.parse(await readFile(summaryFile, "utf8")) as unknown,
          );
    const result = await (dependencies.syncHealth ?? syncHealthIssues)({
      repository: requiredOption(values, "--repository"),
      token,
      summary,
      workflowResult: workflowResult(
        requiredOption(values, "--workflow-result"),
      ),
      runUrl: requiredOption(values, "--run-url"),
    });
    console.log(
      JSON.stringify({
        event: "health_sync_completed",
        created_count: result.created.length,
        commented_count: result.commented.length,
        closed_count: result.closed.length,
      }),
    );
    return 0;
  } catch (error) {
    const usage = error instanceof CliUsageError;
    createSafeLogger().runFailed({
      sourceId: "health-sync",
      runId: "not-started",
      state: "failed_terminal",
      failureCode:
        error instanceof Error ? error.message : "unknown_failure",
      requestTarget: null,
    });
    return usage ? 64 : 4;
  }
}
