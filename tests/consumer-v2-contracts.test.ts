import assert from "node:assert/strict";
import test from "node:test";

import {
  CONSUMER_V2_CONTRACT,
  ConsumerV2IndexSchema,
  ConsumerV2PayloadSchema,
  SCHEMA_VERSION,
} from "@data-hub/contracts";

import {
  compareConsumerV2FixtureObservations,
  consumerV2PayloadFixture,
} from "./consumer-v2-fixture.js";

const SNAPSHOT_ID = "9d3b77bbfc0cf05cbc0f2e27f24cfb0b348ce0e5d71b09267fbd7ce67657e226";
const SNAPSHOT_TAG = "data-20260827T095123Z-9d3b77bbfc0c";
const V2_SOURCE_IDS = [
  "hcp-ipc-2017-monthly",
  "hcp-ipc-2017-official-g1-monthly",
] as const;

function validPayload() {
  return consumerV2PayloadFixture({
    snapshotId: SNAPSHOT_ID,
    snapshotTag: SNAPSHOT_TAG,
    generatedAt: "2026-08-27T09:51:23.000Z",
  });
}

function observationFor(
  payload: ReturnType<typeof validPayload>,
  seriesKey: string,
  locationKey: string,
) {
  return payload.observations.find(
    (row) => row.series_key === seriesKey && row.location_key === locationKey,
  ) ?? assert.fail(`missing fixture observation: ${seriesKey}|${locationKey}`);
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
    observation_count: 360,
    coverage_start: "2023-01-01",
    coverage_end: "2026-08-31",
    source_ids: [...V2_SOURCE_IDS],
    payload: {
      name: "consumer-v2.json" as const,
      byte_length: 8_192,
      sha256: "d".repeat(64),
    },
  };
}

void test("consumer v2 accepts exactly 24 periods for each canonical tuple", () => {
  const parsed = ConsumerV2PayloadSchema.parse(validPayload());

  assert.equal(parsed.consumer_contract, "erp-snack-observation-v2");
  assert.equal(parsed.profile_id, "erp-snack-observation-v2");
  assert.deepEqual(parsed.sources.map((entry) => entry.source_id), V2_SOURCE_IDS);
  assert.equal(parsed.observations.length, 360);
  assert.deepEqual(
    [...new Set(parsed.observations.map((row) => `${row.series_key}|${row.location_key}`))],
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
  const historicalDetailed = observationFor(
    payload,
    "hcp.ipc2017.0111",
    "ma",
  );

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
      observations: payload.observations.map((row) =>
        row === historicalDetailed
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
  const cityObservation = observationFor(
    payload,
    "hcp.ipc2017.01",
    "ma:city:al-hoceima",
  );

  assert.throws(
    () => ConsumerV2PayloadSchema.parse({
      ...payload,
      observations: payload.observations.map((row) =>
        row === cityObservation ? { ...row, geography_type: "country" } : row,
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
  const historicalDetailed = observationFor(
    payload,
    "hcp.ipc2017.0111",
    "ma",
  );

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
      observations: payload.observations.map((row) =>
        row === historicalDetailed
          ? { ...row, context_role: "fresh_national_context" }
          : row,
      ),
    }),
    /fresh_national_context_observation_mismatch/,
  );
});

void test("consumer v2 ordering stays locale-independent inside the allowed domain", () => {
  const payload = validPayload();
  const localeCompareDescriptor = Object.getOwnPropertyDescriptor(
    String.prototype,
    "localeCompare",
  ) ?? assert.fail("missing String.prototype.localeCompare descriptor");
  Object.defineProperty(String.prototype, "localeCompare", {
    ...localeCompareDescriptor,
    value: () => {
      throw new Error("locale_comparison_forbidden");
    },
  });

  try {
    const parsed = ConsumerV2PayloadSchema.parse(payload);
    assert.equal(parsed.observations.length, 360);
  } finally {
    Object.defineProperty(
      String.prototype,
      "localeCompare",
      localeCompareDescriptor,
    );
  }
});

void test("consumer v2 rejects an invented series inside an otherwise valid tuple", () => {
  const payload = validPayload();
  const target = observationFor(payload, "hcp.ipc2017.0111", "ma");
  const observations = payload.observations
    .map((row) =>
      row === target ? { ...row, series_key: "hcp.ipc2017.0112" } : row,
    )
    .sort(compareConsumerV2FixtureObservations);

  assert.throws(
    () => ConsumerV2PayloadSchema.parse({ ...payload, observations }),
    /consumer_v2_observation_tuple_invalid/,
  );
});

void test("consumer v2 rejects a category that does not match its canonical series", () => {
  const payload = validPayload();
  const target = observationFor(payload, "hcp.ipc2017.0111", "ma");
  const observations = payload.observations.map((row) =>
    row === target ? { ...row, category: "fish_seafood" as const } : row,
  );

  assert.throws(
    () => ConsumerV2PayloadSchema.parse({ ...payload, observations }),
    /consumer_v2_observation_tuple_invalid/,
  );
});

void test("consumer v2 rejects one canonical tuple with only 23 periods", () => {
  const payload = validPayload();
  const target = observationFor(
    payload,
    "hcp.ipc2017.0117",
    "ma:city:tetouan",
  );
  const observations = payload.observations.filter((row) => row !== target);

  assert.throws(
    () => ConsumerV2PayloadSchema.parse({ ...payload, observations }),
    /consumer_v2_tuple_period_count_invalid:vegetables\|ma:city:tetouan:23/,
  );
});

void test("consumer v2 rejects one canonical tuple with 25 periods", () => {
  const payload = validPayload();
  const last = [...payload.observations]
    .reverse()
    .find(
      (row) =>
        row.series_key === "hcp.ipc2017.0117" &&
        row.location_key === "ma:city:tetouan",
    ) ?? assert.fail("missing last tuple observation");
  const observations = [
    ...payload.observations,
    {
      ...last,
      period_start: "2025-01-01",
      period_end: "2025-01-31",
    },
  ];

  assert.throws(
    () => ConsumerV2PayloadSchema.parse({ ...payload, observations }),
    /consumer_v2_tuple_period_count_invalid:vegetables\|ma:city:tetouan:25/,
  );
});

void test("consumer v2 rejects a missing canonical tuple", () => {
  const payload = validPayload();
  const observations = payload.observations.filter(
    (row) =>
      row.series_key !== "hcp.ipc2017.0117" ||
      row.location_key !== "ma:city:tetouan",
  );

  assert.throws(
    () => ConsumerV2PayloadSchema.parse({ ...payload, observations }),
    /consumer_v2_tuple_period_count_invalid:vegetables\|ma:city:tetouan:0/,
  );
});

void test("consumer v2 rejects a supplementary out-of-matrix tuple", () => {
  const payload = validPayload();
  const template = observationFor(payload, "hcp.ipc2017.0111", "ma");
  const supplementary = payload.observations
    .filter(
      (row) =>
        row.series_key === template.series_key &&
        row.location_key === template.location_key,
    )
    .map((row) => ({ ...row, series_key: "hcp.ipc2017.0112" }));
  const observations = [...payload.observations, ...supplementary].sort(
    compareConsumerV2FixtureObservations,
  );

  assert.throws(
    () => ConsumerV2PayloadSchema.parse({ ...payload, observations }),
    /consumer_v2_observation_tuple_invalid/,
  );
});

void test("consumer v2 rejects two revisions for one tuple period", () => {
  const payload = validPayload();
  const first = payload.observations[0] ?? assert.fail("missing observation");
  const observations = [
    ...payload.observations,
    { ...first, revision_number: 2 },
  ].sort(compareConsumerV2FixtureObservations);

  assert.throws(
    () => ConsumerV2PayloadSchema.parse({ ...payload, observations }),
    /consumer_v2_tuple_period_revision_duplicate/,
  );
});

void test("consumer v2 rejects any altered observation total", () => {
  const payload = validPayload();

  assert.throws(
    () => ConsumerV2PayloadSchema.parse({
      ...payload,
      observations: payload.observations.slice(0, -1),
    }),
    /consumer_v2_observation_count_invalid:359/,
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
