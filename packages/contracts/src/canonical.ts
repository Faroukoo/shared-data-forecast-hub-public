import { z } from "zod";

import {
  DecimalStringSchema,
  IsoDateSchema,
  IsoTimestampSchema,
  QualityStatusSchema,
  Sha256Schema,
} from "./pipeline.js";
import { SCHEMA_VERSION } from "./schema-version.js";

export const CanonicalObservationSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    observation_id: z.string().regex(/^sha256:.+$/),
    natural_key: z.string().min(1),
    series_key: z.string().min(1),
    source_series_label: z.string().min(1),
    period_start: IsoDateSchema,
    period_end: IsoDateSchema,
    frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "annual"]),
    value: DecimalStringSchema,
    unit: z.string().min(1),
    currency: z.string().length(3).nullable(),
    scaling_factor: DecimalStringSchema,
    geography_type: z.enum(["country", "region", "city", "port", "market"]),
    location_key: z.string().min(1),
    source_id: z.string().min(1),
    artifact_sha256: Sha256Schema,
    source_row: z.int().positive(),
    source_column: z.int().positive(),
    retrieved_at: IsoTimestampSchema,
    source_published_at: IsoTimestampSchema.nullable(),
    quality_status: QualityStatusSchema,
    warning_codes: z.array(z.string().min(1)),
    revision_number: z.int().positive(),
    supersedes_observation_id: z.string().regex(/^sha256:.+$/).nullable(),
  })
  .strict();

export type CanonicalObservation = z.infer<typeof CanonicalObservationSchema>;

export const DatasetVersionSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    dataset_id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    created_at: IsoTimestampSchema,
    source_id: z.string().min(1),
    artifact_sha256s: z.array(Sha256Schema).min(1),
    canonical_sha256: Sha256Schema,
    row_count: z.int().nonnegative(),
    first_period_start: IsoDateSchema.nullable(),
    last_period_end: IsoDateSchema.nullable(),
    series_count: z.int().nonnegative(),
    location_count: z.int().nonnegative(),
    warning_count: z.int().nonnegative(),
    tool_versions: z.record(z.string(), z.string().min(1)),
  })
  .strict();

export type DatasetVersion = z.infer<typeof DatasetVersionSchema>;
