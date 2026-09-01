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

import { enforceZipLimits, sectorSlug } from "./hcp-index-workbook.js";
import { parseHcpMonthHeader, type HcpMonthPeriod } from "./hcp-period.js";

export interface ParseHcpOfficialIndicatorWorkbookInput {
  source: SourceDefinition;
  artifact: RawArtifact;
  bytes: Uint8Array;
  retrievedAt: string;
}

const IPC_G1_LABELS = Object.freeze({
  "Produits alimentaires et boissons non alcoolisées": "hcp.ipc2017.01",
  "Boissons alcoolisées, tabac et stupéfiants": "hcp.ipc2017.02",
  "Articles d'habillement et chaussures": "hcp.ipc2017.03",
  "Logement, eau, gaz, électricité et autres combustibles": "hcp.ipc2017.04",
  "Meubles, articles de ménage et entretien courant du foyer": "hcp.ipc2017.05",
});

const IPC_G2_LABELS = Object.freeze({
  Transports: "hcp.ipc2017.07",
  Communications: "hcp.ipc2017.08",
  "Loisirs et culture": "hcp.ipc2017.09",
  Enseignement: "hcp.ipc2017.10",
  "Restaurants et hôtels": "hcp.ipc2017.11",
});

const IPPI_G1_LABELS = Object.freeze([
  "Industries alimentaires",
  "Fabrication de Boissons",
  "Fabrication de produits à base de tabac",
  "Fabrication de textiles",
  "Industrie d'habillement",
  "Industrie de cuir et de la chaussure",
  "Travail du bois et fabrication d'articles en bois",
]);

const IPPI_G2_LABELS = Object.freeze([
  "Imprimerie et reproduction d’enregistrement",
  "Cokéfaction et raffinage",
  "Industrie chimique",
  "Industrie pharmaceutique",
  "Fabrication de produits en caoutchouc et en plastique",
  "Fabrication d'autres produits minéraux non métalliques",
]);

const IPPI_G3_LABELS = Object.freeze([
  "Fabrication de produits métalliques",
  "Fabrication de produits informatique",
  "Fabrication d’équipements électriques",
  "Fabrication de machines et équipements n.c.a",
  "Industrie automobile",
  "Fabrication d'autres matériels de transport",
  "fabrication de meubles",
]);

function ippiLabelMap(labels: readonly string[]): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(labels.map((label) => [label, `hcp.ipp2018.${sectorSlug(label)}`])),
  );
}

const PROFILES = Object.freeze({
  "ipc-2017-official-g1": Object.freeze({
    sourceId: "hcp-ipc-2017-official-g1-monthly",
    headerRow: 24,
    firstDataRow: 25,
    dateColumn: 2,
    firstValueColumn: 3,
    lastValueColumn: 7,
    baseYear: 2017,
    dateKind: "string" as const,
    labelToKey: IPC_G1_LABELS,
  }),
  "ipc-2017-official-g2": Object.freeze({
    sourceId: "hcp-ipc-2017-official-g2-monthly",
    headerRow: 24,
    firstDataRow: 25,
    dateColumn: 2,
    firstValueColumn: 3,
    lastValueColumn: 7,
    baseYear: 2017,
    dateKind: "string" as const,
    labelToKey: IPC_G2_LABELS,
  }),
  "ippi-2018-official-g1": Object.freeze({
    sourceId: "hcp-ippi-2018-official-g1-monthly",
    headerRow: 22,
    firstDataRow: 23,
    dateColumn: 2,
    firstValueColumn: 3,
    lastValueColumn: 9,
    baseYear: 2018,
    dateKind: "date" as const,
    labelToKey: ippiLabelMap(IPPI_G1_LABELS),
  }),
  "ippi-2018-official-g2": Object.freeze({
    sourceId: "hcp-ippi-2018-official-g2-monthly",
    headerRow: 22,
    firstDataRow: 23,
    dateColumn: 2,
    firstValueColumn: 3,
    lastValueColumn: 8,
    baseYear: 2018,
    dateKind: "date" as const,
    labelToKey: ippiLabelMap(IPPI_G2_LABELS),
  }),
  "ippi-2018-official-g3": Object.freeze({
    sourceId: "hcp-ippi-2018-official-g3-monthly",
    headerRow: 22,
    firstDataRow: 23,
    dateColumn: 2,
    firstValueColumn: 3,
    lastValueColumn: 9,
    baseYear: 2018,
    dateKind: "date" as const,
    labelToKey: ippiLabelMap(IPPI_G3_LABELS),
  }),
});

type ProfileName = keyof typeof PROFILES;
type Profile = (typeof PROFILES)[ProfileName];

const MONTH_TOKENS = Object.freeze([
  "Janv",
  "Févr",
  "Mars",
  "Avr",
  "Mai",
  "Juin",
  "Juill",
  "Août",
  "Sept",
  "Oct",
  "Nov",
  "Déc",
]);

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isProfileName(value: string): value is ProfileName {
  return Object.hasOwn(PROFILES, value);
}

function rejectedBaseYear(profile: string): number {
  return profile.includes("2017") ? 2017 : 2018;
}

function emptyParsed(
  input: ParseHcpOfficialIndicatorWorkbookInput,
  parserErrors: string[],
  baseYear = rejectedBaseYear(input.source.parser.profile),
): ParsedDataset {
  return ParsedDatasetSchema.parse({
    schema_version: SCHEMA_VERSION,
    source_id: input.source.source_id,
    artifact_sha256: input.artifact.sha256,
    parser_kind: input.source.parser.kind,
    parser_profile: input.source.parser.profile,
    frequency: "monthly",
    unit: "index",
    base_year: baseYear,
    observations: [],
    warning_codes: [],
    parser_errors: unique(parserErrors),
    observed_labels: [],
  });
}

function plainText(value: ExcelJS.CellValue): string | null {
  return typeof value === "string" ? value : null;
}

function periodFromString(value: ExcelJS.CellValue): HcpMonthPeriod | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})\/(0[1-9]|1[0-2])$/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  const token = MONTH_TOKENS[month - 1];
  const year = match[1];
  return token && year ? parseHcpMonthHeader(`${token}-${year}`) : null;
}

function periodFromDate(value: ExcelJS.CellValue): HcpMonthPeriod | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth() + 1;
  const monthText = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    periodStart: `${String(year)}-${monthText}-01`,
    periodEnd: `${String(year)}-${monthText}-${String(lastDay).padStart(2, "0")}`,
  };
}

function scalarFromCell(
  value: ExcelJS.CellValue,
  allowDash: boolean,
): { kind: "value"; value: string } | { kind: "missing" } | { kind: "error" } {
  if (value === null || value === undefined || value === "") return { kind: "missing" };
  if (value === "-") return allowDash ? { kind: "missing" } : { kind: "error" };
  if (typeof value !== "number" && typeof value !== "string") return { kind: "error" };
  try {
    const decimal = new Decimal(typeof value === "string" ? value.trim() : value);
    return decimal.isFinite()
      ? { kind: "value", value: decimal.toString() }
      : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

function headerLabels(
  sheet: ExcelJS.Worksheet,
  profile: Profile,
  parserErrors: string[],
): Array<{ column: number; label: string; seriesKey: string }> {
  const labels: Array<{ column: number; label: string; seriesKey: string }> = [];
  const seen = new Set<string>();
  for (
    let column = profile.firstValueColumn;
    column <= profile.lastValueColumn;
    column += 1
  ) {
    const label = plainText(sheet.getCell(profile.headerRow, column).value);
    if (!label) {
      parserErrors.push(`invalid_header:missing_label:${String(column)}`);
      continue;
    }
    if (seen.has(label)) parserErrors.push(`duplicate_label:${label}`);
    seen.add(label);
    const seriesKey = (profile.labelToKey as Readonly<Record<string, string>>)[label];
    if (!seriesKey) {
      parserErrors.push(`unknown_label:${label}`);
      continue;
    }
    labels.push({ column, label, seriesKey });
  }

  const expectedLabels = Object.keys(profile.labelToKey);
  for (const expected of expectedLabels) {
    if (!seen.has(expected)) parserErrors.push(`missing_label:${expected}`);
  }
  labels.forEach(({ label }, index) => {
    if (label !== expectedLabels[index]) {
      parserErrors.push(`label_position_mismatch:${label}`);
    }
  });
  return labels;
}

function sourceErrors(input: ParseHcpOfficialIndicatorWorkbookInput): string[] {
  const errors: string[] = [];
  if (input.source.parser.kind !== "hcp-official-indicator-workbook") {
    errors.push(`invalid_parser_kind:${input.source.parser.kind}`);
  }
  if (input.artifact.source_id !== input.source.source_id) {
    errors.push("artifact_source_mismatch");
  }
  if (
    input.artifact.parser_kind !== input.source.parser.kind ||
    input.artifact.parser_profile !== input.source.parser.profile
  ) {
    errors.push("artifact_parser_mismatch");
  }
  const profileName = input.source.parser.profile;
  if (!isProfileName(profileName)) {
    errors.push(`unsupported_parser_profile:${profileName}`);
  } else if (input.source.source_id !== PROFILES[profileName].sourceId) {
    errors.push(`source_profile_mismatch:${input.source.source_id}`);
  }
  if (Number.isNaN(new Date(input.retrievedAt).getTime())) {
    errors.push("invalid_retrieved_at");
  }
  return errors;
}

export async function parseHcpOfficialIndicatorWorkbook(
  input: ParseHcpOfficialIndicatorWorkbookInput,
): Promise<ParsedDataset> {
  const inputErrors = sourceErrors(input);
  const profileName = input.source.parser.profile;
  if (inputErrors.length > 0 || !isProfileName(profileName)) {
    return emptyParsed(input, inputErrors);
  }
  const profile = PROFILES[profileName];

  await enforceZipLimits(input);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Uint8Array.from(input.bytes).buffer);
  } catch {
    return emptyParsed(input, ["invalid_workbook"], profile.baseYear);
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return emptyParsed(input, ["missing_worksheet"], profile.baseYear);

  const parserErrors: string[] = [];
  const labels = headerLabels(sheet, profile, parserErrors);
  if (parserErrors.length > 0) {
    return emptyParsed(input, [...parserErrors, "empty_observations"], profile.baseYear);
  }

  const retrieved = new Date(input.retrievedAt);
  const retrievedMonth =
    retrieved.getUTCFullYear() * 12 + retrieved.getUTCMonth();
  const observations = [];
  const observedPeriods = new Set<string>();

  for (let rowNumber = profile.firstDataRow; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const dateValue = row.getCell(profile.dateColumn).value;
    const hasValue = labels.some(({ column }) => {
      const value = row.getCell(column).value;
      return value !== null && value !== undefined && value !== "";
    });
    if ((dateValue === null || dateValue === undefined || dateValue === "") && !hasValue) {
      continue;
    }
    const period = profile.dateKind === "string"
      ? periodFromString(dateValue)
      : periodFromDate(dateValue);
    if (!period) {
      parserErrors.push(`invalid_period:${String(rowNumber)}`);
      continue;
    }
    const periodMonth =
      Number(period.periodStart.slice(0, 4)) * 12 +
      Number(period.periodStart.slice(5, 7)) -
      1;
    if (periodMonth > retrievedMonth) {
      parserErrors.push(`future_period:${period.periodStart.slice(0, 7)}`);
      continue;
    }
    const periodKey = period.periodStart.slice(0, 7);
    if (observedPeriods.has(periodKey)) {
      parserErrors.push(`duplicate_period:${periodKey}`);
      continue;
    }
    observedPeriods.add(periodKey);

    for (const { column, label, seriesKey } of labels) {
      const scalar = scalarFromCell(
        row.getCell(column).value,
        label === "Cokéfaction et raffinage",
      );
      if (scalar.kind === "missing") continue;
      if (scalar.kind === "error") {
        parserErrors.push(`unexpected_value:${String(rowNumber)}:${String(column)}`);
        continue;
      }
      observations.push(
        ObservationCandidateSchema.parse({
          schema_version: SCHEMA_VERSION,
          natural_key: `${seriesKey}|ma|${periodKey}`,
          series_key: seriesKey,
          source_series_label: label,
          period_start: period.periodStart,
          period_end: period.periodEnd,
          frequency: "monthly",
          value: scalar.value,
          unit: "index",
          currency: null,
          scaling_factor: "1",
          geography_type: "country",
          location_key: "ma",
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

  if (observations.length === 0) parserErrors.push("empty_observations");
  return ParsedDatasetSchema.parse({
    schema_version: SCHEMA_VERSION,
    source_id: input.source.source_id,
    artifact_sha256: input.artifact.sha256,
    parser_kind: input.source.parser.kind,
    parser_profile: profileName,
    frequency: "monthly",
    unit: "index",
    base_year: profile.baseYear,
    observations,
    warning_codes: [],
    parser_errors: unique(parserErrors),
    observed_labels: Object.keys(profile.labelToKey),
  });
}
