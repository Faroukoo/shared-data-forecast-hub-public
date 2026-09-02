import { z } from "zod";

import { SCHEMA_VERSION } from "./schema-version.js";

const HttpsUrlSchema = z.url().refine((value) => new URL(value).protocol === "https:", {
  message: "https_url_required",
});

const LicenceSchema = z
  .object({
    id: z.string().min(1),
    evidence_url: HttpsUrlSchema,
    permits_internal_derived_use: z.boolean(),
    permits_redistribution: z.boolean(),
  })
  .strict();

const CadenceSchema = z
  .object({
    publication_frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "annual"]),
    normal_publication_lag_days: z.int().positive(),
    poll_interval_days: z.int().positive(),
    warning_age_days: z.int().positive(),
    expiry_age_days: z.int().positive(),
  })
  .strict()
  .refine((value) => value.expiry_age_days >= value.warning_age_days, {
    message: "expiry_must_not_precede_warning",
    path: ["expiry_age_days"],
  });

const CkanConnectorSchema = z
  .object({
    kind: z.literal("ckan"),
    api_base_url: HttpsUrlSchema,
    dataset_id: z.uuid(),
    required_resource_format: z.enum(["CSV", "JSON", "XLSX"]),
  })
  .strict();

const ManualConnectorSchema = z
  .object({
    kind: z.literal("manual"),
    import_directory: z.string().min(1),
  })
  .strict();

const GoogleSheetsXlsxConnectorSchema = z
  .object({
    kind: z.literal("google-sheets-xlsx"),
    spreadsheet_id: z.string().regex(/^[A-Za-z0-9_-]+$/),
    sheet_gid: z.string().regex(/^\d+$/),
  })
  .strict();

const HcpParserSchema = z
  .object({
    kind: z.literal("hcp-index-workbook"),
    profile: z.enum(["ipc-2017", "ipp-2018"]),
  })
  .strict();

const HcpOfficialIndicatorParserSchema = z
  .object({
    kind: z.literal("hcp-official-indicator-workbook"),
    profile: z.enum([
      "ipc-2017-official-g1",
      "ipc-2017-official-g2",
      "ippi-2018-official-g1",
      "ippi-2018-official-g2",
      "ippi-2018-official-g3",
    ]),
  })
  .strict();

export const SourceDefinitionSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    source_id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    publisher_name: z.string().min(1),
    authority_level: z.enum(["official", "licensed", "internal", "candidate"]),
    access_mode: z.enum(["api", "download", "manual", "disabled"]),
    enabled: z.boolean(),
    official_base_url: HttpsUrlSchema,
    licence: LicenceSchema,
    cadence: CadenceSchema,
    connector: z.discriminatedUnion("kind", [
      CkanConnectorSchema,
      ManualConnectorSchema,
      GoogleSheetsXlsxConnectorSchema,
    ]),
    parser: z.discriminatedUnion("kind", [
      HcpParserSchema,
      HcpOfficialIndicatorParserSchema,
    ]),
    geography_scope: z.array(z.enum(["country", "region", "city", "port", "market"])).min(1),
    series_scope: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1),
    owner: z.string().min(1),
    recovery_procedure: z.string().min(1),
  })
  .strict();

export type SourceDefinition = z.infer<typeof SourceDefinitionSchema>;
