import assert from "node:assert/strict";
import test from "node:test";

import {
  CONSUMER_CONTRACT,
  CONSUMER_PROFILE,
  ConsumerIndexSchema,
  ConsumerPayloadSchema,
  SCHEMA_VERSION,
} from "@data-hub/contracts";

const SNAPSHOT_ID = "9d3b77bbfc0cf05cbc0f2e27f24cfb0b348ce0e5d71b09267fbd7ce67657e226";
const SNAPSHOT_TAG = "data-20260827T095123Z-9d3b77bbfc0c";

function observation(
  seriesKey: string,
  locationKey: "ma" | "ma:city:al-hoceima" | "ma:city:tetouan",
) {
  return {
    series_key: seriesKey,
    label_fr: "Alimentation",
    category: "food_overall" as const,
    usage: "macro_context_only" as const,
    geography_type: locationKey === "ma" ? ("country" as const) : ("city" as const),
    location_key: locationKey,
    period_start: "2024-11-01",
    period_end: "2024-11-30",
    frequency: "monthly" as const,
    value: "118.4",
    unit: "index" as const,
    base_year: 2017 as const,
    scaling_factor: "1",
    source_id: "hcp-ipc-2017-monthly" as const,
    artifact_sha256: "b".repeat(64),
    retrieved_at: "2026-08-27T09:51:23.000Z",
    quality_status: "accepted" as const,
    warning_codes: [],
    revision_number: 1,
  };
}

function validPayload() {
  return {
    schema_version: SCHEMA_VERSION,
    consumer_contract: CONSUMER_CONTRACT,
    source_snapshot_tag: SNAPSHOT_TAG,
    source_snapshot_id: SNAPSHOT_ID,
    generated_at: "2026-08-27T09:51:23.000Z",
    profile_id: CONSUMER_PROFILE,
    contains_confidential_data: false as const,
    decision_scope: "observation_only" as const,
    coverage_start: "2024-11-01",
    coverage_end: "2024-11-30",
    sources: [
      {
        source_id: "hcp-ipc-2017-monthly" as const,
        publisher_name: "Haut-Commissariat au Plan",
        official_base_url: "https://www.hcp.ma/",
        licence_id: "ODbL-1.0",
        licence_evidence_url: "https://data.gov.ma/data/fr/dataset/data_7_5",
        health_status: "stale" as const,
        retrieved_at: "2026-08-27T09:51:23.000Z",
        last_period_end: "2024-11-30",
        warning_age_days: 60,
        expiry_age_days: 120,
        age_days_at_snapshot: 635,
        warning_codes: ["source_stale"],
      },
    ],
    observations: [
      observation("hcp.ipc2017.01", "ma"),
      observation("hcp.ipc2017.0111", "ma"),
    ],
  };
}

function validIndex() {
  return {
    schema_version: SCHEMA_VERSION,
    consumer_contract: CONSUMER_CONTRACT,
    source_snapshot_tag: SNAPSHOT_TAG,
    source_snapshot_id: SNAPSHOT_ID,
    contains_confidential_data: false as const,
    decision_scope: "observation_only" as const,
    created_at: "2026-08-27T09:51:23.000Z",
    code_sha: "c".repeat(40),
    indicator_count: 2,
    observation_count: 2,
    coverage_start: "2024-11-01",
    coverage_end: "2024-11-30",
    source_ids: ["hcp-ipc-2017-monthly" as const],
    payload: {
      name: "consumer-v1.json" as const,
      byte_length: 1_024,
      sha256: "d".repeat(64),
    },
  };
}

void test("consumer payload is strict, public and deterministically ordered", () => {
  const parsed = ConsumerPayloadSchema.parse(validPayload());
  assert.equal(parsed.profile_id, "erp-snack-observation-v1");
  assert.equal(parsed.contains_confidential_data, false);

  assert.throws(() => ConsumerPayloadSchema.parse({ ...validPayload(), extra: true }));
  assert.throws(
    () =>
      ConsumerPayloadSchema.parse({
        ...validPayload(),
        observations: [...validPayload().observations].reverse(),
      }),
    /observations_must_be_sorted_and_unique/,
  );
});

void test("consumer payload rejects unknown source fields", () => {
  const payload = validPayload();

  assert.throws(() =>
    ConsumerPayloadSchema.parse({
      ...payload,
      sources: [{ ...payload.sources[0], unexpected: true }],
    }),
  );
});

void test("consumer payload rejects unknown observation fields", () => {
  const payload = validPayload();

  assert.throws(() =>
    ConsumerPayloadSchema.parse({
      ...payload,
      observations: [{ ...payload.observations[0], unexpected: true }],
    }),
  );
});

void test("consumer observation order is independent of the host locale", () => {
  const parsed = ConsumerPayloadSchema.parse({
    ...validPayload(),
    observations: [
      observation("hcp.ipc2017.z", "ma"),
      observation("hcp.ipc2017.é", "ma"),
    ],
  });

  assert.deepEqual(
    parsed.observations.map((row) => row.series_key),
    ["hcp.ipc2017.z", "hcp.ipc2017.é"],
  );
});

void test("consumer payload rejects duplicate observation keys and sources", () => {
  const payload = validPayload();
  assert.throws(
    () =>
      ConsumerPayloadSchema.parse({
        ...payload,
        observations: [payload.observations[0], payload.observations[0]],
      }),
    /observations_must_be_sorted_and_unique/,
  );
  assert.throws(
    () => ConsumerPayloadSchema.parse({ ...payload, sources: [payload.sources[0], payload.sources[0]] }),
    /sources_must_be_sorted_and_unique/,
  );
});

void test("consumer observations cannot cross the public decision boundary", () => {
  const payload = validPayload();

  assert.throws(() =>
    ConsumerPayloadSchema.parse({ ...payload, contains_confidential_data: true }),
  );
  assert.throws(() =>
    ConsumerPayloadSchema.parse({
      ...payload,
      observations: [{ ...payload.observations[0], usage: "supplier_price" }],
    }),
  );
  assert.throws(() =>
    ConsumerPayloadSchema.parse({
      ...payload,
      observations: [{ ...payload.observations[0], quality_status: "quarantined" }],
    }),
  );
});

void test("consumer observations require normalized decimal strings", () => {
  const payload = validPayload();
  assert.throws(
    () =>
      ConsumerPayloadSchema.parse({
        ...payload,
        observations: [{ ...payload.observations[0], value: "118.0" }],
      }),
    /decimal_string_not_normalized/,
  );
});

void test("consumer payload requires an immutable source snapshot tag", () => {
  assert.throws(() =>
    ConsumerPayloadSchema.parse({ ...validPayload(), source_snapshot_tag: "latest" }),
  );
});

void test("consumer payload binds the source tag suffix to the snapshot id", () => {
  assert.throws(
    () =>
      ConsumerPayloadSchema.parse({
        ...validPayload(),
        source_snapshot_id: "f".repeat(64),
      }),
    /source_snapshot_tag_snapshot_mismatch/,
  );
});

void test("consumer index is strict and requires one exact payload descriptor", () => {
  const parsed = ConsumerIndexSchema.parse(validIndex());
  assert.equal(parsed.payload.name, "consumer-v1.json");

  assert.throws(() =>
    ConsumerIndexSchema.parse({
      ...validIndex(),
      payload: { ...validIndex().payload, name: "consumer.json" },
    }),
  );
  assert.throws(() =>
    ConsumerIndexSchema.parse({
      ...validIndex(),
      source_ids: ["hcp-ipc-2017-monthly", "hcp-ipc-2017-monthly"],
    }),
  );
  assert.throws(() => ConsumerIndexSchema.parse({ ...validIndex(), extra: true }));
});

void test("consumer index rejects unknown payload descriptor fields", () => {
  const index = validIndex();

  assert.throws(() =>
    ConsumerIndexSchema.parse({
      ...index,
      payload: { ...index.payload, unexpected: true },
    }),
  );
});

void test("consumer index binds the source tag suffix to the snapshot id", () => {
  assert.throws(
    () =>
      ConsumerIndexSchema.parse({
        ...validIndex(),
        source_snapshot_id: "f".repeat(64),
      }),
    /source_snapshot_tag_snapshot_mismatch/,
  );
});
