import assert from "node:assert/strict";
import test from "node:test";

import {
  SourceDefinitionSchema,
  type SourceDefinition,
} from "@data-hub/contracts";
import {
  assessFreshness,
  assessPeriodFreshness,
  deriveSourceHealth,
  evaluateQuality,
} from "@data-hub/quality";
import {
  HCP_IPC_2017_OFFICIAL_G1_SOURCE,
  HCP_IPC_2017_OFFICIAL_G2_SOURCE,
  HCP_IPC_2017_SOURCE,
  HCP_IPPI_2018_OFFICIAL_G1_SOURCE,
  HCP_IPPI_2018_OFFICIAL_G2_SOURCE,
  HCP_IPPI_2018_OFFICIAL_G3_SOURCE,
  HCP_IPP_2018_SOURCE,
} from "@data-hub/source-registry";

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

void test("quarantines coverage shrinkage instead of accepting a partial replacement", () => {
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
      labels: ["(0113) POISSON ET FRUITS DE MER"],
      naturalKeys: [
        "hcp.ipc2017.0113|ma|2017-01",
        "hcp.ipc2017.0113|ma|2017-02",
      ],
    },
  });
  assert.equal(report.status, "quarantined");
  assert.equal(report.failed_gate_codes.includes("coverage_shrinkage"), true);
  assert.equal(report.warning_codes.includes("coverage_shrinkage"), false);
  assert.equal(report.accepted_observation_count, 0);
});

void test("quarantines a newly observed label instead of normalizing it", () => {
  const report = evaluateQuality({
    source: HCP_IPC_2017_SOURCE,
    parsed: parsedDataset(),
    now: NOW,
    previousCoverage: {
      firstPeriodStart: "2017-01-01",
      lastPeriodEnd: "2017-01-31",
      seriesCount: 1,
      locationCount: 1,
      labels: ["ancienne série"],
      naturalKeys: ["hcp.ipc2017.0113|ma|2017-01"],
    },
  });
  assert.equal(report.status, "quarantined");
  assert.equal(report.failed_gate_codes.includes("new_label"), true);
  assert.equal(report.warning_codes.includes("new_label"), false);
  assert.equal(report.accepted_observation_count, 0);
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

void test("assesses published period freshness at calendar-day boundaries", () => {
  for (const [now, expected] of [
    ["2026-08-28T00:00:00.000Z", null],
    ["2026-08-29T00:00:00.000Z", null],
    ["2026-08-30T00:00:00.000Z", "source_late"],
    ["2026-10-28T00:00:00.000Z", "source_late"],
    ["2026-10-29T00:00:00.000Z", "source_stale"],
  ] as const) {
    assert.equal(
      assessPeriodFreshness({
        source: HCP_IPC_2017_OFFICIAL_G1_SOURCE,
        now,
        lastPeriodEnd: "2026-06-30",
      }),
      expected,
    );
  }
});

void test("uses complete calendar months when assessing a published period", () => {
  assert.equal(
    assessPeriodFreshness({
      source: HCP_IPC_2017_OFFICIAL_G1_SOURCE,
      now: "2026-04-29T00:00:00.000Z",
      lastPeriodEnd: "2026-02-28",
    }),
    null,
  );
});

void test("rejects missing, invalid and future published periods", () => {
  assert.equal(
    assessPeriodFreshness({
      source: HCP_IPC_2017_OFFICIAL_G1_SOURCE,
      now: NOW,
      lastPeriodEnd: null,
    }),
    null,
  );
  assert.equal(
    assessPeriodFreshness({
      source: HCP_IPC_2017_OFFICIAL_G1_SOURCE,
      now: "not-a-timestamp",
      lastPeriodEnd: "2026-06-30",
    }),
    "invalid_period_timestamp",
  );
  assert.equal(
    assessPeriodFreshness({
      source: HCP_IPC_2017_OFFICIAL_G1_SOURCE,
      now: NOW,
      lastPeriodEnd: "not-a-period",
    }),
    "invalid_period_timestamp",
  );
  assert.equal(
    assessPeriodFreshness({
      source: HCP_IPC_2017_OFFICIAL_G1_SOURCE,
      now: NOW,
      lastPeriodEnd: "2026-08-27",
    }),
    "future_period",
  );
});

void test("rejects a non-leap-year now date instead of normalizing it", () => {
  assert.equal(
    assessPeriodFreshness({
      source: HCP_IPC_2017_OFFICIAL_G1_SOURCE,
      now: "2026-02-29T12:00:00.000Z",
      lastPeriodEnd: "2026-02-28",
    }),
    "invalid_period_timestamp",
  );
});

void test("routes official sheets through their published period instead of HTTP metadata", () => {
  const report = evaluateQuality({
    source: HCP_IPC_2017_OFFICIAL_G1_SOURCE,
    parsed: parsedDataset([
      candidate({
        natural_key: "hcp.ipc2017.0113|ma|2020-01",
        period_start: "2020-01-01",
        period_end: "2020-01-31",
      }),
      candidate({
        natural_key: "hcp.ipc2017.0113|ma|2026-06",
        period_start: "2026-06-01",
        period_end: "2026-06-30",
      }),
    ]),
    now: "2026-08-30T00:00:00.000Z",
    remoteLastModified: "2020-01-01T00:00:00.000Z",
  });
  assert.deepEqual(report.warning_codes, ["source_late"]);
});

void test("quarantines official sheets with a future published period", () => {
  const report = evaluateQuality({
    source: HCP_IPC_2017_OFFICIAL_G1_SOURCE,
    parsed: parsedDataset([
      candidate({
        period_start: "2026-09-01",
        period_end: "2026-09-30",
      }),
    ]),
    now: NOW,
  });
  assert.equal(report.status, "quarantined");
  assert.equal(report.failed_gate_codes.includes("future_period"), true);
});

void test("uses each declared HCP parser profile base year", () => {
  for (const [inputSource, baseYear] of [
    [HCP_IPC_2017_SOURCE, 2017],
    [HCP_IPP_2018_SOURCE, 2018],
    [HCP_IPC_2017_OFFICIAL_G1_SOURCE, 2017],
    [HCP_IPC_2017_OFFICIAL_G2_SOURCE, 2017],
    [HCP_IPPI_2018_OFFICIAL_G1_SOURCE, 2018],
    [HCP_IPPI_2018_OFFICIAL_G2_SOURCE, 2018],
    [HCP_IPPI_2018_OFFICIAL_G3_SOURCE, 2018],
  ] as const) {
    const parsed = parsedDataset();
    parsed.base_year = baseYear;
    const report = evaluateQuality({ source: inputSource, parsed, now: NOW });
    assert.equal(report.failed_gate_codes.includes("invalid_index_metadata"), false);
  }
});
