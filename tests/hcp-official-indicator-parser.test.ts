import assert from "node:assert/strict";
import test from "node:test";

import {
  parseHcpOfficialIndicatorWorkbook,
} from "@data-hub/parsers";
import {
  HCP_IPC_2017_OFFICIAL_G1_SOURCE,
  HCP_IPC_2017_OFFICIAL_G2_SOURCE,
  HCP_IPC_2017_SOURCE,
  HCP_IPPI_2018_OFFICIAL_G1_SOURCE,
  HCP_IPPI_2018_OFFICIAL_G2_SOURCE,
  HCP_IPPI_2018_OFFICIAL_G3_SOURCE,
} from "@data-hub/source-registry";

import {
  createHcpOfficialIpcFixture,
  createHcpOfficialIppiFixture,
  createWorkbookWithLargeZipExpansion,
  createWorkbookWithManyZipEntries,
  type HcpOfficialIpcProfile,
  type HcpOfficialIppiProfile,
} from "./fixture-workbooks.js";
import { rawArtifactFactory } from "./test-factories.js";

const RETRIEVED_AT = "2026-08-26T12:00:00.000Z";

const profiles = [
  {
    profile: "ipc-2017-official-g1" as const,
    source: HCP_IPC_2017_OFFICIAL_G1_SOURCE,
    labels: [
      "Produits alimentaires et boissons non alcoolisées",
      "Boissons alcoolisées, tabac et stupéfiants",
      "Articles d'habillement et chaussures",
      "Logement, eau, gaz, électricité et autres combustibles",
      "Meubles, articles de ménage et entretien courant du foyer",
    ],
    keys: [
      "hcp.ipc2017.01",
      "hcp.ipc2017.02",
      "hcp.ipc2017.03",
      "hcp.ipc2017.04",
      "hcp.ipc2017.05",
    ],
    baseYear: 2017,
  },
  {
    profile: "ipc-2017-official-g2" as const,
    source: HCP_IPC_2017_OFFICIAL_G2_SOURCE,
    labels: [
      "Transports",
      "Communications",
      "Loisirs et culture",
      "Enseignement",
      "Restaurants et hôtels",
    ],
    keys: [
      "hcp.ipc2017.07",
      "hcp.ipc2017.08",
      "hcp.ipc2017.09",
      "hcp.ipc2017.10",
      "hcp.ipc2017.11",
    ],
    baseYear: 2017,
  },
  {
    profile: "ippi-2018-official-g1" as const,
    source: HCP_IPPI_2018_OFFICIAL_G1_SOURCE,
    labels: [
      "Industries alimentaires",
      "Fabrication de Boissons",
      "Fabrication de produits à base de tabac",
      "Fabrication de textiles",
      "Industrie d'habillement",
      "Industrie de cuir et de la chaussure",
      "Travail du bois et fabrication d'articles en bois",
    ],
    keys: [
      "hcp.ipp2018.industries-alimentaires",
      "hcp.ipp2018.fabrication-de-boissons",
      "hcp.ipp2018.fabrication-de-produits-a-base-de-tabac",
      "hcp.ipp2018.fabrication-de-textiles",
      "hcp.ipp2018.industrie-d-habillement",
      "hcp.ipp2018.industrie-de-cuir-et-de-la-chaussure",
      "hcp.ipp2018.travail-du-bois-et-fabrication-d-articles-en-bois",
    ],
    baseYear: 2018,
  },
  {
    profile: "ippi-2018-official-g2" as const,
    source: HCP_IPPI_2018_OFFICIAL_G2_SOURCE,
    labels: [
      "Imprimerie et reproduction d’enregistrement",
      "Cokéfaction et raffinage",
      "Industrie chimique",
      "Industrie pharmaceutique",
      "Fabrication de produits en caoutchouc et en plastique",
      "Fabrication d'autres produits minéraux non métalliques",
    ],
    keys: [
      "hcp.ipp2018.imprimerie-et-reproduction-d-enregistrement",
      "hcp.ipp2018.cokefaction-et-raffinage",
      "hcp.ipp2018.industrie-chimique",
      "hcp.ipp2018.industrie-pharmaceutique",
      "hcp.ipp2018.fabrication-de-produits-en-caoutchouc-et-en-plastique",
      "hcp.ipp2018.fabrication-d-autres-produits-mineraux-non-metalliques",
    ],
    baseYear: 2018,
  },
  {
    profile: "ippi-2018-official-g3" as const,
    source: HCP_IPPI_2018_OFFICIAL_G3_SOURCE,
    labels: [
      "Fabrication de produits métalliques",
      "Fabrication de produits informatique",
      "Fabrication d’équipements électriques",
      "Fabrication de machines et équipements n.c.a",
      "Industrie automobile",
      "Fabrication d'autres matériels de transport",
      "fabrication de meubles",
    ],
    keys: [
      "hcp.ipp2018.fabrication-de-produits-metalliques",
      "hcp.ipp2018.fabrication-de-produits-informatique",
      "hcp.ipp2018.fabrication-d-equipements-electriques",
      "hcp.ipp2018.fabrication-de-machines-et-equipements-n-c-a",
      "hcp.ipp2018.industrie-automobile",
      "hcp.ipp2018.fabrication-d-autres-materiels-de-transport",
      "hcp.ipp2018.fabrication-de-meubles",
    ],
    baseYear: 2018,
  },
] as const;

type OfficialSource = (typeof profiles)[number]["source"];

function artifactFor(source: OfficialSource) {
  return rawArtifactFactory({
    source_id: source.source_id,
    parser_kind: source.parser.kind,
    parser_profile: source.parser.profile,
  });
}

async function fixtureFor(
  profile: HcpOfficialIpcProfile | HcpOfficialIppiProfile,
  options: Parameters<typeof createHcpOfficialIpcFixture>[1] = {},
) {
  return profile.startsWith("ipc-")
    ? createHcpOfficialIpcFixture(profile as HcpOfficialIpcProfile, options)
    : createHcpOfficialIppiFixture(profile as HcpOfficialIppiProfile, options);
}

async function parseProfile(
  entry: (typeof profiles)[number],
  options: Parameters<typeof createHcpOfficialIpcFixture>[1] = {},
) {
  return parseHcpOfficialIndicatorWorkbook({
    source: entry.source,
    artifact: artifactFor(entry.source),
    bytes: await fixtureFor(entry.profile, options),
    retrievedAt: RETRIEVED_AT,
  });
}

for (const entry of profiles) {
  void test(`parses the fixed ${entry.profile} label profile`, async () => {
    const parsed = await parseProfile(entry);
    assert.deepEqual(parsed.parser_errors, []);
    assert.equal(parsed.base_year, entry.baseYear);
    assert.deepEqual(parsed.observed_labels, entry.labels);
    assert.deepEqual(
      [...new Set(parsed.observations.map((row) => row.series_key))].sort(),
      [...entry.keys].sort(),
    );
    assert.equal(
      parsed.observations.length,
      entry.labels.length * 2 - (entry.profile === "ippi-2018-official-g2" ? 1 : 0),
    );
    assert.equal(
      parsed.observations.every(
        (row) =>
          row.location_key === "ma" &&
          row.geography_type === "country" &&
          row.frequency === "monthly" &&
          row.unit === "index" &&
          row.currency === null &&
          row.scaling_factor === "1" &&
          row.scalar_reproducible,
      ),
      true,
    );
  });
}

void test("normalizes IPC string periods, decimals and cell provenance", async () => {
  const parsed = await parseProfile(profiles[0]);
  assert.deepEqual(parsed.observations[0], {
    schema_version: "1.0.0",
    natural_key: "hcp.ipc2017.01|ma|2026-07",
    series_key: "hcp.ipc2017.01",
    source_series_label: "Produits alimentaires et boissons non alcoolisées",
    period_start: "2026-07-01",
    period_end: "2026-07-31",
    frequency: "monthly",
    value: "100.5",
    unit: "index",
    currency: null,
    scaling_factor: "1",
    geography_type: "country",
    location_key: "ma",
    source_id: HCP_IPC_2017_OFFICIAL_G1_SOURCE.source_id,
    artifact_sha256: "a".repeat(64),
    source_row: 25,
    source_column: 3,
    retrieved_at: RETRIEVED_AT,
    source_published_at: null,
    scalar_reproducible: true,
  });
  assert.equal(parsed.observations.at(-1)?.period_start, "2026-08-01");
  assert.equal(parsed.observations.at(-1)?.period_end, "2026-08-31");
});

void test("normalizes IPPI Excel dates and omits only the refining dash", async () => {
  const parsed = await parseProfile(profiles[3]);
  const firstObservation = parsed.observations[0];
  assert.ok(firstObservation);
  assert.equal(firstObservation.source_row, 23);
  assert.equal(firstObservation.source_column, 3);
  assert.equal(firstObservation.period_start, "2026-07-01");
  assert.equal(
    parsed.observations.some(
      (row) =>
        row.series_key === "hcp.ipp2018.cokefaction-et-raffinage" &&
        row.period_start === "2026-07-01",
    ),
    false,
  );
  assert.equal(
    parsed.observations.some(
      (row) => row.series_key === "hcp.ipp2018.cokefaction-et-raffinage",
    ),
    true,
  );
});

void test("rejects a padded label instead of normalizing published provenance", async () => {
  const parsed = await parseProfile(profiles[1], { paddedLabel: true });
  assert.equal(
    parsed.parser_errors.some((error) => error.startsWith("unknown_label:")),
    true,
  );
  assert.deepEqual(parsed.observations, []);
});

void test("rejects surrounding whitespace in a strict YYYY/MM period", async () => {
  const parsed = await parseProfile(profiles[0], { periods: [" 2026/07 "] });
  assert.equal(parsed.parser_errors.includes("invalid_period:25"), true);
  assert.deepEqual(parsed.observations, []);
});

const invalidCases = [
  ["shifted header", { headerRowOffset: 1 }, "invalid_header"],
  ["duplicate label", { duplicateLabel: true }, "duplicate_label"],
  ["unknown label", { unknownLabel: true }, "unknown_label"],
  ["future month", { periods: ["2026/09"] }, "future_period"],
  ["invalid month", { periods: ["2026/13"] }, "invalid_period"],
  ["unexpected string", { unexpectedString: true }, "unexpected_value"],
  ["empty observations", { emptyValues: true }, "empty_observations"],
] as const;

for (const [name, options, expectedError] of invalidCases) {
  void test(`fails closed for ${name}`, async () => {
    const parsed = await parseProfile(profiles[0], options);
    assert.equal(
      parsed.parser_errors.some((error) => error.startsWith(expectedError)),
      true,
    );
  });
}

void test("fails closed for a profile/workbook mismatch", async () => {
  const parsed = await parseHcpOfficialIndicatorWorkbook({
    source: HCP_IPC_2017_OFFICIAL_G2_SOURCE,
    artifact: artifactFor(HCP_IPC_2017_OFFICIAL_G2_SOURCE),
    bytes: await createHcpOfficialIpcFixture("ipc-2017-official-g1"),
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(parsed.parser_errors.length > 0, true);
  assert.deepEqual(parsed.observations, []);
});

void test("fails closed for a non-official source and mismatched artifact metadata", async () => {
  const legacy = await parseHcpOfficialIndicatorWorkbook({
    source: HCP_IPC_2017_SOURCE,
    artifact: rawArtifactFactory(),
    bytes: await createHcpOfficialIpcFixture("ipc-2017-official-g1"),
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(legacy.parser_errors.includes("invalid_parser_kind:hcp-index-workbook"), true);
  assert.deepEqual(legacy.observations, []);

  const mismatchedArtifact = await parseHcpOfficialIndicatorWorkbook({
    source: HCP_IPC_2017_OFFICIAL_G1_SOURCE,
    artifact: rawArtifactFactory(),
    bytes: await createHcpOfficialIpcFixture("ipc-2017-official-g1"),
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(mismatchedArtifact.parser_errors.includes("artifact_source_mismatch"), true);
  assert.equal(mismatchedArtifact.parser_errors.includes("artifact_parser_mismatch"), true);
  assert.deepEqual(mismatchedArtifact.observations, []);
});

void test("rejects an official workbook above the byte limit before loading it", async () => {
  await assert.rejects(
    () =>
      parseHcpOfficialIndicatorWorkbook({
        source: HCP_IPC_2017_OFFICIAL_G1_SOURCE,
        artifact: artifactFor(HCP_IPC_2017_OFFICIAL_G1_SOURCE),
        bytes: new Uint8Array(4 * 1024 * 1024 + 1),
        retrievedAt: RETRIEVED_AT,
      }),
    /workbook_too_large/,
  );
});

void test("rejects an official XLSX with too many ZIP entries before loading it", async () => {
  const bytes = await createWorkbookWithManyZipEntries();
  await assert.rejects(
    () =>
      parseHcpOfficialIndicatorWorkbook({
        source: HCP_IPC_2017_OFFICIAL_G1_SOURCE,
        artifact: artifactFor(HCP_IPC_2017_OFFICIAL_G1_SOURCE),
        bytes,
        retrievedAt: RETRIEVED_AT,
      }),
    /xlsx_too_many_entries/,
  );
});

void test("rejects an official XLSX ZIP bomb before loading it", async () => {
  const bytes = await createWorkbookWithLargeZipExpansion();
  assert.equal(bytes.byteLength < 4 * 1024 * 1024, true);
  await assert.rejects(
    () =>
      parseHcpOfficialIndicatorWorkbook({
        source: HCP_IPC_2017_OFFICIAL_G1_SOURCE,
        artifact: artifactFor(HCP_IPC_2017_OFFICIAL_G1_SOURCE),
        bytes,
        retrievedAt: RETRIEVED_AT,
      }),
    /xlsx_uncompressed_too_large/,
  );
});
