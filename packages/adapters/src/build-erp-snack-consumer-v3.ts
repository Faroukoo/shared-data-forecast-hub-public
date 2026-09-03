import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalJson, sha256Hex } from "@data-hub/canonical";
import {
  CONSUMER_V3_CONTRACT,
  CONSUMER_V3_PROFILE,
  CanonicalObservationSchema,
  ConsumerV3PayloadSchema,
  SCHEMA_VERSION,
  type CanonicalObservation,
  type ConsumerV3Observation,
  type ConsumerV3Payload,
  type SnapshotIndex,
  type SourceDefinition,
} from "@data-hub/contracts";
import { validateDataHubState } from "@data-hub/snapshot";
import { HCP_IPC_2017_OFFICIAL_G1_SOURCE } from "@data-hub/source-registry";

import { ERP_SNACK_V3_TUPLES } from "./erp-snack-profile-v3.js";

const TUPLE = ERP_SNACK_V3_TUPLES[0];
const SOURCE_ID = TUPLE.sourceId;
const SOURCE_TAG_PATTERN = /^data-\d{8}T\d{6}Z-[a-f0-9]{12}$/;
const ADMISSIBLE_SNAPSHOT_STATES = new Set(["published", "no_change"]);
const ADMISSIBLE_SOURCE_HEALTH = new Set(["healthy", "late", "stale"]);
const DAY_MS = 86_400_000;
const FOOD_SERIES_LABEL =
  "Produits alimentaires et boissons non alcoolisées";
const OBSERVATION_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;

type AdmittedObservation = CanonicalObservation & {
  quality_status: ConsumerV3Observation["quality_status"];
};

export interface BuildErpSnackConsumerV3Input {
  dataDir: string;
  snapshot: SnapshotIndex;
  sourceTag: string;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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

function exactSource(sources: readonly SourceDefinition[]): SourceDefinition {
  if (sources.length === 0) {
    throw new Error(`consumer_v3_source_missing:${SOURCE_ID}`);
  }
  if (sources.length !== 1 || sources[0]?.source_id !== SOURCE_ID) {
    const unexpected = sources.find((source) => source.source_id !== SOURCE_ID);
    throw new Error(`consumer_v3_source_unexpected:${unexpected?.source_id ?? "duplicate"}`);
  }
  const source = sources[0];
  if (
    source.authority_level !== "official" ||
    !source.enabled ||
    source.access_mode === "disabled"
  ) {
    throw new Error(`consumer_v3_source_not_qualified:${SOURCE_ID}`);
  }
  if (!source.licence.permits_redistribution) {
    throw new Error(`consumer_v3_redistribution_not_permitted:${SOURCE_ID}`);
  }
  if (
    source.licence.id !== HCP_IPC_2017_OFFICIAL_G1_SOURCE.licence.id ||
    source.licence.evidence_url !==
      HCP_IPC_2017_OFFICIAL_G1_SOURCE.licence.evidence_url ||
    source.licence.permits_internal_derived_use !==
      HCP_IPC_2017_OFFICIAL_G1_SOURCE.licence.permits_internal_derived_use
  ) {
    throw new Error(`consumer_v3_licence_mismatch:${SOURCE_ID}`);
  }
  if (canonicalJson(source) !== canonicalJson(HCP_IPC_2017_OFFICIAL_G1_SOURCE)) {
    throw new Error(`consumer_v3_source_not_qualified:${SOURCE_ID}`);
  }
  return HCP_IPC_2017_OFFICIAL_G1_SOURCE;
}

function exactDataset(
  observationsBySource: ReadonlyMap<string, readonly CanonicalObservation[]>,
): readonly CanonicalObservation[] {
  for (const sourceId of observationsBySource.keys()) {
    if (sourceId !== SOURCE_ID) {
      throw new Error(`consumer_v3_dataset_unexpected:${sourceId}`);
    }
  }
  const observations = observationsBySource.get(SOURCE_ID);
  if (!observations) throw new Error(`consumer_v3_dataset_missing:${SOURCE_ID}`);
  return observations;
}

function snapshotSourceFor(snapshot: SnapshotIndex):
  SnapshotIndex["sources"][number] & { dataset_id: string } {
  const source = snapshot.sources.find((entry) => entry.source_id === SOURCE_ID);
  if (!source?.dataset_id || !snapshot.dataset_ids.includes(source.dataset_id)) {
    throw new Error(`consumer_v3_snapshot_dataset_missing:${SOURCE_ID}`);
  }
  if (!ADMISSIBLE_SNAPSHOT_STATES.has(source.state)) {
    throw new Error(`consumer_v3_snapshot_source_state_invalid:${SOURCE_ID}:${source.state}`);
  }
  if (source.health_status === null || !ADMISSIBLE_SOURCE_HEALTH.has(source.health_status)) {
    throw new Error(
      `consumer_v3_snapshot_source_health_invalid:${SOURCE_ID}:${source.health_status ?? "missing"}`,
    );
  }
  if (source.artifact_sha256 === null || source.failure_code !== null) {
    throw new Error(`consumer_v3_snapshot_source_evidence_invalid:${SOURCE_ID}`);
  }
  return { ...source, dataset_id: source.dataset_id };
}

function isAdmitted(row: CanonicalObservation): row is AdmittedObservation {
  return row.quality_status === "accepted" ||
    row.quality_status === "accepted_with_warning";
}

function validateSourceObservation(row: AdmittedObservation): void {
  const expectedNaturalKey =
    `${TUPLE.seriesKey}|${TUPLE.locationKey}|${row.period_start.slice(0, 7)}`;
  const { observation_id: ignored, ...evidence } = row;
  void ignored;
  const expectedObservationId = `sha256:${sha256Hex(canonicalJson(evidence))}`;
  const revisionLinkInvalid = row.revision_number === 1
    ? row.supersedes_observation_id !== null
    : row.supersedes_observation_id === null ||
      !OBSERVATION_ID_PATTERN.test(row.supersedes_observation_id);
  if (
    row.natural_key !== expectedNaturalKey ||
    row.source_series_label !== FOOD_SERIES_LABEL ||
    row.source_column !== 3 ||
    row.source_row < 25 ||
    row.source_published_at !== null ||
    row.observation_id !== expectedObservationId ||
    revisionLinkInvalid
  ) {
    throw new Error("consumer_v3_observation_provenance_invalid");
  }
}

function currentRevisionByPeriod(
  rows: readonly AdmittedObservation[],
): AdmittedObservation[] {
  const seenRevisions = new Set<string>();
  const rowsByPeriod = new Map<string, AdmittedObservation[]>();
  for (const row of rows) {
    const revisionKey = `${row.period_start}|${String(row.revision_number)}`;
    if (seenRevisions.has(revisionKey)) {
      throw new Error(`consumer_v3_period_revision_duplicate:${revisionKey}`);
    }
    seenRevisions.add(revisionKey);
    const periodRows = rowsByPeriod.get(row.period_start) ?? [];
    periodRows.push(row);
    rowsByPeriod.set(row.period_start, periodRows);
  }

  const selected: AdmittedObservation[] = [];
  for (const [periodStart, periodRows] of rowsByPeriod) {
    periodRows.sort((left, right) => left.revision_number - right.revision_number);
    for (let index = 1; index < periodRows.length; index += 1) {
      const previous = periodRows[index - 1];
      const current = periodRows[index];
      if (
        !previous ||
        !current ||
        current.revision_number !== previous.revision_number + 1 ||
        current.supersedes_observation_id !== previous.observation_id
      ) {
        throw new Error(`consumer_v3_revision_chain_invalid:${periodStart}`);
      }
    }
    const latest = periodRows.at(-1);
    if (latest) selected.push(latest);
  }
  return selected.sort((left, right) =>
    compareCodeUnits(left.period_start, right.period_start) ||
    left.revision_number - right.revision_number
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

function sourceFreshness(source: SourceDefinition, ageDays: number): {
  healthStatus: "healthy" | "late" | "stale";
  warningCode: string | null;
} {
  if (ageDays > source.cadence.expiry_age_days) {
    return { healthStatus: "stale", warningCode: "source_stale" };
  }
  if (ageDays > source.cadence.warning_age_days) {
    return { healthStatus: "late", warningCode: "source_late" };
  }
  return { healthStatus: "healthy", warningCode: null };
}

function projectWithSourceTag(input: {
  observationsBySource: ReadonlyMap<string, readonly CanonicalObservation[]>;
  snapshot: SnapshotIndex;
  sources: readonly SourceDefinition[];
  sourceTag: string;
}): ConsumerV3Payload {
  const sourceTag = validateSourceTag(input.sourceTag, input.snapshot);
  const source = exactSource(input.sources);
  const snapshotSource = snapshotSourceFor(input.snapshot);
  const rows = exactDataset(input.observationsBySource).filter(
    (row): row is AdmittedObservation =>
      row.source_id === SOURCE_ID &&
      row.series_key === TUPLE.seriesKey &&
      row.location_key === TUPLE.locationKey &&
      isAdmitted(row),
  );
  rows.forEach(validateSourceObservation);
  const currentRows = currentRevisionByPeriod(rows);
  if (currentRows.length < 24) {
    throw new Error(`consumer_v3_profile_history_incomplete:${String(currentRows.length)}`);
  }
  const selected = currentRows.slice(-24);
  if (
    snapshotSource.state === "published" &&
    selected.some((row) => row.artifact_sha256 !== snapshotSource.artifact_sha256)
  ) {
    throw new Error("consumer_v3_observation_artifact_mismatch");
  }
  for (const row of selected) {
    if (
      row.frequency !== "monthly" ||
      row.unit !== "index" ||
      row.currency !== null ||
      row.scaling_factor !== "1" ||
      row.geography_type !== "country"
    ) {
      throw new Error("consumer_v3_observation_metadata_invalid");
    }
  }
  const observations: ConsumerV3Observation[] = selected.map((row) => ({
    series_key: TUPLE.seriesKey,
    label_fr: "Alimentation",
    category: TUPLE.category,
    usage: "macro_context_only",
    geography_type: TUPLE.geographyType,
    location_key: TUPLE.locationKey,
    period_start: row.period_start,
    period_end: row.period_end,
    frequency: "monthly",
    value: row.value,
    unit: "index",
    base_year: 2017,
    scaling_factor: "1",
    source_id: SOURCE_ID,
    artifact_sha256: row.artifact_sha256,
    retrieved_at: row.retrieved_at,
    quality_status: row.quality_status,
    warning_codes: [...row.warning_codes].sort(compareCodeUnits),
    revision_number: row.revision_number,
    context_role: TUPLE.contextRole,
    granularity: TUPLE.granularity,
  }));
  const first = observations[0];
  const last = observations.at(-1);
  if (!first || !last || observations.length !== 24) {
    throw new Error(`consumer_v3_observation_count_invalid:${String(observations.length)}`);
  }
  const retrievedAt = observations.reduce(
    (latest, row) => row.retrieved_at > latest ? row.retrieved_at : latest,
    first.retrieved_at,
  );
  const ageDays = ageDaysAtSnapshot(last.period_end, input.snapshot.created_at);
  const freshness = sourceFreshness(source, ageDays);
  const warningCodes = [...new Set([
    ...snapshotSource.warning_codes,
    ...(freshness.warningCode ? [freshness.warningCode] : []),
  ])].sort(compareCodeUnits);

  return ConsumerV3PayloadSchema.parse({
    schema_version: SCHEMA_VERSION,
    consumer_contract: CONSUMER_V3_CONTRACT,
    source_snapshot_tag: sourceTag,
    source_snapshot_id: input.snapshot.snapshot_id,
    generated_at: input.snapshot.created_at,
    profile_id: CONSUMER_V3_PROFILE,
    contains_confidential_data: false,
    decision_scope: "observation_only",
    business_context: {
      operating_location_key: "ma:city:casablanca",
      procurement_location_mode: "erp_observed_only",
    },
    coverage_start: first.period_start,
    coverage_end: last.period_end,
    sources: [{
      source_id: SOURCE_ID,
      publisher_name: source.publisher_name,
      official_base_url: source.official_base_url,
      licence_id: source.licence.id,
      licence_evidence_url: source.licence.evidence_url,
      health_status: freshness.healthStatus,
      retrieved_at: retrievedAt,
      last_period_end: last.period_end,
      warning_age_days: source.cadence.warning_age_days,
      expiry_age_days: source.cadence.expiry_age_days,
      age_days_at_snapshot: ageDays,
      warning_codes: warningCodes,
    }],
    observations,
  });
}

export function projectErpSnackV3Observations(input: {
  observationsBySource: ReadonlyMap<string, readonly CanonicalObservation[]>;
  snapshot: SnapshotIndex;
  sources: readonly SourceDefinition[];
}): ConsumerV3Payload {
  return projectWithSourceTag({
    ...input,
    sourceTag: sourceTagFromSnapshot(input.snapshot),
  });
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

async function readVerifiedDataset(
  dataDir: string,
  datasetId: string,
): Promise<CanonicalObservation[]> {
  const bytes = await readFile(
    join(dataDir, "published", datasetId, "observations.jsonl"),
    "utf8",
  );
  return bytes.split("\n").filter(Boolean).map((line) =>
    CanonicalObservationSchema.parse(JSON.parse(line) as unknown)
  );
}

export async function buildErpSnackConsumerV3(
  input: BuildErpSnackConsumerV3Input,
): Promise<ConsumerV3Payload> {
  const state = await validateDataHubState(input.dataDir);
  if (!sameStrings(state.dataset_ids, input.snapshot.dataset_ids)) {
    throw new Error("snapshot_dataset_ids_mismatch");
  }
  const sourceTag = validateSourceTag(input.sourceTag, input.snapshot);
  const snapshotSource = snapshotSourceFor(input.snapshot);
  const validatedSource = state.sources.find((source) => source.source_id === SOURCE_ID);
  if (
    validatedSource?.dataset_id !== snapshotSource.dataset_id ||
    !state.dataset_ids.includes(snapshotSource.dataset_id)
  ) {
    throw new Error(`consumer_v3_verified_dataset_missing:${SOURCE_ID}`);
  }
  const observations = await readVerifiedDataset(input.dataDir, snapshotSource.dataset_id);
  return projectWithSourceTag({
    observationsBySource: new Map([[SOURCE_ID, observations]]),
    snapshot: input.snapshot,
    sources: [HCP_IPC_2017_OFFICIAL_G1_SOURCE],
    sourceTag,
  });
}
