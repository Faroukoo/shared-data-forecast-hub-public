import assert from "node:assert/strict";
import test from "node:test";
import {
  CanonicalObservationSchema,
  DecimalStringSchema,
  SCHEMA_VERSION,
  SourceDefinitionSchema,
  assertSupportedSchemaVersion,
} from "@data-hub/contracts";

void test("accepts one fully qualified monthly CKAN source", () => {
  const parsed = SourceDefinitionSchema.parse({
    schema_version: SCHEMA_VERSION,
    source_id: "hcp-ipc-2017-monthly",
    publisher_name: "Haut-Commissariat au Plan",
    authority_level: "official",
    access_mode: "api",
    enabled: true,
    official_base_url: "https://data.gov.ma/",
    licence: {
      id: "ODbL-1.0",
      evidence_url: "https://data.gov.ma/data/fr/dataset/data_7_5",
      permits_internal_derived_use: true,
      permits_redistribution: true,
    },
    cadence: {
      publication_frequency: "monthly",
      normal_publication_lag_days: 45,
      poll_interval_days: 7,
      warning_age_days: 60,
      expiry_age_days: 120,
    },
    connector: {
      kind: "ckan",
      api_base_url: "https://data.gov.ma/data/api/3/action/",
      dataset_id: "0ebb73ec-1f04-4854-b73e-a7868b0b18b0",
      required_resource_format: "XLSX",
    },
    parser: { kind: "hcp-index-workbook", profile: "ipc-2017" },
    geography_scope: ["country", "city"],
    series_scope: ["consumer_price_index"],
    owner: "data-hub",
    recovery_procedure: "docs/operations/import-and-recovery.md",
  });
  assert.equal(parsed.source_id, "hcp-ipc-2017-monthly");
});

void test("accepts a bounded official HCP Google Sheets definition", () => {
  const parsed = SourceDefinitionSchema.parse({
    schema_version: SCHEMA_VERSION,
    source_id: "hcp-ipc-2017-official-g1-monthly",
    publisher_name: "Haut-Commissariat au Plan",
    authority_level: "official",
    access_mode: "api",
    enabled: true,
    official_base_url: "https://www.hcp.ma/Indices-des-prix-a-la-consommation-IPC_r348.html",
    licence: {
      id: "CC-BY-4.0",
      evidence_url: "https://www.hcp.ma/Conditions-generales-d-utilisation-Version-1-0_a2194.html",
      permits_internal_derived_use: true,
      permits_redistribution: true,
    },
    cadence: {
      publication_frequency: "monthly",
      normal_publication_lag_days: 45,
      poll_interval_days: 7,
      warning_age_days: 60,
      expiry_age_days: 120,
    },
    connector: {
      kind: "google-sheets-xlsx",
      spreadsheet_id: "1mwwtnpnnWH6rxnnLuz3j07QYsvxFVci6EKTCZea0t-8",
      sheet_gid: "0",
    },
    parser: {
      kind: "hcp-official-indicator-workbook",
      profile: "ipc-2017-official-g1",
    },
    geography_scope: ["country"],
    series_scope: ["consumer_price_index"],
    owner: "data-hub",
    recovery_procedure: "docs/operations/import-and-recovery.md",
  });

  assert.equal(parsed.connector.kind, "google-sheets-xlsx");
  assert.equal(parsed.parser.kind, "hcp-official-indicator-workbook");
});

void test("rejects malformed official HCP connector and parser definitions", () => {
  const definition = {
    schema_version: SCHEMA_VERSION,
    source_id: "hcp-ipc-2017-official-g1-monthly",
    publisher_name: "Haut-Commissariat au Plan",
    authority_level: "official",
    access_mode: "api",
    enabled: true,
    official_base_url: "https://www.hcp.ma/Indices-des-prix-a-la-consommation-IPC_r348.html",
    licence: {
      id: "CC-BY-4.0",
      evidence_url: "https://www.hcp.ma/Conditions-generales-d-utilisation-Version-1-0_a2194.html",
      permits_internal_derived_use: true,
      permits_redistribution: true,
    },
    cadence: {
      publication_frequency: "monthly",
      normal_publication_lag_days: 45,
      poll_interval_days: 7,
      warning_age_days: 60,
      expiry_age_days: 120,
    },
    connector: {
      kind: "google-sheets-xlsx",
      spreadsheet_id: "1mwwtnpnnWH6rxnnLuz3j07QYsvxFVci6EKTCZea0t-8",
      sheet_gid: "0",
    },
    parser: {
      kind: "hcp-official-indicator-workbook",
      profile: "ipc-2017-official-g1",
    },
    geography_scope: ["country"],
    series_scope: ["consumer_price_index"],
    owner: "data-hub",
    recovery_procedure: "docs/operations/import-and-recovery.md",
  };

  assert.equal(
    SourceDefinitionSchema.safeParse({
      ...definition,
      connector: { ...definition.connector, spreadsheet_id: "sheet/one" },
    }).success,
    false,
  );
  assert.equal(
    SourceDefinitionSchema.safeParse({
      ...definition,
      connector: { ...definition.connector, spreadsheet_id: "sheet.one" },
    }).success,
    false,
  );
  assert.equal(
    SourceDefinitionSchema.safeParse({
      ...definition,
      connector: { ...definition.connector, sheet_gid: "gid-1" },
    }).success,
    false,
  );
  assert.equal(
    SourceDefinitionSchema.safeParse({
      ...definition,
      parser: { ...definition.parser, profile: "ipc-unknown" },
    }).success,
    false,
  );
  assert.equal(
    SourceDefinitionSchema.safeParse({
      ...definition,
      official_base_url: "http://www.hcp.ma/indicator",
    }).success,
    false,
  );
  assert.equal(
    SourceDefinitionSchema.safeParse({ ...definition, unexpected: true }).success,
    false,
  );
});

void test("rejects an unknown contract major", () => {
  assert.throws(() => {
    assertSupportedSchemaVersion("2.0.0");
  }, /unsupported_schema_major/);
});

void test("requires exact decimal strings and raw evidence on observations", () => {
  const result = CanonicalObservationSchema.safeParse({
    schema_version: SCHEMA_VERSION,
    observation_id: "sha256:abc",
    natural_key: "hcp.ipc2017|ma|0113|2025-01",
    series_key: "hcp.ipc2017.0113",
    source_series_label: "(0113) POISSON ET FRUITS DE MER",
    period_start: "2025-01-01",
    period_end: "2025-01-31",
    frequency: "monthly",
    value: "112.4",
    unit: "index",
    currency: null,
    scaling_factor: "1",
    geography_type: "country",
    location_key: "ma",
    source_id: "hcp-ipc-2017-monthly",
    artifact_sha256: "a".repeat(64),
    source_row: 10,
    source_column: 99,
    retrieved_at: "2026-08-26T12:00:00.000Z",
    source_published_at: null,
    quality_status: "accepted",
    warning_codes: [],
    revision_number: 1,
    supersedes_observation_id: null,
  });
  assert.equal(result.success, true);
});

void test("rejects binary floating point values", () => {
  const result = DecimalStringSchema.safeParse(112.4);
  assert.equal(result.success, false);
});
