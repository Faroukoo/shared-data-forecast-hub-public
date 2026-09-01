import assert from "node:assert/strict";
import test from "node:test";

import {
  ProductionSourceResultSchema,
  ProductionRunSummarySchema,
  SCHEMA_VERSION,
  SnapshotIndexSchema,
  SnapshotManifestSchema,
} from "@data-hub/contracts";

function sourceResult(sourceId: string) {
  return {
    source_id: sourceId,
    run_id: `run:${sourceId}`,
    state: "no_change" as const,
    artifact_sha256: "b".repeat(64),
    dataset_id: `sha256:${"c".repeat(64)}`,
    health_status: "healthy" as const,
    warning_codes: [],
    failure_code: null,
  };
}

void test("keeps period evidence out of production and snapshot source contracts", () => {
  const parsed = ProductionSourceResultSchema.parse(
    sourceResult("hcp-ipc-2017-official-g1-monthly"),
  );
  assert.equal("last_period_end" in parsed, false);
  assert.throws(() =>
    ProductionSourceResultSchema.parse({
      ...sourceResult("hcp-ipc-2017-official-g1-monthly"),
      last_period_end: "2026-07-31",
    }),
  );
});

void test("accepts a bounded terminal result for invalid source evidence", () => {
  const parsed = ProductionSourceResultSchema.parse({
    source_id: "hcp-ipc-2017-monthly",
    run_id: "run:hcp-ipc-2017-monthly:evidence-failure",
    state: "failed_terminal",
    artifact_sha256: null,
    dataset_id: null,
    health_status: null,
    warning_codes: [],
    failure_code: "invalid_source_evidence",
  });

  assert.equal(parsed.state, "failed_terminal");
  assert.equal(parsed.failure_code, "invalid_source_evidence");
  assert.equal("last_period_end" in parsed, false);
});

void test("accepts a publishable production summary", () => {
  const parsed = ProductionRunSummarySchema.parse({
    schema_version: SCHEMA_VERSION,
    production_run_id: "production:2026-08-26T12:00:00.000Z",
    started_at: "2026-08-26T12:00:00.000Z",
    completed_at: "2026-08-26T12:01:00.000Z",
    code_sha: "a".repeat(40),
    decision: "publishable",
    sources: [
      {
        source_id: "hcp-ipc-2017-monthly",
        run_id: "run-1",
        state: "published",
        artifact_sha256: "b".repeat(64),
        dataset_id: `sha256:${"c".repeat(64)}`,
        health_status: "healthy",
        warning_codes: [],
        failure_code: null,
      },
    ],
  });

  assert.equal(parsed.decision, "publishable");
});

void test("rejects production sources outside stable source-id order", () => {
  assert.throws(() =>
    ProductionRunSummarySchema.parse({
      schema_version: SCHEMA_VERSION,
      production_run_id: "production:2026-08-26T12:00:00.000Z",
      started_at: "2026-08-26T12:00:00.000Z",
      completed_at: "2026-08-26T12:01:00.000Z",
      code_sha: "a".repeat(40),
      decision: "no_change",
      sources: [
        sourceResult("hcp-ipp-2018-monthly"),
        sourceResult("hcp-ipc-2017-monthly"),
      ],
    }),
  );
});

void test("rejects a confidential snapshot index", () => {
  assert.throws(() =>
    SnapshotIndexSchema.parse({
      schema_version: SCHEMA_VERSION,
      snapshot_id: "d".repeat(64),
      created_at: "2026-08-26T12:01:00.000Z",
      code_sha: "a".repeat(40),
      previous_snapshot_tag: null,
      archive: {
        name: `data-hub-${"e".repeat(64)}.tar.gz`,
        byte_length: 10,
        sha256: "e".repeat(64),
      },
      manifest_sha256: "f".repeat(64),
      sources: [
        {
          source_id: "hcp-ipc-2017-monthly",
          run_id: "run-1",
          state: "published",
          artifact_sha256: "b".repeat(64),
          dataset_id: `sha256:${"c".repeat(64)}`,
          health_status: "healthy",
          warning_codes: [],
          failure_code: null,
        },
      ],
      dataset_ids: [`sha256:${"c".repeat(64)}`],
      contains_confidential_data: true,
    }),
  );
});

void test("rejects an archive name that does not match its digest", () => {
  assert.throws(() =>
    SnapshotIndexSchema.parse({
      schema_version: SCHEMA_VERSION,
      snapshot_id: "d".repeat(64),
      created_at: "2026-08-26T12:01:00.000Z",
      code_sha: "a".repeat(40),
      previous_snapshot_tag: null,
      archive: {
        name: `data-hub-${"f".repeat(64)}.tar.gz`,
        byte_length: 10,
        sha256: "e".repeat(64),
      },
      manifest_sha256: "f".repeat(64),
      sources: [
        {
          source_id: "hcp-ipc-2017-monthly",
          run_id: "run-1",
          state: "published",
          artifact_sha256: "b".repeat(64),
          dataset_id: `sha256:${"c".repeat(64)}`,
          health_status: "healthy",
          warning_codes: [],
          failure_code: null,
        },
      ],
      dataset_ids: [`sha256:${"c".repeat(64)}`],
      contains_confidential_data: false,
    }),
  );
});

void test("rejects snapshot manifest files outside stable path order", () => {
  assert.throws(() =>
    SnapshotManifestSchema.parse({
      schema_version: SCHEMA_VERSION,
      snapshot_id: "d".repeat(64),
      created_at: "2026-08-26T12:01:00.000Z",
      code_sha: "a".repeat(40),
      files: [
        { path: "runs/z.json", byte_length: 1, sha256: "e".repeat(64) },
        { path: "raw/a", byte_length: 1, sha256: "f".repeat(64) },
      ],
      sources: [sourceResult("hcp-ipc-2017-monthly")],
      dataset_ids: [`sha256:${"c".repeat(64)}`],
    }),
  );
});

void test("rejects repeated dataset IDs in a snapshot index", () => {
  const datasetId = `sha256:${"c".repeat(64)}`;
  assert.throws(() =>
    SnapshotIndexSchema.parse({
      schema_version: SCHEMA_VERSION,
      snapshot_id: "d".repeat(64),
      created_at: "2026-08-26T12:01:00.000Z",
      code_sha: "a".repeat(40),
      previous_snapshot_tag: null,
      archive: {
        name: `data-hub-${"e".repeat(64)}.tar.gz`,
        byte_length: 10,
        sha256: "e".repeat(64),
      },
      manifest_sha256: "f".repeat(64),
      sources: [sourceResult("hcp-ipc-2017-monthly")],
      dataset_ids: [datasetId, datasetId],
      contains_confidential_data: false,
    }),
  );
});
