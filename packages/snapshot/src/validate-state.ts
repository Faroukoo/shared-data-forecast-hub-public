import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { canonicalJson, sha256Hex } from "@data-hub/canonical";
import {
  CanonicalObservationSchema,
  DatasetVersionSchema,
  IngestionRunSchema,
  ProductionSourceResultSchema,
  QualityReportSchema,
  RawArtifactSchema,
  Sha256Schema,
  type DatasetVersion,
  type IngestionRun,
  type ProductionSourceResult,
  type QualityReport,
  type RawArtifact,
  type SourceDefinition,
} from "@data-hub/contracts";
import { getSourceDefinition } from "@data-hub/source-registry";
import { z } from "zod";

const DATA_ROOTS = ["raw", "manifests", "published", "runs", "quality"] as const;

const PublishedArtifactIndexSchema = z
  .object({
    artifact_sha256: Sha256Schema,
    dataset_id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();

export interface ValidatedStateFile {
  path: string;
  byte_length: number;
  sha256: string;
}

export interface ValidatedDataHubState {
  files: ValidatedStateFile[];
  sources: ProductionSourceResult[];
  dataset_ids: string[];
}

export async function sha256File(path: string): Promise<string> {
  return new Promise((resolveDigest, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("end", () => {
      resolveDigest(hash.digest("hex"));
    });
  });
}

function portablePath(path: string): string {
  return path.split(sep).join("/");
}

async function walkDataHub(dataDir: string): Promise<ValidatedStateFile[]> {
  const files: ValidatedStateFile[] = [];
  const root = resolve(dataDir);

  async function visit(path: string): Promise<void> {
    for (const entry of await readdir(path)) {
      const child = join(path, entry);
      const childRelative = portablePath(relative(root, child));
      const stats = await lstat(child);
      if (stats.isSymbolicLink()) {
        throw new Error(`unsafe_symbolic_link:${childRelative}`);
      }
      if (stats.isDirectory()) {
        await visit(child);
        continue;
      }
      if (!stats.isFile()) {
        throw new Error(`unsafe_special_file:${childRelative}`);
      }
      if (stats.nlink > 1) {
        throw new Error(`unsafe_hard_link:${childRelative}`);
      }
      files.push({
        path: childRelative,
        byte_length: stats.size,
        sha256: await sha256File(child),
      });
    }
  }

  for (const rootName of DATA_ROOTS) {
    const path = join(root, rootName);
    let stats;
    try {
      stats = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new Error(`unsafe_symbolic_link:${rootName}`);
    }
    if (!stats.isDirectory()) {
      throw new Error(`unsafe_data_root:${rootName}`);
    }
    await visit(path);
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function resolveStoredPath(dataDir: string, storedPath: string): string {
  if (isAbsolute(storedPath)) {
    throw new Error(`stored_path_escape:${storedPath}`);
  }
  const root = resolve(dataDir);
  const target = resolve(root, storedPath);
  const fromRoot = relative(root, target);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error(`stored_path_escape:${storedPath}`);
  }
  return target;
}

async function readJson(path: string, errorCode: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(errorCode, { cause: error });
  }
}

function qualifiedRedistributableSource(sourceId: string): SourceDefinition {
  let source: SourceDefinition;
  try {
    source = getSourceDefinition(sourceId);
  } catch (error) {
    throw new Error(`unknown_artifact_source:${sourceId}`, { cause: error });
  }
  if (
    source.authority_level !== "official" ||
    !source.enabled ||
    source.access_mode === "disabled"
  ) {
    throw new Error(`source_not_qualified:${sourceId}`);
  }
  if (!source.licence.permits_redistribution) {
    throw new Error(`redistribution_not_permitted:${sourceId}`);
  }
  return source;
}

function datasetIdentity(manifest: DatasetVersion): string {
  const { dataset_id: ignoredId, created_at: ignoredCreatedAt, ...stableFields } =
    manifest;
  void ignoredId;
  void ignoredCreatedAt;
  return `sha256:${sha256Hex(canonicalJson(stableFields))}`;
}

function latestRun(left: IngestionRun, right: IngestionRun): IngestionRun {
  if (right.completed_at > left.completed_at) return right;
  if (right.completed_at < left.completed_at) return left;
  return right.run_id > left.run_id ? right : left;
}

function expectedRunEvidence(run: IngestionRun): {
  artifactRequired: boolean;
  datasetRequired: boolean;
  qualityRequired: boolean;
} {
  if (run.state === "published") {
    return { artifactRequired: true, datasetRequired: true, qualityRequired: true };
  }
  if (run.state === "no_change") {
    return { artifactRequired: true, datasetRequired: true, qualityRequired: false };
  }
  if (run.state === "quarantined") {
    return { artifactRequired: true, datasetRequired: false, qualityRequired: true };
  }
  return { artifactRequired: false, datasetRequired: false, qualityRequired: false };
}

export async function validateDataHubState(
  dataDir: string,
): Promise<ValidatedDataHubState> {
  const root = resolve(dataDir);
  const files = await walkDataHub(root);
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const expectedPaths = new Set<string>();
  const artifacts = new Map<string, RawArtifact>();
  const datasets = new Map<string, DatasetVersion>();
  const qualities = new Map<string, QualityReport>();
  const runs: IngestionRun[] = [];

  for (const file of files) {
    const match = /^manifests\/artifacts\/([a-f0-9]{64})\.json$/.exec(
      file.path,
    );
    if (!match) continue;
    const filenameDigest = match[1] ?? "";
    let artifact: RawArtifact;
    try {
      artifact = RawArtifactSchema.parse(
        await readJson(join(root, file.path), `invalid_artifact_manifest:${file.path}`),
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("invalid_artifact_manifest:")) {
        throw error;
      }
      throw new Error(`invalid_artifact_manifest:${file.path}`, { cause: error });
    }
    if (artifact.sha256 !== filenameDigest) {
      throw new Error(`artifact_manifest_digest_mismatch:${filenameDigest}`);
    }
    const source = qualifiedRedistributableSource(artifact.source_id);
    if (
      !artifact.licence_snapshot.permits_redistribution ||
      artifact.licence_snapshot.id !== source.licence.id ||
      artifact.parser_kind !== source.parser.kind ||
      artifact.parser_profile !== source.parser.profile
    ) {
      throw new Error(`artifact_source_mismatch:${artifact.sha256}`);
    }
    if (artifact.manifest_path !== file.path) {
      throw new Error(`artifact_manifest_path_mismatch:${artifact.sha256}`);
    }
    const expectedArtifactPath = `raw/${artifact.source_id}/${artifact.sha256}/artifact`;
    if (artifact.artifact_path !== expectedArtifactPath) {
      throw new Error(`artifact_path_mismatch:${artifact.sha256}`);
    }
    resolveStoredPath(root, artifact.manifest_path);
    resolveStoredPath(root, artifact.artifact_path);
    const rawFile = filesByPath.get(artifact.artifact_path);
    if (!rawFile) throw new Error(`missing_artifact_bytes:${artifact.sha256}`);
    if (
      rawFile.sha256 !== artifact.sha256 ||
      rawFile.byte_length !== artifact.byte_length
    ) {
      throw new Error(`artifact_digest_mismatch:${artifact.sha256}`);
    }
    expectedPaths.add(file.path);
    expectedPaths.add(artifact.artifact_path);
    artifacts.set(artifact.sha256, artifact);
  }

  for (const file of files) {
    const match = /^published\/([^/]+)\/manifest\.json$/.exec(file.path);
    if (!match) continue;
    const directoryName = match[1] ?? "";
    let manifest: DatasetVersion;
    try {
      manifest = DatasetVersionSchema.parse(
        await readJson(join(root, file.path), `invalid_dataset:${directoryName}`),
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("invalid_dataset:")) {
        throw error;
      }
      throw new Error(`invalid_dataset:${directoryName}`, { cause: error });
    }
    if (manifest.dataset_id !== directoryName) {
      throw new Error(`published_directory_mismatch:${directoryName}`);
    }
    if (datasetIdentity(manifest) !== manifest.dataset_id) {
      throw new Error(`dataset_identity_mismatch:${manifest.dataset_id}`);
    }
    qualifiedRedistributableSource(manifest.source_id);
    const observationsPath = `published/${directoryName}/observations.jsonl`;
    const observationsFile = filesByPath.get(observationsPath);
    if (!observationsFile) {
      throw new Error(`missing_published_observations:${manifest.dataset_id}`);
    }
    if (observationsFile.sha256 !== manifest.canonical_sha256) {
      throw new Error(`published_checksum_mismatch:${manifest.dataset_id}`);
    }
    const lines = (await readFile(join(root, observationsPath), "utf8"))
      .split("\n")
      .filter(Boolean);
    if (lines.length !== manifest.row_count) {
      throw new Error(`published_row_count_mismatch:${manifest.dataset_id}`);
    }
    const observations = lines.map((line, index) => {
      try {
        return CanonicalObservationSchema.parse(JSON.parse(line) as unknown);
      } catch (error) {
        throw new Error(`invalid_observation:${manifest.dataset_id}:${String(index + 1)}`, {
          cause: error,
        });
      }
    });
    if (
      observations.some(
        (observation) =>
          observation.source_id !== manifest.source_id ||
          !manifest.artifact_sha256s.includes(observation.artifact_sha256),
      )
    ) {
      throw new Error(`dataset_evidence_mismatch:${manifest.dataset_id}`);
    }
    const periodStarts = observations.map((row) => row.period_start).sort();
    const periodEnds = observations.map((row) => row.period_end).sort();
    if (
      (periodStarts[0] ?? null) !== manifest.first_period_start ||
      (periodEnds.at(-1) ?? null) !== manifest.last_period_end ||
      new Set(observations.map((row) => row.series_key)).size !==
        manifest.series_count ||
      new Set(observations.map((row) => row.location_key)).size !==
        manifest.location_count
    ) {
      throw new Error(`dataset_statistics_mismatch:${manifest.dataset_id}`);
    }
    for (const artifactSha256 of manifest.artifact_sha256s) {
      const artifact = artifacts.get(artifactSha256);
      if (!artifact || artifact.source_id !== manifest.source_id) {
        throw new Error(`dataset_artifact_mismatch:${manifest.dataset_id}`);
      }
    }
    expectedPaths.add(file.path);
    expectedPaths.add(observationsPath);
    datasets.set(manifest.dataset_id, manifest);
  }

  const publishedIndexes = new Map<string, string>();
  for (const file of files) {
    const match = /^manifests\/published-artifacts\/([a-f0-9]{64})\.json$/.exec(
      file.path,
    );
    if (!match) continue;
    const filenameDigest = match[1] ?? "";
    let index;
    try {
      index = PublishedArtifactIndexSchema.parse(
        await readJson(join(root, file.path), `invalid_published_index:${file.path}`),
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("invalid_published_index:")) {
        throw error;
      }
      throw new Error(`invalid_published_index:${file.path}`, { cause: error });
    }
    const artifact = artifacts.get(index.artifact_sha256);
    const dataset = datasets.get(index.dataset_id);
    if (
      index.artifact_sha256 !== filenameDigest ||
      !artifact ||
      !dataset ||
      artifact.source_id !== dataset.source_id ||
      !dataset.artifact_sha256s.includes(index.artifact_sha256)
    ) {
      throw new Error(`published_index_mismatch:${filenameDigest}`);
    }
    expectedPaths.add(file.path);
    publishedIndexes.set(index.artifact_sha256, index.dataset_id);
  }

  for (const dataset of datasets.values()) {
    for (const artifactSha256 of dataset.artifact_sha256s) {
      if (publishedIndexes.get(artifactSha256) !== dataset.dataset_id) {
        throw new Error(`missing_published_index:${artifactSha256}`);
      }
    }
  }

  for (const file of files) {
    const match = /^quality\/([^/]+)\.json$/.exec(file.path);
    if (!match) continue;
    const runId = match[1] ?? "";
    let report: QualityReport;
    try {
      report = QualityReportSchema.parse(
        await readJson(join(root, file.path), `invalid_quality_report:${runId}`),
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("invalid_quality_report:")) {
        throw error;
      }
      throw new Error(`invalid_quality_report:${runId}`, { cause: error });
    }
    const artifact = artifacts.get(report.artifact_sha256);
    if (!artifact || artifact.source_id !== report.source_id) {
      throw new Error(`quality_evidence_mismatch:${runId}`);
    }
    expectedPaths.add(file.path);
    qualities.set(runId, report);
  }

  for (const file of files) {
    const match = /^runs\/([^/]+)\.json$/.exec(file.path);
    if (!match) continue;
    const filenameRunId = match[1] ?? "";
    let run: IngestionRun;
    try {
      run = IngestionRunSchema.parse(
        await readJson(join(root, file.path), `invalid_run:${filenameRunId}`),
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("invalid_run:")) {
        throw error;
      }
      throw new Error(`invalid_run:${filenameRunId}`, { cause: error });
    }
    if (run.run_id !== filenameRunId) {
      throw new Error(`run_filename_mismatch:${filenameRunId}`);
    }
    qualifiedRedistributableSource(run.source_id);
    const evidence = expectedRunEvidence(run);
    const artifact = run.artifact_sha256
      ? artifacts.get(run.artifact_sha256)
      : undefined;
    const dataset = run.dataset_id ? datasets.get(run.dataset_id) : undefined;
    const quality = qualities.get(run.run_id);
    if (evidence.artifactRequired && !artifact) {
      throw new Error(`missing_run_artifact:${run.run_id}`);
    }
    if (evidence.datasetRequired && !dataset) {
      throw new Error(`missing_run_dataset:${run.run_id}`);
    }
    if (evidence.qualityRequired && !quality) {
      throw new Error(`missing_quality_report:${run.run_id}`);
    }
    if (
      (artifact && artifact.source_id !== run.source_id) ||
      (dataset &&
        (dataset.source_id !== run.source_id ||
          (run.artifact_sha256 !== null &&
            !dataset.artifact_sha256s.includes(run.artifact_sha256)))) ||
      (quality &&
        (quality.source_id !== run.source_id ||
          quality.artifact_sha256 !== run.artifact_sha256))
    ) {
      throw new Error(`run_evidence_mismatch:${run.run_id}`);
    }
    if (
      (run.state === "published" && quality?.status === "quarantined") ||
      (run.state === "quarantined" && quality?.status !== "quarantined")
    ) {
      throw new Error(`run_quality_state_mismatch:${run.run_id}`);
    }
    expectedPaths.add(file.path);
    runs.push(run);
  }

  const runsById = new Map(runs.map((run) => [run.run_id, run]));
  for (const runId of qualities.keys()) {
    if (!runsById.has(runId)) {
      throw new Error(`orphan_quality_report:${runId}`);
    }
  }
  const artifactRunReferences = new Set(
    runs.flatMap((run) => (run.artifact_sha256 ? [run.artifact_sha256] : [])),
  );
  for (const artifactSha256 of artifacts.keys()) {
    if (!artifactRunReferences.has(artifactSha256)) {
      throw new Error(`orphan_artifact:${artifactSha256}`);
    }
  }

  for (const file of files) {
    if (!expectedPaths.has(file.path)) {
      throw new Error(`unexpected_data_hub_file:${file.path}`);
    }
  }

  const latestBySource = new Map<string, IngestionRun>();
  for (const run of runs) {
    const previous = latestBySource.get(run.source_id);
    latestBySource.set(run.source_id, previous ? latestRun(previous, run) : run);
  }
  const sources = [...latestBySource.values()]
    .sort((left, right) => left.source_id.localeCompare(right.source_id))
    .map((run) => {
      const report = qualities.get(run.run_id);
      return ProductionSourceResultSchema.parse({
        source_id: run.source_id,
        run_id: run.run_id,
        state: run.state,
        artifact_sha256: run.artifact_sha256,
        dataset_id: run.dataset_id,
        health_status: null,
        warning_codes: report?.warning_codes ?? [],
        failure_code: run.failure_code,
      });
    });

  return {
    files,
    sources,
    dataset_ids: [...datasets.keys()].sort(),
  };
}
