import { z } from "zod";

import {
  DecimalStringSchema,
  IsoDateSchema,
  IsoTimestampSchema,
  Sha256Schema,
  SourceHealthStatusSchema,
} from "./pipeline.js";
import { SCHEMA_VERSION } from "./schema-version.js";

export const CONSUMER_CONTRACT = "erp-snack-observation-v1" as const;
export const CONSUMER_PROFILE = "erp-snack-observation-v1" as const;

const SnapshotTagSchema = z
  .string()
  .regex(/^data-\d{8}T\d{6}Z-[a-f0-9]{12}$/);
const GitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);

function isSortedUnique(values: string[]): boolean {
  return (
    new Set(values).size === values.length &&
    values.every(
      (value, index) => index === 0 || value > (values[index - 1] ?? ""),
    )
  );
}

function compareObservations(
  left: ConsumerObservation,
  right: ConsumerObservation,
): number {
  return (
    left.series_key.localeCompare(right.series_key) ||
    left.location_key.localeCompare(right.location_key) ||
    left.period_start.localeCompare(right.period_start) ||
    left.revision_number - right.revision_number
  );
}

export const ConsumerSourceSchema = z
  .object({
    source_id: z.literal("hcp-ipc-2017-monthly"),
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

export type ConsumerSource = z.infer<typeof ConsumerSourceSchema>;

export const ConsumerObservationSchema = z
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
    source_id: z.literal("hcp-ipc-2017-monthly"),
    artifact_sha256: Sha256Schema,
    retrieved_at: IsoTimestampSchema,
    quality_status: z.enum(["accepted", "accepted_with_warning"]),
    warning_codes: z.array(z.string().min(1)),
    revision_number: z.int().positive(),
  })
  .strict();

export type ConsumerObservation = z.infer<
  typeof ConsumerObservationSchema
>;

export const ConsumerPayloadSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    consumer_contract: z.literal(CONSUMER_CONTRACT),
    source_snapshot_tag: SnapshotTagSchema,
    source_snapshot_id: Sha256Schema,
    generated_at: IsoTimestampSchema,
    profile_id: z.literal(CONSUMER_PROFILE),
    contains_confidential_data: z.literal(false),
    decision_scope: z.literal("observation_only"),
    coverage_start: IsoDateSchema,
    coverage_end: IsoDateSchema,
    sources: z.array(ConsumerSourceSchema).min(1),
    observations: z.array(ConsumerObservationSchema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (!isSortedUnique(value.sources.map((source) => source.source_id))) {
      context.addIssue({
        code: "custom",
        message: "sources_must_be_sorted_and_unique",
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

export type ConsumerPayload = z.infer<typeof ConsumerPayloadSchema>;

const ConsumerPayloadDescriptorSchema = z
  .object({
    name: z.literal("consumer-v1.json"),
    byte_length: z.int().positive(),
    sha256: Sha256Schema,
  })
  .strict();

export const ConsumerIndexSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    consumer_contract: z.literal(CONSUMER_CONTRACT),
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
    source_ids: z.array(z.literal("hcp-ipc-2017-monthly")).min(1),
    payload: ConsumerPayloadDescriptorSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!isSortedUnique(value.source_ids)) {
      context.addIssue({
        code: "custom",
        message: "source_ids_must_be_sorted_and_unique",
        path: ["source_ids"],
      });
    }
  });

export type ConsumerIndex = z.infer<typeof ConsumerIndexSchema>;
