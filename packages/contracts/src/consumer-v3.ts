import { z } from "zod";

import {
  DecimalStringSchema,
  IsoDateSchema,
  IsoTimestampSchema,
  Sha256Schema,
  SourceHealthStatusSchema,
} from "./pipeline.js";
import { SCHEMA_VERSION } from "./schema-version.js";

export const CONSUMER_V3_CONTRACT = "erp-snack-observation-v3" as const;
export const CONSUMER_V3_PROFILE = "erp-snack-observation-v3" as const;
export const CONSUMER_V3_MAX_INDEX_VALUE = "1000" as const;
export const CONSUMER_V3_TUPLES = Object.freeze([Object.freeze({
  category: "food_overall",
  locationKey: "ma",
  seriesKey: "hcp.ipc2017.01",
  sourceId: "hcp-ipc-2017-official-g1-monthly",
  contextRole: "fresh_national_context",
  granularity: "division",
  geographyType: "country",
})] as const);

export type ConsumerV3Tuple = (typeof CONSUMER_V3_TUPLES)[number];

const SOURCE_ID = "hcp-ipc-2017-official-g1-monthly" as const;
const SnapshotTagSchema = z.string().regex(/^data-\d{8}T\d{6}Z-[a-f0-9]{12}$/);
const GitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length &&
    values.every((value, index) =>
      index === 0 || compareCodeUnits(values[index - 1] ?? "", value) < 0
    );
}

function closedCalendarMonth(start: string, end: string): boolean {
  if (!/^\d{4}-\d{2}-01$/.test(start)) return false;
  const year = Number(start.slice(0, 4));
  const month = Number(start.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return end === `${start.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
}

function ageDays(periodEnd: string, generatedAt: string): number {
  return Math.floor(
    (Date.parse(generatedAt) - Date.parse(`${periodEnd}T00:00:00.000Z`)) /
      86_400_000,
  );
}

function positiveIndexWithinV3Bound(value: string): boolean {
  if (value === "0" || value.startsWith("-")) return false;
  const [integerPart, fractionalPart] = value.split(".");
  if (!integerPart) return false;
  if (integerPart.length < CONSUMER_V3_MAX_INDEX_VALUE.length) return true;
  if (integerPart.length > CONSUMER_V3_MAX_INDEX_VALUE.length) return false;
  if (integerPart < CONSUMER_V3_MAX_INDEX_VALUE) return true;
  if (integerPart > CONSUMER_V3_MAX_INDEX_VALUE) return false;
  return fractionalPart === undefined;
}

const ConsumerV3SourceBaseSchema = z.object({
  source_id: z.literal(SOURCE_ID),
  publisher_name: z.literal("Haut-Commissariat au Plan"),
  official_base_url: z.literal(
    "https://www.hcp.ma/Indices-des-prix-a-la-consommation-IPC_r348.html",
  ),
  licence_id: z.literal("CC-BY-4.0"),
  licence_evidence_url: z.literal(
    "https://www.hcp.ma/Conditions-generales-d-utilisation-Version-1-0_a2194.html",
  ),
  health_status: SourceHealthStatusSchema,
  retrieved_at: IsoTimestampSchema,
  last_period_end: IsoDateSchema,
  warning_age_days: z.literal(60),
  expiry_age_days: z.literal(120),
  age_days_at_snapshot: z.int().nonnegative(),
  warning_codes: z.array(z.string().min(1)),
}).strict();

export type ConsumerV3Source = z.infer<typeof ConsumerV3SourceBaseSchema>;
export const ConsumerV3SourceSchema: z.ZodType<ConsumerV3Source> =
  ConsumerV3SourceBaseSchema.superRefine((value, context) => {
    if (!sortedUnique(value.warning_codes)) {
      context.addIssue({
        code: "custom",
        message: "warning_codes_must_be_sorted_and_unique",
        path: ["warning_codes"],
      });
    }
    if (!["healthy", "late", "stale"].includes(value.health_status)) {
      context.addIssue({
        code: "custom",
        message: "consumer_v3_source_health_invalid",
        path: ["health_status"],
      });
    }
  });

const ConsumerV3ObservationBaseSchema = z.object({
  series_key: z.literal("hcp.ipc2017.01"),
  label_fr: z.literal("Alimentation"),
  category: z.literal("food_overall"),
  usage: z.literal("macro_context_only"),
  geography_type: z.literal("country"),
  location_key: z.literal("ma"),
  period_start: IsoDateSchema,
  period_end: IsoDateSchema,
  frequency: z.literal("monthly"),
  value: DecimalStringSchema,
  unit: z.literal("index"),
  base_year: z.literal(2017),
  scaling_factor: z.literal("1"),
  source_id: z.literal(SOURCE_ID),
  artifact_sha256: Sha256Schema,
  retrieved_at: IsoTimestampSchema,
  quality_status: z.enum(["accepted", "accepted_with_warning"]),
  warning_codes: z.array(z.string().min(1)),
  revision_number: z.int().positive(),
  context_role: z.literal("fresh_national_context"),
  granularity: z.literal("division"),
}).strict();

export type ConsumerV3Observation = z.infer<
  typeof ConsumerV3ObservationBaseSchema
>;
export const ConsumerV3ObservationSchema: z.ZodType<ConsumerV3Observation> =
  ConsumerV3ObservationBaseSchema.superRefine((value, context) => {
    if (!closedCalendarMonth(value.period_start, value.period_end)) {
      context.addIssue({
        code: "custom",
        message: "closed_calendar_month_required",
        path: ["period_end"],
      });
    }
    if (!positiveIndexWithinV3Bound(value.value)) {
      context.addIssue({
        code: "custom",
        message: "positive_bounded_index_required",
        path: ["value"],
      });
    }
    if (!sortedUnique(value.warning_codes)) {
      context.addIssue({
        code: "custom",
        message: "warning_codes_must_be_sorted_and_unique",
        path: ["warning_codes"],
      });
    }
  });

const ConsumerV3PayloadBaseSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  consumer_contract: z.literal(CONSUMER_V3_CONTRACT),
  source_snapshot_tag: SnapshotTagSchema,
  source_snapshot_id: Sha256Schema,
  generated_at: IsoTimestampSchema,
  profile_id: z.literal(CONSUMER_V3_PROFILE),
  contains_confidential_data: z.literal(false),
  decision_scope: z.literal("observation_only"),
  business_context: z.object({
    operating_location_key: z.literal("ma:city:casablanca"),
    procurement_location_mode: z.literal("erp_observed_only"),
  }).strict(),
  coverage_start: IsoDateSchema,
  coverage_end: IsoDateSchema,
  sources: z.array(ConsumerV3SourceSchema),
  observations: z.array(ConsumerV3ObservationSchema),
}).strict();

export type ConsumerV3Payload = z.infer<typeof ConsumerV3PayloadBaseSchema>;
export const ConsumerV3PayloadSchema: z.ZodType<ConsumerV3Payload> =
  ConsumerV3PayloadBaseSchema.superRefine((value, context) => {
    if (value.source_snapshot_tag.slice(-12) !== value.source_snapshot_id.slice(0, 12)) {
      context.addIssue({
        code: "custom",
        message: "source_snapshot_tag_snapshot_mismatch",
        path: ["source_snapshot_tag"],
      });
    }
    if (value.sources.length !== 1 || value.sources[0]?.source_id !== SOURCE_ID) {
      context.addIssue({
        code: "custom",
        message: "sources_must_be_exact_singleton",
        path: ["sources"],
      });
    }
    if (value.observations.length !== 24) {
      context.addIssue({
        code: "custom",
        message: `consumer_v3_observation_count_invalid:${String(value.observations.length)}`,
        path: ["observations"],
      });
    }

    const periodKeys = new Set<string>();
    value.observations.forEach((observation, index) => {
      if (periodKeys.has(observation.period_start)) {
        context.addIssue({
          code: "custom",
          message: "consumer_v3_period_revision_duplicate",
          path: ["observations", index, "revision_number"],
        });
      }
      periodKeys.add(observation.period_start);
      if (observation.period_end > value.generated_at.slice(0, 10)) {
        context.addIssue({
          code: "custom",
          message: "future_observation_period",
          path: ["observations", index, "period_end"],
        });
      }
    });
    const sorted = value.observations.every((observation, index) => {
      const previous = value.observations[index - 1];
      return index === 0 || previous === undefined ||
        compareCodeUnits(previous.period_start, observation.period_start) < 0;
    });
    if (!sorted) {
      context.addIssue({
        code: "custom",
        message: "observations_must_be_sorted_and_unique",
        path: ["observations"],
      });
    }

    const first = value.observations[0];
    const last = value.observations.at(-1);
    if (!first || !last ||
      value.coverage_start !== first.period_start ||
      value.coverage_end !== last.period_end
    ) {
      context.addIssue({
        code: "custom",
        message: "coverage_observation_mismatch",
        path: ["coverage_start"],
      });
    }
    const source = value.sources[0];
    if (source && last) {
      if (source.last_period_end !== last.period_end) {
        context.addIssue({
          code: "custom",
          message: "source_period_evidence_mismatch",
          path: ["sources", 0, "last_period_end"],
        });
      }
      const latestRetrievedAt = value.observations.reduce(
        (latest, row) => row.retrieved_at > latest ? row.retrieved_at : latest,
        value.observations[0]?.retrieved_at ?? "",
      );
      if (source.retrieved_at !== latestRetrievedAt) {
        context.addIssue({
          code: "custom",
          message: "source_retrieval_evidence_mismatch",
          path: ["sources", 0, "retrieved_at"],
        });
      }
      const expectedAge = ageDays(last.period_end, value.generated_at);
      if (expectedAge < 0) {
        context.addIssue({
          code: "custom",
          message: "future_observation_period",
          path: ["coverage_end"],
        });
      }
      if (source.age_days_at_snapshot !== expectedAge) {
        context.addIssue({
          code: "custom",
          message: "source_age_evidence_mismatch",
          path: ["sources", 0, "age_days_at_snapshot"],
        });
      }
      const expectedHealth = expectedAge > source.expiry_age_days
        ? "stale"
        : expectedAge > source.warning_age_days
        ? "late"
        : "healthy";
      if (source.health_status !== expectedHealth) {
        context.addIssue({
          code: "custom",
          message: "source_health_age_mismatch",
          path: ["sources", 0, "health_status"],
        });
      }
    }
  });

const ConsumerV3PayloadDescriptorSchema = z.object({
  name: z.literal("consumer-v3.json"),
  byte_length: z.int().positive(),
  sha256: Sha256Schema,
}).strict();

const ConsumerV3IndexBaseSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  consumer_contract: z.literal(CONSUMER_V3_CONTRACT),
  source_snapshot_tag: SnapshotTagSchema,
  source_snapshot_id: Sha256Schema,
  contains_confidential_data: z.literal(false),
  decision_scope: z.literal("observation_only"),
  created_at: IsoTimestampSchema,
  code_sha: GitShaSchema,
  indicator_count: z.literal(1),
  observation_count: z.literal(24),
  coverage_start: IsoDateSchema,
  coverage_end: IsoDateSchema,
  source_ids: z.tuple([z.literal(SOURCE_ID)]),
  payload: ConsumerV3PayloadDescriptorSchema,
}).strict();

export type ConsumerV3Index = z.infer<typeof ConsumerV3IndexBaseSchema>;
export const ConsumerV3IndexSchema: z.ZodType<ConsumerV3Index> =
  ConsumerV3IndexBaseSchema.superRefine((value, context) => {
    if (value.source_snapshot_tag.slice(-12) !== value.source_snapshot_id.slice(0, 12)) {
      context.addIssue({
        code: "custom",
        message: "source_snapshot_tag_snapshot_mismatch",
        path: ["source_snapshot_tag"],
      });
    }
    if (value.coverage_start > value.coverage_end) {
      context.addIssue({
        code: "custom",
        message: "consumer_v3_index_coverage_invalid",
        path: ["coverage_start"],
      });
    }
  });
