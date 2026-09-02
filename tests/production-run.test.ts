import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CanonicalObservationSchema,
  DatasetVersionSchema,
  QualityReportSchema,
  SCHEMA_VERSION,
  type IngestionRun,
  type QualityReport,
  type SourceDefinition,
} from "@data-hub/contracts";
import { canonicalJson } from "@data-hub/canonical";
import { listEnabledSourceDefinitions } from "@data-hub/source-registry";

import {
  renderProductionMarkdown,
  runProductionIngestion,
  writeProductionOutputs,
} from "../apps/ingest-cli/src/run-production.js";
import {
  ingestionRunFactory,
  productionSummaryFactory,
  qualityReport,
  rawArtifactFactory,
} from "./test-factories.js";

const FIXED_NOW = "2026-08-26T12:00:00.000Z";
const CODE_SHA = "a".repeat(40);

function qualityFor(input: {
  sourceId: string;
  artifactSha256: string;
  status?: QualityReport["status"];
  warningCodes?: string[];
}): QualityReport {
  const status = input.status ?? "accepted";
  const base = qualityReport(status);
  return QualityReportSchema.parse({
    ...base,
    source_id: input.sourceId,
    artifact_sha256: input.artifactSha256,
    warning_codes: input.warningCodes ?? base.warning_codes,
  });
}

async function writePublishedDatasetFixture(input: {
  root: string;
  source: SourceDefinition;
  artifactSha256: string;
  datasetId?: string;
  lastPeriodEnd: string;
  httpLastModified: string | null;
  qualityStatus?: QualityReport["status"];
}): Promise<string> {
  const observation = CanonicalObservationSchema.parse({
    schema_version: SCHEMA_VERSION,
    observation_id: `sha256:${"e".repeat(64)}`,
    natural_key: `${input.source.source_id}|ma|2026-07`,
    series_key: `${input.source.source_id}.series`,
    source_series_label: "Official HCP series",
    period_start: "2026-07-01",
    period_end: input.lastPeriodEnd,
    frequency: "monthly",
    value: "100",
    unit: "index",
    currency: null,
    scaling_factor: "1",
    geography_type: "country",
    location_key: "ma",
    source_id: input.source.source_id,
    artifact_sha256: input.artifactSha256,
    source_row: 5,
    source_column: 3,
    retrieved_at: FIXED_NOW,
    source_published_at: null,
    quality_status: "accepted",
    warning_codes: [],
    revision_number: 1,
    supersedes_observation_id: null,
  });
  const observations = `${JSON.stringify(observation)}\n`;
  const canonicalSha256 = createHash("sha256")
    .update(observations)
    .digest("hex");
  const stableManifest = {
    schema_version: SCHEMA_VERSION,
    created_at: FIXED_NOW,
    source_id: input.source.source_id,
    artifact_sha256s: [input.artifactSha256],
    canonical_sha256: canonicalSha256,
    row_count: 1,
    first_period_start: "2026-07-01",
    last_period_end: input.lastPeriodEnd,
    series_count: 1,
    location_count: 1,
    warning_count: 0,
    tool_versions: { cli: "0.1.0" },
  };
  const { created_at: ignoredCreatedAt, ...identityFields } = stableManifest;
  void ignoredCreatedAt;
  const datasetId = input.datasetId ?? `sha256:${createHash("sha256")
    .update(canonicalJson(identityFields))
    .digest("hex")}`;
  const manifest = DatasetVersionSchema.parse({
    ...stableManifest,
    dataset_id: datasetId,
  });
  const publishedDirectory = join(input.root, "published", datasetId);
  const artifactDirectory = join(input.root, "manifests", "artifacts");
  const qualityDirectory = join(input.root, "quality");
  await Promise.all([
    mkdir(publishedDirectory, { recursive: true }),
    mkdir(artifactDirectory, { recursive: true }),
    mkdir(qualityDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(publishedDirectory, "manifest.json"),
      `${JSON.stringify(manifest)}\n`,
    ),
    writeFile(join(publishedDirectory, "observations.jsonl"), observations),
    writeFile(
      join(artifactDirectory, `${input.artifactSha256}.json`),
      `${JSON.stringify(rawArtifactFactory({
        source_id: input.source.source_id,
        sha256: input.artifactSha256,
        http_last_modified: input.httpLastModified,
      }))}\n`,
    ),
    writeFile(
      join(qualityDirectory, `previous-${input.source.source_id}.json`),
      `${JSON.stringify(qualityFor({
        sourceId: input.source.source_id,
        artifactSha256: input.artifactSha256,
        ...(input.qualityStatus === undefined
          ? {}
          : { status: input.qualityStatus }),
      }))}\n`,
    ),
  ]);
  return datasetId;
}

function verifiedDatasetFixture(input: {
  sourceId: string;
  artifactSha256: string;
  datasetId: string;
}) {
  return DatasetVersionSchema.parse({
    schema_version: SCHEMA_VERSION,
    dataset_id: input.datasetId,
    created_at: FIXED_NOW,
    source_id: input.sourceId,
    artifact_sha256s: [input.artifactSha256],
    canonical_sha256: "f".repeat(64),
    row_count: 1,
    first_period_start: "2026-07-01",
    last_period_end: "2026-07-31",
    series_count: 1,
    location_count: 1,
    warning_count: 0,
    tool_versions: { cli: "0.1.0" },
  });
}

async function productionRunFixture(
  states: IngestionRun["state"][],
) {
  const sources = listEnabledSourceDefinitions();
  const evidence = new Map(
    sources.map((source, index) => {
      const artifactSha256 = (index + 1).toString(16).repeat(64);
      return [
        source.source_id,
        {
          artifactSha256,
          datasetId: `sha256:${(index + 8).toString(16).repeat(64)}`,
        },
      ] as const;
    }),
  );
  let sourceIndex = 0;
  return runProductionIngestion({
    dataDir: "/tmp/not-read",
    codeSha: CODE_SHA,
    now: FIXED_NOW,
    sources,
    runSource: ({ sourceId }) => {
      const state = states[sourceIndex] ?? "no_change";
      sourceIndex += 1;
      const sourceEvidence = evidence.get(sourceId) ?? assert.fail("missing evidence");
      return Promise.resolve(
        ingestionRunFactory({
          source_id: sourceId,
          run_id: `run:${sourceId}`,
          state,
          artifact_sha256: sourceEvidence.artifactSha256,
          dataset_id: sourceEvidence.datasetId,
        }),
      );
    },
    loadArtifact: (_dataDir, sha256) => {
      const source = sources.find(
        (candidate) => evidence.get(candidate.source_id)?.artifactSha256 === sha256,
      ) ?? assert.fail("missing artifact source");
      return Promise.resolve(rawArtifactFactory({ source_id: source.source_id, sha256 }));
    },
    loadQuality: (_dataDir, runId) => {
      const sourceId = runId.replace(/^run:/, "");
      const sourceEvidence = evidence.get(sourceId) ?? assert.fail("missing evidence");
      return Promise.resolve(
        qualityFor({ sourceId, artifactSha256: sourceEvidence.artifactSha256 }),
      );
    },
    loadDataset: (_dataDir, sourceId, datasetId) => {
      const sourceEvidence = evidence.get(sourceId) ?? assert.fail("missing evidence");
      assert.equal(datasetId, sourceEvidence.datasetId);
      return Promise.resolve(
        verifiedDatasetFixture({
          sourceId,
          artifactSha256: sourceEvidence.artifactSha256,
          datasetId,
        }),
      );
    },
  });
}

void test("continues all seven sources but blocks the batch after quarantine", async () => {
  const called: string[] = [];
  const sources = listEnabledSourceDefinitions();
  const quarantinedSourceId = "hcp-ipc-2017-official-g1-monthly";
  const summary = await runProductionIngestion({
    dataDir: "/tmp/not-read",
    codeSha: CODE_SHA,
    now: FIXED_NOW,
    sources,
    runSource: ({ sourceId }) => {
      called.push(sourceId);
      return Promise.resolve(
        ingestionRunFactory({
          source_id: sourceId,
          run_id: `run:${sourceId}`,
          state: sourceId === quarantinedSourceId ? "quarantined" : "no_change",
          artifact_sha256: "a".repeat(64),
          dataset_id:
            sourceId === quarantinedSourceId
              ? null
              : `sha256:${"b".repeat(64)}`,
          failure_code: null,
        }),
      );
    },
    loadArtifact: (_dataDir, sha256) =>
      Promise.resolve(rawArtifactFactory({ sha256 })),
    loadQuality: (_dataDir, runId) => {
      const sourceId = runId.replace(/^run:/, "");
      return Promise.resolve(
        qualityFor({
          sourceId,
          artifactSha256: "a".repeat(64),
          status: sourceId === quarantinedSourceId ? "quarantined" : "accepted",
        }),
      );
    },
  });

  assert.deepEqual(called, sources.map((source) => source.source_id));
  assert.equal(summary.sources.length, 7);
  assert.equal(summary.decision, "blocked");
  assert.equal(
    summary.sources.find((result) => result.source_id === quarantinedSourceId)
      ?.health_status,
    "quarantined",
  );
});

for (const failedState of ["failed_retryable", "failed_terminal"] as const) {
  void test(`continues all seven sources and blocks after ${failedState}`, async () => {
    const called: string[] = [];
    const sources = listEnabledSourceDefinitions();
    const failedSourceId = sources[2]?.source_id ?? assert.fail("missing source");
    const summary = await runProductionIngestion({
      dataDir: "/tmp/not-read",
      codeSha: CODE_SHA,
      now: FIXED_NOW,
      sources,
      runSource: ({ sourceId }) => {
        called.push(sourceId);
        return Promise.resolve(
          ingestionRunFactory({
            source_id: sourceId,
            run_id: `run:${sourceId}:${failedState}`,
            state: sourceId === failedSourceId ? failedState : "no_change",
          }),
        );
      },
      loadArtifact: (_dataDir, sha256) =>
        Promise.resolve(rawArtifactFactory({ sha256 })),
      loadQuality: (_dataDir, runId) => {
        const sourceId = runId
          .slice("run:".length)
          .replace(new RegExp(`:${failedState}$`), "");
        if (sourceId === failedSourceId) return Promise.resolve(null);
        return Promise.resolve(
          qualityFor({ sourceId, artifactSha256: "a".repeat(64) }),
        );
      },
    });

    assert.deepEqual(called, sources.map((source) => source.source_id));
    assert.equal(summary.sources.length, 7);
    assert.equal(summary.decision, "blocked");
    assert.equal(
      summary.sources.find((result) => result.source_id === failedSourceId)?.state,
      failedState,
    );
  });
}

void test("publishes only when at least one valid source changed", async () => {
  const summary = await productionRunFixture(["published", "no_change"]);

  assert.equal(summary.decision, "publishable");
  assert.match(renderProductionMarkdown(summary), /hcp-ipc-2017-monthly/);
});

void test("uses current-run quality as authoritative for semantic no-change", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-production-quality-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = listEnabledSourceDefinitions().find(
    (candidate) => candidate.source_id === "hcp-ipc-2017-official-g1-monthly",
  ) ?? assert.fail("missing official source");
  const datasetArtifactSha256 = "e".repeat(64);
  const artifactSha256 = "f".repeat(64);
  const runId = `run:${source.source_id}:semantic`;
  const datasetId = await writePublishedDatasetFixture({
    root,
    source,
    artifactSha256: datasetArtifactSha256,
    lastPeriodEnd: "2026-07-31",
    httpLastModified: null,
  });
  await Promise.all([
    mkdir(join(root, "manifests", "artifacts"), { recursive: true }),
    mkdir(join(root, "quality"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(root, "manifests", "artifacts", `${artifactSha256}.json`),
      `${JSON.stringify(rawArtifactFactory({
        source_id: source.source_id,
        sha256: artifactSha256,
        http_last_modified: FIXED_NOW,
      }))}\n`,
    ),
    writeFile(
      join(root, "quality", `${runId}.json`),
      `${JSON.stringify(qualityFor({
        sourceId: source.source_id,
        artifactSha256,
        status: "accepted_with_warning",
        warningCodes: ["source_stale"],
      }))}\n`,
    ),
  ]);

  const summary = await runProductionIngestion({
    dataDir: root,
    codeSha: CODE_SHA,
    now: FIXED_NOW,
    sources: [source],
    runSource: () =>
      Promise.resolve(
        ingestionRunFactory({
          source_id: source.source_id,
          run_id: runId,
          state: "no_change",
          artifact_sha256: artifactSha256,
          dataset_id: datasetId,
        }),
      ),
  });

  const result = summary.sources[0] ?? assert.fail("missing source result");
  assert.equal(result.health_status, "stale");
  assert.deepEqual(result.warning_codes, ["source_stale"]);
});

void test("blocks semantic no-change when dataset evidence is missing", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-production-missing-semantic-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = listEnabledSourceDefinitions().find(
    (candidate) => candidate.source_id === "hcp-ipc-2017-official-g1-monthly",
  ) ?? assert.fail("missing official source");
  const artifactSha256 = "4".repeat(64);
  const runId = `run:${source.source_id}:missing-semantic`;
  await Promise.all([
    mkdir(join(root, "manifests", "artifacts"), { recursive: true }),
    mkdir(join(root, "quality"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(root, "manifests", "artifacts", `${artifactSha256}.json`),
      `${JSON.stringify(rawArtifactFactory({
        source_id: source.source_id,
        sha256: artifactSha256,
        http_last_modified: FIXED_NOW,
      }))}\n`,
    ),
    writeFile(
      join(root, "quality", `${runId}.json`),
      `${JSON.stringify(qualityFor({
        sourceId: source.source_id,
        artifactSha256,
      }))}\n`,
    ),
  ]);

  const summary = await runProductionIngestion({
    dataDir: root,
    codeSha: CODE_SHA,
    now: FIXED_NOW,
    sources: [source],
    runSource: () =>
      Promise.resolve(
        ingestionRunFactory({
          source_id: source.source_id,
          run_id: runId,
          state: "no_change",
          artifact_sha256: artifactSha256,
          dataset_id: `sha256:${"3".repeat(64)}`,
        }),
      ),
  });

  const result = summary.sources[0] ?? assert.fail("missing source result");
  assert.equal(result.state, "failed_terminal");
  assert.equal(result.failure_code, "invalid_source_evidence");
  assert.equal(summary.decision, "blocked");
});

void test("blocks no-change when the dataset identity is forged", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-production-forged-id-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = listEnabledSourceDefinitions().find(
    (candidate) => candidate.source_id === "hcp-ipc-2017-official-g1-monthly",
  ) ?? assert.fail("missing official source");
  const artifactSha256 = "2".repeat(64);
  const datasetId = `sha256:${"1".repeat(64)}`;
  await writePublishedDatasetFixture({
    root,
    source,
    artifactSha256,
    datasetId,
    lastPeriodEnd: "2026-07-31",
    httpLastModified: null,
  });

  const summary = await runProductionIngestion({
    dataDir: root,
    codeSha: CODE_SHA,
    now: FIXED_NOW,
    sources: [source],
    runSource: () =>
      Promise.resolve(
        ingestionRunFactory({
          source_id: source.source_id,
          run_id: `run:${source.source_id}:forged-id`,
          state: "no_change",
          artifact_sha256: artifactSha256,
          dataset_id: datasetId,
        }),
      ),
  });

  const result = summary.sources[0] ?? assert.fail("missing source result");
  assert.equal(result.state, "failed_terminal");
  assert.equal(result.failure_code, "invalid_source_evidence");
  assert.equal(summary.decision, "blocked");
});

void test("blocks no-change publication when fallback quality is quarantined", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-production-fallback-quarantine-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = listEnabledSourceDefinitions().find(
    (candidate) => candidate.source_id === "hcp-ipc-2017-official-g1-monthly",
  ) ?? assert.fail("missing official source");
  const artifactSha256 = "5".repeat(64);
  const datasetId = await writePublishedDatasetFixture({
    root,
    source,
    artifactSha256,
    lastPeriodEnd: "2026-07-31",
    httpLastModified: null,
    qualityStatus: "quarantined",
  });

  const summary = await runProductionIngestion({
    dataDir: root,
    codeSha: CODE_SHA,
    now: FIXED_NOW,
    sources: [source],
    runSource: () =>
      Promise.resolve(
        ingestionRunFactory({
          source_id: source.source_id,
          run_id: `run:${source.source_id}:fallback-quarantine`,
          state: "no_change",
          artifact_sha256: artifactSha256,
          dataset_id: datasetId,
        }),
      ),
  });

  const result = summary.sources[0] ?? assert.fail("missing source result");
  assert.equal(result.state, "no_change");
  assert.equal(result.health_status, "quarantined");
  assert.equal(summary.decision, "blocked");
});

void test("blocks exact no-change when the run artifact is absent from the dataset", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-production-artifact-binding-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = listEnabledSourceDefinitions().find(
    (candidate) => candidate.source_id === "hcp-ipc-2017-official-g1-monthly",
  ) ?? assert.fail("missing official source");
  const datasetArtifactSha256 = "7".repeat(64);
  const runArtifactSha256 = "8".repeat(64);
  const datasetId = await writePublishedDatasetFixture({
    root,
    source,
    artifactSha256: datasetArtifactSha256,
    lastPeriodEnd: "2026-07-31",
    httpLastModified: null,
  });
  await writeFile(
    join(root, "manifests", "artifacts", `${runArtifactSha256}.json`),
    `${JSON.stringify(rawArtifactFactory({
      source_id: source.source_id,
      sha256: runArtifactSha256,
      http_last_modified: null,
    }))}\n`,
  );

  const summary = await runProductionIngestion({
    dataDir: root,
    codeSha: CODE_SHA,
    now: FIXED_NOW,
    sources: [source],
    runSource: () =>
      Promise.resolve(
        ingestionRunFactory({
          source_id: source.source_id,
          run_id: `run:${source.source_id}:artifact-mismatch`,
          state: "no_change",
          artifact_sha256: runArtifactSha256,
          dataset_id: datasetId,
        }),
      ),
  });

  const result = summary.sources[0] ?? assert.fail("missing source result");
  assert.equal(result.state, "failed_terminal");
  assert.equal(result.failure_code, "invalid_source_evidence");
  assert.equal(summary.decision, "blocked");
});

void test("continues later sources after one evidence validation failure", async () => {
  const sources = listEnabledSourceDefinitions();
  const failingSource = sources[0] ?? assert.fail("missing enabled source");
  const called: string[] = [];
  const summary = await runProductionIngestion({
    dataDir: "/tmp/not-read",
    codeSha: CODE_SHA,
    now: FIXED_NOW,
    sources,
    runSource: ({ sourceId }) => {
      called.push(sourceId);
      return Promise.resolve(
        ingestionRunFactory({
          source_id: sourceId,
          run_id: `run:${sourceId}:evidence-continuation`,
          state: sourceId === failingSource.source_id ? "no_change" : "published",
          artifact_sha256: "a".repeat(64),
          dataset_id: `sha256:${"b".repeat(64)}`,
        }),
      );
    },
    loadArtifact: (_dataDir, sha256) =>
      Promise.resolve(
        rawArtifactFactory({
          source_id: failingSource.source_id,
          sha256,
        }),
      ),
    loadQuality: (_dataDir, runId) => {
      const sourceId = runId.slice("run:".length).replace(/:evidence-continuation$/, "");
      return Promise.resolve(
        sourceId === failingSource.source_id
          ? null
          : qualityFor({ sourceId, artifactSha256: "a".repeat(64) }),
      );
    },
  });

  assert.deepEqual(called, sources.map((source) => source.source_id));
  assert.equal(summary.sources.length, 7);
  assert.equal(summary.decision, "blocked");
  assert.deepEqual(summary.sources[0], {
    source_id: failingSource.source_id,
    run_id: `run:${failingSource.source_id}:evidence-continuation`,
    state: "failed_terminal",
    artifact_sha256: null,
    dataset_id: null,
    health_status: null,
    warning_codes: [],
    failure_code: "invalid_source_evidence",
  });
  assert.equal(
    summary.sources.slice(1).every((result) => result.state === "published"),
    true,
  );
});

void test("blocks an unbounded no-change dataset ID before reading its directory", async () => {
  const source =
    listEnabledSourceDefinitions()[0] ?? assert.fail("missing enabled source");
  const summary = await runProductionIngestion({
    dataDir: "/tmp/not-read",
    codeSha: CODE_SHA,
    now: FIXED_NOW,
    sources: [source],
    runSource: () =>
      Promise.resolve(
        ingestionRunFactory({
          source_id: source.source_id,
          run_id: `run:${source.source_id}:invalid-dataset`,
          state: "no_change",
          artifact_sha256: "9".repeat(64),
          dataset_id: "../../outside",
        }),
      ),
    loadArtifact: (_dataDir, sha256) =>
      Promise.resolve(
        rawArtifactFactory({ source_id: source.source_id, sha256 }),
      ),
    loadQuality: () => Promise.resolve(null),
  });

  const result = summary.sources[0] ?? assert.fail("missing source result");
  assert.equal(summary.decision, "blocked");
  assert.equal(result.state, "failed_terminal");
  assert.equal(result.failure_code, "invalid_source_evidence");
});

void test("derives official no-change health from the verified July 2026 period", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-production-period-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = listEnabledSourceDefinitions().find(
    (candidate) => candidate.source_id === "hcp-ipc-2017-official-g1-monthly",
  ) ?? assert.fail("missing official source");
  const artifactSha256 = "1".repeat(64);
  const datasetId = await writePublishedDatasetFixture({
    root,
    source,
    artifactSha256,
    lastPeriodEnd: "2026-07-31",
    httpLastModified: "2026-11-29T00:00:00.000Z",
  });

  for (const [now, healthStatus, warningCodes] of [
    ["2026-09-29T00:00:00.000Z", "healthy", []],
    ["2026-09-30T00:00:00.000Z", "late", ["source_late"]],
    ["2026-11-29T00:00:00.000Z", "stale", ["source_stale"]],
  ] as const) {
    const summary = await runProductionIngestion({
      dataDir: root,
      codeSha: CODE_SHA,
      now,
      sources: [source],
      runSource: () =>
        Promise.resolve(
          ingestionRunFactory({
            source_id: source.source_id,
            run_id: `run:${source.source_id}:${now}`,
            state: "no_change",
            artifact_sha256: artifactSha256,
            dataset_id: datasetId,
          }),
        ),
    });
    const result = summary.sources[0] ?? assert.fail("missing source result");
    assert.equal(summary.decision, "no_change");
    assert.equal(result.health_status, healthStatus);
    assert.deepEqual(result.warning_codes, warningCodes);
  }
});

void test("blocks exact no-change when the verified period is in the future", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-production-future-period-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = listEnabledSourceDefinitions().find(
    (candidate) => candidate.source_id === "hcp-ipc-2017-official-g1-monthly",
  ) ?? assert.fail("missing official source");
  const artifactSha256 = "0".repeat(64);
  const datasetId = await writePublishedDatasetFixture({
    root,
    source,
    artifactSha256,
    lastPeriodEnd: "2026-09-30",
    httpLastModified: null,
  });

  const summary = await runProductionIngestion({
    dataDir: root,
    codeSha: CODE_SHA,
    now: FIXED_NOW,
    sources: [source],
    runSource: () =>
      Promise.resolve(
        ingestionRunFactory({
          source_id: source.source_id,
          run_id: `run:${source.source_id}:future-period`,
          state: "no_change",
          artifact_sha256: artifactSha256,
          dataset_id: datasetId,
        }),
      ),
  });

  const result = summary.sources[0] ?? assert.fail("missing source result");
  assert.equal(summary.decision, "blocked");
  assert.equal(result.health_status, "quarantined");
  assert.deepEqual(result.warning_codes, ["future_period"]);
});

void test("reports stale health for an unchanged old CKAN artifact", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-production-ckan-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source =
    listEnabledSourceDefinitions()[0] ?? assert.fail("missing enabled source");
  const artifactSha256 = "3".repeat(64);
  const datasetId = await writePublishedDatasetFixture({
    root,
    source,
    artifactSha256,
    lastPeriodEnd: "2026-07-31",
    httpLastModified: "2026-04-01T00:00:00.000Z",
  });
  const summary = await runProductionIngestion({
    dataDir: root,
    codeSha: CODE_SHA,
    now: FIXED_NOW,
    sources: [source],
    runSource: ({ sourceId }) =>
      Promise.resolve(
        ingestionRunFactory({
          source_id: sourceId,
          run_id: `run:${sourceId}`,
          artifact_sha256: artifactSha256,
          dataset_id: datasetId,
        }),
      ),
  });

  const result = summary.sources[0] ?? assert.fail("missing source result");
  assert.equal(result.health_status, "stale");
  assert.deepEqual(result.warning_codes, ["source_stale"]);
});

void test("writes validated production outputs atomically", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-production-output-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const summary = productionSummaryFactory();
  const jsonPath = join(root, "nested", "summary.json");
  const markdownPath = join(root, "nested", "summary.md");

  await writeProductionOutputs({ summary, jsonPath, markdownPath });

  assert.deepEqual(JSON.parse(await readFile(jsonPath, "utf8")), summary);
  assert.match(await readFile(markdownPath, "utf8"), /no_change/);
});
