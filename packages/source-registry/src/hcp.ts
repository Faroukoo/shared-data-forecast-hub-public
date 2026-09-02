import {
  SCHEMA_VERSION,
  SourceDefinitionSchema,
} from "@data-hub/contracts";

const API_BASE_URL = "https://data.gov.ma/data/api/3/action/";
const RECOVERY_PROCEDURE = "docs/operations/import-and-recovery.md";
const HCP_TERMS_URL =
  "https://www.hcp.ma/Conditions-generales-d-utilisation-Version-1-0_a2194.html";
const HCP_IPC_PAGE_URL =
  "https://www.hcp.ma/Indices-des-prix-a-la-consommation-IPC_r348.html";
const HCP_IPPI_PAGE_URL =
  "https://www.hcp.ma/Indices-des-prix-a-la-production-industrielle-IPPI_r624.html";
const HCP_IPC_SPREADSHEET_ID = "1mwwtnpnnWH6rxnnLuz3j07QYsvxFVci6EKTCZea0t-8";
const HCP_IPPI_SPREADSHEET_ID = "1dkerRpPLruxJqxQS7yvQSRwuKbk2tyW5D7DVG0U2Hro";

export const HCP_LOCATION_KEYS = {
  National: "ma",
  Agadir: "ma:city:agadir",
  "Al Hoceima": "ma:city:al-hoceima",
  "Béni Mellal": "ma:city:beni-mellal",
  Casablanca: "ma:city:casablanca",
  Dakhla: "ma:city:dakhla",
  Errachidia: "ma:city:errachidia",
  "Fès": "ma:city:fes",
  Guelmim: "ma:city:guelmim",
  "Kénitra": "ma:city:kenitra",
  "Laâyoune": "ma:city:laayoune",
  Marrakech: "ma:city:marrakech",
  "Meknès": "ma:city:meknes",
  Oujda: "ma:city:oujda",
  Rabat: "ma:city:rabat",
  Safi: "ma:city:safi",
  Settat: "ma:city:settat",
  Tanger: "ma:city:tanger",
  "Tétouan": "ma:city:tetouan",
} as const;

const common = {
  schema_version: SCHEMA_VERSION,
  publisher_name: "Haut-Commissariat au Plan",
  authority_level: "official" as const,
  access_mode: "api" as const,
  enabled: true,
  official_base_url: "https://data.gov.ma/",
  cadence: {
    publication_frequency: "monthly" as const,
    normal_publication_lag_days: 45,
    poll_interval_days: 7,
    warning_age_days: 60,
    expiry_age_days: 120,
  },
  owner: "data-hub",
  recovery_procedure: RECOVERY_PROCEDURE,
};

export const HCP_IPC_2017_SOURCE = SourceDefinitionSchema.parse({
  ...common,
  source_id: "hcp-ipc-2017-monthly",
  licence: {
    id: "ODbL-1.0",
    evidence_url:
      "https://data.gov.ma/data/fr/dataset/0ebb73ec-1f04-4854-b73e-a7868b0b18b0",
    permits_internal_derived_use: true,
    permits_redistribution: true,
  },
  connector: {
    kind: "ckan",
    api_base_url: API_BASE_URL,
    dataset_id: "0ebb73ec-1f04-4854-b73e-a7868b0b18b0",
    required_resource_format: "XLSX",
  },
  parser: { kind: "hcp-index-workbook", profile: "ipc-2017" },
  geography_scope: ["country", "city"],
  series_scope: ["consumer_price_index"],
});

export const HCP_IPP_2018_SOURCE = SourceDefinitionSchema.parse({
  ...common,
  source_id: "hcp-ipp-2018-monthly",
  licence: {
    id: "ODbL-1.0",
    evidence_url:
      "https://data.gov.ma/data/fr/dataset/59a68619-4bd8-4086-8bea-5a0e4757b4d8",
    permits_internal_derived_use: true,
    permits_redistribution: true,
  },
  connector: {
    kind: "ckan",
    api_base_url: API_BASE_URL,
    dataset_id: "59a68619-4bd8-4086-8bea-5a0e4757b4d8",
    required_resource_format: "XLSX",
  },
  parser: { kind: "hcp-index-workbook", profile: "ipp-2018" },
  geography_scope: ["country"],
  series_scope: ["producer_price_index"],
});

const officialCommon = {
  schema_version: SCHEMA_VERSION,
  publisher_name: "Haut-Commissariat au Plan",
  authority_level: "official" as const,
  access_mode: "api" as const,
  enabled: true,
  licence: {
    id: "CC-BY-4.0",
    evidence_url: HCP_TERMS_URL,
    permits_internal_derived_use: true,
    permits_redistribution: true,
  },
  cadence: common.cadence,
  owner: "data-hub",
  recovery_procedure: RECOVERY_PROCEDURE,
  geography_scope: ["country"],
};

export const HCP_IPC_2017_OFFICIAL_G1_SOURCE = SourceDefinitionSchema.parse({
  ...officialCommon,
  source_id: "hcp-ipc-2017-official-g1-monthly",
  official_base_url: HCP_IPC_PAGE_URL,
  connector: {
    kind: "google-sheets-xlsx",
    spreadsheet_id: HCP_IPC_SPREADSHEET_ID,
    sheet_gid: "0",
  },
  parser: { kind: "hcp-official-indicator-workbook", profile: "ipc-2017-official-g1" },
  series_scope: ["consumer_price_index"],
});

export const HCP_IPC_2017_OFFICIAL_G2_SOURCE = SourceDefinitionSchema.parse({
  ...officialCommon,
  source_id: "hcp-ipc-2017-official-g2-monthly",
  official_base_url: HCP_IPC_PAGE_URL,
  connector: {
    kind: "google-sheets-xlsx",
    spreadsheet_id: HCP_IPC_SPREADSHEET_ID,
    sheet_gid: "1240277578",
  },
  parser: { kind: "hcp-official-indicator-workbook", profile: "ipc-2017-official-g2" },
  series_scope: ["consumer_price_index"],
});

export const HCP_IPPI_2018_OFFICIAL_G1_SOURCE = SourceDefinitionSchema.parse({
  ...officialCommon,
  source_id: "hcp-ippi-2018-official-g1-monthly",
  official_base_url: HCP_IPPI_PAGE_URL,
  connector: {
    kind: "google-sheets-xlsx",
    spreadsheet_id: HCP_IPPI_SPREADSHEET_ID,
    sheet_gid: "1228710067",
  },
  parser: { kind: "hcp-official-indicator-workbook", profile: "ippi-2018-official-g1" },
  series_scope: ["producer_price_index"],
});

export const HCP_IPPI_2018_OFFICIAL_G2_SOURCE = SourceDefinitionSchema.parse({
  ...officialCommon,
  source_id: "hcp-ippi-2018-official-g2-monthly",
  official_base_url: HCP_IPPI_PAGE_URL,
  connector: {
    kind: "google-sheets-xlsx",
    spreadsheet_id: HCP_IPPI_SPREADSHEET_ID,
    sheet_gid: "53126080",
  },
  parser: { kind: "hcp-official-indicator-workbook", profile: "ippi-2018-official-g2" },
  series_scope: ["producer_price_index"],
});

export const HCP_IPPI_2018_OFFICIAL_G3_SOURCE = SourceDefinitionSchema.parse({
  ...officialCommon,
  source_id: "hcp-ippi-2018-official-g3-monthly",
  official_base_url: HCP_IPPI_PAGE_URL,
  connector: {
    kind: "google-sheets-xlsx",
    spreadsheet_id: HCP_IPPI_SPREADSHEET_ID,
    sheet_gid: "872756965",
  },
  parser: { kind: "hcp-official-indicator-workbook", profile: "ippi-2018-official-g3" },
  series_scope: ["producer_price_index"],
});
