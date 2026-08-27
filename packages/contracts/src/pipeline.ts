import { z } from "zod";

import { SCHEMA_VERSION } from "./schema-version.js";

export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const IsoDateSchema = z.iso.date();
export const IsoTimestampSchema = z.iso.datetime({ offset: true });
export const DecimalStringSchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/)
  .refine((value) => value !== "-0" && !value.endsWith(".0"), {
    message: "decimal_string_not_normalized",
  });

const NullableHttpMetadataSchema = z.string().min(1).nullable();

export const RawArtifactSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    source_id: z.string().min(1),
    original_url: z.url(),
    retrieved_at: IsoTimestampSchema,
    http_etag: NullableHttpMetadataSchema,
    http_last_modified: NullableHttpMetadataSchema,
    content_type: z.string().min(1).nullable(),
    byte_length: z.int().nonnegative(),
    original_filename: z.string().min(1),
    sha256: Sha256Schema,
    parser_kind: z.string().min(1),
    parser_profile: z.string().min(1),
    licence_snapshot: z
      .object({
        id: z.string().min(1),
        evidence_url: z.url(),
        permits_internal_derived_use: z.boolean(),
        permits_redistribution: z.boolean(),
      })
      .strict(),
    source_publication_period: z.string().min(1).nullable(),
    predecessor_sha256: Sha256Schema.nullable(),
    artifact_path: z.string().min(1),
    manifest_path: z.string().min(1),
  })
  .strict();

export type RawArtifact = z.infer<typeof RawArtifactSchema>;

export const ObservationCandidateSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
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
    scalar_reproducible: z.boolean(),
  })
  .strict();

export type ObservationCandidate = z.infer<typeof ObservationCandidateSchema>;

export const ParsedDatasetSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    source_id: z.string().min(1),
    artifact_sha256: Sha256Schema,
    parser_kind: z.string().min(1),
    parser_profile: z.string().min(1),
    frequency: z.enum(["monthly"]),
    unit: z.string().min(1),
    base_year: z.int().positive(),
    observations: z.array(ObservationCandidateSchema),
    warning_codes: z.array(z.string().min(1)),
    parser_errors: z.array(z.string().min(1)),
    observed_labels: z.array(z.string().min(1)),
  })
  .strict();

export type ParsedDataset = z.infer<typeof ParsedDatasetSchema>;

export const QualityStatusSchema = z.enum([
  "accepted",
  "accepted_with_warning",
  "quarantined",
]);

export const QualityGateSchema = z
  .object({
    code: z.string().min(1),
    severity: z.enum(["mandatory", "warning"]),
    passed: z.boolean(),
    details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  })
  .strict();

export const QualityReportSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    source_id: z.string().min(1),
    artifact_sha256: Sha256Schema,
    status: QualityStatusSchema,
    evaluated_at: IsoTimestampSchema,
    gates: z.array(QualityGateSchema),
    failed_gate_codes: z.array(z.string().min(1)),
    warning_codes: z.array(z.string().min(1)),
    input_observation_count: z.int().nonnegative(),
    accepted_observation_count: z.int().nonnegative(),
    quarantined_observation_count: z.int().nonnegative(),
  })
  .strict();

export type QualityReport = z.infer<typeof QualityReportSchema>;

export const SourceHealthStatusSchema = z.enum([
  "healthy",
  "late",
  "stale",
  "schema_changed",
  "quarantined",
  "disabled",
  "licence_blocked",
]);

export const SourceHealthSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    source_id: z.string().min(1),
    status: SourceHealthStatusSchema,
    assessed_at: IsoTimestampSchema,
    reason_codes: z.array(z.string().min(1)),
    remote_last_modified: IsoTimestampSchema.nullable(),
  })
  .strict();

export type SourceHealth = z.infer<typeof SourceHealthSchema>;

export const IngestionRunStateSchema = z.enum([
  "no_change",
  "published",
  "quarantined",
  "failed_retryable",
  "failed_terminal",
]);

export const IngestionRunSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    run_id: z.string().min(1),
    source_id: z.string().min(1),
    access_mode: z.enum(["api", "download", "manual"]),
    operator_id: z.string().min(1).nullable(),
    claimed_publication_period: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
    connector_version: z.string().min(1),
    parser_version: z.string().min(1),
    started_at: IsoTimestampSchema,
    completed_at: IsoTimestampSchema,
    state: IngestionRunStateSchema,
    request_target: z.string().min(1).nullable(),
    http_status: z.int().min(100).max(599).nullable(),
    artifact_sha256: Sha256Schema.nullable(),
    dataset_id: z.string().min(1).nullable(),
    parsed_count: z.int().nonnegative(),
    accepted_count: z.int().nonnegative(),
    warned_count: z.int().nonnegative(),
    quarantined_count: z.int().nonnegative(),
    failure_code: z.string().min(1).nullable(),
    retryable: z.boolean(),
  })
  .strict();

export type IngestionRun = z.infer<typeof IngestionRunSchema>;
