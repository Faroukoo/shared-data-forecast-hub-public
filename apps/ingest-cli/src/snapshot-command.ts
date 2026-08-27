import { readFile } from "node:fs/promises";

import { ProductionRunSummarySchema } from "@data-hub/contracts";
import {
  createSnapshot,
  restoreSnapshot,
  validateDataHubState,
  type CreateSnapshotInput,
  type RestoreSnapshotInput,
} from "@data-hub/snapshot";

import {
  CliUsageError,
  parseCliOptions,
  requiredOption,
} from "./command-options.js";
import { createSafeLogger } from "./safe-log.js";

export interface SnapshotCommandDependencies {
  createSnapshot?: (input: CreateSnapshotInput) => Promise<unknown>;
  restoreSnapshot?: (input: RestoreSnapshotInput) => Promise<unknown>;
  validateState?: (dataDir: string) => Promise<unknown>;
}

const VERIFY_OPTIONS = new Set(["--data-dir"]);
const CREATE_OPTIONS = new Set([
  "--data-dir",
  "--output-dir",
  "--summary-file",
  "--previous-tag",
]);
const RESTORE_OPTIONS = new Set([
  "--archive",
  "--checksum",
  "--index",
  "--target-data-dir",
]);

async function executeSnapshotSubcommand(
  args: string[],
  dependencies: SnapshotCommandDependencies,
): Promise<void> {
  const subcommand = args[0];
  if (subcommand === "verify-state") {
    const values = parseCliOptions(args.slice(1), VERIFY_OPTIONS);
    await (dependencies.validateState ?? validateDataHubState)(
      requiredOption(values, "--data-dir"),
    );
    console.log(JSON.stringify({ event: "snapshot_state_verified" }));
    return;
  }
  if (subcommand === "create") {
    const values = parseCliOptions(args.slice(1), CREATE_OPTIONS);
    const summary = ProductionRunSummarySchema.parse(
      JSON.parse(
        await readFile(requiredOption(values, "--summary-file"), "utf8"),
      ) as unknown,
    );
    const encodedPreviousTag = requiredOption(values, "--previous-tag");
    if (
      encodedPreviousTag !== "none" &&
      !/^data-\d{8}T\d{6}Z-[a-f0-9]{12}$/.test(encodedPreviousTag)
    ) {
      throw new CliUsageError("invalid_previous_snapshot_tag");
    }
    await (dependencies.createSnapshot ?? createSnapshot)({
      dataDir: requiredOption(values, "--data-dir"),
      outputDir: requiredOption(values, "--output-dir"),
      summary,
      previousSnapshotTag:
        encodedPreviousTag === "none" ? null : encodedPreviousTag,
    });
    console.log(JSON.stringify({ event: "snapshot_created" }));
    return;
  }
  if (subcommand === "restore") {
    const values = parseCliOptions(args.slice(1), RESTORE_OPTIONS);
    await (dependencies.restoreSnapshot ?? restoreSnapshot)({
      archivePath: requiredOption(values, "--archive"),
      checksumPath: requiredOption(values, "--checksum"),
      indexPath: requiredOption(values, "--index"),
      targetDataDir: requiredOption(values, "--target-data-dir"),
    });
    console.log(JSON.stringify({ event: "snapshot_restored" }));
    return;
  }
  throw new CliUsageError("unknown_snapshot_command");
}

export async function executeSnapshotCommand(
  args: string[],
  dependencies: SnapshotCommandDependencies = {},
): Promise<number> {
  try {
    await executeSnapshotSubcommand(args, dependencies);
    return 0;
  } catch (error) {
    const usage = error instanceof CliUsageError;
    createSafeLogger().runFailed({
      sourceId: "snapshot-store",
      runId: "not-started",
      state: "failed_terminal",
      failureCode:
        error instanceof Error ? error.message : "unknown_failure",
      requestTarget: null,
    });
    return usage ? 64 : 4;
  }
}
