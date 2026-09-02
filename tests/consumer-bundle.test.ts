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
  CONSUMER_V2_PROFILE,
  ConsumerPayloadSchema,
  ConsumerV2PayloadSchema,
  SCHEMA_VERSION,
  type ConsumerPayload,
  type ConsumerV2Payload,
} from "@data-hub/contracts";
import {
  verifyConsumerBundle,
  writeConsumerBundle,
  type CreatedConsumerBundle,
} from "@data-hub/adapters";

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
  return ConsumerV2PayloadSchema.parse({
    schema_version: SCHEMA_VERSION,
    consumer_contract: CONSUMER_V2_CONTRACT,
    source_snapshot_tag: SNAPSHOT_TAG,
    source_snapshot_id: SNAPSHOT_ID,
    generated_at: GENERATED_AT,
    profile_id: CONSUMER_V2_PROFILE,
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
      {
        source_id: "hcp-ipc-2017-official-g1-monthly",
        publisher_name: "Haut-Commissariat au Plan",
        official_base_url:
          "https://www.hcp.ma/Indices-des-prix-a-la-consommation-IPC_r348.html",
        licence_id: "CC-BY-4.0",
        licence_evidence_url:
          "https://www.hcp.ma/Conditions-generales-d-utilisation-Version-1-0_a2194.html",
        health_status: "healthy",
        retrieved_at: GENERATED_AT,
        last_period_end: "2026-07-31",
        warning_age_days: 60,
        expiry_age_days: 120,
        age_days_at_snapshot: 27,
        warning_codes: [],
      },
    ],
    observations: [
      {
        ...observation("hcp.ipc2017.01", "ma", "2024-10-01", "2024-10-31"),
        source_id: "hcp-ipc-2017-official-g1-monthly",
        context_role: "fresh_national_context",
        granularity: "division",
      },
      {
        ...observation(
          "hcp.ipc2017.0111",
          "ma:city:tetouan",
          "2024-11-01",
          "2024-11-30",
        ),
        category: "bread_cereals",
        context_role: "historical_detailed_context",
        granularity: "group_of_products",
      },
    ],
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

function verificationInput(created: CreatedConsumerBundle) {
  return {
    indexPath: created.indexPath,
    payloadPath: created.payloadPath,
    checksumPath: created.checksumPath,
  };
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
