import {
  ObservationCandidateSchema,
  ParsedDatasetSchema,
  QualityReportSchema,
  RawArtifactSchema,
  SCHEMA_VERSION,
  type ObservationCandidate,
  type ParsedDataset,
  type QualityReport,
  type RawArtifact,
} from "@data-hub/contracts";

const RETRIEVED_AT = "2026-08-26T12:00:00.000Z";

export function rawArtifact(sha256 = "a".repeat(64)): RawArtifact {
  return RawArtifactSchema.parse({
    schema_version: SCHEMA_VERSION,
    source_id: "hcp-ipc-2017-monthly",
    original_url: "https://data.gov.ma/data/example.xlsx",
    retrieved_at: RETRIEVED_AT,
    http_etag: null,
    http_last_modified: null,
    content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    byte_length: 100,
    original_filename: "example.xlsx",
    sha256,
    parser_kind: "hcp-index-workbook",
    parser_profile: "ipc-2017",
    licence_snapshot: {
      id: "ODbL-1.0",
      evidence_url: "https://data.gov.ma/data/fr/dataset/data_7_5",
      permits_internal_derived_use: true,
      permits_redistribution: true,
    },
    source_publication_period: null,
    predecessor_sha256: null,
    artifact_path: `raw/hcp-ipc-2017-monthly/${sha256}/artifact`,
    manifest_path: `manifests/artifacts/${sha256}.json`,
  });
}

export function candidate(
  overrides: Partial<ObservationCandidate> = {},
): ObservationCandidate {
  return ObservationCandidateSchema.parse({
    schema_version: SCHEMA_VERSION,
    natural_key: "hcp.ipc2017.0113|ma|2017-01",
    series_key: "hcp.ipc2017.0113",
    source_series_label: "(0113) POISSON ET FRUITS DE MER",
    period_start: "2017-01-01",
    period_end: "2017-01-31",
    frequency: "monthly",
    value: "95.4",
    unit: "index",
    currency: null,
    scaling_factor: "1",
    geography_type: "country",
    location_key: "ma",
    source_id: "hcp-ipc-2017-monthly",
    artifact_sha256: "a".repeat(64),
    source_row: 5,
    source_column: 4,
    retrieved_at: RETRIEVED_AT,
    source_published_at: null,
    scalar_reproducible: true,
    ...overrides,
  });
}

export function parsedDataset(
  observations: ObservationCandidate[] = [candidate()],
): ParsedDataset {
  return ParsedDatasetSchema.parse({
    schema_version: SCHEMA_VERSION,
    source_id: "hcp-ipc-2017-monthly",
    artifact_sha256: "a".repeat(64),
    parser_kind: "hcp-index-workbook",
    parser_profile: "ipc-2017",
    frequency: "monthly",
    unit: "index",
    base_year: 2017,
    observations,
    warning_codes: [],
    parser_errors: [],
    observed_labels: ["(0113) POISSON ET FRUITS DE MER"],
  });
}

export function qualityReport(
  status: "accepted" | "accepted_with_warning" | "quarantined" = "accepted",
): QualityReport {
  const quarantined = status === "quarantined";
  return QualityReportSchema.parse({
    schema_version: SCHEMA_VERSION,
    source_id: "hcp-ipc-2017-monthly",
    artifact_sha256: "a".repeat(64),
    status,
    evaluated_at: RETRIEVED_AT,
    gates: [
      {
        code: "source_qualified",
        severity: "mandatory",
        passed: true,
        details: {},
      },
      ...(quarantined
        ? [{ code: "test_quarantine", severity: "mandatory" as const, passed: false, details: {} }]
        : []),
    ],
    failed_gate_codes: quarantined ? ["test_quarantine"] : [],
    warning_codes: status === "accepted_with_warning" ? ["test_warning"] : [],
    input_observation_count: 1,
    accepted_observation_count: quarantined ? 0 : 1,
    quarantined_observation_count: quarantined ? 1 : 0,
  });
}
