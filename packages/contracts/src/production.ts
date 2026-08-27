import { z } from "zod";

import {
  IngestionRunStateSchema,
  IsoTimestampSchema,
  Sha256Schema,
  SourceHealthStatusSchema,
} from "./pipeline.js";
import { SCHEMA_VERSION } from "./schema-version.js";

const DatasetIdSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const GitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);

function isSortedUnique(values: string[]): boolean {
  return (
    new Set(values).size === values.length &&
    values.every((value, index) => index === 0 || value > (values[index - 1] ?? ""))
  );
}

function requireSortedUnique(
  context: z.RefinementCtx,
  path: "files" | "sources" | "dataset_ids",
  values: string[],
): void {
  if (!isSortedUnique(values)) {
    context.addIssue({
      code: "custom",
      message: `${path}_must_be_sorted_and_unique`,
      path: [path],
    });
  }
}

export const ProductionSourceResultSchema = z
  .object({
    source_id: z.string().min(1),
    run_id: z.string().min(1),
    state: IngestionRunStateSchema,
    artifact_sha256: Sha256Schema.nullable(),
    dataset_id: DatasetIdSchema.nullable(),
    health_status: SourceHealthStatusSchema.nullable(),
    warning_codes: z.array(z.string().min(1)),
    failure_code: z.string().min(1).nullable(),
  })
  .strict();

export type ProductionSourceResult = z.infer<
  typeof ProductionSourceResultSchema
>;

export const ProductionRunSummarySchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    production_run_id: z.string().min(1),
    started_at: IsoTimestampSchema,
    completed_at: IsoTimestampSchema,
    code_sha: GitShaSchema,
    decision: z.enum(["no_change", "publishable", "blocked"]),
    sources: z.array(ProductionSourceResultSchema).min(1),
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
  });

export type ProductionRunSummary = z.infer<typeof ProductionRunSummarySchema>;

export const SnapshotFileSchema = z
  .object({
    path: z.string().min(1),
    byte_length: z.int().nonnegative(),
    sha256: Sha256Schema,
  })
  .strict();

export type SnapshotFile = z.infer<typeof SnapshotFileSchema>;

export const SnapshotManifestSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    snapshot_id: Sha256Schema,
    created_at: IsoTimestampSchema,
    code_sha: GitShaSchema,
    files: z.array(SnapshotFileSchema).min(1),
    sources: z.array(ProductionSourceResultSchema).min(1),
    dataset_ids: z.array(DatasetIdSchema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    requireSortedUnique(
      context,
      "files",
      value.files.map((file) => file.path),
    );
    requireSortedUnique(
      context,
      "sources",
      value.sources.map((source) => source.source_id),
    );
    requireSortedUnique(context, "dataset_ids", value.dataset_ids);
  });

export type SnapshotManifest = z.infer<typeof SnapshotManifestSchema>;

export const SnapshotIndexSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    snapshot_id: Sha256Schema,
    created_at: IsoTimestampSchema,
    code_sha: GitShaSchema,
    previous_snapshot_tag: z
      .string()
      .regex(/^data-\d{8}T\d{6}Z-[a-f0-9]{12}$/)
      .nullable(),
    archive: z
      .object({
        name: z.string().regex(/^data-hub-[a-f0-9]{64}\.tar\.gz$/),
        byte_length: z.int().positive(),
        sha256: Sha256Schema,
      })
      .strict(),
    manifest_sha256: Sha256Schema,
    sources: z.array(ProductionSourceResultSchema).min(1),
    dataset_ids: z.array(DatasetIdSchema).min(1),
    contains_confidential_data: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    requireSortedUnique(
      context,
      "sources",
      value.sources.map((source) => source.source_id),
    );
    requireSortedUnique(context, "dataset_ids", value.dataset_ids);
    if (value.archive.name !== `data-hub-${value.archive.sha256}.tar.gz`) {
      context.addIssue({
        code: "custom",
        message: "archive_name_digest_mismatch",
        path: ["archive", "name"],
      });
    }
  });

export type SnapshotIndex = z.infer<typeof SnapshotIndexSchema>;
