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
  CONSUMER_CONTRACT,
  CONSUMER_V2_CONTRACT,
  CONSUMER_V3_CONTRACT,
  ConsumerIndexSchema,
  ConsumerPayloadSchema,
  ConsumerV2IndexSchema,
  ConsumerV2PayloadSchema,
  ConsumerV3IndexSchema,
  ConsumerV3PayloadSchema,
  type ConsumerIndex,
  type ConsumerPayload,
  type ConsumerV2Index,
  type ConsumerV2Payload,
  type ConsumerV3Index,
  type ConsumerV3Payload,
} from "@data-hub/contracts";

const INDEX_NAME = "consumer-index.json";
const BUNDLE_SPEC = {
  [CONSUMER_CONTRACT]: {
    payloadName: "consumer-v1.json",
    checksumName: "consumer-v1.json.sha256",
    indexSchema: ConsumerIndexSchema,
    payloadSchema: ConsumerPayloadSchema,
  },
  [CONSUMER_V2_CONTRACT]: {
    payloadName: "consumer-v2.json",
    checksumName: "consumer-v2.json.sha256",
    indexSchema: ConsumerV2IndexSchema,
    payloadSchema: ConsumerV2PayloadSchema,
  },
  [CONSUMER_V3_CONTRACT]: {
    payloadName: "consumer-v3.json",
    checksumName: "consumer-v3.json.sha256",
    indexSchema: ConsumerV3IndexSchema,
    payloadSchema: ConsumerV3PayloadSchema,
  },
} as const;

type SupportedConsumerContract = keyof typeof BUNDLE_SPEC;
type BundleSpec = (typeof BUNDLE_SPEC)[SupportedConsumerContract];
export type SupportedConsumerPayload =
  | ConsumerPayload
  | ConsumerV2Payload
  | ConsumerV3Payload;
export type SupportedConsumerIndex =
  | ConsumerIndex
  | ConsumerV2Index
  | ConsumerV3Index;

export interface WriteConsumerBundleInput {
  outputDir: string;
  payload: SupportedConsumerPayload;
  codeSha: string;
}

export interface VerifyConsumerBundleInput {
  indexPath: string;
  payloadPath: string;
  checksumPath: string;
}

export interface CreatedConsumerBundle {
  index: SupportedConsumerIndex;
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

function bundleSpecForContract(contract: unknown): BundleSpec {
  if (
    contract !== CONSUMER_CONTRACT &&
    contract !== CONSUMER_V2_CONTRACT &&
    contract !== CONSUMER_V3_CONTRACT
  ) {
    throw new Error("unsupported_consumer_contract");
  }
  return BUNDLE_SPEC[contract];
}

async function assertBundleRoot(
  input: VerifyConsumerBundleInput,
): Promise<string> {
  if (basename(input.indexPath) !== INDEX_NAME) {
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
  const indexStats = await lstat(input.indexPath);
  if (indexStats.isSymbolicLink() || !indexStats.isFile()) {
    throw new Error("consumer_bundle_asset_not_regular");
  }
  return bundleDir;
}

async function assertBundleLayout(
  input: VerifyConsumerBundleInput,
  bundleDir: string,
  spec: BundleSpec,
): Promise<void> {
  if (
    basename(input.payloadPath) !== spec.payloadName ||
    basename(input.checksumPath) !== spec.checksumName
  ) {
    throw new Error("consumer_bundle_path_mismatch");
  }
  const entries = (await readdir(bundleDir)).sort();
  const expectedNames = [INDEX_NAME, spec.payloadName, spec.checksumName].sort();
  if (!sameStrings(entries, expectedNames)) {
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

function parseIndex(bytes: Buffer): {
  index: SupportedConsumerIndex;
  spec: BundleSpec;
} {
  try {
    const candidate = JSON.parse(bytes.toString("utf8")) as unknown;
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      throw new Error("unsupported_consumer_contract");
    }
    const spec = bundleSpecForContract(
      (candidate as { consumer_contract?: unknown }).consumer_contract,
    );
    return {
      index: spec.indexSchema.parse(candidate),
      spec,
    };
  } catch (error) {
    throw new Error("invalid_consumer_index", { cause: error });
  }
}

function parsePayload(
  bytes: Buffer,
  spec: BundleSpec,
): SupportedConsumerPayload {
  try {
    return spec.payloadSchema.parse(
      JSON.parse(bytes.toString("utf8")) as unknown,
    );
  } catch (error) {
    throw new Error("invalid_consumer_payload", { cause: error });
  }
}

function assertCrossFileConsistency(
  index: SupportedConsumerIndex,
  payload: SupportedConsumerPayload,
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
): Promise<SupportedConsumerIndex> {
  const bundleDir = await assertBundleRoot(input);
  const indexBytes = await readFile(input.indexPath);
  const { index, spec } = parseIndex(indexBytes);
  await assertBundleLayout(input, bundleDir, spec);
  const [payloadBytes, checksumBytes] = await Promise.all([
    readFile(input.payloadPath),
    readFile(input.checksumPath),
  ]);

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
    `${payloadSha256}  ${spec.payloadName}\n`
  ) {
    throw new Error("consumer_checksum_sidecar_mismatch");
  }
  const payload = parsePayload(payloadBytes, spec);
  if (!payloadBytes.equals(Buffer.from(`${canonicalJson(payload)}\n`))) {
    throw new Error("non_canonical_consumer_payload");
  }
  assertCrossFileConsistency(index, payload);
  return index;
}

export async function writeConsumerBundle(
  input: WriteConsumerBundleInput,
): Promise<CreatedConsumerBundle> {
  const spec = bundleSpecForContract(input.payload.consumer_contract);
  const payload = spec.payloadSchema.parse(input.payload);
  const payloadBytes = Buffer.from(`${canonicalJson(payload)}\n`);
  const payloadSha256 = sha256Hex(payloadBytes);
  const index = spec.indexSchema.parse({
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
      name: spec.payloadName,
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
    payloadPath: join(stagingDirectory, spec.payloadName),
    checksumPath: join(stagingDirectory, spec.checksumName),
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
        `${payloadSha256}  ${spec.payloadName}\n`,
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
    payloadPath: join(input.outputDir, spec.payloadName),
    checksumPath: join(input.outputDir, spec.checksumName),
  };
}
