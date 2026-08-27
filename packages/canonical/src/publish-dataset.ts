import { randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  DatasetVersionSchema,
  type CanonicalObservation,
  type DatasetVersion,
  type ObservationCandidate,
  type QualityReport,
  type RawArtifact,
  type SourceDefinition,
} from "@data-hub/contracts";

import { canonicalJson, sha256Hex } from "./canonical-json.js";
import { resolveRevisions } from "./revisions.js";

export interface PublishDatasetInput {
  dataRoot: string;
  source: SourceDefinition;
  artifact: RawArtifact;
  candidates: ObservationCandidate[];
  quality: QualityReport;
  previous: CanonicalObservation[];
  createdAt: string;
}

function jsonLines(observations: CanonicalObservation[]): string {
  return observations.map((row) => `${canonicalJson(row)}\n`).join("");
}

function datasetIdentity(manifest: Omit<DatasetVersion, "dataset_id">): string {
  const { created_at: ignored, ...stableFields } = manifest;
  void ignored;
  return `sha256:${sha256Hex(canonicalJson(stableFields))}`;
}

async function writeIndexWithoutOverwrite(
  targetPath: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  const temporaryPath = join(dirname(targetPath), `.tmp-${randomUUID()}`);
  try {
    await writeFile(temporaryPath, content, { flag: "wx" });
    try {
      await link(temporaryPath, targetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readFile(targetPath, "utf8");
      if (existing !== content) throw new Error("published_artifact_index_collision");
    }
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function verifyPublishedTarget(
  target: string,
  expected: DatasetVersion,
): Promise<DatasetVersion> {
  const manifest = DatasetVersionSchema.parse(
    JSON.parse(await readFile(join(target, "manifest.json"), "utf8")),
  );
  const { dataset_id: datasetId, ...withoutId } = manifest;
  if (datasetIdentity(withoutId) !== datasetId) {
    throw new Error(`dataset_identity_mismatch:${datasetId}`);
  }
  if (
    manifest.dataset_id !== expected.dataset_id ||
    manifest.canonical_sha256 !== expected.canonical_sha256
  ) {
    throw new Error(`dataset_id_collision:${expected.dataset_id}`);
  }
  const observations = await readFile(join(target, "observations.jsonl"));
  if (sha256Hex(observations) !== expected.canonical_sha256) {
    throw new Error(`published_checksum_mismatch:${expected.dataset_id}`);
  }
  const rowCount = new TextDecoder()
    .decode(observations)
    .split("\n")
    .filter(Boolean).length;
  if (rowCount !== expected.row_count) {
    throw new Error(`published_row_count_mismatch:${expected.dataset_id}`);
  }
  return manifest;
}

export async function publishDataset(
  input: PublishDatasetInput,
): Promise<DatasetVersion> {
  if (input.quality.status === "quarantined") throw new Error("publication_blocked");
  if (
    input.quality.source_id !== input.source.source_id ||
    input.quality.artifact_sha256 !== input.artifact.sha256
  ) {
    throw new Error("publication_evidence_mismatch");
  }

  const observations = resolveRevisions({
    candidates: input.candidates,
    previous: input.previous,
    qualityStatus: input.quality.status,
    warningCodes: input.quality.warning_codes,
  });
  const jsonl = jsonLines(observations);
  const periodStarts = observations.map((row) => row.period_start).sort();
  const periodEnds = observations.map((row) => row.period_end).sort();
  const withoutId: Omit<DatasetVersion, "dataset_id"> = {
    schema_version: input.quality.schema_version,
    created_at: input.createdAt,
    source_id: input.source.source_id,
    artifact_sha256s: [input.artifact.sha256],
    canonical_sha256: sha256Hex(jsonl),
    row_count: observations.length,
    first_period_start: periodStarts[0] ?? null,
    last_period_end: periodEnds.at(-1) ?? null,
    series_count: new Set(observations.map((row) => row.series_key)).size,
    location_count: new Set(observations.map((row) => row.location_key)).size,
    warning_count: input.quality.warning_codes.length,
    tool_versions: {
      node: process.version,
      cli: "0.1.0",
      contracts: "0.1.0",
      parser: "0.1.0",
      quality: "0.1.0",
    },
  };
  const manifest = DatasetVersionSchema.parse({
    ...withoutId,
    dataset_id: datasetIdentity(withoutId),
  });

  const publishedRoot = join(input.dataRoot, "published");
  await mkdir(publishedRoot, { recursive: true });
  const temporary = join(publishedRoot, `.tmp-${randomUUID()}`);
  const target = join(publishedRoot, manifest.dataset_id);
  let moved = false;
  try {
    await mkdir(temporary, { recursive: false });
    await writeFile(join(temporary, "observations.jsonl"), jsonl, { flag: "wx" });
    await writeFile(
      join(temporary, "manifest.json"),
      `${canonicalJson(manifest)}\n`,
      { flag: "wx" },
    );
    const written = await readFile(join(temporary, "observations.jsonl"));
    if (sha256Hex(written) !== manifest.canonical_sha256) {
      throw new Error("publication_checksum_mismatch");
    }
    const rowCount = new TextDecoder()
      .decode(written)
      .split("\n")
      .filter(Boolean).length;
    if (rowCount !== manifest.row_count) throw new Error("publication_row_count_mismatch");
    try {
      await rename(temporary, target);
      moved = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
    }
  } finally {
    if (!moved) await rm(temporary, { recursive: true, force: true });
  }

  const verified = await verifyPublishedTarget(target, manifest);
  const indexPath = join(
    input.dataRoot,
    "manifests",
    "published-artifacts",
    `${input.artifact.sha256}.json`,
  );
  await writeIndexWithoutOverwrite(
    indexPath,
    `${canonicalJson({
      artifact_sha256: input.artifact.sha256,
      dataset_id: verified.dataset_id,
    })}\n`,
  );
  return verified;
}

export async function findPublishedDatasetByArtifact(
  dataRoot: string,
  sha256: string,
): Promise<string | null> {
  const indexPath = join(
    dataRoot,
    "manifests",
    "published-artifacts",
    `${sha256}.json`,
  );
  let encodedIndex: string;
  try {
    encodedIndex = await readFile(indexPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const index = JSON.parse(encodedIndex) as unknown;
  if (typeof index !== "object" || index === null) {
    throw new Error("invalid_published_index");
  }
  const indexRecord = index as Record<string, unknown>;
  const datasetId = indexRecord.dataset_id;
  if (
    indexRecord.artifact_sha256 !== sha256 ||
    typeof datasetId !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(datasetId)
  ) {
    throw new Error("invalid_published_index");
  }
  const target = join(dataRoot, "published", datasetId);
  const manifest = DatasetVersionSchema.parse(
    JSON.parse(await readFile(join(target, "manifest.json"), "utf8")),
  );
  if (!manifest.artifact_sha256s.includes(sha256)) {
    throw new Error("invalid_published_index");
  }
  return (await verifyPublishedTarget(target, manifest)).dataset_id;
}
