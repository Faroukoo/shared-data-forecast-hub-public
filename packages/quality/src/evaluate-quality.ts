import {
  QualityReportSchema,
  SCHEMA_VERSION,
  SourceHealthSchema,
  type ParsedDataset,
  type QualityReport,
  type SourceDefinition,
  type SourceHealth,
} from "@data-hub/contracts";

type DetailValue = string | number | boolean | null;

interface Gate {
  code: string;
  severity: "mandatory" | "warning";
  passed: boolean;
  details: Record<string, DetailValue>;
}

export interface PreviousCoverage {
  firstPeriodStart: string | null;
  lastPeriodEnd: string | null;
  seriesCount: number;
  locationCount: number;
  labels: string[];
}

export interface EvaluateQualityInput {
  source: SourceDefinition;
  parsed: ParsedDataset;
  now: string;
  remoteLastModified?: string | null;
  previousCoverage?: PreviousCoverage;
}

function fingerprint(row: ParsedDataset["observations"][number]): string {
  return JSON.stringify([
    row.series_key,
    row.period_start,
    row.period_end,
    row.value,
    row.unit,
    row.currency,
    row.scaling_factor,
    row.location_key,
    row.source_id,
  ]);
}

function uniqueObservationCount(parsed: ParsedDataset): {
  uniqueCount: number;
  conflictCount: number;
} {
  const byNaturalKey = new Map<string, Set<string>>();
  for (const row of parsed.observations) {
    const fingerprints = byNaturalKey.get(row.natural_key) ?? new Set<string>();
    fingerprints.add(fingerprint(row));
    byNaturalKey.set(row.natural_key, fingerprints);
  }
  return {
    uniqueCount: byNaturalKey.size,
    conflictCount: [...byNaturalKey.values()].filter((values) => values.size > 1).length,
  };
}

function coverageShrank(
  parsed: ParsedDataset,
  previous: PreviousCoverage | undefined,
): boolean {
  if (!previous || parsed.observations.length === 0) return false;
  const firstObservation = parsed.observations[0];
  if (!firstObservation) return false;
  const first = parsed.observations.reduce(
    (minimum, row) => (row.period_start < minimum ? row.period_start : minimum),
    firstObservation.period_start,
  );
  const last = parsed.observations.reduce(
    (maximum, row) => (row.period_end > maximum ? row.period_end : maximum),
    firstObservation.period_end,
  );
  const seriesCount = new Set(parsed.observations.map((row) => row.series_key)).size;
  const locationCount = new Set(parsed.observations.map((row) => row.location_key)).size;
  return (
    (previous.firstPeriodStart !== null && first > previous.firstPeriodStart) ||
    (previous.lastPeriodEnd !== null && last < previous.lastPeriodEnd) ||
    seriesCount < previous.seriesCount ||
    locationCount < previous.locationCount
  );
}

export type FreshnessCode =
  | "source_stale"
  | "source_late"
  | "invalid_remote_timestamp"
  | "invalid_period_timestamp"
  | "future_period"
  | null;

export interface AssessFreshnessInput {
  source: SourceDefinition;
  now: string;
  remoteLastModified: string | null | undefined;
}

export function assessFreshness(input: AssessFreshnessInput): FreshnessCode {
  if (!input.remoteLastModified) return null;
  const nowMs = Date.parse(input.now);
  const modifiedMs = Date.parse(input.remoteLastModified);
  if (!Number.isFinite(nowMs) || !Number.isFinite(modifiedMs)) {
    return "invalid_remote_timestamp";
  }
  const ageDays = (nowMs - modifiedMs) / 86_400_000;
  if (ageDays > input.source.cadence.expiry_age_days) return "source_stale";
  if (ageDays > input.source.cadence.warning_age_days) return "source_late";
  return null;
}

export interface AssessPeriodFreshnessInput {
  source: SourceDefinition;
  now: string;
  lastPeriodEnd: string | null;
}

function parseUtcCalendarDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
  return new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
}

function utcCalendarDay(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function assessPeriodFreshness(input: AssessPeriodFreshnessInput): FreshnessCode {
  if (!input.lastPeriodEnd) return null;
  const nowMs = Date.parse(input.now);
  const periodEndMs = parseUtcCalendarDate(input.lastPeriodEnd);
  if (!Number.isFinite(nowMs) || periodEndMs === null) {
    return "invalid_period_timestamp";
  }
  const ageDays = (utcCalendarDay(nowMs) - periodEndMs) / 86_400_000;
  if (ageDays < 0) return "future_period";
  if (ageDays > input.source.cadence.expiry_age_days) return "source_stale";
  if (ageDays > input.source.cadence.warning_age_days) return "source_late";
  return null;
}

function expectedBaseYear(source: SourceDefinition): number {
  if (source.parser.kind === "hcp-index-workbook") {
    return source.parser.profile === "ipc-2017" ? 2017 : 2018;
  }
  switch (source.parser.profile) {
    case "ipc-2017-official-g1":
    case "ipc-2017-official-g2":
      return 2017;
    case "ippi-2018-official-g1":
    case "ippi-2018-official-g2":
    case "ippi-2018-official-g3":
      return 2018;
  }
}

function lastPeriodEnd(parsed: ParsedDataset): string | null {
  if (parsed.observations.length === 0) return null;
  return parsed.observations.reduce(
    (latest, row) => (row.period_end > latest ? row.period_end : latest),
    parsed.observations[0]?.period_end ?? "",
  );
}

export function evaluateQuality(input: EvaluateQualityInput): QualityReport {
  const { source, parsed } = input;
  const { uniqueCount, conflictCount } = uniqueObservationCount(parsed);
  const expectedIndexBaseYear = expectedBaseYear(source);
  const invalidLocations = parsed.observations.filter(
    (row) => row.location_key !== "ma" && !row.location_key.startsWith("ma:"),
  ).length;
  const nonReproducible = parsed.observations.filter(
    (row) => !row.scalar_reproducible,
  ).length;

  const gates: Gate[] = [
    {
      code: "source_disabled",
      severity: "mandatory",
      passed: source.enabled && source.access_mode !== "disabled",
      details: { enabled: source.enabled, access_mode: source.access_mode },
    },
    {
      code: "source_unqualified",
      severity: "mandatory",
      passed: source.authority_level !== "candidate",
      details: { authority_level: source.authority_level },
    },
    {
      code: "licence_blocked",
      severity: "mandatory",
      passed: source.licence.permits_internal_derived_use,
      details: { licence_id: source.licence.id },
    },
    {
      code: "parser_error",
      severity: "mandatory",
      passed: parsed.parser_errors.length === 0,
      details: { count: parsed.parser_errors.length },
    },
    {
      code: "empty_observations",
      severity: "mandatory",
      passed: parsed.observations.length > 0,
      details: { count: parsed.observations.length },
    },
    {
      code: "conflicting_natural_key",
      severity: "mandatory",
      passed: conflictCount === 0,
      details: { count: conflictCount },
    },
    {
      code: "invalid_index_metadata",
      severity: "mandatory",
      passed: parsed.unit === "index" && parsed.base_year === expectedIndexBaseYear,
      details: { unit: parsed.unit, base_year: parsed.base_year },
    },
    {
      code: "unknown_location",
      severity: "mandatory",
      passed: invalidLocations === 0,
      details: { count: invalidLocations },
    },
    {
      code: "non_reproducible_scalar",
      severity: "mandatory",
      passed: nonReproducible === 0,
      details: { count: nonReproducible },
    },
  ];

  const warningCodes = [...parsed.warning_codes];
  const publishedPeriodEnd = source.connector.kind === "google-sheets-xlsx"
    ? lastPeriodEnd(parsed)
    : null;
  const freshness = source.connector.kind === "google-sheets-xlsx"
    ? assessPeriodFreshness({
        source,
        now: input.now,
        lastPeriodEnd: publishedPeriodEnd,
      })
    : assessFreshness({
        source,
        now: input.now,
        remoteLastModified: input.remoteLastModified,
      });
  if (freshness === "future_period") {
    gates.push({
      code: freshness,
      severity: "mandatory",
      passed: false,
      details: { last_period_end: publishedPeriodEnd },
    });
  }
  if (freshness && freshness !== "future_period") warningCodes.push(freshness);
  if (coverageShrank(parsed, input.previousCoverage)) {
    warningCodes.push("coverage_shrinkage");
  }
  const previousCoverage = input.previousCoverage;
  if (
    previousCoverage &&
    parsed.observed_labels.some((label) => !previousCoverage.labels.includes(label))
  ) {
    warningCodes.push("new_label");
  }
  for (const warning of [...new Set(warningCodes)]) {
    gates.push({
      code: warning,
      severity: "warning",
      passed: false,
      details: {},
    });
  }

  const failedGateCodes = gates
    .filter((gate) => gate.severity === "mandatory" && !gate.passed)
    .map((gate) => gate.code);
  const uniqueWarnings = [...new Set(warningCodes)];
  const status =
    failedGateCodes.length > 0
      ? "quarantined"
      : uniqueWarnings.length > 0
        ? "accepted_with_warning"
        : "accepted";

  return QualityReportSchema.parse({
    schema_version: SCHEMA_VERSION,
    source_id: source.source_id,
    artifact_sha256: parsed.artifact_sha256,
    status,
    evaluated_at: input.now,
    gates,
    failed_gate_codes: failedGateCodes,
    warning_codes: uniqueWarnings,
    input_observation_count: parsed.observations.length,
    accepted_observation_count: status === "quarantined" ? 0 : uniqueCount,
    quarantined_observation_count:
      status === "quarantined" ? parsed.observations.length : 0,
  });
}

export interface DeriveSourceHealthInput {
  source: SourceDefinition;
  report: QualityReport;
  now: string;
  remoteLastModified?: string | null;
}

export function deriveSourceHealth(input: DeriveSourceHealthInput): SourceHealth {
  let status: SourceHealth["status"] = "healthy";
  if (!input.source.enabled || input.source.access_mode === "disabled") {
    status = "disabled";
  } else if (!input.source.licence.permits_internal_derived_use) {
    status = "licence_blocked";
  } else if (input.report.failed_gate_codes.includes("parser_error")) {
    status = "schema_changed";
  } else if (input.report.status === "quarantined") {
    status = "quarantined";
  } else if (input.report.warning_codes.includes("source_stale")) {
    status = "stale";
  } else if (input.report.warning_codes.includes("source_late")) {
    status = "late";
  }
  return SourceHealthSchema.parse({
    schema_version: SCHEMA_VERSION,
    source_id: input.source.source_id,
    status,
    assessed_at: input.now,
    reason_codes: [
      ...input.report.failed_gate_codes,
      ...input.report.warning_codes,
    ],
    remote_last_modified: input.remoteLastModified ?? null,
  });
}
