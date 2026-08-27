import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { canonicalJson, sha256Hex } from "@data-hub/canonical";
import {
  SnapshotIndexSchema,
  SnapshotManifestSchema,
  type ProductionSourceResult,
  type SnapshotIndex,
} from "@data-hub/contracts";
import { extract as extractTar, list as listTar } from "tar";

import { validateArchiveEntry } from "./archive-policy.js";
import { sha256File, validateDataHubState } from "./validate-state.js";

export interface RestoreSnapshotInput {
  archivePath: string;
  checksumPath: string;
  indexPath: string;
  targetDataDir: string;
}

async function targetIsEmptyOrAbsent(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("restore_target_not_empty");
    }
    if ((await readdir(path)).length > 0) {
      throw new Error("restore_target_not_empty");
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function safeExtractedPath(root: string, storedPath: string): string {
  const target = resolve(root, storedPath);
  const fromRoot = relative(resolve(root), target);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    fromRoot.startsWith(sep)
  ) {
    throw new Error(`unsafe_manifest_path:${storedPath}`);
  }
  return target;
}

function sourceTuples(sources: ProductionSourceResult[]) {
  return sources.map((source) => ({
    source_id: source.source_id,
    state: source.state,
    artifact_sha256: source.artifact_sha256,
    dataset_id: source.dataset_id,
  }));
}

export async function restoreSnapshot(
  input: RestoreSnapshotInput,
): Promise<SnapshotIndex> {
  const targetExisted = await targetIsEmptyOrAbsent(input.targetDataDir);
  let index: SnapshotIndex;
  try {
    index = SnapshotIndexSchema.parse(
      JSON.parse(await readFile(input.indexPath, "utf8")) as unknown,
    );
  } catch (error) {
    throw new Error("invalid_snapshot_index", { cause: error });
  }
  if (basename(input.archivePath) !== index.archive.name) {
    throw new Error("archive_name_mismatch");
  }
  const archiveStats = await lstat(input.archivePath);
  if (!archiveStats.isFile() || archiveStats.size !== index.archive.byte_length) {
    throw new Error("archive_size_mismatch");
  }
  const archiveSha256 = await sha256File(input.archivePath);
  if (archiveSha256 !== index.archive.sha256) {
    throw new Error("archive_digest_mismatch");
  }
  const sidecar = await readFile(input.checksumPath, "utf8");
  const sidecarMatch = /^([a-f0-9]{64})[ ]{2}([^\r\n]+)\r?\n?$/.exec(
    sidecar,
  );
  if (
    !sidecarMatch ||
    sidecarMatch[1] !== archiveSha256 ||
    sidecarMatch[2] !== index.archive.name
  ) {
    throw new Error("checksum_sidecar_mismatch");
  }

  const archiveEntries = new Set<string>();
  await listTar({
    file: input.archivePath,
    strict: true,
    onReadEntry: (entry) => {
      validateArchiveEntry(entry.path, entry.type);
      if (archiveEntries.has(entry.path)) {
        throw new Error(`duplicate_archive_entry:${entry.path}`);
      }
      archiveEntries.add(entry.path);
    },
  });
  if (!archiveEntries.has("snapshot-manifest.json")) {
    throw new Error("missing_snapshot_manifest");
  }

  await mkdir(dirname(input.targetDataDir), { recursive: true });
  const extractionDirectory = await mkdtemp(
    join(dirname(input.targetDataDir), ".snapshot-restore-"),
  );
  try {
    await extractTar({
      cwd: extractionDirectory,
      file: input.archivePath,
      keep: true,
      preserveOwner: false,
      preservePaths: false,
      strict: true,
      unlink: false,
      filter: (path, entry) => {
        const type = "type" in entry ? entry.type : "Unknown";
        validateArchiveEntry(path, type);
        return true;
      },
    });
    const manifestPath = join(extractionDirectory, "snapshot-manifest.json");
    const manifestBytes = await readFile(manifestPath);
    if (sha256Hex(manifestBytes) !== index.manifest_sha256) {
      throw new Error("snapshot_manifest_digest_mismatch");
    }
    let manifest;
    try {
      manifest = SnapshotManifestSchema.parse(
        JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown,
      );
    } catch (error) {
      throw new Error("invalid_snapshot_manifest", { cause: error });
    }
    const identity = {
      schema_version: manifest.schema_version,
      files: manifest.files,
      sources: manifest.sources,
      dataset_ids: manifest.dataset_ids,
    };
    const snapshotId = sha256Hex(canonicalJson(identity));
    if (
      manifest.snapshot_id !== snapshotId ||
      index.snapshot_id !== snapshotId ||
      manifest.created_at !== index.created_at ||
      manifest.code_sha !== index.code_sha ||
      canonicalJson(manifest.sources) !== canonicalJson(index.sources) ||
      canonicalJson(manifest.dataset_ids) !== canonicalJson(index.dataset_ids)
    ) {
      throw new Error("snapshot_identity_mismatch");
    }
    const extractedDataDir = join(extractionDirectory, "data-hub");
    for (const file of manifest.files) {
      safeExtractedPath(extractedDataDir, file.path);
    }
    const state = await validateDataHubState(extractedDataDir);
    if (
      canonicalJson(state.files) !== canonicalJson(manifest.files) ||
      canonicalJson(sourceTuples(state.sources)) !==
        canonicalJson(sourceTuples(manifest.sources)) ||
      canonicalJson(state.dataset_ids) !== canonicalJson(manifest.dataset_ids)
    ) {
      throw new Error("restored_state_mismatch");
    }
    const targetStillExisted = await targetIsEmptyOrAbsent(input.targetDataDir);
    if (targetStillExisted) await rmdir(input.targetDataDir);
    await rename(extractedDataDir, input.targetDataDir);
    return index;
  } finally {
    await rm(extractionDirectory, { recursive: true, force: true });
    if (targetExisted) {
      await mkdir(input.targetDataDir, { recursive: true });
    }
  }
}
