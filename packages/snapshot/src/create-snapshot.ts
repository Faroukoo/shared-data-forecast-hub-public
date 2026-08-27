import { randomUUID } from "node:crypto";
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { canonicalJson, sha256Hex } from "@data-hub/canonical";
import {
  ProductionRunSummarySchema,
  SCHEMA_VERSION,
  SnapshotIndexSchema,
  SnapshotManifestSchema,
  type ProductionRunSummary,
  type SnapshotIndex,
} from "@data-hub/contracts";
import { create as createTar } from "tar";

import { sha256File, validateDataHubState } from "./validate-state.js";

const EPOCH = new Date(0);

export interface CreateSnapshotInput {
  dataDir: string;
  outputDir: string;
  summary: ProductionRunSummary;
  previousSnapshotTag: string | null;
}

export interface CreatedSnapshot {
  archivePath: string;
  checksumPath: string;
  indexPath: string;
  index: SnapshotIndex;
}

function sourceTuples(
  sources: ProductionRunSummary["sources"],
): Array<{
  source_id: string;
  state: string;
  artifact_sha256: string | null;
  dataset_id: string | null;
}> {
  return sources.map((source) => ({
    source_id: source.source_id,
    state: source.state,
    artifact_sha256: source.artifact_sha256,
    dataset_id: source.dataset_id,
  }));
}

function assertPublicSummary(summary: ProductionRunSummary): void {
  const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
  const safeCode = /^[a-z0-9][a-z0-9_.:-]*$/;
  for (const source of summary.sources) {
    if (
      !safeIdentifier.test(source.run_id) ||
      source.warning_codes.some((code) => !safeCode.test(code)) ||
      (source.failure_code !== null && !safeCode.test(source.failure_code))
    ) {
      throw new Error(`unsafe_public_summary:${source.source_id}`);
    }
  }
}

async function stageFile(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  try {
    await link(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await copyFile(source, target);
  }
}

export async function createSnapshot(
  input: CreateSnapshotInput,
): Promise<CreatedSnapshot> {
  const summary = ProductionRunSummarySchema.parse(input.summary);
  assertPublicSummary(summary);
  if (summary.decision === "blocked") {
    throw new Error("snapshot_blocked_production_run");
  }
  if (
    input.previousSnapshotTag !== null &&
    !/^data-\d{8}T\d{6}Z-[a-f0-9]{12}$/.test(input.previousSnapshotTag)
  ) {
    throw new Error("invalid_previous_snapshot_tag");
  }
  if (
    input.previousSnapshotTag !== null &&
    summary.decision !== "publishable"
  ) {
    throw new Error("snapshot_requires_published_change");
  }

  const state = await validateDataHubState(input.dataDir);
  if (
    canonicalJson(sourceTuples(summary.sources)) !==
    canonicalJson(sourceTuples(state.sources))
  ) {
    throw new Error("production_summary_state_mismatch");
  }
  const identity = {
    schema_version: SCHEMA_VERSION,
    files: state.files,
    sources: summary.sources,
    dataset_ids: state.dataset_ids,
  };
  const snapshotId = sha256Hex(canonicalJson(identity));
  const manifest = SnapshotManifestSchema.parse({
    schema_version: SCHEMA_VERSION,
    snapshot_id: snapshotId,
    created_at: summary.completed_at,
    code_sha: summary.code_sha,
    files: state.files,
    sources: summary.sources,
    dataset_ids: state.dataset_ids,
  });
  const manifestBytes = `${canonicalJson(manifest)}\n`;
  await mkdir(input.outputDir, { recursive: true });
  const stagingDirectory = await mkdtemp(
    join(dirname(input.dataDir), ".snapshot-stage-"),
  );
  const provisionalArchive = join(
    input.outputDir,
    `.tmp-${randomUUID()}.tar.gz`,
  );
  let archivePath: string | null = null;
  try {
    for (const file of state.files) {
      await stageFile(
        join(input.dataDir, file.path),
        join(stagingDirectory, "data-hub", file.path),
      );
    }
    await writeFile(
      join(stagingDirectory, "snapshot-manifest.json"),
      manifestBytes,
      { flag: "wx" },
    );
    const archiveEntries = [
      "snapshot-manifest.json",
      ...state.files.map((file) => `data-hub/${file.path}`),
    ].sort();
    await createTar(
      {
        cwd: stagingDirectory,
        file: provisionalArchive,
        gzip: { level: 1 },
        mtime: EPOCH,
        noDirRecurse: true,
        portable: true,
        strict: true,
        filter: (_path, entry) => {
          if (entry.mode !== undefined) {
            entry.mode = (entry.mode & ~0o7777) | 0o644;
          }
          return true;
        },
      },
      archiveEntries,
    );
    const archiveSha256 = await sha256File(provisionalArchive);
    const archiveName = `data-hub-${archiveSha256}.tar.gz`;
    archivePath = join(input.outputDir, archiveName);
    await rename(provisionalArchive, archivePath);
    const archiveStats = await stat(archivePath);
    const checksumPath = `${archivePath}.sha256`;
    const indexPath = join(input.outputDir, "snapshot-index.json");
    const index = SnapshotIndexSchema.parse({
      schema_version: SCHEMA_VERSION,
      snapshot_id: snapshotId,
      created_at: summary.completed_at,
      code_sha: summary.code_sha,
      previous_snapshot_tag: input.previousSnapshotTag,
      archive: {
        name: archiveName,
        byte_length: archiveStats.size,
        sha256: archiveSha256,
      },
      manifest_sha256: sha256Hex(manifestBytes),
      sources: summary.sources,
      dataset_ids: state.dataset_ids,
      contains_confidential_data: false,
    });
    await Promise.all([
      writeFile(checksumPath, `${archiveSha256}  ${archiveName}\n`, {
        flag: "wx",
      }),
      writeFile(indexPath, `${canonicalJson(index)}\n`, { flag: "wx" }),
    ]);
    return { archivePath, checksumPath, indexPath, index };
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
    await rm(provisionalArchive, { force: true });
  }
}
