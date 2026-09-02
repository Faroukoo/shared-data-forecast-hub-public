import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { canonicalJson } from "@data-hub/canonical";
import {
  ERP_SNACK_V2_TUPLES,
  buildErpSnackConsumerV2,
  projectErpSnackV2Observations,
} from "@data-hub/adapters";
import {
  CanonicalObservationSchema,
  ConsumerV2PayloadSchema,
  SCHEMA_VERSION,
  SnapshotIndexSchema,
  type CanonicalObservation,
  type SnapshotIndex,
  type SourceDefinition,
} from "@data-hub/contracts";
import {
  HCP_IPC_2017_OFFICIAL_G1_SOURCE,
  HCP_IPC_2017_SOURCE,
} from "@data-hub/source-registry";

const SNAPSHOT_CREATED_AT = "2026-09-01T12:00:00.000Z";
const SNAPSHOT_ID =
  "9d3b77bbfc0cf05cbc0f2e27f24cfb0b348ce0e5d71b09267fbd7ce67657e226";
const SOURCE_TAG = "data-20260901T120000Z-9d3b77bbfc0c";
const LEGACY_DATASET_ID = `sha256:${"d".repeat(64)}`;
const OFFICIAL_DATASET_ID = `sha256:${"e".repeat(64)}`;
const LEGACY_SOURCE_ID = "hcp-ipc-2017-monthly" as const;
const OFFICIAL_SOURCE_ID = "hcp-ipc-2017-official-g1-monthly" as const;

const EXPECTED_TUPLES = [
  ["food_overall", "ma", "hcp.ipc2017.01", OFFICIAL_SOURCE_ID, "fresh_national_context", "division"],
  ["food_overall", "ma:city:al-hoceima", "hcp.ipc2017.01", LEGACY_SOURCE_ID, "historical_detailed_context", "division"],
  ["food_overall", "ma:city:tetouan", "hcp.ipc2017.01", LEGACY_SOURCE_ID, "historical_detailed_context", "division"],
  ["bread_cereals", "ma", "hcp.ipc2017.0111", LEGACY_SOURCE_ID, "historical_detailed_context", "group_of_products"],
  ["bread_cereals", "ma:city:al-hoceima", "hcp.ipc2017.0111", LEGACY_SOURCE_ID, "historical_detailed_context", "group_of_products"],
  ["bread_cereals", "ma:city:tetouan", "hcp.ipc2017.0111", LEGACY_SOURCE_ID, "historical_detailed_context", "group_of_products"],
  ["fish_seafood", "ma", "hcp.ipc2017.0113", LEGACY_SOURCE_ID, "historical_detailed_context", "group_of_products"],
  ["fish_seafood", "ma:city:al-hoceima", "hcp.ipc2017.0113", LEGACY_SOURCE_ID, "historical_detailed_context", "group_of_products"],
  ["fish_seafood", "ma:city:tetouan", "hcp.ipc2017.0113", LEGACY_SOURCE_ID, "historical_detailed_context", "group_of_products"],
  ["oils_fats", "ma", "hcp.ipc2017.0115", LEGACY_SOURCE_ID, "historical_detailed_context", "group_of_products"],
  ["oils_fats", "ma:city:al-hoceima", "hcp.ipc2017.0115", LEGACY_SOURCE_ID, "historical_detailed_context", "group_of_products"],
  ["oils_fats", "ma:city:tetouan", "hcp.ipc2017.0115", LEGACY_SOURCE_ID, "historical_detailed_context", "group_of_products"],
  ["vegetables", "ma", "hcp.ipc2017.0117", LEGACY_SOURCE_ID, "historical_detailed_context", "group_of_products"],
  ["vegetables", "ma:city:al-hoceima", "hcp.ipc2017.0117", LEGACY_SOURCE_ID, "historical_detailed_context", "group_of_products"],
  ["vegetables", "ma:city:tetouan", "hcp.ipc2017.0117", LEGACY_SOURCE_ID, "historical_detailed_context", "group_of_products"],
] as const;

type RequiredSourceId = typeof LEGACY_SOURCE_ID | typeof OFFICIAL_SOURCE_ID;

function monthPeriod(
  sourceId: RequiredSourceId,
  offset: number,
): { start: string; end: string } {
  const firstYear = sourceId === OFFICIAL_SOURCE_ID ? 2024 : 2022;
  const firstMonthIndex = sourceId === OFFICIAL_SOURCE_ID ? 7 : 10;
  const absoluteMonth = firstMonthIndex + offset;
  const year = firstYear + Math.floor(absoluteMonth / 12);
  const monthIndex = absoluteMonth % 12;
  const month = String(monthIndex + 1).padStart(2, "0");
  const lastDay = String(new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate())
    .padStart(2, "0");
  return {
    start: `${String(year)}-${month}-01`,
    end: `${String(year)}-${month}-${lastDay}`,
  };
}

function observation(input: {
  seriesKey: string;
  locationKey: string;
  monthOffset: number;
  sourceId: RequiredSourceId;
  qualityStatus?: "accepted" | "accepted_with_warning" | "quarantined";
}): CanonicalObservation {
  const period = monthPeriod(input.sourceId, input.monthOffset);
  const qualityStatus = input.qualityStatus ?? "accepted";
  return CanonicalObservationSchema.parse({
    schema_version: SCHEMA_VERSION,
    observation_id: `sha256:${input.sourceId}|${input.seriesKey}|${input.locationKey}|${period.start}`,
    natural_key: `${input.seriesKey}|${input.locationKey}|${period.start.slice(0, 7)}`,
    series_key: input.seriesKey,
    source_series_label: `Libellé ${input.seriesKey}`,
    period_start: period.start,
    period_end: period.end,
    frequency: "monthly",
    value: String(100 + input.monthOffset),
    unit: "index",
    currency: null,
    scaling_factor: "1",
    geography_type: input.locationKey === "ma" ? "country" : "city",
    location_key: input.locationKey,
    source_id: input.sourceId,
    artifact_sha256:
      input.sourceId === OFFICIAL_SOURCE_ID ? "b".repeat(64) : "a".repeat(64),
    source_row: input.monthOffset + 1,
    source_column: 4,
    retrieved_at: SNAPSHOT_CREATED_AT,
    source_published_at: null,
    quality_status: qualityStatus,
    warning_codes:
      qualityStatus === "accepted_with_warning" ? ["source_stale"] : [],
    revision_number: 1,
    supersedes_observation_id: null,
  });
}

function completeObservationsBySource(): Map<string, CanonicalObservation[]> {
  const rows = new Map<string, CanonicalObservation[]>([
    [LEGACY_SOURCE_ID, []],
    [OFFICIAL_SOURCE_ID, []],
  ]);
  for (const tuple of EXPECTED_TUPLES) {
    const [, locationKey, seriesKey, sourceId] = tuple;
    const destination = rows.get(sourceId) ?? assert.fail(`missing ${sourceId}`);
    for (let monthOffset = 0; monthOffset < 25; monthOffset += 1) {
      destination.push(observation({
        seriesKey,
        locationKey,
        monthOffset,
        sourceId,
        qualityStatus:
          sourceId === LEGACY_SOURCE_ID && monthOffset === 24
            ? "accepted_with_warning"
            : "accepted",
      }));
    }
  }

  rows.get(LEGACY_SOURCE_ID)?.push(
    observation({
      seriesKey: "hcp.ipc2017.01",
      locationKey: "ma",
      monthOffset: 24,
      sourceId: LEGACY_SOURCE_ID,
    }),
    observation({
      seriesKey: "hcp.ipc2017.0115",
      locationKey: "ma:city:casablanca",
      monthOffset: 24,
      sourceId: LEGACY_SOURCE_ID,
    }),
  );
  rows.get(OFFICIAL_SOURCE_ID)?.push(
    observation({
      seriesKey: "hcp.ipc2017.0111",
      locationKey: "ma",
      monthOffset: 24,
      sourceId: OFFICIAL_SOURCE_ID,
    }),
  );
  return rows;
}

function snapshot(overrides: Partial<SnapshotIndex> = {}): SnapshotIndex {
  return SnapshotIndexSchema.parse({
    schema_version: SCHEMA_VERSION,
    snapshot_id: SNAPSHOT_ID,
    created_at: SNAPSHOT_CREATED_AT,
    code_sha: "c".repeat(40),
    previous_snapshot_tag: null,
    archive: {
      name: `data-hub-${"f".repeat(64)}.tar.gz`,
      byte_length: 1,
      sha256: "f".repeat(64),
    },
    manifest_sha256: "9".repeat(64),
    sources: [
      {
        source_id: LEGACY_SOURCE_ID,
        run_id: `run:${LEGACY_SOURCE_ID}`,
        state: "published",
        artifact_sha256: "a".repeat(64),
        dataset_id: LEGACY_DATASET_ID,
        health_status: "stale",
        warning_codes: ["source_stale"],
        failure_code: null,
      },
      {
        source_id: OFFICIAL_SOURCE_ID,
        run_id: `run:${OFFICIAL_SOURCE_ID}`,
        state: "published",
        artifact_sha256: "b".repeat(64),
        dataset_id: OFFICIAL_DATASET_ID,
        health_status: "healthy",
        warning_codes: [],
        failure_code: null,
      },
    ],
    dataset_ids: [LEGACY_DATASET_ID, OFFICIAL_DATASET_ID],
    contains_confidential_data: false,
    ...overrides,
  });
}

function sources(): SourceDefinition[] {
  return [HCP_IPC_2017_SOURCE, HCP_IPC_2017_OFFICIAL_G1_SOURCE];
}

void test("defines the literal fifteen-cell matrix with one official national food tuple", () => {
  assert.deepEqual(
    ERP_SNACK_V2_TUPLES.map((tuple) => [
      tuple.category,
      tuple.locationKey,
      tuple.seriesKey,
      tuple.sourceId,
      tuple.contextRole,
      tuple.granularity,
    ]),
    EXPECTED_TUPLES,
  );
  assert.equal(
    new Set(ERP_SNACK_V2_TUPLES.map((tuple) => `${tuple.category}|${tuple.locationKey}`)).size,
    15,
  );
  assert.deepEqual(
    ERP_SNACK_V2_TUPLES
      .filter((tuple) => tuple.sourceId === OFFICIAL_SOURCE_ID)
      .map((tuple) => `${tuple.category}|${tuple.locationKey}`),
    ["food_overall|ma"],
  );
  assert.equal(
    ERP_SNACK_V2_TUPLES.filter((tuple) => tuple.sourceId === LEGACY_SOURCE_ID).length,
    14,
  );
});

void test("projects the latest 24 observations for every exact tuple", () => {
  const payload = projectErpSnackV2Observations({
    observationsBySource: completeObservationsBySource(),
    snapshot: snapshot(),
    sources: sources(),
  });

  assert.equal(payload.source_snapshot_tag, SOURCE_TAG);
  assert.deepEqual(payload.sources.map((source) => source.source_id), [
    LEGACY_SOURCE_ID,
    OFFICIAL_SOURCE_ID,
  ]);
  assert.equal(payload.observations.length, 360);
  for (const tuple of EXPECTED_TUPLES) {
    const [category, locationKey, seriesKey, sourceId, contextRole, granularity] = tuple;
    const selected = payload.observations.filter(
      (row) => row.category === category && row.location_key === locationKey,
    );
    assert.equal(selected.length, 24, `${category}|${locationKey}`);
    assert.equal(selected[0]?.period_start, sourceId === OFFICIAL_SOURCE_ID ? "2024-09-01" : "2022-12-01");
    assert.equal(selected.at(-1)?.period_end, sourceId === OFFICIAL_SOURCE_ID ? "2026-08-31" : "2024-11-30");
    assert.equal(selected.every((row) => row.series_key === seriesKey), true);
    assert.equal(selected.every((row) => row.source_id === sourceId), true);
    assert.equal(selected.every((row) => row.context_role === contextRole), true);
    assert.equal(selected.every((row) => row.granularity === granularity), true);
  }
  assert.equal(payload.generated_at, SNAPSHOT_CREATED_AT);
  assert.equal(payload.coverage_start, "2022-12-01");
  assert.equal(payload.coverage_end, "2026-08-31");
  assert.equal(payload.sources[0]?.licence_id, "ODbL-1.0");
  assert.equal(payload.sources[0].health_status, "stale");
  assert.equal(payload.sources[1]?.licence_id, "CC-BY-4.0");
  assert.equal(payload.sources[1].health_status, "healthy");
  ConsumerV2PayloadSchema.parse(payload);
});

void test("is byte deterministic across source, row and wall-clock order", () => {
  const rows = completeObservationsBySource();
  const originalNow = Date.now;
  try {
    Date.now = () => Date.parse("2031-01-01T00:00:00.000Z");
    const first = projectErpSnackV2Observations({
      observationsBySource: rows,
      snapshot: snapshot(),
      sources: sources(),
    });
    Date.now = () => Date.parse("2042-12-31T23:59:59.999Z");
    const reversed = projectErpSnackV2Observations({
      observationsBySource: new Map(
        [...rows.entries()].reverse().map(([sourceId, observations]) => [
          sourceId,
          [...observations].reverse(),
        ]),
      ),
      snapshot: snapshot(),
      sources: [...sources()].reverse(),
    });

    assert.equal(canonicalJson(first), canonicalJson(reversed));
  } finally {
    Date.now = originalNow;
  }
});

void test("fails closed with stable codes for either missing dataset or one missing tuple", () => {
  for (const sourceId of [LEGACY_SOURCE_ID, OFFICIAL_SOURCE_ID]) {
    const rows = completeObservationsBySource();
    rows.delete(sourceId);
    assert.throws(
      () => projectErpSnackV2Observations({
        observationsBySource: rows,
        snapshot: snapshot(),
        sources: sources(),
      }),
      new RegExp(`consumer_v2_dataset_missing:${sourceId}`),
    );
  }

  const rows = completeObservationsBySource();
  const missing = EXPECTED_TUPLES.at(-1) ?? assert.fail("missing tuple fixture");
  const [, locationKey, seriesKey, sourceId] = missing;
  rows.set(
    sourceId,
    (rows.get(sourceId) ?? []).filter(
      (row) => row.series_key !== seriesKey || row.location_key !== locationKey,
    ),
  );
  assert.throws(
    () => projectErpSnackV2Observations({
      observationsBySource: rows,
      snapshot: snapshot(),
      sources: sources(),
    }),
    /consumer_v2_profile_tuple_missing:vegetables\|ma:city:tetouan/,
  );
});

void test("rejects unexpected source inputs and snapshot dataset mismatches", () => {
  const unexpectedRows = completeObservationsBySource();
  unexpectedRows.set("hcp-ipp-2018-monthly", []);
  assert.throws(
    () => projectErpSnackV2Observations({
      observationsBySource: unexpectedRows,
      snapshot: snapshot(),
      sources: sources(),
    }),
    /consumer_v2_dataset_unexpected:hcp-ipp-2018-monthly/,
  );
  assert.throws(
    () => projectErpSnackV2Observations({
      observationsBySource: completeObservationsBySource(),
      snapshot: snapshot(),
      sources: [HCP_IPC_2017_SOURCE],
    }),
    /consumer_v2_source_missing:hcp-ipc-2017-official-g1-monthly/,
  );

  const missingOfficialDataset = snapshot({
    sources: snapshot().sources.map((source) =>
      source.source_id === OFFICIAL_SOURCE_ID
        ? { ...source, dataset_id: null }
        : source,
    ),
  });
  assert.throws(
    () => projectErpSnackV2Observations({
      observationsBySource: completeObservationsBySource(),
      snapshot: missingOfficialDataset,
      sources: sources(),
    }),
    /consumer_v2_snapshot_dataset_missing:hcp-ipc-2017-official-g1-monthly/,
  );
});

async function malformedDataDir(t: TestContext): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), "erp-snack-consumer-v2-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await mkdir(join(dataDir, "published"), { recursive: true });
  await writeFile(join(dataDir, "published", "unexpected.txt"), "unverified\n");
  return dataDir;
}

void test("validates the data hub state before loading snapshot datasets", async (t) => {
  const dataDir = await malformedDataDir(t);
  await assert.rejects(
    () => buildErpSnackConsumerV2({
      dataDir,
      snapshot: snapshot(),
      sourceTag: SOURCE_TAG,
    }),
    /unexpected_data_hub_file:published\/unexpected.txt/,
  );
});
