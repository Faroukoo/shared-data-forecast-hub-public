import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalJson } from "@data-hub/canonical";
import {
  CONSUMER_CONTRACT,
  CONSUMER_PROFILE,
  CanonicalObservationSchema,
  ConsumerPayloadSchema,
  SCHEMA_VERSION,
  type CanonicalObservation,
  type ConsumerObservation,
  type ConsumerPayload,
  type SnapshotIndex,
  type SourceDefinition,
} from "@data-hub/contracts";
import { validateDataHubState } from "@data-hub/snapshot";
import { HCP_IPC_2017_SOURCE } from "@data-hub/source-registry";

import {
  ERP_SNACK_LOCATIONS,
  ERP_SNACK_SERIES,
} from "./erp-snack-profile.js";

const DAY_MS = 86_400_000;
const SOURCE_TAG_PATTERN = /^data-\d{8}T\d{6}Z-[a-f0-9]{12}$/;

type ErpSnackSeries = (typeof ERP_SNACK_SERIES)[number];
type AdmittedCanonicalObservation = CanonicalObservation & {
  quality_status: ConsumerObservation["quality_status"];
};

export interface BuildErpSnackConsumerInput {
  dataDir: string;
  snapshot: SnapshotIndex;
  sourceTag: string;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isAdmittedObservation(
  observation: CanonicalObservation,
): observation is AdmittedCanonicalObservation {
  return (
    observation.quality_status === "accepted" ||
    observation.quality_status === "accepted_with_warning"
  );
}

function observationOrder(
  left: Pick<ConsumerObservation, "series_key" | "location_key" | "period_start" | "revision_number">,
  right: Pick<ConsumerObservation, "series_key" | "location_key" | "period_start" | "revision_number">,
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

export function projectErpSnackObservations(input: {
  observations: readonly CanonicalObservation[];
  snapshot: SnapshotIndex;
  source: SourceDefinition;
  sourceTag: string;
}): ConsumerPayload {
  const sourceTag = validateSourceTag(input.sourceTag, input.snapshot);
  const seriesByKey = new Map<string, ErpSnackSeries>(
    ERP_SNACK_SERIES.map((series) => [series.seriesKey, series]),
  );
  const locations = new Set<string>(ERP_SNACK_LOCATIONS);
  const groups = new Map<string, AdmittedCanonicalObservation[]>();

  for (const observation of input.observations) {
    if (
      observation.source_id !== input.source.source_id ||
      !seriesByKey.has(observation.series_key) ||
      !locations.has(observation.location_key) ||
      !isAdmittedObservation(observation)
    ) {
      continue;
    }
    const key = `${observation.series_key}|${observation.location_key}`;
    const group = groups.get(key) ?? [];
    group.push(observation);
    groups.set(key, group);
  }

  const selected: AdmittedCanonicalObservation[] = [];
  for (const series of ERP_SNACK_SERIES) {
    for (const location of ERP_SNACK_LOCATIONS) {
      const key = `${series.seriesKey}|${location}`;
      const rows = groups.get(key);
      if (!rows || rows.length === 0) {
        throw new Error(`consumer_profile_series_missing:${key}`);
      }
      rows.sort(
        (left, right) =>
          compareCodeUnits(left.period_start, right.period_start) ||
          left.revision_number - right.revision_number,
      );
      selected.push(...rows.slice(-24));
    }
  }

  const observations = selected
    .map((row): ConsumerObservation => {
      const profile = seriesByKey.get(row.series_key);
      if (!profile) throw new Error("consumer_profile_series_missing");
      if (
        row.location_key !== "ma" &&
        row.location_key !== "ma:city:al-hoceima" &&
        row.location_key !== "ma:city:tetouan"
      ) {
        throw new Error("consumer_profile_location_invalid");
      }
      return {
        series_key: row.series_key,
        label_fr: profile.labelFr,
        category: profile.category,
        usage: "macro_context_only",
        geography_type: row.location_key === "ma" ? "country" : "city",
        location_key: row.location_key,
        period_start: row.period_start,
        period_end: row.period_end,
        frequency: "monthly",
        value: row.value,
        unit: "index",
        base_year: 2017,
        scaling_factor: row.scaling_factor,
        source_id: "hcp-ipc-2017-monthly",
        artifact_sha256: row.artifact_sha256,
        retrieved_at: row.retrieved_at,
        quality_status: row.quality_status,
        warning_codes: [...row.warning_codes],
        revision_number: row.revision_number,
      };
    })
    .sort(observationOrder);

  const coverageStart = observations.reduce(
    (minimum, row) => row.period_start < minimum ? row.period_start : minimum,
    observations[0]?.period_start ?? "",
  );
  const coverageEnd = observations.reduce(
    (maximum, row) => row.period_end > maximum ? row.period_end : maximum,
    observations[0]?.period_end ?? "",
  );
  const retrievedAt = observations.reduce(
    (maximum, row) => row.retrieved_at > maximum ? row.retrieved_at : maximum,
    observations[0]?.retrieved_at ?? "",
  );
  const ageDays = ageDaysAtSnapshot(coverageEnd, input.snapshot.created_at);
  const freshness = sourceFreshness(input.source, ageDays);
  const snapshotSource = input.snapshot.sources.find(
    (entry) => entry.source_id === input.source.source_id,
  );
  if (!snapshotSource) {
    throw new Error(`consumer_snapshot_source_missing:${input.source.source_id}`);
  }
  const warningCodes = [...new Set([
    ...snapshotSource.warning_codes,
    ...(freshness.warningCode ? [freshness.warningCode] : []),
  ])].sort(compareCodeUnits);

  return ConsumerPayloadSchema.parse({
    schema_version: SCHEMA_VERSION,
    consumer_contract: CONSUMER_CONTRACT,
    source_snapshot_tag: sourceTag,
    source_snapshot_id: input.snapshot.snapshot_id,
    generated_at: input.snapshot.created_at,
    profile_id: CONSUMER_PROFILE,
    contains_confidential_data: false,
    decision_scope: "observation_only",
    coverage_start: coverageStart,
    coverage_end: coverageEnd,
    sources: [{
      source_id: "hcp-ipc-2017-monthly",
      publisher_name: input.source.publisher_name,
      official_base_url: input.source.official_base_url,
      licence_id: input.source.licence.id,
      licence_evidence_url: input.source.licence.evidence_url,
      health_status: freshness.healthStatus,
      retrieved_at: retrievedAt,
      last_period_end: coverageEnd,
      warning_age_days: input.source.cadence.warning_age_days,
      expiry_age_days: input.source.cadence.expiry_age_days,
      age_days_at_snapshot: ageDays,
      warning_codes: warningCodes,
    }],
    observations,
  });
}

function assertSameDatasetIds(
  validatedDatasetIds: string[],
  snapshotDatasetIds: string[],
): void {
  if (canonicalJson(validatedDatasetIds) !== canonicalJson(snapshotDatasetIds)) {
    throw new Error("snapshot_dataset_ids_mismatch");
  }
}

async function readCurrentIpcObservations(
  dataDir: string,
  snapshot: SnapshotIndex,
): Promise<CanonicalObservation[]> {
  const source = snapshot.sources.find(
    (entry) => entry.source_id === HCP_IPC_2017_SOURCE.source_id,
  );
  if (!source?.dataset_id || !snapshot.dataset_ids.includes(source.dataset_id)) {
    throw new Error("consumer_snapshot_dataset_missing");
  }
  const bytes = await readFile(
    join(dataDir, "published", source.dataset_id, "observations.jsonl"),
    "utf8",
  );
  return bytes
    .split("\n")
    .filter(Boolean)
    .map((line) => CanonicalObservationSchema.parse(JSON.parse(line) as unknown));
}

export async function buildErpSnackConsumer(
  input: BuildErpSnackConsumerInput,
): Promise<ConsumerPayload> {
  const state = await validateDataHubState(input.dataDir);
  assertSameDatasetIds(state.dataset_ids, input.snapshot.dataset_ids);
  const rows = await readCurrentIpcObservations(input.dataDir, input.snapshot);
  return projectErpSnackObservations({
    observations: rows,
    snapshot: input.snapshot,
    source: HCP_IPC_2017_SOURCE,
    sourceTag: input.sourceTag,
  });
}
