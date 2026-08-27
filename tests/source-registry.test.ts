import assert from "node:assert/strict";
import test from "node:test";

import {
  HCP_IPC_2017_SOURCE,
  HCP_IPP_2018_SOURCE,
  getSourceDefinition,
  listEnabledSourceDefinitions,
} from "@data-hub/source-registry";

void test("registers only the two qualified monthly HCP sources", () => {
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

void test("fails closed for an unknown source", () => {
  assert.throws(
    () => getSourceDefinition("onp-daily"),
    /unknown_source:onp-daily/,
  );
});

void test("lists enabled sources in stable source-id order", () => {
  assert.deepEqual(
    listEnabledSourceDefinitions().map((source) => source.source_id),
    ["hcp-ipc-2017-monthly", "hcp-ipp-2018-monthly"],
  );
});
