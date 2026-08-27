import assert from "node:assert/strict";
import test from "node:test";

import {
  SourceDefinitionSchema,
  type SourceDefinition,
} from "@data-hub/contracts";
import {
  assessFreshness,
  deriveSourceHealth,
  evaluateQuality,
} from "@data-hub/quality";
import { HCP_IPC_2017_SOURCE } from "@data-hub/source-registry";

import {
  candidate,
  parsedDataset,
} from "./test-factories.js";

const NOW = "2026-08-26T00:00:00.000Z";

function source(
  overrides: Partial<SourceDefinition>,
): SourceDefinition {
  return SourceDefinitionSchema.parse({
    ...HCP_IPC_2017_SOURCE,
    ...overrides,
  });
}

void test("quarantines a conflicting natural key", () => {
  const parsed = parsedDataset([
    candidate({ natural_key: "series|ma|2025-01", value: "100" }),
    candidate({ natural_key: "series|ma|2025-01", value: "101" }),
  ]);
  const report = evaluateQuality({ source: HCP_IPC_2017_SOURCE, parsed, now: NOW });
  assert.equal(report.status, "quarantined");
  assert.equal(report.failed_gate_codes.includes("conflicting_natural_key"), true);
});

void test("publishes historical data with an explicit stale warning", () => {
  const report = evaluateQuality({
    source: HCP_IPC_2017_SOURCE,
    parsed: parsedDataset([candidate()]),
    now: NOW,
    remoteLastModified: "2025-02-06T12:15:45.000Z",
  });
  assert.equal(report.status, "accepted_with_warning");
  assert.equal(report.warning_codes.includes("source_stale"), true);
  assert.equal(
    deriveSourceHealth({ source: HCP_IPC_2017_SOURCE, report, now: NOW }).status,
    "stale",
  );
});

void test("blocks candidate, disabled and licence-blocked sources", () => {
  const candidateSource = source({ authority_level: "candidate" });
  const disabledSource = source({ enabled: false, access_mode: "disabled" });
  const blockedLicence = source({
    licence: {
      ...HCP_IPC_2017_SOURCE.licence,
      permits_internal_derived_use: false,
    },
  });
  for (const [inputSource, code] of [
    [candidateSource, "source_unqualified"],
    [disabledSource, "source_disabled"],
    [blockedLicence, "licence_blocked"],
  ] as const) {
    const report = evaluateQuality({
      source: inputSource,
      parsed: parsedDataset(),
      now: NOW,
    });
    assert.equal(report.failed_gate_codes.includes(code), true);
  }
});

void test("quarantines parser errors, empty rows and invalid index metadata", () => {
  const parserError = parsedDataset();
  parserError.parser_errors.push("invalid_identity_header");
  const empty = parsedDataset([]);
  const wrongUnit = parsedDataset();
  wrongUnit.unit = "MAD";
  const wrongBase = parsedDataset();
  wrongBase.base_year = 2010;

  for (const parsed of [parserError, empty, wrongUnit, wrongBase]) {
    assert.equal(
      evaluateQuality({ source: HCP_IPC_2017_SOURCE, parsed, now: NOW }).status,
      "quarantined",
    );
  }
});

void test("collapses exact duplicates without treating them as a conflict", () => {
  const exact = candidate();
  const report = evaluateQuality({
    source: HCP_IPC_2017_SOURCE,
    parsed: parsedDataset([exact, { ...exact }]),
    now: NOW,
  });
  assert.equal(report.status, "accepted");
  assert.equal(report.accepted_observation_count, 1);
});

void test("warns on coverage shrinkage and a newly observed label", () => {
  const report = evaluateQuality({
    source: HCP_IPC_2017_SOURCE,
    parsed: parsedDataset([
      candidate({
        period_start: "2017-02-01",
        period_end: "2017-02-28",
        natural_key: "hcp.ipc2017.0113|ma|2017-02",
      }),
    ]),
    now: NOW,
    previousCoverage: {
      firstPeriodStart: "2017-01-01",
      lastPeriodEnd: "2017-02-28",
      seriesCount: 1,
      locationCount: 1,
      labels: ["ancienne série"],
    },
  });
  assert.equal(report.status, "accepted_with_warning");
  assert.equal(report.warning_codes.includes("coverage_shrinkage"), true);
  assert.equal(report.warning_codes.includes("new_label"), true);
});

void test("assesses unchanged source freshness without reparsing", () => {
  assert.equal(
    assessFreshness({
      source: HCP_IPC_2017_SOURCE,
      now: "2026-08-26T00:00:00.000Z",
      remoteLastModified: "2026-04-01T00:00:00.000Z",
    }),
    "source_stale",
  );
});
