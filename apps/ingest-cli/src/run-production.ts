import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  CanonicalObservationSchema,
  DatasetVersionSchema,
  ProductionRunSummarySchema,
  QualityReportSchema,
  RawArtifactSchema,
  SCHEMA_VERSION,
  type DatasetVersion,
  type IngestionRun,
  type ProductionRunSummary,
  type ProductionSourceResult,
  type QualityReport,
  type RawArtifact,
  type SourceDefinition,
} from "@data-hub/contracts";
import {
  assessFreshness,
  assessPeriodFreshness,
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
const BLOCKING_HEALTH_STATUSES = new Set<
  Exclude<ProductionSourceResult["health_status"], null>
>(["schema_changed", "quarantined", "disabled", "licence_blocked"]);

function isBlockingResult(result: ProductionSourceResult): boolean {
  return (
    BLOCKING_STATES.has(result.state) ||
    (result.health_status !== null &&
      BLOCKING_HEALTH_STATUSES.has(result.health_status))
  );
}

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

async function loadVerifiedDatasetFromDisk(
  dataDir: string,
  sourceId: string,
  datasetId: string,
): Promise<DatasetVersion> {
  if (!/^sha256:[a-f0-9]{64}$/.test(datasetId)) {
    throw new Error(`invalid_no_change_dataset:${datasetId}`);
  }
  const directory = join(dataDir, "published", datasetId);
  const manifest = DatasetVersionSchema.parse(
    JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
  );
  if (manifest.dataset_id !== datasetId || manifest.source_id !== sourceId) {
    throw new Error(`dataset_evidence_mismatch:${datasetId}`);
  }

  const observationsBytes = await readFile(join(directory, "observations.jsonl"));
  const canonicalSha256 = createHash("sha256")
    .update(observationsBytes)
    .digest("hex");
  const lines = new TextDecoder()
    .decode(observationsBytes)
    .split("\n")
    .filter(Boolean);
  if (
    canonicalSha256 !== manifest.canonical_sha256 ||
    lines.length !== manifest.row_count
  ) {
    throw new Error(`dataset_content_mismatch:${datasetId}`);
  }
  const observations = lines.map((line) =>
    CanonicalObservationSchema.parse(JSON.parse(line)),
  );
  if (
    observations.some(
      (observation) =>
        observation.source_id !== sourceId ||
        !manifest.artifact_sha256s.includes(observation.artifact_sha256),
    )
  ) {
    throw new Error(`dataset_observation_mismatch:${datasetId}`);
  }
  const periodStarts = observations.map((row) => row.period_start).sort();
  const periodEnds = observations.map((row) => row.period_end).sort();
  if (
    (periodStarts[0] ?? null) !== manifest.first_period_start ||
    (periodEnds.at(-1) ?? null) !== manifest.last_period_end
  ) {
    throw new Error(`dataset_period_mismatch:${datasetId}`);
  }
  return manifest;
}

async function loadLatestCompatibleQualityFromDisk(
  dataDir: string,
  manifest: DatasetVersion,
): Promise<QualityReport | null> {
  let entries;
  try {
    entries = await readdir(join(dataDir, "quality"), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let latest: { filename: string; report: QualityReport } | null = null;
  for (const entry of entries
    .filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const report = QualityReportSchema.parse(
      JSON.parse(
        await readFile(join(dataDir, "quality", entry.name), "utf8"),
      ),
    );
    if (
      report.source_id !== manifest.source_id ||
      !manifest.artifact_sha256s.includes(report.artifact_sha256)
    ) {
      continue;
    }
    if (
      latest === null ||
      report.evaluated_at > latest.report.evaluated_at ||
      (report.evaluated_at === latest.report.evaluated_at &&
        entry.name > latest.filename)
    ) {
      latest = { filename: entry.name, report };
    }
  }
  return latest?.report ?? null;
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
  if (code !== null) {
    return { health: "late", warnings: [code] };
  }
  return { health: "healthy", warnings: [] };
}

const FRESHNESS_WARNING_CODES = new Set<Exclude<FreshnessCode, null>>([
  "source_stale",
  "source_late",
  "invalid_remote_timestamp",
  "invalid_period_timestamp",
  "future_period",
]);

function requireMatchingQuality(input: {
  source: SourceDefinition;
  run: IngestionRun;
  report: QualityReport;
}): void {
  if (
    input.report.source_id !== input.source.source_id ||
    input.report.artifact_sha256 !== input.run.artifact_sha256
  ) {
    throw new Error(`quality_evidence_mismatch:${input.run.run_id}`);
  }
}

function resultFromQuality(input: {
  source: SourceDefinition;
  run: IngestionRun;
  report: QualityReport;
  now: string;
}): ProductionSourceResult {
  requireMatchingQuality(input);
  const health = deriveSourceHealth({
    source: input.source,
    report: input.report,
    now: input.now,
  });
  return {
    source_id: input.source.source_id,
    run_id: input.run.run_id,
    state: input.run.state,
    artifact_sha256: input.run.artifact_sha256,
    dataset_id: input.run.dataset_id,
    health_status: health.status,
    warning_codes: input.report.warning_codes,
    failure_code: safeFailureCode(input.run.failure_code),
  };
}

async function summarizeRun(input: {
  dataDir: string;
  now: string;
  source: SourceDefinition;
  run: IngestionRun;
  loadArtifact: NonNullable<RunProductionOptions["loadArtifact"]>;
  loadQuality: NonNullable<RunProductionOptions["loadQuality"]>;
}): Promise<ProductionSourceResult> {
  const currentReport = await input.loadQuality(input.dataDir, input.run.run_id);
  if (currentReport) {
    return resultFromQuality({
      source: input.source,
      run: input.run,
      report: currentReport,
      now: input.now,
    });
  }

  if (input.run.state === "no_change" && input.run.artifact_sha256) {
    const artifact = await input.loadArtifact(
      input.dataDir,
      input.run.artifact_sha256,
    );
    if (
      artifact.sha256 !== input.run.artifact_sha256 ||
      artifact.source_id !== input.source.source_id
    ) {
      throw new Error(`artifact_evidence_mismatch:${input.run.run_id}`);
    }
    if (!input.run.dataset_id) {
      throw new Error(`missing_no_change_dataset:${input.run.run_id}`);
    }
    const manifest = await loadVerifiedDatasetFromDisk(
      input.dataDir,
      input.source.source_id,
      input.run.dataset_id,
    );
    if (!manifest.artifact_sha256s.includes(input.run.artifact_sha256)) {
      throw new Error(`dataset_artifact_mismatch:${input.run.run_id}`);
    }
    const compatibleReport = await loadLatestCompatibleQualityFromDisk(
      input.dataDir,
      manifest,
    );
    const freshnessCode = input.source.connector.kind === "google-sheets-xlsx"
      ? assessPeriodFreshness({
          source: input.source,
          now: input.now,
          lastPeriodEnd: manifest.last_period_end,
        })
      : assessFreshness({
          source: input.source,
          now: input.now,
          remoteLastModified: artifact.http_last_modified,
        });
    const freshness = healthFromFreshness(freshnessCode);
    const report = compatibleReport
      ? QualityReportSchema.parse({
          ...compatibleReport,
          warning_codes: [
            ...compatibleReport.warning_codes.filter(
              (code) =>
                !FRESHNESS_WARNING_CODES.has(
                  code as Exclude<FreshnessCode, null>,
                ),
            ),
            ...freshness.warnings,
          ],
        })
      : null;
    const qualityHealth = report
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
      health_status:
        qualityHealth && qualityHealth.status !== "healthy"
          ? qualityHealth.status
          : freshness.health,
      warning_codes: report?.warning_codes ?? freshness.warnings,
      failure_code: null,
    };
  }

  return {
    source_id: input.source.source_id,
    run_id: input.run.run_id,
    state: input.run.state,
    artifact_sha256: input.run.artifact_sha256,
    dataset_id: input.run.dataset_id,
    health_status: null,
    warning_codes: [],
    failure_code: safeFailureCode(input.run.failure_code),
  };
}

function evidenceFailureResult(input: {
  source: SourceDefinition;
  run: IngestionRun;
}): ProductionSourceResult {
  return {
    source_id: input.source.source_id,
    run_id: input.run.run_id,
    state: "failed_terminal",
    artifact_sha256: null,
    dataset_id: null,
    health_status: null,
    warning_codes: [],
    failure_code: "invalid_source_evidence",
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
    try {
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
    } catch {
      results.push(evidenceFailureResult({ source, run }));
    }
  }

  const decision = results.some(isBlockingResult)
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
    `- Blocked: ${String(validated.sources.filter(isBlockingResult).length)}`,
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
