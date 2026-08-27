import {
  ObservationCandidateSchema,
  ParsedDatasetSchema,
  ProductionRunSummarySchema,
  QualityReportSchema,
  RawArtifactSchema,
  SCHEMA_VERSION,
  IngestionRunSchema,
  type IngestionRun,
  type ObservationCandidate,
  type ParsedDataset,
  type ProductionRunSummary,
  type QualityReport,
  type RawArtifact,
} from "@data-hub/contracts";

const RETRIEVED_AT = "2026-08-26T12:00:00.000Z";

export function rawArtifact(sha256 = "a".repeat(64)): RawArtifact {
  return rawArtifactFactory({ sha256 });
}

export function rawArtifactFactory(
  overrides: Partial<RawArtifact> = {},
): RawArtifact {
  const digest = overrides.sha256 ?? "a".repeat(64);
  const sourceId = overrides.source_id ?? "hcp-ipc-2017-monthly";
  return RawArtifactSchema.parse({
    schema_version: SCHEMA_VERSION,
    source_id: sourceId,
    original_url: "https://data.gov.ma/data/example.xlsx",
    retrieved_at: RETRIEVED_AT,
    http_etag: null,
    http_last_modified: null,
    content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    byte_length: 100,
    original_filename: "example.xlsx",
    sha256: digest,
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
    artifact_path: `raw/${sourceId}/${digest}/artifact`,
    manifest_path: `manifests/artifacts/${digest}.json`,
    ...overrides,
  });
}

export function ingestionRunFactory(
  overrides: Partial<IngestionRun> = {},
): IngestionRun {
  const sourceId = overrides.source_id ?? "hcp-ipc-2017-monthly";
  const state = overrides.state ?? "no_change";
  return IngestionRunSchema.parse({
    schema_version: SCHEMA_VERSION,
    run_id: `run:${sourceId}`,
    source_id: sourceId,
    access_mode: "api",
    operator_id: null,
    claimed_publication_period: null,
    connector_version: "0.1.0",
    parser_version: "0.1.0",
    started_at: RETRIEVED_AT,
    completed_at: RETRIEVED_AT,
    state,
    request_target: "https://data.gov.ma/data/api/3/action/package_show?id=",
    http_status: state.startsWith("failed_") ? null : 200,
    artifact_sha256: state.startsWith("failed_") ? null : "a".repeat(64),
    dataset_id: state === "quarantined" || state.startsWith("failed_")
      ? null
      : `sha256:${"b".repeat(64)}`,
    parsed_count: 0,
    accepted_count: 0,
    warned_count: 0,
    quarantined_count: state === "quarantined" ? 1 : 0,
    failure_code: state.startsWith("failed_") ? "request_timeout" : null,
    retryable: state === "failed_retryable",
    ...overrides,
  });
}

export function productionSummaryFactory(
  overrides: Partial<ProductionRunSummary> = {},
): ProductionRunSummary {
  const decision = overrides.decision ?? "no_change";
  const blocking = decision === "blocked";
  const publishable = decision === "publishable";
  return ProductionRunSummarySchema.parse({
    schema_version: SCHEMA_VERSION,
    production_run_id: "production:2026-08-26T12:00:00.000Z",
    started_at: RETRIEVED_AT,
    completed_at: RETRIEVED_AT,
    code_sha: "c".repeat(40),
    decision,
    sources: [
      {
        source_id: "hcp-ipc-2017-monthly",
        run_id: "run:hcp-ipc-2017-monthly",
        state: blocking ? "failed_retryable" : publishable ? "published" : "no_change",
        artifact_sha256: blocking ? null : "a".repeat(64),
        dataset_id: blocking ? null : `sha256:${"b".repeat(64)}`,
        health_status: blocking ? null : "healthy",
        warning_codes: [],
        failure_code: blocking ? "request_timeout" : null,
      },
    ],
    ...overrides,
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
