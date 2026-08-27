import assert from "node:assert/strict";
import test from "node:test";

import {
  parseHcpIndexWorkbook,
  parseHcpMonthHeader,
} from "@data-hub/parsers";
import {
  HCP_IPC_2017_SOURCE,
  HCP_IPP_2018_SOURCE,
} from "@data-hub/source-registry";

import {
  createIpcFixture,
  createIppFixture,
  createWorkbookWithManyZipEntries,
} from "./fixture-workbooks.js";
import { rawArtifact } from "./test-factories.js";

const RETRIEVED_AT = "2026-08-26T12:00:00.000Z";

async function parseIpc(options: Parameters<typeof createIpcFixture>[0] = {}) {
  return parseHcpIndexWorkbook({
    source: HCP_IPC_2017_SOURCE,
    artifact: rawArtifact("a".repeat(64)),
    bytes: await createIpcFixture(options),
    retrievedAt: RETRIEVED_AT,
  });
}

void test("maps monthly IPC cells to exact city observations", async () => {
  const parsed = await parseIpc();
  const observation = parsed.observations[0];
  assert.ok(observation);
  assert.deepEqual(
    {
      series_key: observation.series_key,
      location_key: observation.location_key,
      period_start: observation.period_start,
      period_end: observation.period_end,
      value: observation.value,
      unit: observation.unit,
      source_row: observation.source_row,
      source_column: observation.source_column,
    },
    {
      series_key: "hcp.ipc2017.0113",
      location_key: "ma",
      period_start: "2017-01-01",
      period_end: "2017-01-31",
      value: "95.4",
      unit: "index",
      source_row: 5,
      source_column: 4,
    },
  );
});

void test("records a missing marker without inventing zero", async () => {
  const parsed = await parseIpc();
  assert.equal(parsed.observations.some((row) => row.value === "0"), false);
  assert.equal(parsed.warning_codes.includes("missing_value_marker"), true);
});

void test("accepts every exact French month abbreviation", () => {
  const tokens = [
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
  ];
  assert.deepEqual(
    tokens.map((token) => parseHcpMonthHeader(`${token}-2024`)?.periodStart),
    tokens.map((_token, index) => `2024-${String(index + 1).padStart(2, "0")}-01`),
  );
  assert.equal(parseHcpMonthHeader("Févr-2024")?.periodEnd, "2024-02-29");
  assert.equal(parseHcpMonthHeader("2024"), null);
});

void test("maps monthly IPP sectors to national observations", async () => {
  const parsed = await parseHcpIndexWorkbook({
    source: HCP_IPP_2018_SOURCE,
    artifact: rawArtifact("b".repeat(64)),
    bytes: await createIppFixture(),
    retrievedAt: RETRIEVED_AT,
  });
  const observation = parsed.observations[0];
  assert.ok(observation);
  assert.equal(observation.series_key, "hcp.ipp2018.industries-extractives");
  assert.equal(observation.location_key, "ma");
});

void test("returns parser errors for an unknown city and schema drift", async () => {
  const unknownCity = await parseIpc({ cityLabel: "Ville inventée" });
  assert.equal(unknownCity.parser_errors.includes("unknown_location:Ville inventée"), true);

  const wrongPeriodicity = await parseIpc({ periodicity: "Annuelle" });
  assert.equal(wrongPeriodicity.parser_errors.includes("invalid_periodicity"), true);

  const missingMetadata = await parseIpc({ includeMetadata: false });
  assert.equal(missingMetadata.parser_errors.includes("missing_sheet:Metadata"), true);

  const renamedHeader = await parseIpc({ firstHeader: "Territoires" });
  assert.equal(renamedHeader.parser_errors.includes("invalid_identity_header"), true);
});

void test("reports a formula without a cached scalar", async () => {
  const parsed = await parseIpc({ formulaWithoutResult: true });
  assert.equal(
    parsed.parser_errors.includes("formula_without_cached_scalar"),
    true,
  );
});

void test("accepts the exact official HCP division source label", async () => {
  const parsed = await parseIpc({
    sourceLabel: "Division des Indices Statistiques (HCP)",
  });
  assert.equal(parsed.parser_errors.length, 0);
  assert.equal(parsed.observations.length > 0, true);
});

void test("rejects workbook byte and ZIP expansion limits", async () => {
  await assert.rejects(
    () =>
      parseHcpIndexWorkbook({
        source: HCP_IPC_2017_SOURCE,
        artifact: rawArtifact(),
        bytes: new Uint8Array(4 * 1024 * 1024 + 1),
        retrievedAt: RETRIEVED_AT,
      }),
    /workbook_too_large/,
  );
  const manyEntries = await createWorkbookWithManyZipEntries();
  await assert.rejects(
    () =>
      parseHcpIndexWorkbook({
        source: HCP_IPC_2017_SOURCE,
        artifact: rawArtifact(),
        bytes: manyEntries,
        retrievedAt: RETRIEVED_AT,
      }),
    /xlsx_too_many_entries/,
  );
  const ipcFixture = await createIpcFixture();
  await assert.rejects(
    () =>
      parseHcpIndexWorkbook({
        source: HCP_IPC_2017_SOURCE,
        artifact: rawArtifact(),
        bytes: ipcFixture,
        retrievedAt: RETRIEVED_AT,
        limits: { maxUncompressedBytes: 1 },
      }),
    /xlsx_uncompressed_too_large/,
  );
});
