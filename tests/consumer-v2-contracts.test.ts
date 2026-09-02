import assert from "node:assert/strict";
import test from "node:test";

import {
  CONSUMER_V2_CONTRACT,
  CONSUMER_V2_PROFILE,
  ConsumerV2IndexSchema,
  ConsumerV2PayloadSchema,
  SCHEMA_VERSION,
} from "@data-hub/contracts";

const SNAPSHOT_ID = "9d3b77bbfc0cf05cbc0f2e27f24cfb0b348ce0e5d71b09267fbd7ce67657e226";
const SNAPSHOT_TAG = "data-20260827T095123Z-9d3b77bbfc0c";
const V2_SOURCE_IDS = [
  "hcp-ipc-2017-monthly",
  "hcp-ipc-2017-official-g1-monthly",
] as const;
const SERIES = [
  {
    seriesKey: "hcp.ipc2017.01",
    category: "food_overall",
    labelFr: "Alimentation",
    granularity: "division",
  },
  {
    seriesKey: "hcp.ipc2017.0111",
    category: "bread_cereals",
    labelFr: "Pain et céréales",
    granularity: "group_of_products",
  },
  {
    seriesKey: "hcp.ipc2017.0113",
    category: "fish_seafood",
    labelFr: "Poisson et fruits de mer",
    granularity: "group_of_products",
  },
  {
    seriesKey: "hcp.ipc2017.0115",
    category: "oils_fats",
    labelFr: "Huiles et graisses",
    granularity: "group_of_products",
  },
  {
    seriesKey: "hcp.ipc2017.0117",
    category: "vegetables",
    labelFr: "Légumes",
    granularity: "group_of_products",
  },
] as const;
const LOCATIONS = [
  "ma",
  "ma:city:al-hoceima",
  "ma:city:tetouan",
] as const;

type SeriesFixture = (typeof SERIES)[number];
type LocationFixture = (typeof LOCATIONS)[number];

function source(sourceId: (typeof V2_SOURCE_IDS)[number]) {
  const official = sourceId === "hcp-ipc-2017-official-g1-monthly";
  return {
    source_id: sourceId,
    publisher_name: "Haut-Commissariat au Plan",
    official_base_url: "https://www.hcp.ma/",
    licence_id: official ? "CC-BY-4.0" : "ODbL-1.0",
    licence_evidence_url: official
      ? "https://www.hcp.ma/Indices-des-prix-a-la-consommation-IPC_r348.html"
      : "https://data.gov.ma/data/fr/dataset/data_7_5",
    health_status: official ? ("healthy" as const) : ("stale" as const),
    retrieved_at: "2026-08-27T09:51:23.000Z",
    last_period_end: official ? "2026-08-31" : "2024-11-30",
    warning_age_days: 60,
    expiry_age_days: 120,
    age_days_at_snapshot: official ? 0 : 635,
    warning_codes: official ? [] : ["source_stale"],
  };
}

function latestCell(series: SeriesFixture, locationKey: LocationFixture) {
  const freshNational =
    series.category === "food_overall" && locationKey === "ma";
  return {
    series_key: series.seriesKey,
    label_fr: series.labelFr,
    category: series.category,
    usage: "macro_context_only" as const,
    geography_type: locationKey === "ma" ? ("country" as const) : ("city" as const),
    location_key: locationKey,
    period_start: freshNational ? "2026-08-01" : "2024-11-01",
    period_end: freshNational ? "2026-08-31" : "2024-11-30",
    frequency: "monthly" as const,
    value: freshNational ? "101.2" : "118.4",
    unit: "index" as const,
    base_year: 2017 as const,
    scaling_factor: "1",
    source_id: freshNational
      ? ("hcp-ipc-2017-official-g1-monthly" as const)
      : ("hcp-ipc-2017-monthly" as const),
    artifact_sha256: freshNational ? "c".repeat(64) : "b".repeat(64),
    retrieved_at: "2026-08-27T09:51:23.000Z",
    quality_status: freshNational
      ? ("accepted" as const)
      : ("accepted_with_warning" as const),
    warning_codes: freshNational ? [] : ["source_stale"],
    revision_number: 1,
    context_role: freshNational
      ? ("fresh_national_context" as const)
      : ("historical_detailed_context" as const),
    granularity: series.granularity,
  };
}

function validPayload() {
  const observations = SERIES.flatMap((series) =>
    LOCATIONS.map((location) => latestCell(series, location)),
  );
  return {
    schema_version: SCHEMA_VERSION,
    consumer_contract: CONSUMER_V2_CONTRACT,
    source_snapshot_tag: SNAPSHOT_TAG,
    source_snapshot_id: SNAPSHOT_ID,
    generated_at: "2026-08-27T09:51:23.000Z",
    profile_id: CONSUMER_V2_PROFILE,
    contains_confidential_data: false as const,
    decision_scope: "observation_only" as const,
    coverage_start: "2024-11-01",
    coverage_end: "2026-08-31",
    sources: V2_SOURCE_IDS.map(source),
    observations,
  };
}

function validIndex() {
  return {
    schema_version: SCHEMA_VERSION,
    consumer_contract: CONSUMER_V2_CONTRACT,
    source_snapshot_tag: SNAPSHOT_TAG,
    source_snapshot_id: SNAPSHOT_ID,
    contains_confidential_data: false as const,
    decision_scope: "observation_only" as const,
    created_at: "2026-08-27T09:51:23.000Z",
    code_sha: "c".repeat(40),
    indicator_count: 5,
    observation_count: 15,
    coverage_start: "2024-11-01",
    coverage_end: "2026-08-31",
    source_ids: [...V2_SOURCE_IDS],
    payload: {
      name: "consumer-v2.json" as const,
      byte_length: 8_192,
      sha256: "d".repeat(64),
    },
  };
}

void test("consumer v2 accepts the exact fifteen-cell two-source fixture", () => {
  const parsed = ConsumerV2PayloadSchema.parse(validPayload());

  assert.equal(parsed.consumer_contract, "erp-snack-observation-v2");
  assert.equal(parsed.profile_id, "erp-snack-observation-v2");
  assert.deepEqual(parsed.sources.map((entry) => entry.source_id), V2_SOURCE_IDS);
  assert.equal(parsed.observations.length, 15);
  assert.deepEqual(
    parsed.observations.map((row) => `${row.series_key}|${row.location_key}`),
    [
      "hcp.ipc2017.01|ma",
      "hcp.ipc2017.01|ma:city:al-hoceima",
      "hcp.ipc2017.01|ma:city:tetouan",
      "hcp.ipc2017.0111|ma",
      "hcp.ipc2017.0111|ma:city:al-hoceima",
      "hcp.ipc2017.0111|ma:city:tetouan",
      "hcp.ipc2017.0113|ma",
      "hcp.ipc2017.0113|ma:city:al-hoceima",
      "hcp.ipc2017.0113|ma:city:tetouan",
      "hcp.ipc2017.0115|ma",
      "hcp.ipc2017.0115|ma:city:al-hoceima",
      "hcp.ipc2017.0115|ma:city:tetouan",
      "hcp.ipc2017.0117|ma",
      "hcp.ipc2017.0117|ma:city:al-hoceima",
      "hcp.ipc2017.0117|ma:city:tetouan",
    ],
  );
});

void test("consumer v2 rejects unknown payload, source and observation fields", () => {
  const payload = validPayload();

  assert.throws(() => ConsumerV2PayloadSchema.parse({ ...payload, extra: true }));
  assert.throws(() => ConsumerV2PayloadSchema.parse({
    ...payload,
    sources: [{ ...payload.sources[0], extra: true }, payload.sources[1]],
  }));
  assert.throws(() => ConsumerV2PayloadSchema.parse({
    ...payload,
    observations: [{ ...payload.observations[0], extra: true }, ...payload.observations.slice(1)],
  }));
});

void test("consumer v2 rejects v1 contract, profile and payload filename literals", () => {
  assert.throws(() => ConsumerV2PayloadSchema.parse({
    ...validPayload(),
    consumer_contract: "erp-snack-observation-v1",
  }));
  assert.throws(() => ConsumerV2PayloadSchema.parse({
    ...validPayload(),
    profile_id: "erp-snack-observation-v1",
  }));
  assert.throws(() => ConsumerV2IndexSchema.parse({
    ...validIndex(),
    payload: { ...validIndex().payload, name: "consumer-v1.json" },
  }));
});

void test("consumer v2 observations cannot cross the public decision boundary", () => {
  const payload = validPayload();

  assert.throws(() => ConsumerV2PayloadSchema.parse({
    ...payload,
    contains_confidential_data: true,
  }));
  assert.throws(() => ConsumerV2PayloadSchema.parse({
    ...payload,
    observations: [{ ...payload.observations[0], usage: "supplier_price" }, ...payload.observations.slice(1)],
  }));
});

void test("consumer v2 rejects duplicate and unsorted observations", () => {
  const payload = validPayload();

  assert.throws(
    () => ConsumerV2PayloadSchema.parse({
      ...payload,
      observations: [payload.observations[0], payload.observations[0]],
    }),
    /observations_must_be_sorted_and_unique/,
  );
  assert.throws(
    () => ConsumerV2PayloadSchema.parse({
      ...payload,
      observations: [...payload.observations].reverse(),
    }),
    /observations_must_be_sorted_and_unique/,
  );
});

void test("consumer v2 binds each observation role to its required source", () => {
  const payload = validPayload();
  const freshNational = payload.observations[0];
  const historicalDetailed = payload.observations[3];

  assert.throws(
    () => ConsumerV2PayloadSchema.parse({
      ...payload,
      observations: [
        { ...freshNational, source_id: "hcp-ipc-2017-monthly" },
        ...payload.observations.slice(1),
      ],
    }),
    /fresh_national_context_observation_mismatch/,
  );
  assert.throws(
    () => ConsumerV2PayloadSchema.parse({
      ...payload,
      observations: payload.observations.map((row, index) =>
        index === 3
          ? { ...historicalDetailed, source_id: "hcp-ipc-2017-official-g1-monthly" }
          : row,
      ),
    }),
    /historical_detailed_context_observation_mismatch/,
  );
});

void test("consumer v2 requires the exact national food tuple to use official fresh context", () => {
  const payload = validPayload();

  assert.throws(
    () => ConsumerV2PayloadSchema.parse({
      ...payload,
      observations: [
        {
          ...payload.observations[0],
          source_id: "hcp-ipc-2017-monthly",
          context_role: "historical_detailed_context",
        },
        ...payload.observations.slice(1),
      ],
    }),
    /fresh_national_context_observation_mismatch/,
  );
});

void test("consumer v2 rejects a city location marked as country geography", () => {
  const payload = validPayload();

  assert.throws(
    () => ConsumerV2PayloadSchema.parse({
      ...payload,
      observations: payload.observations.map((row, index) =>
        index === 1 ? { ...row, geography_type: "country" } : row,
      ),
    }),
    /geography_type_location_mismatch/,
  );
});

void test("consumer v2 rejects the fresh national location marked as city geography", () => {
  const payload = validPayload();

  assert.throws(
    () => ConsumerV2PayloadSchema.parse({
      ...payload,
      observations: [
        { ...payload.observations[0], geography_type: "city" },
        ...payload.observations.slice(1),
      ],
    }),
    /geography_type_location_mismatch/,
  );
});

void test("consumer v2 rejects invalid context role and granularity combinations", () => {
  const payload = validPayload();

  assert.throws(
    () => ConsumerV2PayloadSchema.parse({
      ...payload,
      observations: [
        { ...payload.observations[0], granularity: "group_of_products" },
        ...payload.observations.slice(1),
      ],
    }),
    /fresh_national_context_observation_mismatch|food_overall_requires_division/,
  );
  assert.throws(
    () => ConsumerV2PayloadSchema.parse({
      ...payload,
      observations: payload.observations.map((row, index) =>
        index === 3 ? { ...row, context_role: "fresh_national_context" } : row,
      ),
    }),
    /fresh_national_context_observation_mismatch/,
  );
});

void test("consumer v2 observation order uses code units for non-ASCII series", () => {
  const payload = validPayload();
  const detailed = payload.observations[3];

  const parsed = ConsumerV2PayloadSchema.parse({
    ...payload,
    observations: [
      { ...detailed, series_key: "hcp.ipc2017.z" },
      { ...detailed, series_key: "hcp.ipc2017.é" },
    ],
  });

  assert.deepEqual(
    parsed.observations.map((row) => row.series_key),
    ["hcp.ipc2017.z", "hcp.ipc2017.é"],
  );
});

void test("consumer v2 payload requires the exact sorted source pair", () => {
  const payload = validPayload();
  const invalidSourceSets = [
    [payload.sources[0]],
    [...payload.sources].reverse(),
    [payload.sources[0], payload.sources[0]],
  ];

  for (const sources of invalidSourceSets) {
    assert.throws(
      () => ConsumerV2PayloadSchema.parse({ ...payload, sources }),
      /sources_must_be_exact_sorted_pair/,
    );
  }
});

void test("consumer v2 index is strict and requires its exact source pair and descriptor", () => {
  const parsed = ConsumerV2IndexSchema.parse(validIndex());
  assert.deepEqual(parsed.source_ids, V2_SOURCE_IDS);
  assert.equal(parsed.payload.name, "consumer-v2.json");

  assert.throws(() => ConsumerV2IndexSchema.parse({ ...validIndex(), extra: true }));
  assert.throws(() => ConsumerV2IndexSchema.parse({
    ...validIndex(),
    payload: { ...validIndex().payload, extra: true },
  }));
  assert.throws(
    () => ConsumerV2IndexSchema.parse({
      ...validIndex(),
      source_ids: [...V2_SOURCE_IDS].reverse(),
    }),
    /source_ids_must_be_exact_sorted_pair/,
  );
  assert.throws(
    () => ConsumerV2IndexSchema.parse({
      ...validIndex(),
      source_ids: [V2_SOURCE_IDS[0]],
    }),
    /source_ids_must_be_exact_sorted_pair/,
  );
});

void test("consumer v2 index rejects v1 and widened public-boundary literals", () => {
  assert.throws(() => ConsumerV2IndexSchema.parse({
    ...validIndex(),
    consumer_contract: "erp-snack-observation-v1",
  }));
  assert.throws(() => ConsumerV2IndexSchema.parse({
    ...validIndex(),
    contains_confidential_data: true,
  }));
  assert.throws(() => ConsumerV2IndexSchema.parse({
    ...validIndex(),
    decision_scope: "observation_and_recommendation",
  }));
});

void test("consumer v2 payload and index bind the source tag to the snapshot id", () => {
  assert.throws(
    () => ConsumerV2PayloadSchema.parse({
      ...validPayload(),
      source_snapshot_id: "f".repeat(64),
    }),
    /source_snapshot_tag_snapshot_mismatch/,
  );
  assert.throws(
    () => ConsumerV2IndexSchema.parse({
      ...validIndex(),
      source_snapshot_id: "f".repeat(64),
    }),
    /source_snapshot_tag_snapshot_mismatch/,
  );
});
