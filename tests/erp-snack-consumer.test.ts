import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  CanonicalObservationSchema,
  ConsumerPayloadSchema,
  SCHEMA_VERSION,
  SnapshotIndexSchema,
  type CanonicalObservation,
  type SnapshotIndex,
} from "@data-hub/contracts";
import {
  ERP_SNACK_LOCATIONS,
  ERP_SNACK_SERIES,
  buildErpSnackConsumer,
  projectErpSnackObservations,
} from "@data-hub/adapters";
import { HCP_IPC_2017_SOURCE } from "@data-hub/source-registry";

import { runRemoteIngestion } from "../apps/ingest-cli/src/run-ingestion.js";
import {
  createCkanFetchFixture,
  createIpcFixture,
} from "./fixture-workbooks.js";

const SNAPSHOT_CREATED_AT = "2026-08-27T09:50:54.738Z";
const SNAPSHOT_ID = "9d3b77bbfc0cf05cbc0f2e27f24cfb0b348ce0e5d71b09267fbd7ce67657e226";
const SOURCE_RELEASE_TAG = "data-20260827T095123Z-9d3b77bbfc0c";
const DATASET_ID = `sha256:${"d".repeat(64)}`;
const ARTIFACT_SHA256 = "a".repeat(64);

const expectedSeries = [
  "hcp.ipc2017.01",
  "hcp.ipc2017.0111",
  "hcp.ipc2017.0113",
  "hcp.ipc2017.0115",
  "hcp.ipc2017.0117",
];
const expectedLocations = [
  "ma",
  "ma:city:al-hoceima",
  "ma:city:tetouan",
];

function monthPeriod(offset: number): { start: string; end: string } {
  const year = 2022 + Math.floor((10 + offset) / 12);
  const monthIndex = (10 + offset) % 12;
  const month = String(monthIndex + 1).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0))
    .getUTCDate()
    .toString()
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
  sourceId?: string;
  qualityStatus?: "accepted" | "accepted_with_warning" | "quarantined";
}): CanonicalObservation {
  const period = monthPeriod(input.monthOffset);
  const sourceId = input.sourceId ?? HCP_IPC_2017_SOURCE.source_id;
  const qualityStatus = input.qualityStatus ?? "accepted";
  return CanonicalObservationSchema.parse({
    schema_version: SCHEMA_VERSION,
    observation_id: `sha256:${sourceId}|${input.seriesKey}|${input.locationKey}|${period.start}`,
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
    source_id: sourceId,
    artifact_sha256: ARTIFACT_SHA256,
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

function completeProfileObservations(): CanonicalObservation[] {
  const rows: CanonicalObservation[] = [];
  for (const series of expectedSeries) {
    for (const location of expectedLocations) {
      for (let monthOffset = 0; monthOffset < 25; monthOffset += 1) {
        rows.push(observation({
          seriesKey: series,
          locationKey: location,
          monthOffset,
          qualityStatus:
            monthOffset === 24 ? "accepted_with_warning" : "accepted",
        }));
      }
    }
  }
  rows.push(observation({
    seriesKey: "hcp.ipp2018.total",
    locationKey: "ma",
    monthOffset: 24,
    sourceId: "hcp-ipp-2018-monthly",
  }));
  rows.push(observation({
    seriesKey: "hcp.ipc2017.0115",
    locationKey: "ma:city:casablanca",
    monthOffset: 24,
  }));
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
      name: `data-hub-${"b".repeat(64)}.tar.gz`,
      byte_length: 1,
      sha256: "b".repeat(64),
    },
    manifest_sha256: "e".repeat(64),
    sources: [{
      source_id: HCP_IPC_2017_SOURCE.source_id,
      run_id: "run:hcp-ipc-2017-monthly",
      state: "published",
      artifact_sha256: ARTIFACT_SHA256,
      dataset_id: DATASET_ID,
      health_status: "stale",
      warning_codes: ["source_stale"],
      failure_code: null,
    }],
    dataset_ids: [DATASET_ID],
    contains_confidential_data: false,
    ...overrides,
  });
}

void test("projects the exact deterministic ERP-Snack macro profile", () => {
  const rows = completeProfileObservations();
  const input = {
    observations: rows,
    snapshot: snapshot(),
    source: HCP_IPC_2017_SOURCE,
    sourceTag: SOURCE_RELEASE_TAG,
  };

  const payload = projectErpSnackObservations(input);
  const reversedPayload = projectErpSnackObservations({
    ...input,
    observations: [...rows].reverse(),
  });

  assert.deepEqual(ERP_SNACK_SERIES.map((series) => series.seriesKey), expectedSeries);
  assert.deepEqual([...ERP_SNACK_LOCATIONS], expectedLocations);
  assert.deepEqual(
    [...new Set(payload.observations.map((row) => row.series_key))],
    expectedSeries,
  );
  assert.deepEqual(
    [...new Set(payload.observations.map((row) => row.location_key))],
    expectedLocations,
  );
  assert.equal(payload.observations.length, 5 * 3 * 24);
  assert.equal(payload.observations.some((row) => row.series_key.startsWith("hcp.ipp")), false);
  assert.equal(payload.observations.some((row) => row.location_key.includes("casablanca")), false);
  assert.equal(payload.coverage_start, "2022-12-01");
  assert.equal(payload.coverage_end, "2024-11-30");
  assert.equal(payload.generated_at, SNAPSHOT_CREATED_AT);
  assert.equal(payload.source_snapshot_tag, SOURCE_RELEASE_TAG);
  const payloadSource = payload.sources[0] ?? assert.fail("missing payload source");
  assert.equal(payloadSource.health_status, "stale");
  assert.equal(payloadSource.age_days_at_snapshot, 635);
  assert.deepEqual(payloadSource.warning_codes, ["source_stale"]);
  assert.equal(JSON.stringify(payload), JSON.stringify(reversedPayload));
  ConsumerPayloadSchema.parse(payload);
});

void test("binds the authoritative source release tag to the snapshot suffix", () => {
  const input = {
    observations: completeProfileObservations(),
    snapshot: snapshot(),
    source: HCP_IPC_2017_SOURCE,
  };

  assert.throws(
    () => projectErpSnackObservations({ ...input, sourceTag: "latest" }),
    /consumer_source_tag_invalid/,
  );
  assert.throws(
    () => projectErpSnackObservations({
      ...input,
      sourceTag: "data-20260827T095123Z-aaaaaaaaaaaa",
    }),
    /consumer_source_tag_snapshot_mismatch/,
  );
});

void test("rejects a profile missing one exact series and location tuple", () => {
  const rows = completeProfileObservations().filter(
    (row) => !(row.series_key === "hcp.ipc2017.0117" && row.location_key === "ma:city:tetouan"),
  );

  assert.throws(
    () => projectErpSnackObservations({
      observations: rows,
      snapshot: snapshot(),
      source: HCP_IPC_2017_SOURCE,
      sourceTag: SOURCE_RELEASE_TAG,
    }),
    /consumer_profile_series_missing/,
  );
});

async function incompleteFixture(t: TestContext): Promise<{
  dataDir: string;
  snapshot: SnapshotIndex;
  artifactManifestPath: string;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "erp-snack-consumer-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const run = await runRemoteIngestion({
    sourceId: HCP_IPC_2017_SOURCE.source_id,
    dataDir,
    fetchImpl: createCkanFetchFixture(await createIpcFixture()),
    now: SNAPSHOT_CREATED_AT,
  });
  assert.equal(run.state, "published");
  const artifactSha256 = run.artifact_sha256 ?? assert.fail("missing artifact");
  const datasetId = run.dataset_id ?? assert.fail("missing dataset");
  return {
    dataDir,
    artifactManifestPath: join(
      dataDir,
      "manifests",
      "artifacts",
      `${artifactSha256}.json`,
    ),
    snapshot: snapshot({
      sources: [{
        source_id: HCP_IPC_2017_SOURCE.source_id,
        run_id: run.run_id,
        state: run.state,
        artifact_sha256: artifactSha256,
        dataset_id: datasetId,
        health_status: "stale",
        warning_codes: ["source_stale"],
        failure_code: null,
      }],
      dataset_ids: [datasetId],
    }),
  };
}

void test("validates the restored state before projecting an incomplete fixture", async (t) => {
  const fixture = await incompleteFixture(t);

  await assert.rejects(
    () => buildErpSnackConsumer({
      dataDir: fixture.dataDir,
      snapshot: fixture.snapshot,
      sourceTag: SOURCE_RELEASE_TAG,
    }),
    /consumer_profile_series_missing/,
  );
});

void test("rejects unqualified source and licence state before projection", async (t) => {
  const fixture = await incompleteFixture(t);
  const originalAuthority = HCP_IPC_2017_SOURCE.authority_level;
  const originalEnabled = HCP_IPC_2017_SOURCE.enabled;
  const originalRedistribution = HCP_IPC_2017_SOURCE.licence.permits_redistribution;

  try {
    HCP_IPC_2017_SOURCE.authority_level = "licensed";
    await assert.rejects(
      () => buildErpSnackConsumer({
        dataDir: fixture.dataDir,
        snapshot: fixture.snapshot,
        sourceTag: SOURCE_RELEASE_TAG,
      }),
      /source_not_qualified/,
    );
    HCP_IPC_2017_SOURCE.authority_level = originalAuthority;

    HCP_IPC_2017_SOURCE.enabled = false;
    await assert.rejects(
      () => buildErpSnackConsumer({
        dataDir: fixture.dataDir,
        snapshot: fixture.snapshot,
        sourceTag: SOURCE_RELEASE_TAG,
      }),
      /source_not_qualified/,
    );
    HCP_IPC_2017_SOURCE.enabled = originalEnabled;

    HCP_IPC_2017_SOURCE.licence.permits_redistribution = false;
    await assert.rejects(
      () => buildErpSnackConsumer({
        dataDir: fixture.dataDir,
        snapshot: fixture.snapshot,
        sourceTag: SOURCE_RELEASE_TAG,
      }),
      /redistribution_not_permitted/,
    );
  } finally {
    HCP_IPC_2017_SOURCE.authority_level = originalAuthority;
    HCP_IPC_2017_SOURCE.enabled = originalEnabled;
    HCP_IPC_2017_SOURCE.licence.permits_redistribution = originalRedistribution;
  }

  const artifactManifest = JSON.parse(
    await readFile(fixture.artifactManifestPath, "utf8"),
  ) as { licence_snapshot: { permits_redistribution: boolean } };
  artifactManifest.licence_snapshot.permits_redistribution = false;
  await writeFile(
    fixture.artifactManifestPath,
    `${JSON.stringify(artifactManifest, null, 2)}\n`,
  );
  await assert.rejects(
    () => buildErpSnackConsumer({
      dataDir: fixture.dataDir,
      snapshot: fixture.snapshot,
      sourceTag: SOURCE_RELEASE_TAG,
    }),
    /artifact_source_mismatch/,
  );
});
