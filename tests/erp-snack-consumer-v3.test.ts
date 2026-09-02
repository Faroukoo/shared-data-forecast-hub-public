import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { canonicalJson } from "@data-hub/canonical";
import {
  ERP_SNACK_V3_TUPLES,
  buildErpSnackConsumerV3,
  projectErpSnackV3Observations,
} from "@data-hub/adapters";
import {
  CanonicalObservationSchema,
  ConsumerV3PayloadSchema,
  SCHEMA_VERSION,
  SnapshotIndexSchema,
  type CanonicalObservation,
  type SnapshotIndex,
  type SourceDefinition,
} from "@data-hub/contracts";
import { HCP_IPC_2017_OFFICIAL_G1_SOURCE } from "@data-hub/source-registry";

import { runRemoteIngestion } from "../apps/ingest-cli/src/run-ingestion.js";
import { createHcpOfficialIpcFixture } from "./fixture-workbooks.js";
import {
  V3_GENERATED_AT,
  V3_SNAPSHOT_ID,
  V3_SNAPSHOT_TAG,
  V3_SOURCE_ID,
} from "./consumer-v3-fixture.js";

const DATASET_ID = `sha256:${"e".repeat(64)}`;
const PERIODS = [
  ["2024-08-01", "2024-08-31", "100"],
  ["2024-09-01", "2024-09-30", "101"],
  ["2024-10-01", "2024-10-31", "102"],
  ["2024-11-01", "2024-11-30", "103"],
  ["2024-12-01", "2024-12-31", "104"],
  ["2025-01-01", "2025-01-31", "105"],
  ["2025-02-01", "2025-02-28", "106"],
  ["2025-03-01", "2025-03-31", "107"],
  ["2025-04-01", "2025-04-30", "108"],
  ["2025-05-01", "2025-05-31", "109"],
  ["2025-06-01", "2025-06-30", "110"],
  ["2025-07-01", "2025-07-31", "111"],
  ["2025-08-01", "2025-08-31", "112"],
  ["2025-09-01", "2025-09-30", "113"],
  ["2025-10-01", "2025-10-31", "114"],
  ["2025-11-01", "2025-11-30", "115"],
  ["2025-12-01", "2025-12-31", "116"],
  ["2026-01-01", "2026-01-31", "117"],
  ["2026-02-01", "2026-02-28", "118"],
  ["2026-03-01", "2026-03-31", "119"],
  ["2026-04-01", "2026-04-30", "120"],
  ["2026-05-01", "2026-05-31", "121"],
  ["2026-06-01", "2026-06-30", "122"],
  ["2026-07-01", "2026-07-31", "123"],
  ["2026-08-01", "2026-08-31", "124"],
] as const;

function observation(input: {
  periodIndex: number;
  seriesKey?: string;
  locationKey?: string;
  sourceId?: string;
  revisionNumber?: number;
  value?: string;
  qualityStatus?: "accepted" | "accepted_with_warning" | "quarantined";
}): CanonicalObservation {
  const period = PERIODS[input.periodIndex] ?? assert.fail("missing period");
  const sourceId = input.sourceId ?? V3_SOURCE_ID;
  const seriesKey = input.seriesKey ?? "hcp.ipc2017.01";
  const locationKey = input.locationKey ?? "ma";
  const revisionNumber = input.revisionNumber ?? 1;
  const qualityStatus = input.qualityStatus ?? "accepted";
  return CanonicalObservationSchema.parse({
    schema_version: SCHEMA_VERSION,
    observation_id: `sha256:${sourceId}|${seriesKey}|${locationKey}|${period[0]}|${String(revisionNumber)}`,
    natural_key: `${seriesKey}|${locationKey}|${period[0].slice(0, 7)}`,
    series_key: seriesKey,
    source_series_label: "Produits alimentaires",
    period_start: period[0],
    period_end: period[1],
    frequency: "monthly",
    value: input.value ?? period[2],
    unit: "index",
    currency: null,
    scaling_factor: "1",
    geography_type: locationKey === "ma" ? "country" : "city",
    location_key: locationKey,
    source_id: sourceId,
    artifact_sha256: "c".repeat(64),
    source_row: input.periodIndex + 1,
    source_column: 4,
    retrieved_at: V3_GENERATED_AT,
    source_published_at: null,
    quality_status: qualityStatus,
    warning_codes: qualityStatus === "accepted_with_warning" ? ["source_late"] : [],
    revision_number: revisionNumber,
    supersedes_observation_id: revisionNumber === 1 ? null : `sha256:prior-${period[0]}`,
  });
}

function observations(): CanonicalObservation[] {
  const rows = PERIODS.map((_, periodIndex) => observation({ periodIndex }));
  rows.push(
    observation({ periodIndex: 24, seriesKey: "hcp.ipc2017.0111" }),
    observation({ periodIndex: 24, locationKey: "ma:city:casablanca" }),
    observation({ periodIndex: 24, sourceId: "hcp-ipc-2017-monthly" }),
    observation({ periodIndex: 24, qualityStatus: "quarantined" }),
  );
  return rows;
}

function snapshot(overrides: Partial<SnapshotIndex> = {}): SnapshotIndex {
  return SnapshotIndexSchema.parse({
    schema_version: SCHEMA_VERSION,
    snapshot_id: V3_SNAPSHOT_ID,
    created_at: V3_GENERATED_AT,
    code_sha: "d".repeat(40),
    previous_snapshot_tag: null,
    archive: {
      name: `data-hub-${"f".repeat(64)}.tar.gz`,
      byte_length: 1,
      sha256: "f".repeat(64),
    },
    manifest_sha256: "9".repeat(64),
    sources: [{
      source_id: V3_SOURCE_ID,
      run_id: `run:${V3_SOURCE_ID}`,
      state: "published",
      artifact_sha256: "c".repeat(64),
      dataset_id: DATASET_ID,
      health_status: "healthy",
      warning_codes: [],
      failure_code: null,
    }],
    dataset_ids: [DATASET_ID],
    contains_confidential_data: false,
    ...overrides,
  });
}

function project(rows = observations(), source = HCP_IPC_2017_OFFICIAL_G1_SOURCE) {
  return projectErpSnackV3Observations({
    observationsBySource: new Map([[V3_SOURCE_ID, rows]]),
    snapshot: snapshot(),
    sources: [source],
  });
}

void test("v3 profile is the contract-owned single national food tuple", async () => {
  const contracts = await import("@data-hub/contracts") as unknown as {
    CONSUMER_V3_TUPLES?: unknown;
  };
  assert.equal(ERP_SNACK_V3_TUPLES, contracts.CONSUMER_V3_TUPLES);
  assert.deepEqual(ERP_SNACK_V3_TUPLES, [{
    category: "food_overall",
    locationKey: "ma",
    seriesKey: "hcp.ipc2017.01",
    sourceId: V3_SOURCE_ID,
    contextRole: "fresh_national_context",
    granularity: "division",
    geographyType: "country",
  }]);
});

void test("projects only the latest 24 official national food months", () => {
  const payload = project();
  assert.equal(payload.source_snapshot_tag, V3_SNAPSHOT_TAG);
  assert.deepEqual(payload.sources.map((source) => source.source_id), [V3_SOURCE_ID]);
  assert.deepEqual(payload.business_context, {
    operating_location_key: "ma:city:casablanca",
    procurement_location_mode: "erp_observed_only",
  });
  assert.equal(payload.observations.length, 24);
  assert.equal(payload.observations[0]?.period_start, "2024-09-01");
  assert.equal(payload.observations.at(-1)?.period_end, "2026-08-31");
  assert.deepEqual(
    [...new Set(payload.observations.map((row) =>
      `${row.series_key}|${row.location_key}|${row.source_id}`,
    ))],
    ["hcp.ipc2017.01|ma|hcp-ipc-2017-official-g1-monthly"],
  );
  assert.equal(payload.coverage_start, "2024-09-01");
  assert.equal(payload.coverage_end, "2026-08-31");
  ConsumerV3PayloadSchema.parse(payload);
});

void test("selects the highest revision and stays byte deterministic", () => {
  const rows = observations();
  rows.push(observation({ periodIndex: 24, revisionNumber: 2, value: "999" }));
  const first = project(rows);
  const reversed = project([...rows].reverse());
  assert.equal(first.observations.at(-1)?.revision_number, 2);
  assert.equal(first.observations.at(-1)?.value, "999");
  assert.equal(canonicalJson(first), canonicalJson(reversed));
});

void test("rejects missing, unexpected and incomplete canonical datasets", () => {
  assert.throws(() => projectErpSnackV3Observations({
    observationsBySource: new Map(),
    snapshot: snapshot(),
    sources: [HCP_IPC_2017_OFFICIAL_G1_SOURCE],
  }), /consumer_v3_dataset_missing/);
  assert.throws(() => projectErpSnackV3Observations({
    observationsBySource: new Map([
      [V3_SOURCE_ID, observations()],
      ["hcp-ipc-2017-monthly", []],
    ]),
    snapshot: snapshot(),
    sources: [HCP_IPC_2017_OFFICIAL_G1_SOURCE],
  }), /consumer_v3_dataset_unexpected:hcp-ipc-2017-monthly/);
  assert.throws(() => project(observations().filter((row) => row.period_start >= "2024-10-01")), /consumer_v3_profile_history_incomplete:23/);
});

void test("rejects duplicate revisions for the selected tuple period", () => {
  const rows = observations();
  rows.push({ ...observation({ periodIndex: 24 }), observation_id: "sha256:duplicate" });
  assert.throws(() => project(rows), /consumer_v3_period_revision_duplicate/);
});

void test("rejects unexpected metadata on selected canonical observations", () => {
  const mutations: ReadonlyArray<Partial<CanonicalObservation>> = [
    { frequency: "annual" },
    { unit: "percent" },
    { currency: "MAD" },
    { scaling_factor: "100" },
    { geography_type: "city" },
  ];
  for (const mutation of mutations) {
    const rows = observations();
    const row = rows[1] ?? assert.fail("missing selected observation");
    rows[1] = { ...row, ...mutation };
    assert.throws(() => project(rows), /consumer_v3_observation_metadata_invalid/);
  }
});

const SOURCE_MUTATIONS: ReadonlyArray<{
  name: string;
  mutate: (source: SourceDefinition) => void;
  expected: RegExp;
}> = [
  { name: "disabled", mutate: (source) => { source.enabled = false; }, expected: /consumer_v3_source_not_qualified/ },
  { name: "non-official", mutate: (source) => { source.authority_level = "licensed"; }, expected: /consumer_v3_source_not_qualified/ },
  { name: "redistribution", mutate: (source) => { source.licence.permits_redistribution = false; }, expected: /consumer_v3_redistribution_not_permitted/ },
  { name: "licence", mutate: (source) => { source.licence.id = "ODbL-1.0"; }, expected: /consumer_v3_licence_mismatch/ },
  { name: "licence evidence", mutate: (source) => { source.licence.evidence_url = "https://example.invalid/licence"; }, expected: /consumer_v3_licence_mismatch/ },
  { name: "internal derived use", mutate: (source) => { source.licence.permits_internal_derived_use = false; }, expected: /consumer_v3_licence_mismatch/ },
  { name: "publisher", mutate: (source) => { source.publisher_name = "Other"; }, expected: /consumer_v3_source_not_qualified/ },
  { name: "official URL", mutate: (source) => { source.official_base_url = "https://example.invalid/official"; }, expected: /consumer_v3_source_not_qualified/ },
  { name: "cadence", mutate: (source) => { source.cadence.warning_age_days = 61; }, expected: /consumer_v3_source_not_qualified/ },
  { name: "connector", mutate: (source) => {
    if (source.connector.kind !== "google-sheets-xlsx") assert.fail("wrong connector");
    source.connector.sheet_gid = "1240277578";
  }, expected: /consumer_v3_source_not_qualified/ },
  { name: "parser", mutate: (source) => {
    if (source.parser.kind !== "hcp-official-indicator-workbook") assert.fail("wrong parser");
    source.parser.profile = "ipc-2017-official-g2";
  }, expected: /consumer_v3_source_not_qualified/ },
  { name: "geography", mutate: (source) => { source.geography_scope = ["country", "city"]; }, expected: /consumer_v3_source_not_qualified/ },
  { name: "series", mutate: (source) => { source.series_scope = ["producer_price_index"]; }, expected: /consumer_v3_source_not_qualified/ },
  { name: "owner", mutate: (source) => { source.owner = "other"; }, expected: /consumer_v3_source_not_qualified/ },
  { name: "recovery", mutate: (source) => { source.recovery_procedure = "docs/other.md"; }, expected: /consumer_v3_source_not_qualified/ },
];

for (const mutation of SOURCE_MUTATIONS) {
  void test(`rejects the official source ${mutation.name} mutation`, () => {
    const source = structuredClone(HCP_IPC_2017_OFFICIAL_G1_SOURCE);
    mutation.mutate(source);
    assert.throws(() => project(observations(), source), mutation.expected);
  });
}

void test("rejects snapshot dataset, state, health and evidence mutations", () => {
  const mutations: ReadonlyArray<[Partial<SnapshotIndex["sources"][number]>, RegExp]> = [
    [{ dataset_id: null }, /consumer_v3_snapshot_dataset_missing/],
    [{ state: "quarantined" }, /consumer_v3_snapshot_source_state_invalid/],
    [{ health_status: "licence_blocked" }, /consumer_v3_snapshot_source_health_invalid/],
    [{ artifact_sha256: null }, /consumer_v3_snapshot_source_evidence_invalid/],
    [{ failure_code: "blocked" }, /consumer_v3_snapshot_source_evidence_invalid/],
  ];
  for (const [changes, expected] of mutations) {
    const source = snapshot().sources[0] ?? assert.fail("missing snapshot source");
    const changed = snapshot({ sources: [{ ...source, ...changes }] });
    assert.throws(() => projectErpSnackV3Observations({
      observationsBySource: new Map([[V3_SOURCE_ID, observations()]]),
      snapshot: changed,
      sources: [HCP_IPC_2017_OFFICIAL_G1_SOURCE],
    }), expected);
  }
});

async function malformedDataDir(t: TestContext): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), "erp-snack-consumer-v3-malformed-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await mkdir(join(dataDir, "published"), { recursive: true });
  await writeFile(join(dataDir, "published", "unexpected.txt"), "unverified\n");
  return dataDir;
}

void test("builder validates Data Hub state before reading canonical JSONL", async (t) => {
  const dataDir = await malformedDataDir(t);
  await assert.rejects(() => buildErpSnackConsumerV3({
    dataDir,
    snapshot: snapshot(),
    sourceTag: V3_SNAPSHOT_TAG,
  }), /unexpected_data_hub_file:published\/unexpected.txt/);
});

void test("builder reads only the verified official snapshot dataset", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "erp-snack-consumer-v3-valid-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const periods = PERIODS.map(([start]) => start.slice(0, 7).replace("-", "/"));
  const workbook = await createHcpOfficialIpcFixture("ipc-2017-official-g1", { periods });
  const run = await runRemoteIngestion({
    sourceId: V3_SOURCE_ID,
    dataDir,
    fetchImpl: () => Promise.resolve(new Response(workbook, {
      status: 200,
      headers: {
        "content-length": String(workbook.byteLength),
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    })),
    now: V3_GENERATED_AT,
  });
  assert.equal(run.state, "published");
  const datasetId = run.dataset_id ?? assert.fail("missing dataset");
  const source = snapshot().sources[0] ?? assert.fail("missing snapshot source");
  const verifiedSnapshot = snapshot({
    sources: [{
      ...source,
      run_id: run.run_id,
      state: run.state,
      artifact_sha256: run.artifact_sha256,
      dataset_id: datasetId,
      failure_code: run.failure_code,
    }],
    dataset_ids: [datasetId],
  });
  const payload = await buildErpSnackConsumerV3({
    dataDir,
    snapshot: verifiedSnapshot,
    sourceTag: V3_SNAPSHOT_TAG,
  });
  assert.equal(payload.observations.length, 24);
  assert.deepEqual(payload.sources.map((source) => source.source_id), [V3_SOURCE_ID]);

  await assert.rejects(() => buildErpSnackConsumerV3({
    dataDir,
    snapshot: snapshot({ dataset_ids: [DATASET_ID] }),
    sourceTag: V3_SNAPSHOT_TAG,
  }), /snapshot_dataset_ids_mismatch/);
});
