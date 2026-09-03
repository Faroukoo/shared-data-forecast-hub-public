import assert from "node:assert/strict";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { canonicalJson, sha256Hex } from "@data-hub/canonical";
import {
  CONSUMER_CONTRACT,
  CONSUMER_PROFILE,
  CONSUMER_V2_CONTRACT,
  CONSUMER_V3_CONTRACT,
  ConsumerPayloadSchema,
  SCHEMA_VERSION,
  type ConsumerPayload,
  type ConsumerV2Index,
  type ConsumerV2Payload,
  type ConsumerV3Index,
  type ConsumerV3Payload,
} from "@data-hub/contracts";
import {
  verifyConsumerBundle,
  writeConsumerBundle,
  type CreatedConsumerBundle,
} from "@data-hub/adapters";

import {
  compareConsumerV2FixtureObservations,
  consumerV2PayloadFixture,
} from "./consumer-v2-fixture.js";
import { consumerV3PayloadFixture } from "./consumer-v3-fixture.js";

const SNAPSHOT_ID = "9d3b77bbfc0cf05cbc0f2e27f24cfb0b348ce0e5d71b09267fbd7ce67657e226";
const SNAPSHOT_TAG = "data-20260827T095123Z-9d3b77bbfc0c";
const GENERATED_AT = "2026-08-27T09:51:23.000Z";
const CODE_SHA = "c".repeat(40);

function observation(
  seriesKey: string,
  locationKey: "ma" | "ma:city:tetouan",
  periodStart: string,
  periodEnd: string,
) {
  return {
    series_key: seriesKey,
    label_fr: "Alimentation",
    category: "food_overall" as const,
    usage: "macro_context_only" as const,
    geography_type:
      locationKey === "ma" ? ("country" as const) : ("city" as const),
    location_key: locationKey,
    period_start: periodStart,
    period_end: periodEnd,
    frequency: "monthly" as const,
    value: "118.4",
    unit: "index" as const,
    base_year: 2017 as const,
    scaling_factor: "1",
    source_id: "hcp-ipc-2017-monthly" as const,
    artifact_sha256: "b".repeat(64),
    retrieved_at: GENERATED_AT,
    quality_status: "accepted" as const,
    warning_codes: [],
    revision_number: 1,
  };
}

function payload(): ConsumerPayload {
  return ConsumerPayloadSchema.parse({
    schema_version: SCHEMA_VERSION,
    consumer_contract: CONSUMER_CONTRACT,
    source_snapshot_tag: SNAPSHOT_TAG,
    source_snapshot_id: SNAPSHOT_ID,
    generated_at: GENERATED_AT,
    profile_id: CONSUMER_PROFILE,
    contains_confidential_data: false,
    decision_scope: "observation_only",
    coverage_start: "2024-10-01",
    coverage_end: "2024-11-30",
    sources: [
      {
        source_id: "hcp-ipc-2017-monthly",
        publisher_name: "Haut-Commissariat au Plan",
        official_base_url: "https://www.hcp.ma/",
        licence_id: "ODbL-1.0",
        licence_evidence_url: "https://data.gov.ma/data/fr/dataset/data_7_5",
        health_status: "stale",
        retrieved_at: GENERATED_AT,
        last_period_end: "2024-11-30",
        warning_age_days: 60,
        expiry_age_days: 120,
        age_days_at_snapshot: 635,
        warning_codes: ["source_stale"],
      },
    ],
    observations: [
      observation("hcp.ipc2017.01", "ma", "2024-10-01", "2024-10-31"),
      observation(
        "hcp.ipc2017.0111",
        "ma:city:tetouan",
        "2024-11-01",
        "2024-11-30",
      ),
    ],
  });
}

function payloadV2(): ConsumerV2Payload {
  return consumerV2PayloadFixture({
    snapshotId: SNAPSHOT_ID,
    snapshotTag: SNAPSHOT_TAG,
    generatedAt: GENERATED_AT,
  });
}

function payloadV3(): ConsumerV3Payload {
  return consumerV3PayloadFixture({
    snapshotId: SNAPSHOT_ID,
    snapshotTag: SNAPSHOT_TAG,
  });
}

async function createBundle(t: TestContext): Promise<{
  root: string;
  outputDir: string;
  created: CreatedConsumerBundle;
}> {
  const root = await mkdtemp(join(tmpdir(), "consumer-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputDir = join(root, "bundle");
  const created = await writeConsumerBundle({
    outputDir,
    payload: payload(),
    codeSha: CODE_SHA,
  });
  return { root, outputDir, created };
}

async function createV2Bundle(t: TestContext): Promise<{
  root: string;
  outputDir: string;
  created: CreatedConsumerBundle;
}> {
  const root = await mkdtemp(join(tmpdir(), "consumer-v2-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputDir = join(root, "bundle");
  const created = await writeConsumerBundle({
    outputDir,
    payload: payloadV2(),
    codeSha: CODE_SHA,
  });
  return { root, outputDir, created };
}

async function createV3Bundle(t: TestContext): Promise<{
  root: string;
  outputDir: string;
  created: CreatedConsumerBundle;
}> {
  const root = await mkdtemp(join(tmpdir(), "consumer-v3-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputDir = join(root, "bundle");
  const created = await writeConsumerBundle({
    outputDir,
    payload: payloadV3(),
    codeSha: CODE_SHA,
  });
  return { root, outputDir, created };
}

function verificationInput(created: CreatedConsumerBundle) {
  return {
    indexPath: created.indexPath,
    payloadPath: created.payloadPath,
    checksumPath: created.checksumPath,
  };
}

async function rewriteSignedV2Bundle(input: {
  created: CreatedConsumerBundle;
  mutateIndex?: (index: ConsumerV2Index) => ConsumerV2Index;
  mutatePayload?: (payload: ConsumerV2Payload) => ConsumerV2Payload;
  synchronizeIndexFromPayload?: boolean;
}): Promise<void> {
  const originalPayload = JSON.parse(
    await readFile(input.created.payloadPath, "utf8"),
  ) as ConsumerV2Payload;
  const mutatedPayload = input.mutatePayload?.(originalPayload) ?? originalPayload;
  const payloadBytes = Buffer.from(`${canonicalJson(mutatedPayload)}\n`);
  const payloadSha256 = sha256Hex(payloadBytes);
  const originalIndex = input.created.index as ConsumerV2Index;
  const synchronizedFields = input.synchronizeIndexFromPayload === false
    ? {}
    : {
        source_snapshot_tag: mutatedPayload.source_snapshot_tag,
        source_snapshot_id: mutatedPayload.source_snapshot_id,
        created_at: mutatedPayload.generated_at,
        coverage_start: mutatedPayload.coverage_start,
        coverage_end: mutatedPayload.coverage_end,
        source_ids: mutatedPayload.sources.map((source) => source.source_id),
        indicator_count: new Set(
          mutatedPayload.observations.map((row) => row.series_key),
        ).size,
        observation_count: mutatedPayload.observations.length,
      };
  const synchronizedIndex: ConsumerV2Index = {
    ...originalIndex,
    ...synchronizedFields,
    payload: {
      ...originalIndex.payload,
      byte_length: payloadBytes.byteLength,
      sha256: payloadSha256,
    },
  };
  const mutatedIndex = input.mutateIndex?.(synchronizedIndex) ?? synchronizedIndex;
  await Promise.all([
    writeFile(input.created.payloadPath, payloadBytes),
    writeFile(input.created.indexPath, `${canonicalJson(mutatedIndex)}\n`),
    writeFile(
      input.created.checksumPath,
      `${payloadSha256}  consumer-v2.json\n`,
    ),
  ]);
}

async function rewriteSignedV3Bundle(input: {
  created: CreatedConsumerBundle;
  mutatePayload: (payload: ConsumerV3Payload) => ConsumerV3Payload;
}): Promise<void> {
  const originalPayload = JSON.parse(
    await readFile(input.created.payloadPath, "utf8"),
  ) as ConsumerV3Payload;
  const mutatedPayload = input.mutatePayload(originalPayload);
  const payloadBytes = Buffer.from(`${canonicalJson(mutatedPayload)}\n`);
  const payloadSha256 = sha256Hex(payloadBytes);
  const originalIndex = input.created.index as ConsumerV3Index;
  const index = {
    ...originalIndex,
    coverage_start: mutatedPayload.coverage_start,
    coverage_end: mutatedPayload.coverage_end,
    source_ids: mutatedPayload.sources.map((source) => source.source_id),
    indicator_count: new Set(mutatedPayload.observations.map((row) => row.series_key)).size,
    observation_count: mutatedPayload.observations.length,
    payload: {
      ...originalIndex.payload,
      byte_length: payloadBytes.byteLength,
      sha256: payloadSha256,
    },
  };
  await Promise.all([
    writeFile(input.created.payloadPath, payloadBytes),
    writeFile(input.created.indexPath, `${canonicalJson(index)}\n`),
    writeFile(
      input.created.checksumPath,
      `${payloadSha256}  consumer-v3.json\n`,
    ),
  ]);
}

void test("writes and verifies exactly three canonical consumer assets", async (t) => {
  const { outputDir, created } = await createBundle(t);
  const payloadBytes = `${canonicalJson(payload())}\n`;
  const payloadSha256 = sha256Hex(payloadBytes);
  const expectedIndex = {
    schema_version: SCHEMA_VERSION,
    consumer_contract: CONSUMER_CONTRACT,
    source_snapshot_tag: SNAPSHOT_TAG,
    source_snapshot_id: SNAPSHOT_ID,
    contains_confidential_data: false,
    decision_scope: "observation_only",
    created_at: GENERATED_AT,
    code_sha: CODE_SHA,
    indicator_count: 2,
    observation_count: 2,
    coverage_start: "2024-10-01",
    coverage_end: "2024-11-30",
    source_ids: ["hcp-ipc-2017-monthly"],
    payload: {
      name: "consumer-v1.json",
      byte_length: Buffer.byteLength(payloadBytes),
      sha256: payloadSha256,
    },
  };

  assert.deepEqual((await readdir(outputDir)).sort(), [
    "consumer-index.json",
    "consumer-v1.json",
    "consumer-v1.json.sha256",
  ]);
  assert.equal(await readFile(created.payloadPath, "utf8"), payloadBytes);
  assert.equal(
    await readFile(created.checksumPath, "utf8"),
    `${payloadSha256}  consumer-v1.json\n`,
  );
  assert.equal(
    await readFile(created.indexPath, "utf8"),
    `${canonicalJson(expectedIndex)}\n`,
  );
  assert.deepEqual(created.index, expectedIndex);
  assert.deepEqual(
    await verifyConsumerBundle(verificationInput(created)),
    created.index,
  );
});

void test("writes and verifies exactly three canonical v2 consumer assets", async (t) => {
  const { outputDir, created } = await createV2Bundle(t);
  const payloadBytes = `${canonicalJson(payloadV2())}\n`;
  const payloadSha256 = sha256Hex(payloadBytes);

  assert.deepEqual((await readdir(outputDir)).sort(), [
    "consumer-index.json",
    "consumer-v2.json",
    "consumer-v2.json.sha256",
  ]);
  assert.equal(created.index.consumer_contract, CONSUMER_V2_CONTRACT);
  assert.equal(created.index.payload.name, "consumer-v2.json");
  assert.equal(created.index.payload.byte_length, Buffer.byteLength(payloadBytes));
  assert.equal(created.index.payload.sha256, payloadSha256);
  assert.equal(await readFile(created.payloadPath, "utf8"), payloadBytes);
  assert.equal(
    await readFile(created.checksumPath, "utf8"),
    `${payloadSha256}  consumer-v2.json\n`,
  );
  assert.deepEqual(
    await verifyConsumerBundle(verificationInput(created)),
    created.index,
  );
});

void test("writes and verifies exactly three canonical v3 consumer assets", async (t) => {
  const { outputDir, created } = await createV3Bundle(t);
  const payloadBytes = `${canonicalJson(payloadV3())}\n`;
  const payloadSha256 = sha256Hex(payloadBytes);

  assert.deepEqual((await readdir(outputDir)).sort(), [
    "consumer-index.json",
    "consumer-v3.json",
    "consumer-v3.json.sha256",
  ]);
  assert.equal(created.index.consumer_contract, CONSUMER_V3_CONTRACT);
  assert.equal(created.index.payload.name, "consumer-v3.json");
  assert.equal(created.index.payload.byte_length, Buffer.byteLength(payloadBytes));
  assert.equal(created.index.payload.sha256, payloadSha256);
  assert.equal(await readFile(created.payloadPath, "utf8"), payloadBytes);
  assert.equal(
    await readFile(created.checksumPath, "utf8"),
    `${payloadSha256}  consumer-v3.json\n`,
  );
  assert.deepEqual(await verifyConsumerBundle(verificationInput(created)), created.index);
});

void test("v3 verifier rejects self-consistent signed matrix mutations", async (t) => {
  const missing = await createV3Bundle(t);
  await rewriteSignedV3Bundle({
    created: missing.created,
    mutatePayload: (value) => ({
      ...value,
      observations: value.observations.slice(1),
      coverage_start: value.observations[1]?.period_start ?? value.coverage_start,
    }),
  });
  await assert.rejects(
    () => verifyConsumerBundle(verificationInput(missing.created)),
    /invalid_consumer_index|invalid_consumer_payload/,
  );

  const city = await createV3Bundle(t);
  await rewriteSignedV3Bundle({
    created: city.created,
    mutatePayload: (value) => ({
      ...value,
      observations: value.observations.map((row, index) =>
        index === 0 ? { ...row, location_key: "ma:city:casablanca" as "ma" } : row,
      ),
    }),
  });
  await assert.rejects(
    () => verifyConsumerBundle(verificationInput(city.created)),
    /invalid_consumer_payload/,
  );
});

void test("v2 writer rejects incomplete and out-of-matrix payloads", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "consumer-v2-invalid-write-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const complete = payloadV2();
  const invented = complete.observations.map((row, index) =>
    index === 24 ? { ...row, series_key: "hcp.ipc2017.0112" } : row,
  ).sort(compareConsumerV2FixtureObservations);

  await assert.rejects(
    () => writeConsumerBundle({
      outputDir: join(root, "incomplete"),
      payload: { ...complete, observations: complete.observations.slice(0, -1) },
      codeSha: CODE_SHA,
    }),
    /consumer_v2_observation_count_invalid/,
  );
  await assert.rejects(
    () => writeConsumerBundle({
      outputDir: join(root, "out-of-matrix"),
      payload: { ...complete, observations: invented },
      codeSha: CODE_SHA,
    }),
    /consumer_v2_observation_tuple_invalid/,
  );
});

void test("v2 verifier rejects self-consistent signed incomplete and out-of-matrix bundles", async (t) => {
  const incomplete = await createV2Bundle(t);
  await rewriteSignedV2Bundle({
    created: incomplete.created,
    mutatePayload: (value) => ({
      ...value,
      observations: value.observations.slice(0, -1),
    }),
  });
  await assert.rejects(
    () => verifyConsumerBundle(verificationInput(incomplete.created)),
    /invalid_consumer_payload/,
  );

  const outOfMatrix = await createV2Bundle(t);
  await rewriteSignedV2Bundle({
    created: outOfMatrix.created,
    mutatePayload: (value) => ({
      ...value,
      observations: value.observations.map((row, index) =>
        index === 24 ? { ...row, series_key: "hcp.ipc2017.0112" } : row,
      ).sort(compareConsumerV2FixtureObservations),
    }),
  });
  await assert.rejects(
    () => verifyConsumerBundle(verificationInput(outOfMatrix.created)),
    /invalid_consumer_payload/,
  );
});

const V2_CROSS_FILE_MUTATIONS: ReadonlyArray<{
  name: string;
  expected: RegExp;
  mutateIndex?: (index: ConsumerV2Index) => ConsumerV2Index;
  mutatePayload?: (payload: ConsumerV2Payload) => ConsumerV2Payload;
}> = [
  {
    name: "index source tag",
    expected: /consumer_snapshot_identity_mismatch/,
    mutateIndex: (value) => ({
      ...value,
      source_snapshot_tag: "data-20260828T095123Z-9d3b77bbfc0c",
    }),
  },
  {
    name: "index snapshot id",
    expected: /consumer_snapshot_identity_mismatch/,
    mutateIndex: (value) => ({
      ...value,
      source_snapshot_id: `9d3b77bbfc0c${"f".repeat(52)}`,
    }),
  },
  {
    name: "index created at",
    expected: /consumer_index_payload_mismatch/,
    mutateIndex: (value) => ({
      ...value,
      created_at: "2026-08-28T09:51:23.000Z",
    }),
  },
  {
    name: "payload generated at",
    expected: /consumer_index_payload_mismatch/,
    mutatePayload: (value) => ({
      ...value,
      generated_at: "2026-08-28T09:51:23.000Z",
    }),
  },
  {
    name: "index coverage start",
    expected: /consumer_index_payload_mismatch/,
    mutateIndex: (value) => ({ ...value, coverage_start: "2023-02-01" }),
  },
  {
    name: "index coverage end",
    expected: /consumer_index_payload_mismatch/,
    mutateIndex: (value) => ({ ...value, coverage_end: "2026-07-31" }),
  },
  {
    name: "index source ids",
    expected: /invalid_consumer_index/,
    mutateIndex: (value) => ({
      ...value,
      source_ids: [...value.source_ids].reverse(),
    }),
  },
  {
    name: "index indicator count",
    expected: /consumer_index_payload_mismatch/,
    mutateIndex: (value) => ({ ...value, indicator_count: 4 }),
  },
  {
    name: "index observation count",
    expected: /consumer_index_payload_mismatch/,
    mutateIndex: (value) => ({ ...value, observation_count: 359 }),
  },
];

for (const invalidCase of V2_CROSS_FILE_MUTATIONS) {
  void test(`v2 verifier rejects independent ${invalidCase.name} mutation`, async (t) => {
    const bundle = await createV2Bundle(t);
    await rewriteSignedV2Bundle({
      created: bundle.created,
      ...(invalidCase.mutateIndex === undefined
        ? {}
        : { mutateIndex: invalidCase.mutateIndex }),
      ...(invalidCase.mutatePayload === undefined
        ? {}
        : { mutatePayload: invalidCase.mutatePayload }),
      synchronizeIndexFromPayload: false,
    });

    await assert.rejects(
      () => verifyConsumerBundle(verificationInput(bundle.created)),
      invalidCase.expected,
    );
  });
}

void test("detects corrupted v2 payload bytes", async (t) => {
  const { created } = await createV2Bundle(t);
  await appendFile(created.payloadPath, " ");

  await assert.rejects(
    () => verifyConsumerBundle(verificationInput(created)),
    /consumer_payload_(?:size|digest)_mismatch/,
  );
});

void test("refuses mixed v1 and v2 bundle asset names", async (t) => {
  const { outputDir, created } = await createV2Bundle(t);
  const mixedPayloadPath = join(outputDir, "consumer-v1.json");
  await rename(created.payloadPath, mixedPayloadPath);

  await assert.rejects(
    () =>
      verifyConsumerBundle({
        ...verificationInput(created),
        payloadPath: mixedPayloadPath,
      }),
    /consumer_bundle_path_mismatch|unexpected_consumer_bundle_files/,
  );
});

void test("rejects an unknown contract from the index before accepting asset names", async (t) => {
  const { outputDir, created } = await createBundle(t);
  const unknownPayloadPath = join(outputDir, "consumer-v3.json");
  const unknownChecksumPath = join(outputDir, "consumer-v3.json.sha256");
  await Promise.all([
    rename(created.payloadPath, unknownPayloadPath),
    rename(created.checksumPath, unknownChecksumPath),
    writeFile(
      created.indexPath,
      `${canonicalJson({
        ...created.index,
        consumer_contract: "erp-snack-observation-v3",
        payload: { ...created.index.payload, name: "consumer-v3.json" },
      })}\n`,
    ),
  ]);

  await assert.rejects(
    () =>
      verifyConsumerBundle({
        indexPath: created.indexPath,
        payloadPath: unknownPayloadPath,
        checksumPath: unknownChecksumPath,
      }),
    /invalid_consumer_index/,
  );
});

void test("refuses a non-empty v2 output directory without overwriting it", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "consumer-v2-bundle-collision-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputDir = join(root, "bundle");
  await mkdir(outputDir);
  const sentinel = join(outputDir, "keep.txt");
  await writeFile(sentinel, "keep\n");

  await assert.rejects(
    () =>
      writeConsumerBundle({
        outputDir,
        payload: payloadV2(),
        codeSha: CODE_SHA,
      }),
    /consumer_output_not_empty/,
  );
  assert.equal(await readFile(sentinel, "utf8"), "keep\n");
});

void test("refuses an existing non-empty output directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "consumer-bundle-collision-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputDir = join(root, "bundle");
  await mkdir(outputDir);
  const sentinel = join(outputDir, "keep.txt");
  await writeFile(sentinel, "keep\n");

  await assert.rejects(
    () => writeConsumerBundle({ outputDir, payload: payload(), codeSha: CODE_SHA }),
    /consumer_output_not_empty/,
  );
  assert.equal(await readFile(sentinel, "utf8"), "keep\n");
});

void test("detects corrupted payload bytes", async (t) => {
  const { created } = await createBundle(t);
  await appendFile(created.payloadPath, " ");

  await assert.rejects(
    () => verifyConsumerBundle(verificationInput(created)),
    /consumer_payload_(?:size|digest)_mismatch/,
  );
});

void test("detects a corrupted index snapshot identity", async (t) => {
  const { created } = await createBundle(t);
  const corruptedIndex = {
    ...created.index,
    source_snapshot_tag: "data-20260827T095123Z-dddddddddddd",
    source_snapshot_id: "d".repeat(64),
  };
  await writeFile(created.indexPath, `${canonicalJson(corruptedIndex)}\n`);

  await assert.rejects(
    () => verifyConsumerBundle(verificationInput(created)),
    /consumer_snapshot_identity_mismatch/,
  );
});

void test("rejects a self-consistent bundle whose tag suffix mismatches its snapshot id", async (t) => {
  const { created } = await createBundle(t);
  const invalidSnapshotId = "d".repeat(64);
  const invalidPayload = {
    ...payload(),
    source_snapshot_id: invalidSnapshotId,
  };
  const payloadBytes = Buffer.from(`${canonicalJson(invalidPayload)}\n`);
  const payloadSha256 = sha256Hex(payloadBytes);
  const invalidIndex = {
    ...created.index,
    source_snapshot_id: invalidSnapshotId,
    payload: {
      ...created.index.payload,
      byte_length: payloadBytes.byteLength,
      sha256: payloadSha256,
    },
  };
  await Promise.all([
    writeFile(created.payloadPath, payloadBytes),
    writeFile(created.indexPath, `${canonicalJson(invalidIndex)}\n`),
    writeFile(created.checksumPath, `${payloadSha256}  consumer-v1.json\n`),
  ]);

  await assert.rejects(
    () => verifyConsumerBundle(verificationInput(created)),
    /invalid_consumer_index/,
  );
});

void test("detects a corrupted checksum sidecar", async (t) => {
  const { created } = await createBundle(t);
  await writeFile(
    created.checksumPath,
    `${"e".repeat(64)}  consumer-v1.json\n`,
  );

  await assert.rejects(
    () => verifyConsumerBundle(verificationInput(created)),
    /consumer_checksum_sidecar_mismatch/,
  );
});

void test("refuses unexpected files in a consumer bundle", async (t) => {
  const { outputDir, created } = await createBundle(t);
  await writeFile(join(outputDir, "unexpected.json"), "{}\n");

  await assert.rejects(
    () => verifyConsumerBundle(verificationInput(created)),
    /unexpected_consumer_bundle_files/,
  );
});

void test("refuses symlinked and non-regular consumer assets", async (t) => {
  const symlinkBundle = await createBundle(t);
  const originalPayloadPath = join(symlinkBundle.root, "original-payload.json");
  await rename(symlinkBundle.created.payloadPath, originalPayloadPath);
  await symlink(originalPayloadPath, symlinkBundle.created.payloadPath);

  await assert.rejects(
    () => verifyConsumerBundle(verificationInput(symlinkBundle.created)),
    /consumer_bundle_asset_not_regular/,
  );

  const specialBundle = await createBundle(t);
  await rm(specialBundle.created.checksumPath);
  await mkdir(specialBundle.created.checksumPath);

  await assert.rejects(
    () => verifyConsumerBundle(verificationInput(specialBundle.created)),
    /consumer_bundle_asset_not_regular/,
  );
});
