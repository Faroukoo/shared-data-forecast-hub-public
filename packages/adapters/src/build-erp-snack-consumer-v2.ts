import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalJson } from "@data-hub/canonical";
import {
  CONSUMER_V2_CONTRACT,
  CONSUMER_V2_PROFILE,
  CanonicalObservationSchema,
  ConsumerV2PayloadSchema,
  SCHEMA_VERSION,
  type CanonicalObservation,
  type ConsumerV2Observation,
  type ConsumerV2Payload,
  type SnapshotIndex,
  type SourceDefinition,
} from "@data-hub/contracts";
import { validateDataHubState } from "@data-hub/snapshot";
import {
  HCP_IPC_2017_OFFICIAL_G1_SOURCE,
  HCP_IPC_2017_SOURCE,
} from "@data-hub/source-registry";

import { ERP_SNACK_SERIES } from "./erp-snack-profile.js";
import {
  ERP_SNACK_V2_TUPLES,
  type ErpSnackV2Tuple,
} from "./erp-snack-profile-v2.js";

const DAY_MS = 86_400_000;
const SOURCE_TAG_PATTERN = /^data-\d{8}T\d{6}Z-[a-f0-9]{12}$/;
const REQUIRED_SOURCE_IDS = [
  "hcp-ipc-2017-monthly",
  "hcp-ipc-2017-official-g1-monthly",
] as const;
const REGISTERED_SOURCE_BY_ID = new Map([
  [HCP_IPC_2017_SOURCE.source_id, HCP_IPC_2017_SOURCE],
  [
    HCP_IPC_2017_OFFICIAL_G1_SOURCE.source_id,
    HCP_IPC_2017_OFFICIAL_G1_SOURCE,
  ],
]);
const ADMISSIBLE_SNAPSHOT_STATES = new Set(["published", "no_change"]);
const ADMISSIBLE_SOURCE_HEALTH = new Set(["healthy", "late", "stale"]);

type RequiredSourceId = (typeof REQUIRED_SOURCE_IDS)[number];
type AdmittedCanonicalObservation = CanonicalObservation & {
  quality_status: ConsumerV2Observation["quality_status"];
};

export interface BuildErpSnackConsumerV2Input {
  dataDir: string;
  snapshot: SnapshotIndex;
  sourceTag: string;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function observationOrder(
  left: Pick<
    ConsumerV2Observation,
    "series_key" | "location_key" | "period_start" | "revision_number"
  >,
  right: Pick<
    ConsumerV2Observation,
    "series_key" | "location_key" | "period_start" | "revision_number"
  >,
): number {
  return (
    compareCodeUnits(left.series_key, right.series_key) ||
    compareCodeUnits(left.location_key, right.location_key) ||
    compareCodeUnits(left.period_start, right.period_start) ||
    left.revision_number - right.revision_number
  );
}

function validateSourceTag(sourceTag: string, snapshot: SnapshotIndex): string {
  if (!SOURCE_TAG_PATTERN.test(sourceTag)) {
    throw new Error("consumer_source_tag_invalid");
  }
  if (sourceTag.slice(-12) !== snapshot.snapshot_id.slice(0, 12)) {
    throw new Error("consumer_source_tag_snapshot_mismatch");
  }
  return sourceTag;
}

function sourceTagFromSnapshot(snapshot: SnapshotIndex): string {
  const timestamp = new Date(snapshot.created_at)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `data-${timestamp}-${snapshot.snapshot_id.slice(0, 12)}`;
}

function isRequiredSourceId(value: string): value is RequiredSourceId {
  return REQUIRED_SOURCE_IDS.some((sourceId) => sourceId === value);
}

function isAdmittedObservation(
  observation: CanonicalObservation,
): observation is AdmittedCanonicalObservation {
  return (
    observation.quality_status === "accepted" ||
    observation.quality_status === "accepted_with_warning"
  );
}

function ageDaysAtSnapshot(periodEnd: string, createdAt: string): number {
  const age = Math.floor(
    (Date.parse(createdAt) - Date.parse(`${periodEnd}T00:00:00.000Z`)) /
      DAY_MS,
  );
  if (age < 0) throw new Error("snapshot_precedes_observation");
  return age;
}

function sourceFreshness(
  source: SourceDefinition,
  ageDays: number,
): { healthStatus: "healthy" | "late" | "stale"; warningCode: string | null } {
  if (ageDays > source.cadence.expiry_age_days) {
    return { healthStatus: "stale", warningCode: "source_stale" };
  }
  if (ageDays > source.cadence.warning_age_days) {
    return { healthStatus: "late", warningCode: "source_late" };
  }
  return { healthStatus: "healthy", warningCode: null };
}

function exactSources(
  sources: readonly SourceDefinition[],
): ReadonlyMap<RequiredSourceId, SourceDefinition> {
  const byId = new Map<RequiredSourceId, SourceDefinition>();
  for (const source of sources) {
    if (!isRequiredSourceId(source.source_id)) {
      throw new Error(`consumer_v2_source_unexpected:${source.source_id}`);
    }
    if (byId.has(source.source_id)) {
      throw new Error(`consumer_v2_source_duplicate:${source.source_id}`);
    }
    if (
      source.authority_level !== "official" ||
      !source.enabled ||
      source.access_mode === "disabled"
    ) {
      throw new Error(`consumer_v2_source_not_qualified:${source.source_id}`);
    }
    if (!source.licence.permits_redistribution) {
      throw new Error(
        `consumer_v2_redistribution_not_permitted:${source.source_id}`,
      );
    }
    const registeredSource = REGISTERED_SOURCE_BY_ID.get(source.source_id);
    if (
      !registeredSource ||
      source.licence.id !== registeredSource.licence.id ||
      source.licence.evidence_url !==
        registeredSource.licence.evidence_url ||
      source.licence.permits_internal_derived_use !==
        registeredSource.licence.permits_internal_derived_use
    ) {
      throw new Error(`consumer_v2_licence_mismatch:${source.source_id}`);
    }
    if (canonicalJson(source) !== canonicalJson(registeredSource)) {
      throw new Error(`consumer_v2_source_not_qualified:${source.source_id}`);
    }
    byId.set(source.source_id, registeredSource);
  }
  for (const sourceId of REQUIRED_SOURCE_IDS) {
    if (!byId.has(sourceId)) {
      throw new Error(`consumer_v2_source_missing:${sourceId}`);
    }
  }
  return byId;
}

function exactObservationDatasets(
  observationsBySource: ReadonlyMap<
    string,
    readonly CanonicalObservation[]
  >,
): ReadonlyMap<RequiredSourceId, readonly CanonicalObservation[]> {
  for (const sourceId of observationsBySource.keys()) {
    if (!isRequiredSourceId(sourceId)) {
      throw new Error(`consumer_v2_dataset_unexpected:${sourceId}`);
    }
  }
  const datasets = new Map<
    RequiredSourceId,
    readonly CanonicalObservation[]
  >();
  for (const sourceId of REQUIRED_SOURCE_IDS) {
    const observations = observationsBySource.get(sourceId);
    if (!observations) {
      throw new Error(`consumer_v2_dataset_missing:${sourceId}`);
    }
    datasets.set(sourceId, observations);
  }
  return datasets;
}

function snapshotSourceFor(
  snapshot: SnapshotIndex,
  sourceId: RequiredSourceId,
): SnapshotIndex["sources"][number] & { dataset_id: string } {
  const source = snapshot.sources.find((entry) => entry.source_id === sourceId);
  if (
    !source?.dataset_id ||
    !snapshot.dataset_ids.includes(source.dataset_id)
  ) {
    throw new Error(`consumer_v2_snapshot_dataset_missing:${sourceId}`);
  }
  if (!ADMISSIBLE_SNAPSHOT_STATES.has(source.state)) {
    throw new Error(
      `consumer_v2_snapshot_source_state_invalid:${sourceId}:${source.state}`,
    );
  }
  if (
    source.health_status === null ||
    !ADMISSIBLE_SOURCE_HEALTH.has(source.health_status)
  ) {
    throw new Error(
      `consumer_v2_snapshot_source_health_invalid:${sourceId}:${source.health_status ?? "missing"}`,
    );
  }
  if (source.artifact_sha256 === null || source.failure_code !== null) {
    throw new Error(`consumer_v2_snapshot_source_evidence_invalid:${sourceId}`);
  }
  return { ...source, dataset_id: source.dataset_id };
}

function currentRevisionByPeriod(
  rows: readonly AdmittedCanonicalObservation[],
): AdmittedCanonicalObservation[] {
  const currentByPeriod = new Map<string, AdmittedCanonicalObservation>();
  for (const row of rows) {
    const current = currentByPeriod.get(row.period_start);
    if (
      !current ||
      row.revision_number > current.revision_number ||
      (row.revision_number === current.revision_number &&
        compareCodeUnits(canonicalJson(row), canonicalJson(current)) > 0)
    ) {
      currentByPeriod.set(row.period_start, row);
    }
  }
  return [...currentByPeriod.values()].sort(
    (left, right) =>
      compareCodeUnits(left.period_start, right.period_start) ||
      left.revision_number - right.revision_number,
  );
}

function projectWithSourceTag(input: {
  observationsBySource: ReadonlyMap<
    string,
    readonly CanonicalObservation[]
  >;
  snapshot: SnapshotIndex;
  sources: readonly SourceDefinition[];
  sourceTag: string;
}): ConsumerV2Payload {
  const sourceTag = validateSourceTag(input.sourceTag, input.snapshot);
  const sourceById = exactSources(input.sources);
  const datasets = exactObservationDatasets(input.observationsBySource);
  const snapshotSourceById = new Map(
    REQUIRED_SOURCE_IDS.map((sourceId) => [
      sourceId,
      snapshotSourceFor(input.snapshot, sourceId),
    ]),
  );
  const seriesByKey = new Map<
    string,
    (typeof ERP_SNACK_SERIES)[number]
  >(
    ERP_SNACK_SERIES.map((series) => [series.seriesKey, series]),
  );
  const selectedBySource = new Map<
    RequiredSourceId,
    AdmittedCanonicalObservation[]
  >(
    REQUIRED_SOURCE_IDS.map((sourceId) => [sourceId, []]),
  );
  const selected: Array<{
    row: AdmittedCanonicalObservation;
    tuple: ErpSnackV2Tuple;
  }> = [];

  for (const tuple of ERP_SNACK_V2_TUPLES) {
    const rows = (datasets.get(tuple.sourceId) ?? []).filter(
      (row): row is AdmittedCanonicalObservation =>
        row.source_id === tuple.sourceId &&
        row.series_key === tuple.seriesKey &&
        row.location_key === tuple.locationKey &&
        isAdmittedObservation(row),
    );
    if (rows.length === 0) {
      throw new Error(
        `consumer_v2_profile_tuple_missing:${tuple.category}|${tuple.locationKey}`,
      );
    }
    const currentRows = currentRevisionByPeriod(rows);
    if (currentRows.length < 24) {
      throw new Error(
        `consumer_v2_profile_history_incomplete:${tuple.category}|${tuple.locationKey}:${String(currentRows.length)}`,
      );
    }
    for (const row of currentRows.slice(-24)) {
      selected.push({ row, tuple });
      selectedBySource.get(tuple.sourceId)?.push(row);
    }
  }

  if (selected.length !== 360) {
    throw new Error(
      `consumer_v2_observation_count_invalid:${String(selected.length)}`,
    );
  }

  const observations = selected
    .map(({ row, tuple }): ConsumerV2Observation => {
      const profile = seriesByKey.get(tuple.seriesKey);
      if (!profile) throw new Error("consumer_v2_profile_series_missing");
      return {
        series_key: row.series_key,
        label_fr: profile.labelFr,
        category: tuple.category,
        usage: "macro_context_only",
        geography_type: tuple.geographyType,
        location_key: tuple.locationKey,
        period_start: row.period_start,
        period_end: row.period_end,
        frequency: "monthly",
        value: row.value,
        unit: "index",
        base_year: 2017,
        scaling_factor: row.scaling_factor,
        source_id: tuple.sourceId,
        artifact_sha256: row.artifact_sha256,
        retrieved_at: row.retrieved_at,
        quality_status: row.quality_status,
        warning_codes: [...row.warning_codes].sort(compareCodeUnits),
        revision_number: row.revision_number,
        context_role: tuple.contextRole,
        granularity: tuple.granularity,
      };
    })
    .sort(observationOrder);
  if (observations.length !== 360) {
    throw new Error(
      `consumer_v2_observation_count_invalid:${String(observations.length)}`,
    );
  }

  const coverageStart = observations.reduce(
    (minimum, row) =>
      row.period_start < minimum ? row.period_start : minimum,
    observations[0]?.period_start ?? "",
  );
  const coverageEnd = observations.reduce(
    (maximum, row) => (row.period_end > maximum ? row.period_end : maximum),
    observations[0]?.period_end ?? "",
  );
  const payloadSources = REQUIRED_SOURCE_IDS.map((sourceId) => {
    const source = sourceById.get(sourceId);
    const snapshotSource = snapshotSourceById.get(sourceId);
    const sourceRows = selectedBySource.get(sourceId) ?? [];
    if (!source || !snapshotSource || sourceRows.length === 0) {
      throw new Error(`consumer_v2_source_evidence_missing:${sourceId}`);
    }
    const lastPeriodEnd = sourceRows.reduce(
      (maximum, row) =>
        row.period_end > maximum ? row.period_end : maximum,
      sourceRows[0]?.period_end ?? "",
    );
    const retrievedAt = sourceRows.reduce(
      (maximum, row) =>
        row.retrieved_at > maximum ? row.retrieved_at : maximum,
      sourceRows[0]?.retrieved_at ?? "",
    );
    const ageDays = ageDaysAtSnapshot(lastPeriodEnd, input.snapshot.created_at);
    const freshness = sourceFreshness(source, ageDays);
    const warningCodes = [
      ...new Set([
        ...snapshotSource.warning_codes,
        ...(freshness.warningCode ? [freshness.warningCode] : []),
      ]),
    ].sort(compareCodeUnits);
    return {
      source_id: sourceId,
      publisher_name: source.publisher_name,
      official_base_url: source.official_base_url,
      licence_id: source.licence.id,
      licence_evidence_url: source.licence.evidence_url,
      health_status: snapshotSource.health_status ?? freshness.healthStatus,
      retrieved_at: retrievedAt,
      last_period_end: lastPeriodEnd,
      warning_age_days: source.cadence.warning_age_days,
      expiry_age_days: source.cadence.expiry_age_days,
      age_days_at_snapshot: ageDays,
      warning_codes: warningCodes,
    };
  });

  return ConsumerV2PayloadSchema.parse({
    schema_version: SCHEMA_VERSION,
    consumer_contract: CONSUMER_V2_CONTRACT,
    source_snapshot_tag: sourceTag,
    source_snapshot_id: input.snapshot.snapshot_id,
    generated_at: input.snapshot.created_at,
    profile_id: CONSUMER_V2_PROFILE,
    contains_confidential_data: false,
    decision_scope: "observation_only",
    coverage_start: coverageStart,
    coverage_end: coverageEnd,
    sources: payloadSources,
    observations,
  });
}

export function projectErpSnackV2Observations(input: {
  observationsBySource: ReadonlyMap<
    string,
    readonly CanonicalObservation[]
  >;
  snapshot: SnapshotIndex;
  sources: readonly SourceDefinition[];
}): ConsumerV2Payload {
  return projectWithSourceTag({
    ...input,
    sourceTag: sourceTagFromSnapshot(input.snapshot),
  });
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

async function readVerifiedDataset(
  dataDir: string,
  datasetId: string,
): Promise<CanonicalObservation[]> {
  const bytes = await readFile(
    join(dataDir, "published", datasetId, "observations.jsonl"),
    "utf8",
  );
  return bytes
    .split("\n")
    .filter(Boolean)
    .map((line) =>
      CanonicalObservationSchema.parse(JSON.parse(line) as unknown),
    );
}

export async function buildErpSnackConsumerV2(
  input: BuildErpSnackConsumerV2Input,
): Promise<ConsumerV2Payload> {
  const state = await validateDataHubState(input.dataDir);
  if (!sameStrings(state.dataset_ids, input.snapshot.dataset_ids)) {
    throw new Error("snapshot_dataset_ids_mismatch");
  }
  const sourceTag = validateSourceTag(input.sourceTag, input.snapshot);
  const observationsBySource = new Map<
    RequiredSourceId,
    readonly CanonicalObservation[]
  >();
  for (const sourceId of REQUIRED_SOURCE_IDS) {
    const snapshotSource = snapshotSourceFor(input.snapshot, sourceId);
    const validatedSource = state.sources.find(
      (source) => source.source_id === sourceId,
    );
    if (
      validatedSource?.dataset_id !== snapshotSource.dataset_id ||
      !state.dataset_ids.includes(snapshotSource.dataset_id)
    ) {
      throw new Error(`consumer_v2_verified_dataset_missing:${sourceId}`);
    }
    observationsBySource.set(
      sourceId,
      await readVerifiedDataset(input.dataDir, snapshotSource.dataset_id),
    );
  }

  return projectWithSourceTag({
    observationsBySource,
    snapshot: input.snapshot,
    sources: [HCP_IPC_2017_SOURCE, HCP_IPC_2017_OFFICIAL_G1_SOURCE],
    sourceTag,
  });
}
