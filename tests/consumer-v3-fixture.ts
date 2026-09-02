import {
  CONSUMER_V3_CONTRACT,
  CONSUMER_V3_PROFILE,
  ConsumerV3PayloadSchema,
  SCHEMA_VERSION,
  type ConsumerV3Payload,
} from "@data-hub/contracts";

export const V3_SNAPSHOT_ID =
  "9d3b77bbfc0cf05cbc0f2e27f24cfb0b348ce0e5d71b09267fbd7ce67657e226";
export const V3_SNAPSHOT_TAG = "data-20260901T120000Z-9d3b77bbfc0c";
export const V3_GENERATED_AT = "2026-09-01T12:00:00.000Z";
export const V3_SOURCE_ID = "hcp-ipc-2017-official-g1-monthly" as const;

const PERIODS = [
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

export function consumerV3PayloadFixture(input: {
  snapshotId?: string;
  snapshotTag?: string;
  generatedAt?: string;
} = {}): ConsumerV3Payload {
  const generatedAt = input.generatedAt ?? V3_GENERATED_AT;
  const ageDaysAtSnapshot = Math.floor(
    (Date.parse(generatedAt) - Date.parse("2026-08-31T00:00:00.000Z")) /
      86_400_000,
  );
  return ConsumerV3PayloadSchema.parse({
    schema_version: SCHEMA_VERSION,
    consumer_contract: CONSUMER_V3_CONTRACT,
    source_snapshot_tag: input.snapshotTag ?? V3_SNAPSHOT_TAG,
    source_snapshot_id: input.snapshotId ?? V3_SNAPSHOT_ID,
    generated_at: generatedAt,
    profile_id: CONSUMER_V3_PROFILE,
    contains_confidential_data: false,
    decision_scope: "observation_only",
    business_context: {
      operating_location_key: "ma:city:casablanca",
      procurement_location_mode: "erp_observed_only",
    },
    coverage_start: "2024-09-01",
    coverage_end: "2026-08-31",
    sources: [{
      source_id: V3_SOURCE_ID,
      publisher_name: "Haut-Commissariat au Plan",
      official_base_url:
        "https://www.hcp.ma/Indices-des-prix-a-la-consommation-IPC_r348.html",
      licence_id: "CC-BY-4.0",
      licence_evidence_url:
        "https://www.hcp.ma/Conditions-generales-d-utilisation-Version-1-0_a2194.html",
      health_status: "healthy",
      retrieved_at: generatedAt,
      last_period_end: "2026-08-31",
      warning_age_days: 60,
      expiry_age_days: 120,
      age_days_at_snapshot: ageDaysAtSnapshot,
      warning_codes: [],
    }],
    observations: PERIODS.map(([periodStart, periodEnd, value], index) => ({
      series_key: "hcp.ipc2017.01",
      label_fr: "Alimentation",
      category: "food_overall",
      usage: "macro_context_only",
      geography_type: "country",
      location_key: "ma",
      period_start: periodStart,
      period_end: periodEnd,
      frequency: "monthly",
      value,
      unit: "index",
      base_year: 2017,
      scaling_factor: "1",
      source_id: V3_SOURCE_ID,
      artifact_sha256: "c".repeat(64),
      retrieved_at: generatedAt,
      quality_status: index === 0 ? "accepted_with_warning" : "accepted",
      warning_codes: index === 0 ? ["source_late"] : [],
      revision_number: 1,
      context_role: "fresh_national_context",
      granularity: "division",
    })),
  });
}
