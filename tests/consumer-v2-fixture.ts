import {
  CONSUMER_V2_CONTRACT,
  CONSUMER_V2_PROFILE,
  ConsumerV2PayloadSchema,
  SCHEMA_VERSION,
  type ConsumerV2Payload,
} from "@data-hub/contracts";

export const CONSUMER_V2_FIXTURE_SOURCE_IDS = [
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

export const CONSUMER_V2_FIXTURE_TUPLES = SERIES.flatMap((series) =>
  LOCATIONS.map((locationKey) => {
    const freshNational =
      series.category === "food_overall" && locationKey === "ma";
    return {
      ...series,
      locationKey,
      geographyType: locationKey === "ma" ? ("country" as const) : ("city" as const),
      sourceId: freshNational
        ? ("hcp-ipc-2017-official-g1-monthly" as const)
        : ("hcp-ipc-2017-monthly" as const),
      contextRole: freshNational
        ? ("fresh_national_context" as const)
        : ("historical_detailed_context" as const),
    };
  }),
);

function monthPeriod(
  sourceId: (typeof CONSUMER_V2_FIXTURE_SOURCE_IDS)[number],
  offset: number,
): { start: string; end: string } {
  const firstYear = sourceId === "hcp-ipc-2017-official-g1-monthly" ? 2024 : 2023;
  const firstMonthIndex = sourceId === "hcp-ipc-2017-official-g1-monthly" ? 8 : 0;
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

export function compareConsumerV2FixtureObservations(
  left: ConsumerV2Payload["observations"][number],
  right: ConsumerV2Payload["observations"][number],
): number {
  return (
    (left.series_key < right.series_key ? -1 : left.series_key > right.series_key ? 1 : 0) ||
    (left.location_key < right.location_key ? -1 : left.location_key > right.location_key ? 1 : 0) ||
    (left.period_start < right.period_start ? -1 : left.period_start > right.period_start ? 1 : 0) ||
    left.revision_number - right.revision_number
  );
}

export function consumerV2PayloadFixture(input: {
  snapshotId?: string;
  snapshotTag?: string;
  generatedAt?: string;
} = {}): ConsumerV2Payload {
  const snapshotId = input.snapshotId ??
    "9d3b77bbfc0cf05cbc0f2e27f24cfb0b348ce0e5d71b09267fbd7ce67657e226";
  const snapshotTag = input.snapshotTag ??
    "data-20260901T120000Z-9d3b77bbfc0c";
  const generatedAt = input.generatedAt ?? "2026-09-01T12:00:00.000Z";
  const observations = CONSUMER_V2_FIXTURE_TUPLES.flatMap((tuple) =>
    Array.from({ length: 24 }, (_, offset) => {
      const period = monthPeriod(tuple.sourceId, offset);
      return {
        series_key: tuple.seriesKey,
        label_fr: tuple.labelFr,
        category: tuple.category,
        usage: "macro_context_only" as const,
        geography_type: tuple.geographyType,
        location_key: tuple.locationKey,
        period_start: period.start,
        period_end: period.end,
        frequency: "monthly" as const,
        value: String(100 + offset),
        unit: "index" as const,
        base_year: 2017 as const,
        scaling_factor: "1",
        source_id: tuple.sourceId,
        artifact_sha256:
          tuple.sourceId === "hcp-ipc-2017-official-g1-monthly"
            ? "c".repeat(64)
            : "b".repeat(64),
        retrieved_at: generatedAt,
        quality_status:
          tuple.sourceId === "hcp-ipc-2017-official-g1-monthly"
            ? ("accepted" as const)
            : ("accepted_with_warning" as const),
        warning_codes:
          tuple.sourceId === "hcp-ipc-2017-official-g1-monthly"
            ? []
            : ["source_stale"],
        revision_number: 1,
        context_role: tuple.contextRole,
        granularity: tuple.granularity,
      };
    }),
  );

  return ConsumerV2PayloadSchema.parse({
    schema_version: SCHEMA_VERSION,
    consumer_contract: CONSUMER_V2_CONTRACT,
    source_snapshot_tag: snapshotTag,
    source_snapshot_id: snapshotId,
    generated_at: generatedAt,
    profile_id: CONSUMER_V2_PROFILE,
    contains_confidential_data: false,
    decision_scope: "observation_only",
    coverage_start: "2023-01-01",
    coverage_end: "2026-08-31",
    sources: [
      {
        source_id: "hcp-ipc-2017-monthly",
        publisher_name: "Haut-Commissariat au Plan",
        official_base_url: "https://www.hcp.ma/",
        licence_id: "ODbL-1.0",
        licence_evidence_url: "https://data.gov.ma/data/fr/dataset/data_7_5",
        health_status: "stale",
        retrieved_at: generatedAt,
        last_period_end: "2024-12-31",
        warning_age_days: 60,
        expiry_age_days: 120,
        age_days_at_snapshot: 609,
        warning_codes: ["source_stale"],
      },
      {
        source_id: "hcp-ipc-2017-official-g1-monthly",
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
        age_days_at_snapshot: 1,
        warning_codes: [],
      },
    ],
    observations,
  });
}
