import assert from "node:assert/strict";
import test from "node:test";

import {
  HCP_IPC_2017_SOURCE,
  HCP_IPC_2017_OFFICIAL_G1_SOURCE,
  HCP_IPC_2017_OFFICIAL_G2_SOURCE,
  HCP_IPP_2018_SOURCE,
  HCP_IPPI_2018_OFFICIAL_G1_SOURCE,
  HCP_IPPI_2018_OFFICIAL_G2_SOURCE,
  HCP_IPPI_2018_OFFICIAL_G3_SOURCE,
  getSourceDefinition,
  listEnabledSourceDefinitions,
} from "@data-hub/source-registry";

void test("registers the two legacy CKAN monthly HCP sources", () => {
  assert.deepEqual(
    [HCP_IPC_2017_SOURCE, HCP_IPP_2018_SOURCE].map((source) => [
      source.source_id,
      source.connector.kind === "ckan" ? source.connector.dataset_id : null,
      source.parser.profile,
    ]),
    [
      [
        "hcp-ipc-2017-monthly",
        "0ebb73ec-1f04-4854-b73e-a7868b0b18b0",
        "ipc-2017",
      ],
      [
        "hcp-ipp-2018-monthly",
        "59a68619-4bd8-4086-8bea-5a0e4757b4d8",
        "ipp-2018",
      ],
    ],
  );
});

void test("registers the five official HCP workbooks with bounded sheet metadata", () => {
  assert.deepEqual(
    [
      HCP_IPC_2017_OFFICIAL_G1_SOURCE,
      HCP_IPC_2017_OFFICIAL_G2_SOURCE,
      HCP_IPPI_2018_OFFICIAL_G1_SOURCE,
      HCP_IPPI_2018_OFFICIAL_G2_SOURCE,
      HCP_IPPI_2018_OFFICIAL_G3_SOURCE,
    ].map((source) => [
      source.source_id,
      source.connector.kind === "google-sheets-xlsx" ? source.connector.spreadsheet_id : null,
      source.connector.kind === "google-sheets-xlsx" ? source.connector.sheet_gid : null,
      source.parser.profile,
      source.official_base_url,
      source.licence.id,
    ]),
    [
      ["hcp-ipc-2017-official-g1-monthly", "1mwwtnpnnWH6rxnnLuz3j07QYsvxFVci6EKTCZea0t-8", "0", "ipc-2017-official-g1", "https://www.hcp.ma/Indices-des-prix-a-la-consommation-IPC_r348.html", "CC-BY-4.0"],
      ["hcp-ipc-2017-official-g2-monthly", "1mwwtnpnnWH6rxnnLuz3j07QYsvxFVci6EKTCZea0t-8", "1240277578", "ipc-2017-official-g2", "https://www.hcp.ma/Indices-des-prix-a-la-consommation-IPC_r348.html", "CC-BY-4.0"],
      ["hcp-ippi-2018-official-g1-monthly", "1dkerRpPLruxJqxQS7yvQSRwuKbk2tyW5D7DVG0U2Hro", "1228710067", "ippi-2018-official-g1", "https://www.hcp.ma/Indices-des-prix-a-la-production-industrielle-IPPI_r624.html", "CC-BY-4.0"],
      ["hcp-ippi-2018-official-g2-monthly", "1dkerRpPLruxJqxQS7yvQSRwuKbk2tyW5D7DVG0U2Hro", "53126080", "ippi-2018-official-g2", "https://www.hcp.ma/Indices-des-prix-a-la-production-industrielle-IPPI_r624.html", "CC-BY-4.0"],
      ["hcp-ippi-2018-official-g3-monthly", "1dkerRpPLruxJqxQS7yvQSRwuKbk2tyW5D7DVG0U2Hro", "872756965", "ippi-2018-official-g3", "https://www.hcp.ma/Indices-des-prix-a-la-production-industrielle-IPPI_r624.html", "CC-BY-4.0"],
    ],
  );
});

void test("fails closed for an unknown source", () => {
  assert.throws(
    () => getSourceDefinition("onp-daily"),
    /unknown_source:onp-daily/,
  );
});

void test("lists enabled sources in stable source-id order", () => {
  assert.deepEqual(
    listEnabledSourceDefinitions().map((source) => source.source_id),
    [
      "hcp-ipc-2017-monthly",
      "hcp-ipc-2017-official-g1-monthly",
      "hcp-ipc-2017-official-g2-monthly",
      "hcp-ipp-2018-monthly",
      "hcp-ippi-2018-official-g1-monthly",
      "hcp-ippi-2018-official-g2-monthly",
      "hcp-ippi-2018-official-g3-monthly",
    ],
  );
});
