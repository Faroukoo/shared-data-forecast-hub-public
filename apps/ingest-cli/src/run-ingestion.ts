import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";

import { LocalArtifactStore } from "@data-hub/artifact-store";
import {
  CanonicalObservationSchema,
  DatasetVersionSchema,
  IngestionRunSchema,
  SCHEMA_VERSION,
  type CanonicalObservation,
  type IngestionRun,
  type QualityReport,
  type RawArtifact,
  type SourceDefinition,
} from "@data-hub/contracts";
import {
  findPublishedDatasetByArtifact,
  publishDataset,
} from "@data-hub/canonical";
import {
  discoverCkanResource,
  downloadCkanResource,
} from "@data-hub/connectors";
import { parseHcpIndexWorkbook } from "@data-hub/parsers";
import {
  evaluateQuality,
  type PreviousCoverage,
} from "@data-hub/quality";
import { getSourceDefinition } from "@data-hub/source-registry";

interface SharedOptions {
  sourceId: string;
  dataDir: string;
  now?: string;
}

export interface RemoteIngestionOptions extends SharedOptions {
  fetchImpl?: typeof fetch;
  environment?: NodeJS.ProcessEnv;
}

export interface ManualIngestionOptions extends SharedOptions {
  filePath: string;
  operatorId: string;
  claimedPublicationPeriod: string;
}

function now(options: SharedOptions): string {
  return options.now ?? new Date().toISOString();
}

function runId(sourceId: string, startedAt: string): string {
  return `${sourceId}:${startedAt}:${randomUUID()}`;
}

function requestTarget(source: SourceDefinition): string | null {
  if (source.connector.kind !== "ckan") return null;
  const url = new URL("package_show", source.connector.api_base_url);
  url.searchParams.set("id", source.connector.dataset_id);
  return url.toString();
}

function retryableFailure(code: string): boolean {
  return (
    code === "request_timeout" ||
    code.startsWith("http_status:5") ||
    code === "fetch failed"
  );
}

async function persistRun(dataDir: string, run: IngestionRun): Promise<void> {
  const runsDirectory = join(dataDir, "runs");
  await mkdir(runsDirectory, { recursive: true });
  const target = join(runsDirectory, `${run.run_id}.json`);
  const temporary = join(runsDirectory, `.tmp-${randomUUID()}`);
  await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, target);
}

async function persistQuality(
  dataDir: string,
  runIdentifier: string,
  quality: QualityReport,
): Promise<void> {
  const qualityDirectory = join(dataDir, "quality");
  await mkdir(qualityDirectory, { recursive: true });
  const target = join(qualityDirectory, `${runIdentifier}.json`);
  const temporary = join(qualityDirectory, `.tmp-${randomUUID()}`);
  await writeFile(temporary, `${JSON.stringify(quality, null, 2)}\n`, {
    flag: "wx",
  });
  await rename(temporary, target);
}

function terminalRun(input: {
  id: string;
  source: SourceDefinition;
  accessMode: "api" | "manual";
  operatorId: string | null;
  claimedPublicationPeriod: string | null;
  timestamp: string;
  state: IngestionRun["state"];
  requestTarget: string | null;
  httpStatus: number | null;
  artifactSha256: string | null;
  datasetId: string | null;
  quality?: QualityReport;
  failureCode?: string | null;
  retryable?: boolean;
}): IngestionRun {
  return IngestionRunSchema.parse({
    schema_version: SCHEMA_VERSION,
    run_id: input.id,
    source_id: input.source.source_id,
    access_mode: input.accessMode,
    operator_id: input.operatorId,
    claimed_publication_period: input.claimedPublicationPeriod,
    connector_version: "0.1.0",
    parser_version: "0.1.0",
    started_at: input.timestamp,
    completed_at: input.timestamp,
    state: input.state,
    request_target: input.requestTarget,
    http_status: input.httpStatus,
    artifact_sha256: input.artifactSha256,
    dataset_id: input.datasetId,
    parsed_count: input.quality?.input_observation_count ?? 0,
    accepted_count: input.quality?.accepted_observation_count ?? 0,
    warned_count: input.quality?.warning_codes.length ?? 0,
    quarantined_count: input.quality?.quarantined_observation_count ?? 0,
    failure_code: input.failureCode ?? null,
    retryable: input.retryable ?? false,
  });
}

async function latestPublishedObservations(
  dataDir: string,
  sourceId: string,
): Promise<CanonicalObservation[]> {
  const published = join(dataDir, "published");
  let entries;
  try {
    entries = await readdir(published, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  let latest: {
    directory: string;
    createdAt: string;
    datasetId: string;
    canonicalSha256: string;
    rowCount: number;
  } | null = null;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".tmp-")) continue;
    try {
      const manifest = DatasetVersionSchema.parse(
        JSON.parse(await readFile(join(published, entry.name, "manifest.json"), "utf8")),
      );
      if (manifest.dataset_id !== entry.name) {
        throw new Error("published_directory_mismatch");
      }
      if (manifest.source_id !== sourceId) continue;
      if (
        latest === null ||
        manifest.created_at > latest.createdAt ||
        (manifest.created_at === latest.createdAt && manifest.dataset_id > latest.datasetId)
      ) {
        latest = {
          directory: join(published, entry.name),
          createdAt: manifest.created_at,
          datasetId: manifest.dataset_id,
          canonicalSha256: manifest.canonical_sha256,
          rowCount: manifest.row_count,
        };
      }
    } catch (error) {
      throw new Error(`invalid_published_dataset:${entry.name}`, {
        cause: error,
      });
    }
  }
  if (!latest) return [];
  try {
    const bytes = await readFile(join(latest.directory, "observations.jsonl"));
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== latest.canonicalSha256) {
      throw new Error("published_checksum_mismatch");
    }
    const lines = new TextDecoder().decode(bytes).split("\n").filter(Boolean);
    if (lines.length !== latest.rowCount) {
      throw new Error("published_row_count_mismatch");
    }
    return lines.map((line) =>
      CanonicalObservationSchema.parse(JSON.parse(line)),
    );
  } catch (error) {
    throw new Error(`invalid_published_dataset:${latest.datasetId}`, {
      cause: error,
    });
  }
}

function coverageFrom(
  observations: CanonicalObservation[],
): PreviousCoverage | undefined {
  const firstObservation = observations[0];
  if (!firstObservation) return undefined;
  let firstPeriodStart = firstObservation.period_start;
  let lastPeriodEnd = firstObservation.period_end;
  const series = new Set<string>();
  const locations = new Set<string>();
  const labels = new Set<string>();
  for (const observation of observations) {
    if (observation.period_start < firstPeriodStart) {
      firstPeriodStart = observation.period_start;
    }
    if (observation.period_end > lastPeriodEnd) {
      lastPeriodEnd = observation.period_end;
    }
    series.add(observation.series_key);
    locations.add(observation.location_key);
    labels.add(observation.source_series_label);
  }
  return {
    firstPeriodStart,
    lastPeriodEnd,
    seriesCount: series.size,
    locationCount: locations.size,
    labels: [...labels],
  };
}

async function finishArtifact(input: {
  dataDir: string;
  source: SourceDefinition;
  artifact: RawArtifact;
  bytes: Uint8Array;
  timestamp: string;
  runIdentifier: string;
  remoteLastModified?: string | null;
}): Promise<{ quality: QualityReport; datasetId: string | null }> {
  const parsed = await parseHcpIndexWorkbook({
    source: input.source,
    artifact: input.artifact,
    bytes: input.bytes,
    retrievedAt: input.timestamp,
  });
  const previous = await latestPublishedObservations(
    input.dataDir,
    input.source.source_id,
  );
  const previousCoverage = coverageFrom(previous);
  const quality = evaluateQuality({
    source: input.source,
    parsed,
    now: input.timestamp,
    ...(previousCoverage === undefined ? {} : { previousCoverage }),
    ...(input.remoteLastModified === undefined
      ? {}
      : { remoteLastModified: input.remoteLastModified }),
  });
  await persistQuality(input.dataDir, input.runIdentifier, quality);
  if (quality.status === "quarantined") return { quality, datasetId: null };
  const dataset = await publishDataset({
    dataRoot: input.dataDir,
    source: input.source,
    artifact: input.artifact,
    candidates: parsed.observations,
    quality,
    previous,
    createdAt: input.timestamp,
  });
  return { quality, datasetId: dataset.dataset_id };
}

export async function runRemoteIngestion(
  options: RemoteIngestionOptions,
): Promise<IngestionRun> {
  if (!options.fetchImpl && (options.environment ?? process.env).DATA_HUB_ALLOW_NETWORK !== "1") {
    throw new Error("network_not_enabled");
  }
  const source = getSourceDefinition(options.sourceId);
  const timestamp = now(options);
  const id = runId(source.source_id, timestamp);
  const target = requestTarget(source);
  let artifactSha256: string | null = null;
  try {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const discovery = await discoverCkanResource(source, fetchImpl);
    const downloaded = await downloadCkanResource(source, discovery, fetchImpl);
    const store = new LocalArtifactStore(options.dataDir);
    const stored = await store.putArtifact({
      source,
      originalUrl: downloaded.finalUrl,
      retrievedAt: timestamp,
      etag: downloaded.etag,
      lastModified: downloaded.lastModified,
      contentType: downloaded.contentType,
      originalFilename: downloaded.originalFilename,
      sourcePublicationPeriod: null,
      predecessorSha256: null,
      bytes: downloaded.bytes,
    });
    artifactSha256 = stored.artifact.sha256;
    const existingDataset = await findPublishedDatasetByArtifact(
      options.dataDir,
      stored.artifact.sha256,
    );
    if (existingDataset) {
      const run = terminalRun({
        id,
        source,
        accessMode: "api",
        operatorId: null,
        claimedPublicationPeriod: null,
        timestamp,
        state: "no_change",
        requestTarget: target,
        httpStatus: 200,
        artifactSha256,
        datasetId: existingDataset,
      });
      await persistRun(options.dataDir, run);
      return run;
    }
    const finished = await finishArtifact({
      dataDir: options.dataDir,
      source,
      artifact: stored.artifact,
      bytes: downloaded.bytes,
      timestamp,
      runIdentifier: id,
      remoteLastModified:
        discovery.resource.lastModified ?? discovery.metadataModified,
    });
    const run = terminalRun({
      id,
      source,
      accessMode: "api",
      operatorId: null,
      claimedPublicationPeriod: null,
      timestamp,
      state: finished.datasetId ? "published" : "quarantined",
      requestTarget: target,
      httpStatus: 200,
      artifactSha256,
      datasetId: finished.datasetId,
      quality: finished.quality,
    });
    await persistRun(options.dataDir, run);
    return run;
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown_failure";
    const retryable = retryableFailure(code);
    const run = terminalRun({
      id,
      source,
      accessMode: "api",
      operatorId: null,
      claimedPublicationPeriod: null,
      timestamp,
      state: retryable ? "failed_retryable" : "failed_terminal",
      requestTarget: target,
      httpStatus: null,
      artifactSha256,
      datasetId: null,
      failureCode: code,
      retryable,
    });
    await persistRun(options.dataDir, run);
    return run;
  }
}

export async function runManualIngestion(
  options: ManualIngestionOptions,
): Promise<IngestionRun> {
  if (!options.operatorId.trim()) throw new Error("operator_required");
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(options.claimedPublicationPeriod)) {
    throw new Error("invalid_claimed_period");
  }
  const source = getSourceDefinition(options.sourceId);
  const timestamp = now(options);
  const id = runId(source.source_id, timestamp);
  let artifactSha256: string | null = null;
  try {
    const bytes = new Uint8Array(await readFile(options.filePath));
    const filename = basename(options.filePath);
    const store = new LocalArtifactStore(options.dataDir);
    const stored = await store.putArtifact({
      source,
      originalUrl: `manual://import/${encodeURIComponent(filename)}`,
      retrievedAt: timestamp,
      etag: null,
      lastModified: null,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      originalFilename: filename,
      sourcePublicationPeriod: options.claimedPublicationPeriod,
      predecessorSha256: null,
      bytes,
    });
    artifactSha256 = stored.artifact.sha256;
    const existingDataset = await findPublishedDatasetByArtifact(
      options.dataDir,
      artifactSha256,
    );
    if (existingDataset) {
      const run = terminalRun({
        id,
        source,
        accessMode: "manual",
        operatorId: options.operatorId,
        claimedPublicationPeriod: options.claimedPublicationPeriod,
        timestamp,
        state: "no_change",
        requestTarget: null,
        httpStatus: null,
        artifactSha256,
        datasetId: existingDataset,
      });
      await persistRun(options.dataDir, run);
      return run;
    }
    const finished = await finishArtifact({
      dataDir: options.dataDir,
      source,
      artifact: stored.artifact,
      bytes,
      timestamp,
      runIdentifier: id,
    });
    const run = terminalRun({
      id,
      source,
      accessMode: "manual",
      operatorId: options.operatorId,
      claimedPublicationPeriod: options.claimedPublicationPeriod,
      timestamp,
      state: finished.datasetId ? "published" : "quarantined",
      requestTarget: null,
      httpStatus: null,
      artifactSha256,
      datasetId: finished.datasetId,
      quality: finished.quality,
    });
    await persistRun(options.dataDir, run);
    return run;
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown_failure";
    const run = terminalRun({
      id,
      source,
      accessMode: "manual",
      operatorId: options.operatorId,
      claimedPublicationPeriod: options.claimedPublicationPeriod,
      timestamp,
      state: "failed_terminal",
      requestTarget: null,
      httpStatus: null,
      artifactSha256,
      datasetId: null,
      failureCode: code,
    });
    await persistRun(options.dataDir, run);
    return run;
  }
}
