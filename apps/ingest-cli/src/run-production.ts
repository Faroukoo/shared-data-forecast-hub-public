import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  ProductionRunSummarySchema,
  QualityReportSchema,
  RawArtifactSchema,
  SCHEMA_VERSION,
  type IngestionRun,
  type ProductionRunSummary,
  type ProductionSourceResult,
  type QualityReport,
  type RawArtifact,
  type SourceDefinition,
} from "@data-hub/contracts";
import {
  assessFreshness,
  deriveSourceHealth,
  type FreshnessCode,
} from "@data-hub/quality";
import { listEnabledSourceDefinitions } from "@data-hub/source-registry";

import { runRemoteIngestion } from "./run-ingestion.js";

export interface RunProductionOptions {
  dataDir: string;
  codeSha: string;
  now?: string;
  sources?: SourceDefinition[];
  runSource?: typeof runRemoteIngestion;
  loadArtifact?: (dataDir: string, sha256: string) => Promise<RawArtifact>;
  loadQuality?: (
    dataDir: string,
    runId: string,
  ) => Promise<QualityReport | null>;
}

export interface WriteProductionOutputsInput {
  summary: ProductionRunSummary;
  jsonPath: string;
  markdownPath: string;
}

const BLOCKING_STATES = new Set<IngestionRun["state"]>([
  "quarantined",
  "failed_retryable",
  "failed_terminal",
]);

async function loadArtifactFromDisk(
  dataDir: string,
  sha256: string,
): Promise<RawArtifact> {
  return RawArtifactSchema.parse(
    JSON.parse(
      await readFile(
        join(dataDir, "manifests", "artifacts", `${sha256}.json`),
        "utf8",
      ),
    ),
  );
}

async function loadQualityFromDisk(
  dataDir: string,
  runId: string,
): Promise<QualityReport | null> {
  try {
    return QualityReportSchema.parse(
      JSON.parse(await readFile(join(dataDir, "quality", `${runId}.json`), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function safeFailureCode(value: string | null): string | null {
  if (value === null) return null;
  return /^[a-z0-9][a-z0-9_.:-]*$/.test(value)
    ? value
    : "unsafe_failure_code";
}

function healthFromFreshness(code: FreshnessCode): {
  health: ProductionSourceResult["health_status"];
  warnings: string[];
} {
  if (code === "source_stale") {
    return { health: "stale", warnings: [code] };
  }
  if (code === "source_late" || code === "invalid_remote_timestamp") {
    return { health: "late", warnings: [code] };
  }
  return { health: "healthy", warnings: [] };
}

async function summarizeRun(input: {
  dataDir: string;
  now: string;
  source: SourceDefinition;
  run: IngestionRun;
  loadArtifact: NonNullable<RunProductionOptions["loadArtifact"]>;
  loadQuality: NonNullable<RunProductionOptions["loadQuality"]>;
}): Promise<ProductionSourceResult> {
  if (input.run.state === "no_change" && input.run.artifact_sha256) {
    const artifact = await input.loadArtifact(
      input.dataDir,
      input.run.artifact_sha256,
    );
    const freshness = healthFromFreshness(
      assessFreshness({
        source: input.source,
        now: input.now,
        remoteLastModified: artifact.http_last_modified,
      }),
    );
    return {
      source_id: input.source.source_id,
      run_id: input.run.run_id,
      state: input.run.state,
      artifact_sha256: input.run.artifact_sha256,
      dataset_id: input.run.dataset_id,
      health_status: freshness.health,
      warning_codes: freshness.warnings,
      failure_code: null,
    };
  }

  const report = await input.loadQuality(input.dataDir, input.run.run_id);
  const health = report
    ? deriveSourceHealth({
        source: input.source,
        report,
        now: input.now,
      })
    : null;
  return {
    source_id: input.source.source_id,
    run_id: input.run.run_id,
    state: input.run.state,
    artifact_sha256: input.run.artifact_sha256,
    dataset_id: input.run.dataset_id,
    health_status: health?.status ?? null,
    warning_codes: report?.warning_codes ?? [],
    failure_code: safeFailureCode(input.run.failure_code),
  };
}

export async function runProductionIngestion(
  options: RunProductionOptions,
): Promise<ProductionRunSummary> {
  const timestamp = options.now ?? new Date().toISOString();
  const sources = [...(options.sources ?? listEnabledSourceDefinitions())].sort(
    (left, right) => left.source_id.localeCompare(right.source_id),
  );
  const runSource = options.runSource ?? runRemoteIngestion;
  const loadArtifact = options.loadArtifact ?? loadArtifactFromDisk;
  const loadQuality = options.loadQuality ?? loadQualityFromDisk;
  const results: ProductionSourceResult[] = [];

  for (const source of sources) {
    const run = await runSource({
      sourceId: source.source_id,
      dataDir: options.dataDir,
      now: timestamp,
    });
    results.push(
      await summarizeRun({
        dataDir: options.dataDir,
        now: timestamp,
        source,
        run,
        loadArtifact,
        loadQuality,
      }),
    );
  }

  const decision = results.some((result) => BLOCKING_STATES.has(result.state))
    ? "blocked"
    : results.some((result) => result.state === "published")
      ? "publishable"
      : "no_change";

  return ProductionRunSummarySchema.parse({
    schema_version: SCHEMA_VERSION,
    production_run_id: `production:${timestamp}`,
    started_at: timestamp,
    completed_at: timestamp,
    code_sha: options.codeSha,
    decision,
    sources: results,
  });
}

function markdownCell(value: string | null): string {
  return value === null
    ? "-"
    : value.replaceAll("|", "\\|").replaceAll(/\s+/g, " ").trim();
}

export function renderProductionMarkdown(
  summary: ProductionRunSummary,
): string {
  const validated = ProductionRunSummarySchema.parse(summary);
  const lines = [
    "# Production data run",
    "",
    `- Decision: ${validated.decision}`,
    `- Sources: ${String(validated.sources.length)}`,
    `- Published: ${String(validated.sources.filter((source) => source.state === "published").length)}`,
    `- Blocked: ${String(validated.sources.filter((source) => BLOCKING_STATES.has(source.state)).length)}`,
    "",
    "| Source | State | Health | Warnings | Failure |",
    "| --- | --- | --- | --- | --- |",
    ...validated.sources.map((source) =>
      [
        source.source_id,
        source.state,
        source.health_status ?? "-",
        source.warning_codes.join(", ") || "-",
        markdownCell(source.failure_code),
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"),
    ),
    "",
  ];
  return lines.join("\n");
}

export async function writeProductionOutputs(
  input: WriteProductionOutputsInput,
): Promise<void> {
  const summary = ProductionRunSummarySchema.parse(input.summary);
  await Promise.all([
    mkdir(dirname(input.jsonPath), { recursive: true }),
    mkdir(dirname(input.markdownPath), { recursive: true }),
  ]);
  const jsonTemporary = `${input.jsonPath}.tmp-${randomUUID()}`;
  const markdownTemporary = `${input.markdownPath}.tmp-${randomUUID()}`;
  try {
    await Promise.all([
      writeFile(jsonTemporary, `${JSON.stringify(summary, null, 2)}\n`, {
        flag: "wx",
      }),
      writeFile(markdownTemporary, renderProductionMarkdown(summary), {
        flag: "wx",
      }),
    ]);
    await rename(jsonTemporary, input.jsonPath);
    await rename(markdownTemporary, input.markdownPath);
  } finally {
    await Promise.all([
      rm(jsonTemporary, { force: true }),
      rm(markdownTemporary, { force: true }),
    ]);
  }
}
