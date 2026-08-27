import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { canonicalJson, sha256Hex } from "@data-hub/canonical";
import {
  ConsumerIndexSchema,
  ConsumerPayloadSchema,
  type ConsumerIndex,
  type ConsumerPayload,
} from "@data-hub/contracts";

const INDEX_NAME = "consumer-index.json";
const PAYLOAD_NAME = "consumer-v1.json";
const CHECKSUM_NAME = "consumer-v1.json.sha256";
const BUNDLE_NAMES = [INDEX_NAME, PAYLOAD_NAME, CHECKSUM_NAME].sort();

export interface WriteConsumerBundleInput {
  outputDir: string;
  payload: ConsumerPayload;
  codeSha: string;
}

export interface VerifyConsumerBundleInput {
  indexPath: string;
  payloadPath: string;
  checksumPath: string;
}

export interface CreatedConsumerBundle {
  index: ConsumerIndex;
  indexPath: string;
  payloadPath: string;
  checksumPath: string;
}

async function targetIsEmptyOrAbsent(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("consumer_output_not_empty");
    }
    if ((await readdir(path)).length > 0) {
      throw new Error("consumer_output_not_empty");
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function sameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

async function assertBundleLayout(
  input: VerifyConsumerBundleInput,
): Promise<void> {
  if (
    basename(input.indexPath) !== INDEX_NAME ||
    basename(input.payloadPath) !== PAYLOAD_NAME ||
    basename(input.checksumPath) !== CHECKSUM_NAME
  ) {
    throw new Error("consumer_bundle_path_mismatch");
  }

  const directories = [
    dirname(resolve(input.indexPath)),
    dirname(resolve(input.payloadPath)),
    dirname(resolve(input.checksumPath)),
  ];
  if (!directories.every((directory) => directory === directories[0])) {
    throw new Error("consumer_bundle_path_mismatch");
  }
  const bundleDir = directories[0];
  if (bundleDir === undefined) {
    throw new Error("consumer_bundle_path_mismatch");
  }
  const directoryStats = await lstat(bundleDir);
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new Error("consumer_bundle_directory_not_regular");
  }
  const entries = (await readdir(bundleDir)).sort();
  if (!sameStrings(entries, BUNDLE_NAMES)) {
    throw new Error("unexpected_consumer_bundle_files");
  }

  for (const path of [
    input.indexPath,
    input.payloadPath,
    input.checksumPath,
  ]) {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("consumer_bundle_asset_not_regular");
    }
  }
}

function parseIndex(bytes: Buffer): ConsumerIndex {
  try {
    return ConsumerIndexSchema.parse(
      JSON.parse(bytes.toString("utf8")) as unknown,
    );
  } catch (error) {
    throw new Error("invalid_consumer_index", { cause: error });
  }
}

function parsePayload(bytes: Buffer): ConsumerPayload {
  try {
    return ConsumerPayloadSchema.parse(
      JSON.parse(bytes.toString("utf8")) as unknown,
    );
  } catch (error) {
    throw new Error("invalid_consumer_payload", { cause: error });
  }
}

function assertCrossFileConsistency(
  index: ConsumerIndex,
  payload: ConsumerPayload,
): void {
  if (
    index.source_snapshot_tag !== payload.source_snapshot_tag ||
    index.source_snapshot_id !== payload.source_snapshot_id
  ) {
    throw new Error("consumer_snapshot_identity_mismatch");
  }
  if (
    index.created_at !== payload.generated_at ||
    index.coverage_start !== payload.coverage_start ||
    index.coverage_end !== payload.coverage_end
  ) {
    throw new Error("consumer_index_payload_mismatch");
  }

  const sourceIds = payload.sources.map((source) => source.source_id);
  const indicatorCount = new Set(
    payload.observations.map((observation) => observation.series_key),
  ).size;
  if (
    !sameStrings(index.source_ids, sourceIds) ||
    index.indicator_count !== indicatorCount ||
    index.observation_count !== payload.observations.length
  ) {
    throw new Error("consumer_index_payload_mismatch");
  }
}

export async function verifyConsumerBundle(
  input: VerifyConsumerBundleInput,
): Promise<ConsumerIndex> {
  await assertBundleLayout(input);
  const [indexBytes, payloadBytes, checksumBytes] = await Promise.all([
    readFile(input.indexPath),
    readFile(input.payloadPath),
    readFile(input.checksumPath),
  ]);
  const index = parseIndex(indexBytes);

  if (!indexBytes.equals(Buffer.from(`${canonicalJson(index)}\n`))) {
    throw new Error("non_canonical_consumer_index");
  }
  if (payloadBytes.byteLength !== index.payload.byte_length) {
    throw new Error("consumer_payload_size_mismatch");
  }
  const payloadSha256 = sha256Hex(payloadBytes);
  if (payloadSha256 !== index.payload.sha256) {
    throw new Error("consumer_payload_digest_mismatch");
  }
  if (
    checksumBytes.toString("utf8") !==
    `${payloadSha256}  ${PAYLOAD_NAME}\n`
  ) {
    throw new Error("consumer_checksum_sidecar_mismatch");
  }
  const payload = parsePayload(payloadBytes);
  if (!payloadBytes.equals(Buffer.from(`${canonicalJson(payload)}\n`))) {
    throw new Error("non_canonical_consumer_payload");
  }
  assertCrossFileConsistency(index, payload);
  return index;
}

export async function writeConsumerBundle(
  input: WriteConsumerBundleInput,
): Promise<CreatedConsumerBundle> {
  const payload = ConsumerPayloadSchema.parse(input.payload);
  const payloadBytes = Buffer.from(`${canonicalJson(payload)}\n`);
  const payloadSha256 = sha256Hex(payloadBytes);
  const index = ConsumerIndexSchema.parse({
    schema_version: payload.schema_version,
    consumer_contract: payload.consumer_contract,
    source_snapshot_tag: payload.source_snapshot_tag,
    source_snapshot_id: payload.source_snapshot_id,
    contains_confidential_data: payload.contains_confidential_data,
    decision_scope: payload.decision_scope,
    created_at: payload.generated_at,
    code_sha: input.codeSha,
    indicator_count: new Set(
      payload.observations.map((observation) => observation.series_key),
    ).size,
    observation_count: payload.observations.length,
    coverage_start: payload.coverage_start,
    coverage_end: payload.coverage_end,
    source_ids: payload.sources.map((source) => source.source_id),
    payload: {
      name: PAYLOAD_NAME,
      byte_length: payloadBytes.byteLength,
      sha256: payloadSha256,
    },
  });

  const targetExisted = await targetIsEmptyOrAbsent(input.outputDir);
  await mkdir(dirname(input.outputDir), { recursive: true });
  const stagingDirectory = await mkdtemp(
    join(dirname(input.outputDir), ".consumer-bundle-"),
  );
  const stagedPaths = {
    indexPath: join(stagingDirectory, INDEX_NAME),
    payloadPath: join(stagingDirectory, PAYLOAD_NAME),
    checksumPath: join(stagingDirectory, CHECKSUM_NAME),
  };
  let committed = false;
  try {
    await Promise.all([
      writeFile(stagedPaths.indexPath, `${canonicalJson(index)}\n`, {
        flag: "wx",
      }),
      writeFile(stagedPaths.payloadPath, payloadBytes, { flag: "wx" }),
      writeFile(
        stagedPaths.checksumPath,
        `${payloadSha256}  ${PAYLOAD_NAME}\n`,
        { flag: "wx" },
      ),
    ]);
    await verifyConsumerBundle(stagedPaths);

    const targetStillExisted = await targetIsEmptyOrAbsent(input.outputDir);
    if (targetStillExisted) await rmdir(input.outputDir);
    await rename(stagingDirectory, input.outputDir);
    committed = true;
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
    if (targetExisted && !committed) {
      await mkdir(input.outputDir, { recursive: true });
    }
  }

  return {
    index,
    indexPath: join(input.outputDir, INDEX_NAME),
    payloadPath: join(input.outputDir, PAYLOAD_NAME),
    checksumPath: join(input.outputDir, CHECKSUM_NAME),
  };
}
