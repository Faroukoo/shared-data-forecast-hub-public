import assert from "node:assert/strict";
import test from "node:test";

import {
  CONSUMER_V3_CONTRACT,
  CONSUMER_V3_PROFILE,
  CONSUMER_V3_TUPLES,
  ConsumerV3IndexSchema,
  ConsumerV3PayloadSchema,
  SCHEMA_VERSION,
} from "@data-hub/contracts";

import {
  V3_GENERATED_AT,
  V3_SNAPSHOT_ID,
  V3_SNAPSHOT_TAG,
  V3_SOURCE_ID,
  consumerV3PayloadFixture,
} from "./consumer-v3-fixture.js";

function validIndex() {
  return {
    schema_version: SCHEMA_VERSION,
    consumer_contract: CONSUMER_V3_CONTRACT,
    source_snapshot_tag: V3_SNAPSHOT_TAG,
    source_snapshot_id: V3_SNAPSHOT_ID,
    contains_confidential_data: false,
    decision_scope: "observation_only",
    created_at: V3_GENERATED_AT,
    code_sha: "d".repeat(40),
    indicator_count: 1,
    observation_count: 24,
    coverage_start: "2024-09-01",
    coverage_end: "2026-08-31",
    source_ids: [V3_SOURCE_ID],
    payload: {
      name: "consumer-v3.json",
      byte_length: 8_192,
      sha256: "e".repeat(64),
    },
  };
}

void test("consumer v3 accepts exactly one source, one tuple and 24 closed months", () => {
  const parsed = ConsumerV3PayloadSchema.parse(consumerV3PayloadFixture());

  assert.equal(CONSUMER_V3_CONTRACT, "erp-snack-observation-v3");
  assert.equal(CONSUMER_V3_PROFILE, "erp-snack-observation-v3");
  assert.deepEqual(CONSUMER_V3_TUPLES, [{
    category: "food_overall",
    locationKey: "ma",
    seriesKey: "hcp.ipc2017.01",
    sourceId: "hcp-ipc-2017-official-g1-monthly",
    contextRole: "fresh_national_context",
    granularity: "division",
    geographyType: "country",
  }]);
  assert.equal(parsed.sources.length, 1);
  assert.equal(parsed.observations.length, 24);
  assert.deepEqual(parsed.business_context, {
    operating_location_key: "ma:city:casablanca",
    procurement_location_mode: "erp_observed_only",
  });
  assert.deepEqual(
    [...new Set(parsed.observations.map((row) =>
      `${row.series_key}|${row.location_key}|${row.source_id}`,
    ))],
    ["hcp.ipc2017.01|ma|hcp-ipc-2017-official-g1-monthly"],
  );
  assert.deepEqual(
    parsed.observations.map((row) => `${row.period_start}|${row.period_end}|${row.value}`),
    [
      "2024-09-01|2024-09-30|101", "2024-10-01|2024-10-31|102",
      "2024-11-01|2024-11-30|103", "2024-12-01|2024-12-31|104",
      "2025-01-01|2025-01-31|105", "2025-02-01|2025-02-28|106",
      "2025-03-01|2025-03-31|107", "2025-04-01|2025-04-30|108",
      "2025-05-01|2025-05-31|109", "2025-06-01|2025-06-30|110",
      "2025-07-01|2025-07-31|111", "2025-08-01|2025-08-31|112",
      "2025-09-01|2025-09-30|113", "2025-10-01|2025-10-31|114",
      "2025-11-01|2025-11-30|115", "2025-12-01|2025-12-31|116",
      "2026-01-01|2026-01-31|117", "2026-02-01|2026-02-28|118",
      "2026-03-01|2026-03-31|119", "2026-04-01|2026-04-30|120",
      "2026-05-01|2026-05-31|121", "2026-06-01|2026-06-30|122",
      "2026-07-01|2026-07-31|123", "2026-08-01|2026-08-31|124",
    ],
  );
});

const OBSERVATION_MUTATIONS: ReadonlyArray<{
  name: string;
  mutate: (row: Record<string, unknown>) => void;
}> = [
  { name: "legacy source", mutate: (row) => { row.source_id = "hcp-ipc-2017-monthly"; } },
  { name: "city", mutate: (row) => { row.location_key = "ma:city:casablanca"; } },
  { name: "city geography", mutate: (row) => { row.geography_type = "city"; } },
  { name: "detailed category", mutate: (row) => { row.category = "bread_cereals"; } },
  { name: "detailed series", mutate: (row) => { row.series_key = "hcp.ipc2017.0111"; } },
  { name: "wrong label", mutate: (row) => { row.label_fr = "Pain et céréales"; } },
  { name: "decision usage", mutate: (row) => { row.usage = "supplier_price"; } },
  { name: "historical role", mutate: (row) => { row.context_role = "historical_detailed_context"; } },
  { name: "detailed granularity", mutate: (row) => { row.granularity = "group_of_products"; } },
  { name: "wrong frequency", mutate: (row) => { row.frequency = "annual"; } },
  { name: "wrong unit", mutate: (row) => { row.unit = "percent"; } },
  { name: "wrong base", mutate: (row) => { row.base_year = 2018; } },
  { name: "wrong scaling", mutate: (row) => { row.scaling_factor = "100"; } },
];

for (const mutation of OBSERVATION_MUTATIONS) {
  void test(`consumer v3 rejects ${mutation.name} observation metadata`, () => {
    const payload = structuredClone(consumerV3PayloadFixture()) as unknown as {
      observations: Array<Record<string, unknown>>;
    };
    mutation.mutate(payload.observations[0] ?? assert.fail("missing observation"));
    assert.throws(() => ConsumerV3PayloadSchema.parse(payload));
  });
}

void test("consumer v3 keeps the public observation-only boundary closed", () => {
  const payload = consumerV3PayloadFixture();
  assert.throws(() => ConsumerV3PayloadSchema.parse({
    ...payload,
    contains_confidential_data: true,
  }));
  assert.throws(() => ConsumerV3PayloadSchema.parse({
    ...payload,
    decision_scope: "price_recommendation",
  }));
  assert.throws(() => ConsumerV3PayloadSchema.parse({
    ...payload,
    forecast: { coefficient: 0.15 },
  }));
  assert.throws(() => ConsumerV3PayloadSchema.parse({
    ...payload,
    business_context: {
      ...payload.business_context,
      procurement_location_mode: "supplier_address_inferred",
    },
  }));
});

void test("consumer v3 rejects missing, duplicate and unsorted periods", () => {
  const payload = consumerV3PayloadFixture();
  assert.throws(
    () => ConsumerV3PayloadSchema.parse({
      ...payload,
      observations: payload.observations.slice(1),
    }),
    /consumer_v3_observation_count_invalid:23/,
  );
  assert.throws(
    () => ConsumerV3PayloadSchema.parse({
      ...payload,
      observations: [...payload.observations, payload.observations[0]],
    }),
    /consumer_v3_observation_count_invalid:25|consumer_v3_period_revision_duplicate/,
  );
  assert.throws(
    () => ConsumerV3PayloadSchema.parse({
      ...payload,
      observations: [...payload.observations].reverse(),
    }),
    /observations_must_be_sorted_and_unique/,
  );
});

void test("consumer v3 rejects non-closed, future and non-positive or unbounded values", () => {
  const payload = consumerV3PayloadFixture();
  const mutateFirst = (changes: Record<string, unknown>) => ({
    ...payload,
    observations: [{ ...payload.observations[0], ...changes }, ...payload.observations.slice(1)],
  });
  assert.throws(() => ConsumerV3PayloadSchema.parse(mutateFirst({ period_start: "2024-09-02" })), /closed_calendar_month_required/);
  assert.throws(() => ConsumerV3PayloadSchema.parse(mutateFirst({ period_end: "2024-09-29" })), /closed_calendar_month_required/);
  assert.throws(() => ConsumerV3PayloadSchema.parse({
    ...payload,
    generated_at: "2026-08-01T00:00:00.000Z",
  }), /future_observation_period/);
  assert.throws(() => ConsumerV3PayloadSchema.parse(mutateFirst({ value: "0" })), /positive_bounded_index_required/);
  assert.throws(() => ConsumerV3PayloadSchema.parse(mutateFirst({ value: "9".repeat(400) })), /positive_bounded_index_required/);
});

void test("consumer v3 binds coverage and source age evidence to observations and snapshot", () => {
  const payload = consumerV3PayloadFixture();
  assert.throws(() => ConsumerV3PayloadSchema.parse({ ...payload, coverage_start: "2024-10-01" }), /coverage_observation_mismatch/);
  assert.throws(() => ConsumerV3PayloadSchema.parse({ ...payload, coverage_end: "2026-07-31" }), /coverage_observation_mismatch/);
  assert.throws(() => ConsumerV3PayloadSchema.parse({
    ...payload,
    sources: [{ ...payload.sources[0], last_period_end: "2026-07-31" }],
  }), /source_period_evidence_mismatch/);
  assert.throws(() => ConsumerV3PayloadSchema.parse({
    ...payload,
    sources: [{ ...payload.sources[0], retrieved_at: "2026-08-31T11:00:00.000Z" }],
  }), /source_retrieval_evidence_mismatch/);
  assert.throws(() => ConsumerV3PayloadSchema.parse({
    ...payload,
    sources: [{ ...payload.sources[0], age_days_at_snapshot: 2 }],
  }), /source_age_evidence_mismatch/);
  assert.throws(() => ConsumerV3PayloadSchema.parse({
    ...payload,
    source_snapshot_tag: "data-20260901T120000Z-aaaaaaaaaaaa",
  }), /source_snapshot_tag_snapshot_mismatch/);
});

void test("consumer v3 requires the exact single official source evidence", () => {
  const payload = consumerV3PayloadFixture();
  assert.throws(() => ConsumerV3PayloadSchema.parse({ ...payload, sources: [] }), /sources_must_be_exact_singleton/);
  assert.throws(() => ConsumerV3PayloadSchema.parse({
    ...payload,
    sources: [{ ...payload.sources[0], licence_id: "ODbL-1.0" }],
  }));
  assert.throws(() => ConsumerV3PayloadSchema.parse({
    ...payload,
    sources: [{ ...payload.sources[0], warning_age_days: 61 }],
  }));
});

void test("consumer v3 index fixes all contract metadata and snapshot identity", () => {
  assert.doesNotThrow(() => ConsumerV3IndexSchema.parse(validIndex()));
  const mutations = [
    { ...validIndex(), indicator_count: 2 },
    { ...validIndex(), observation_count: 23 },
    { ...validIndex(), source_ids: ["hcp-ipc-2017-monthly"] },
    { ...validIndex(), payload: { ...validIndex().payload, name: "consumer-v2.json" } },
    { ...validIndex(), source_snapshot_tag: "data-20260901T120000Z-aaaaaaaaaaaa" },
  ];
  for (const mutation of mutations) {
    assert.throws(() => ConsumerV3IndexSchema.parse(mutation));
  }
});
