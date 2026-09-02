import { z } from "zod";

import {
  DecimalStringSchema,
  IsoDateSchema,
  IsoTimestampSchema,
  Sha256Schema,
  SourceHealthStatusSchema,
} from "./pipeline.js";
import { SCHEMA_VERSION } from "./schema-version.js";

export const CONSUMER_V2_CONTRACT = "erp-snack-observation-v2" as const;
export const CONSUMER_V2_PROFILE = "erp-snack-observation-v2" as const;

const V2_SOURCE_IDS = [
  "hcp-ipc-2017-monthly",
  "hcp-ipc-2017-official-g1-monthly",
] as const;
const SnapshotTagSchema = z
  .string()
  .regex(/^data-\d{8}T\d{6}Z-[a-f0-9]{12}$/);
const GitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);

function isExactSortedSourcePair(values: readonly string[]): boolean {
  return (
    values.length === V2_SOURCE_IDS.length &&
    values.every((value, index) => value === V2_SOURCE_IDS[index])
  );
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const ConsumerV2SourceBaseSchema = z
  .object({
    source_id: z.enum(V2_SOURCE_IDS),
    publisher_name: z.string().min(1),
    official_base_url: z.url(),
    licence_id: z.string().min(1),
    licence_evidence_url: z.url(),
    health_status: SourceHealthStatusSchema,
    retrieved_at: IsoTimestampSchema,
    last_period_end: IsoDateSchema,
    warning_age_days: z.int().positive(),
    expiry_age_days: z.int().positive(),
    age_days_at_snapshot: z.int().nonnegative(),
    warning_codes: z.array(z.string().min(1)),
  })
  .strict();

export type ConsumerV2Source = z.infer<typeof ConsumerV2SourceBaseSchema>;
export const ConsumerV2SourceSchema: z.ZodType<ConsumerV2Source> =
  ConsumerV2SourceBaseSchema;

const ConsumerV2ObservationBaseSchema = z
  .object({
    series_key: z.string().min(1),
    label_fr: z.string().min(1),
    category: z.enum([
      "food_overall",
      "bread_cereals",
      "fish_seafood",
      "oils_fats",
      "vegetables",
    ]),
    usage: z.literal("macro_context_only"),
    geography_type: z.enum(["country", "city"]),
    location_key: z.enum([
      "ma",
      "ma:city:tetouan",
      "ma:city:al-hoceima",
    ]),
    period_start: IsoDateSchema,
    period_end: IsoDateSchema,
    frequency: z.literal("monthly"),
    value: DecimalStringSchema,
    unit: z.literal("index"),
    base_year: z.literal(2017),
    scaling_factor: DecimalStringSchema,
    source_id: z.enum(V2_SOURCE_IDS),
    artifact_sha256: Sha256Schema,
    retrieved_at: IsoTimestampSchema,
    quality_status: z.enum(["accepted", "accepted_with_warning"]),
    warning_codes: z.array(z.string().min(1)),
    revision_number: z.int().positive(),
    context_role: z.enum([
      "fresh_national_context",
      "historical_detailed_context",
    ]),
    granularity: z.enum(["division", "group_of_products"]),
  })
  .strict();

export type ConsumerV2Observation = z.infer<
  typeof ConsumerV2ObservationBaseSchema
>;

export const ConsumerV2ObservationSchema: z.ZodType<ConsumerV2Observation> =
  ConsumerV2ObservationBaseSchema.superRefine((value, context) => {
    const isFreshNationalTuple =
      value.category === "food_overall" &&
      value.location_key === "ma" &&
      value.series_key === "hcp.ipc2017.01";

    if (isFreshNationalTuple) {
      if (
        value.source_id !== "hcp-ipc-2017-official-g1-monthly" ||
        value.context_role !== "fresh_national_context" ||
        value.geography_type !== "country"
      ) {
        context.addIssue({
          code: "custom",
          message: "fresh_national_context_observation_mismatch",
          path: ["context_role"],
        });
      }
    } else {
      if (value.source_id !== "hcp-ipc-2017-monthly") {
        context.addIssue({
          code: "custom",
          message: "historical_detailed_context_observation_mismatch",
          path: ["context_role"],
        });
      }
      if (value.context_role !== "historical_detailed_context") {
        context.addIssue({
          code: "custom",
          message: "fresh_national_context_observation_mismatch",
          path: ["context_role"],
        });
      }
    }

    if (
      (value.location_key === "ma" && value.geography_type !== "country") ||
      (value.location_key !== "ma" && value.geography_type !== "city")
    ) {
      context.addIssue({
        code: "custom",
        message: "geography_type_location_mismatch",
        path: ["geography_type"],
      });
    }

    if (
      value.category === "food_overall" &&
      value.granularity !== "division"
    ) {
      context.addIssue({
        code: "custom",
        message: "food_overall_requires_division",
        path: ["granularity"],
      });
    }
    if (
      value.category !== "food_overall" &&
      value.granularity !== "group_of_products"
    ) {
      context.addIssue({
        code: "custom",
        message: "detailed_categories_require_group_of_products",
        path: ["granularity"],
      });
    }
  });

function compareObservations(
  left: ConsumerV2Observation,
  right: ConsumerV2Observation,
): number {
  return (
    compareCodeUnits(left.series_key, right.series_key) ||
    compareCodeUnits(left.location_key, right.location_key) ||
    compareCodeUnits(left.period_start, right.period_start) ||
    left.revision_number - right.revision_number
  );
}

const ConsumerV2PayloadBaseSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    consumer_contract: z.literal(CONSUMER_V2_CONTRACT),
    source_snapshot_tag: SnapshotTagSchema,
    source_snapshot_id: Sha256Schema,
    generated_at: IsoTimestampSchema,
    profile_id: z.literal(CONSUMER_V2_PROFILE),
    contains_confidential_data: z.literal(false),
    decision_scope: z.literal("observation_only"),
    coverage_start: IsoDateSchema,
    coverage_end: IsoDateSchema,
    sources: z.array(ConsumerV2SourceSchema).min(1),
    observations: z.array(ConsumerV2ObservationSchema).min(1),
  })
  .strict();

export type ConsumerV2Payload = z.infer<typeof ConsumerV2PayloadBaseSchema>;

export const ConsumerV2PayloadSchema: z.ZodType<ConsumerV2Payload> =
  ConsumerV2PayloadBaseSchema.superRefine((value, context) => {
    if (
      value.source_snapshot_tag.slice(-12) !==
      value.source_snapshot_id.slice(0, 12)
    ) {
      context.addIssue({
        code: "custom",
        message: "source_snapshot_tag_snapshot_mismatch",
        path: ["source_snapshot_tag"],
      });
    }

    if (!isExactSortedSourcePair(value.sources.map((source) => source.source_id))) {
      context.addIssue({
        code: "custom",
        message: "sources_must_be_exact_sorted_pair",
        path: ["sources"],
      });
    }

    const observationKeys = value.observations.map(
      (observation) =>
        `${observation.series_key}|${observation.location_key}|${observation.period_start}|${String(observation.revision_number)}`,
    );
    const observationsAreSorted = value.observations.every(
      (observation, index) => {
        const previous = value.observations[index - 1];
        return (
          index === 0 ||
          (previous !== undefined &&
            compareObservations(previous, observation) < 0)
        );
      },
    );
    if (
      new Set(observationKeys).size !== observationKeys.length ||
      !observationsAreSorted
    ) {
      context.addIssue({
        code: "custom",
        message: "observations_must_be_sorted_and_unique",
        path: ["observations"],
      });
    }
  });

const ConsumerV2PayloadDescriptorSchema = z
  .object({
    name: z.literal("consumer-v2.json"),
    byte_length: z.int().positive(),
    sha256: Sha256Schema,
  })
  .strict();

const ConsumerV2IndexBaseSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    consumer_contract: z.literal(CONSUMER_V2_CONTRACT),
    source_snapshot_tag: SnapshotTagSchema,
    source_snapshot_id: Sha256Schema,
    contains_confidential_data: z.literal(false),
    decision_scope: z.literal("observation_only"),
    created_at: IsoTimestampSchema,
    code_sha: GitShaSchema,
    indicator_count: z.int().positive(),
    observation_count: z.int().positive(),
    coverage_start: IsoDateSchema,
    coverage_end: IsoDateSchema,
    source_ids: z.array(z.enum(V2_SOURCE_IDS)).min(1),
    payload: ConsumerV2PayloadDescriptorSchema,
  })
  .strict();

export type ConsumerV2Index = z.infer<typeof ConsumerV2IndexBaseSchema>;

export const ConsumerV2IndexSchema: z.ZodType<ConsumerV2Index> =
  ConsumerV2IndexBaseSchema.superRefine((value, context) => {
    if (
      value.source_snapshot_tag.slice(-12) !==
      value.source_snapshot_id.slice(0, 12)
    ) {
      context.addIssue({
        code: "custom",
        message: "source_snapshot_tag_snapshot_mismatch",
        path: ["source_snapshot_tag"],
      });
    }

    if (!isExactSortedSourcePair(value.source_ids)) {
      context.addIssue({
        code: "custom",
        message: "source_ids_must_be_exact_sorted_pair",
        path: ["source_ids"],
      });
    }
  });
