#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import {
  discoverCkanResource,
  probeCkanResource,
} from "@data-hub/connectors";
import { getSourceDefinition } from "@data-hub/source-registry";

import { runManualIngestion, runRemoteIngestion } from "./run-ingestion.js";
import { executeProductionCommand } from "./production-command.js";
import { executeHealthCommand } from "./health-command.js";
import { createSafeLogger } from "./safe-log.js";
import { executeSnapshotCommand } from "./snapshot-command.js";

const EXIT_BY_STATE = {
  published: 0,
  no_change: 0,
  quarantined: 2,
  failed_retryable: 3,
  failed_terminal: 4,
} as const;

function options(args: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error("invalid_usage");
    }
    if (result.has(key)) throw new Error(`duplicate_option:${key}`);
    result.set(key, value);
  }
  return result;
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`missing_option:${key}`);
  return value;
}

async function execute(argv: string[]): Promise<number> {
  const logger = createSafeLogger();
  const command = argv[0];
  if (command === "production-run") {
    return executeProductionCommand(argv.slice(1));
  }
  if (command === "snapshot") {
    return executeSnapshotCommand(argv.slice(1));
  }
  if (command === "health-sync") {
    return executeHealthCommand(argv.slice(1));
  }
  if (command === "smoke") {
    if (process.env.DATA_HUB_ALLOW_NETWORK !== "1") throw new Error("network_not_enabled");
    const values = options(argv.slice(1));
    const source = getSourceDefinition(required(values, "--source"));
    const discovery = await discoverCkanResource(source);
    const probe = await probeCkanResource(source, discovery);
    console.log(
      JSON.stringify({
        event: "ckan_smoke_completed",
        source_id: source.source_id,
        content_type: probe.contentType,
        content_length: probe.contentLength,
        etag_present: probe.etag !== null,
        last_modified_present: probe.lastModified !== null,
      }),
    );
    return 0;
  }
  if (command !== "ingest") throw new Error("invalid_usage");

  const manual = argv[1] === "import-file";
  const values = options(argv.slice(manual ? 2 : 1));
  const sourceId = required(values, "--source");
  const dataDir = values.get("--data-dir") ?? ".data-hub";
  const run = manual
    ? await runManualIngestion({
        sourceId,
        dataDir,
        filePath: required(values, "--file"),
        operatorId: required(values, "--operator"),
        claimedPublicationPeriod: required(values, "--period"),
      })
    : await runRemoteIngestion({ sourceId, dataDir });
  if (run.state === "failed_retryable" || run.state === "failed_terminal") {
    logger.runFailed({
      sourceId: run.source_id,
      runId: run.run_id,
      state: run.state,
      failureCode: run.failure_code ?? "unknown_failure",
      requestTarget: run.request_target,
    });
  } else {
    logger.runCompleted(run);
  }
  return EXIT_BY_STATE[run.state];
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    return await execute(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_failure";
    createSafeLogger().runFailed({
      sourceId: "unknown",
      runId: "not-started",
      state: "failed_terminal",
      failureCode: message,
      requestTarget: null,
    });
    if (process.env.DATA_HUB_DEBUG === "1" && error instanceof Error) {
      console.error(JSON.stringify({ event: "debug_error", name: error.name }));
    }
    return message.includes("usage") || message.includes("option") ? 64 : 4;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await main();
}
