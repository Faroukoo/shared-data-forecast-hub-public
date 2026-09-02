import ExcelJS from "exceljs";
import { Decimal } from "decimal.js";

import {
  ObservationCandidateSchema,
  ParsedDatasetSchema,
  SCHEMA_VERSION,
  type ParsedDataset,
  type RawArtifact,
  type SourceDefinition,
} from "@data-hub/contracts";
import { HCP_LOCATION_KEYS } from "@data-hub/source-registry";

import { parseHcpMonthHeader, type HcpMonthPeriod } from "./hcp-period.js";
import { enforceZipLimits } from "./xlsx-zip-limits.js";

export interface ParseHcpWorkbookInput {
  source: SourceDefinition;
  artifact: RawArtifact;
  bytes: Uint8Array;
  retrievedAt: string;
  limits?: {
    maxEntries?: number;
    maxUncompressedBytes?: number;
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function emptyParsed(
  input: ParseHcpWorkbookInput,
  parserErrors: string[],
  warningCodes: string[] = [],
) {
  const profile = input.source.parser.profile;
  return ParsedDatasetSchema.parse({
    schema_version: SCHEMA_VERSION,
    source_id: input.source.source_id,
    artifact_sha256: input.artifact.sha256,
    parser_kind: input.source.parser.kind,
    parser_profile: profile,
    frequency: "monthly",
    unit: "index",
    base_year: profile === "ipc-2017" ? 2017 : 2018,
    observations: [],
    warning_codes: unique(warningCodes),
    parser_errors: unique(parserErrors),
    observed_labels: [],
  });
}

function normalizedText(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function plainCellText(value: ExcelJS.CellValue): string | null {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function metadataFrom(sheet: ExcelJS.Worksheet): Map<string, string> {
  const result = new Map<string, string>();
  for (let rowNumber = 1; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    const key = plainCellText(sheet.getCell(rowNumber, 1).value);
    const value = plainCellText(sheet.getCell(rowNumber, 2).value);
    if (key && value) result.set(normalizedText(key), value);
  }
  return result;
}

function scalarFromCell(
  value: ExcelJS.CellValue,
): { kind: "value"; value: string } | { kind: "missing" } | { kind: "error" } {
  if (value === null || value === undefined || value === "-") return { kind: "missing" };
  let scalar: string | number;
  if (typeof value === "object") {
    if (!("formula" in value) && !("sharedFormula" in value)) return { kind: "error" };
    const result = value.result;
    if (typeof result !== "string" && typeof result !== "number") return { kind: "error" };
    scalar = result;
  } else if (typeof value === "string" || typeof value === "number") {
    scalar = value;
  } else {
    return { kind: "error" };
  }
  try {
    const decimal = new Decimal(typeof scalar === "string" ? scalar.trim() : scalar);
    if (!decimal.isFinite()) return { kind: "error" };
    return { kind: "value", value: decimal.toString() };
  } catch {
    return { kind: "error" };
  }
}

export function sectorSlug(label: string): string {
  return label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function periodColumns(
  sheet: ExcelJS.Worksheet,
  identityColumns: number,
  parserErrors: string[],
): Array<{ column: number; period: HcpMonthPeriod }> {
  const result: Array<{ column: number; period: HcpMonthPeriod }> = [];
  const header = sheet.getRow(4);
  for (let column = identityColumns + 1; column <= header.actualCellCount; column += 1) {
    const raw = plainCellText(header.getCell(column).value);
    if (!raw) {
      parserErrors.push(`missing_period_header:${String(column)}`);
      continue;
    }
    if (/^\d{4}$/.test(raw)) continue;
    const period = parseHcpMonthHeader(raw);
    if (!period) {
      parserErrors.push(`unknown_period_header:${raw}`);
      continue;
    }
    result.push({ column, period });
  }
  return result;
}

export async function parseHcpIndexWorkbook(
  input: ParseHcpWorkbookInput,
): Promise<ParsedDataset> {
  await enforceZipLimits(input);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Uint8Array.from(input.bytes).buffer);
  } catch {
    return emptyParsed(input, ["invalid_workbook"]);
  }
  const data = workbook.getWorksheet("Data");
  const metadataSheet = workbook.getWorksheet("Metadata");
  const missingSheets = [
    ...(data ? [] : ["missing_sheet:Data"]),
    ...(metadataSheet ? [] : ["missing_sheet:Metadata"]),
  ];
  if (!data || !metadataSheet) return emptyParsed(input, missingSheets);

  const metadata = metadataFrom(metadataSheet);
  const periodicity = metadata.get("periodicite");
  const unit = metadata.get("unite");
  const sourceLabel = metadata.get("source");
  const metadataErrors = [
    ...(periodicity ? [] : ["missing_metadata:periodicity"]),
    ...(unit ? [] : ["missing_metadata:unit"]),
    ...(sourceLabel ? [] : ["missing_metadata:source"]),
  ];
  if (periodicity && !normalizedText(periodicity).includes("mensuel")) {
    metadataErrors.push("invalid_periodicity");
  }
  if (unit && normalizedText(unit) !== "indice") metadataErrors.push("invalid_unit");
  if (sourceLabel) {
    const normalizedSource = normalizedText(sourceLabel);
    const acceptedSourceLabels = new Set([
      "haut-commissariat au plan",
      "hcp",
      "division des indices statistiques (hcp)",
    ]);
    if (!acceptedSourceLabels.has(normalizedSource)) {
      metadataErrors.push("invalid_source_label");
    }
  }

  const profile = input.source.parser.profile;
  const identityColumns = profile === "ipc-2017" ? 2 : 1;
  const headers = data.getRow(4);
  const identityHeaderValid =
    profile === "ipc-2017"
      ? plainCellText(headers.getCell(1).value) === "Villes" &&
        plainCellText(headers.getCell(2).value) === "Divisions et groupes de produits"
      : plainCellText(headers.getCell(1).value) === "Secteurs";
  if (!identityHeaderValid) metadataErrors.push("invalid_identity_header");

  const parserErrors = [...metadataErrors];
  const periods = periodColumns(data, identityColumns, parserErrors);
  if (parserErrors.length > 0) return emptyParsed(input, parserErrors);

  const observations = [];
  const warningCodes: string[] = [];
  const observedLabels: string[] = [];
  for (let rowNumber = 5; rowNumber <= data.rowCount; rowNumber += 1) {
    const row = data.getRow(rowNumber);
    const identity = plainCellText(row.getCell(1).value);
    if (!identity) continue;

    let locationKey = "ma";
    let geographyType: "country" | "city" = "country";
    let seriesKey: string;
    let seriesLabel: string;
    if (profile === "ipc-2017") {
      const mappedLocation = (
        HCP_LOCATION_KEYS as Readonly<Record<string, string>>
      )[identity];
      if (!mappedLocation) {
        parserErrors.push(`unknown_location:${identity}`);
        continue;
      }
      locationKey = mappedLocation;
      geographyType = mappedLocation === "ma" ? "country" : "city";
      const label = plainCellText(row.getCell(2).value);
      if (!label) {
        parserErrors.push(`missing_series_label:${String(rowNumber)}`);
        continue;
      }
      const code = /^\(([A-Z0-9]+)\)\s+/.exec(label)?.[1];
      if (!code) {
        parserErrors.push(`invalid_series_label:${String(rowNumber)}`);
        continue;
      }
      seriesLabel = label;
      seriesKey = `hcp.ipc2017.${code.toLowerCase()}`;
    } else {
      seriesLabel = identity;
      const slug = sectorSlug(identity);
      if (!slug) {
        parserErrors.push(`invalid_series_label:${String(rowNumber)}`);
        continue;
      }
      seriesKey = `hcp.ipp2018.${slug}`;
    }
    observedLabels.push(seriesLabel);

    for (const { column, period } of periods) {
      const scalar = scalarFromCell(row.getCell(column).value);
      if (scalar.kind === "missing") {
        warningCodes.push("missing_value_marker");
        continue;
      }
      if (scalar.kind === "error") {
        parserErrors.push("formula_without_cached_scalar");
        continue;
      }
      observations.push(
        ObservationCandidateSchema.parse({
          schema_version: SCHEMA_VERSION,
          natural_key: `${seriesKey}|${locationKey}|${period.periodStart.slice(0, 7)}`,
          series_key: seriesKey,
          source_series_label: seriesLabel,
          period_start: period.periodStart,
          period_end: period.periodEnd,
          frequency: "monthly",
          value: scalar.value,
          unit: "index",
          currency: null,
          scaling_factor: "1",
          geography_type: geographyType,
          location_key: locationKey,
          source_id: input.source.source_id,
          artifact_sha256: input.artifact.sha256,
          source_row: rowNumber,
          source_column: column,
          retrieved_at: input.retrievedAt,
          source_published_at: null,
          scalar_reproducible: true,
        }),
      );
    }
  }

  return ParsedDatasetSchema.parse({
    schema_version: SCHEMA_VERSION,
    source_id: input.source.source_id,
    artifact_sha256: input.artifact.sha256,
    parser_kind: input.source.parser.kind,
    parser_profile: profile,
    frequency: "monthly",
    unit: "index",
    base_year: profile === "ipc-2017" ? 2017 : 2018,
    observations,
    warning_codes: unique(warningCodes),
    parser_errors: unique(parserErrors),
    observed_labels: unique(observedLabels),
  });
}
