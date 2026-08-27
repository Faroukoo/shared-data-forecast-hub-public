import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalArtifactStore } from "@data-hub/artifact-store";
import { HCP_IPC_2017_SOURCE } from "@data-hub/source-registry";

import { runManualIngestion, runRemoteIngestion } from "../apps/ingest-cli/src/run-ingestion.js";
import { createSafeLogger } from "../apps/ingest-cli/src/safe-log.js";
import {
  createCkanFetchFixture,
  createIpcFixture,
} from "./fixture-workbooks.js";

const FIXED_NOW = "2026-08-26T12:00:00.000Z";

void test("publishes once then reports no_change for identical remote bytes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-flow-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await createIpcFixture();
  const fetchImpl = createCkanFetchFixture(fixture);

  const first = await runRemoteIngestion({
    sourceId: "hcp-ipc-2017-monthly",
    dataDir: root,
    fetchImpl,
    now: FIXED_NOW,
  });
  const second = await runRemoteIngestion({
    sourceId: "hcp-ipc-2017-monthly",
    dataDir: root,
    fetchImpl,
    now: FIXED_NOW,
  });

  assert.equal(first.state, "published");
  assert.equal(second.state, "no_change");
  assert.equal(first.artifact_sha256, second.artifact_sha256);
});

void test("resumes an archived but unpublished artifact", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-resume-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await createIpcFixture();
  const store = new LocalArtifactStore(root);
  await store.putArtifact({
    source: HCP_IPC_2017_SOURCE,
    originalUrl: "https://data.gov.ma/data/example.xlsx",
    retrievedAt: FIXED_NOW,
    etag: '"fixture"',
    lastModified: "Thu, 06 Feb 2025 12:15:45 GMT",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    originalFilename: "example.xlsx",
    sourcePublicationPeriod: null,
    predecessorSha256: null,
    bytes: fixture,
  });

  const run = await runRemoteIngestion({
    sourceId: "hcp-ipc-2017-monthly",
    dataDir: root,
    fetchImpl: createCkanFetchFixture(fixture),
    now: FIXED_NOW,
  });
  assert.equal(run.state, "published");
});

void test("a quarantined workbook never creates published output", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-quarantine-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await createIpcFixture({ firstHeader: "Territoires" });
  const run = await runRemoteIngestion({
    sourceId: "hcp-ipc-2017-monthly",
    dataDir: root,
    fetchImpl: createCkanFetchFixture(fixture),
    now: FIXED_NOW,
  });
  assert.equal(run.state, "quarantined");
  await assert.rejects(() => access(join(root, "published")));
  const report = JSON.parse(
    await readFile(join(root, "quality", `${run.run_id}.json`), "utf8"),
  ) as { failed_gate_codes: string[] };
  assert.equal(report.failed_gate_codes.includes("parser_error"), true);
});

void test("fails closed when an existing published manifest is corrupt", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-corrupt-published-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const corruptDirectory = join(root, "published", "corrupt");
  await mkdir(corruptDirectory, { recursive: true });
  await writeFile(join(corruptDirectory, "manifest.json"), "not-json\n");

  const run = await runRemoteIngestion({
    sourceId: "hcp-ipc-2017-monthly",
    dataDir: root,
    fetchImpl: createCkanFetchFixture(await createIpcFixture()),
    now: FIXED_NOW,
  });

  assert.equal(run.state, "failed_terminal");
  assert.equal(run.failure_code, "invalid_published_dataset:corrupt");
  assert.deepEqual(await readdir(join(root, "published")), ["corrupt"]);
});

void test("warns when a new source artifact loses historical coverage", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-coverage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await runRemoteIngestion({
    sourceId: "hcp-ipc-2017-monthly",
    dataDir: root,
    fetchImpl: createCkanFetchFixture(await createIpcFixture()),
    now: FIXED_NOW,
  });

  const reduced = await runRemoteIngestion({
    sourceId: "hcp-ipc-2017-monthly",
    dataDir: root,
    fetchImpl: createCkanFetchFixture(
      await createIpcFixture({ includeCasablanca: false }),
    ),
    now: "2026-08-26T12:01:00.000Z",
  });
  const report = JSON.parse(
    await readFile(join(root, "quality", `${reduced.run_id}.json`), "utf8"),
  ) as { warning_codes: string[] };

  assert.equal(reduced.state, "published");
  assert.equal(report.warning_codes.includes("coverage_shrinkage"), true);
});

void test("fails closed when published observations no longer match their checksum", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-corrupt-jsonl-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await runRemoteIngestion({
    sourceId: "hcp-ipc-2017-monthly",
    dataDir: root,
    fetchImpl: createCkanFetchFixture(await createIpcFixture()),
    now: FIXED_NOW,
  });
  assert.equal(first.state, "published");
  const datasetId = first.dataset_id;
  assert.notEqual(datasetId, null);
  const observationsPath = join(
    root,
    "published",
    datasetId ?? "missing",
    "observations.jsonl",
  );
  await writeFile(
    observationsPath,
    `${await readFile(observationsPath, "utf8")}\n`,
  );

  const run = await runRemoteIngestion({
    sourceId: "hcp-ipc-2017-monthly",
    dataDir: root,
    fetchImpl: createCkanFetchFixture(
      await createIpcFixture({ includeCasablanca: false }),
    ),
    now: "2026-08-26T12:01:00.000Z",
  });

  assert.equal(run.state, "failed_terminal");
  assert.equal(run.failure_code, `invalid_published_dataset:${datasetId ?? "missing"}`);
});

void test("manual import uses the same parser and quality path", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-manual-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = join(root, "operator-input.xlsx");
  await writeFile(filePath, await createIpcFixture());
  const run = await runManualIngestion({
    sourceId: "hcp-ipc-2017-monthly",
    dataDir: root,
    filePath,
    operatorId: "admin-1",
    claimedPublicationPeriod: "2025-01",
    now: FIXED_NOW,
  });
  assert.equal(run.state, "published");
  assert.equal(run.access_mode, "manual");
  assert.equal(run.operator_id, "admin-1");
});

void test("logs omit URL credentials, query values and unsafe authorization text", () => {
  const lines: string[] = [];
  const logger = createSafeLogger((line) => lines.push(line));
  logger.runFailed({
    sourceId: "hcp-ipc-2017-monthly",
    runId: "run:T:ABC-1",
    state: "failed_terminal",
    failureCode: "Authorization: Bearer topsecret",
    requestTarget: "https://user:secret@data.gov.ma/file?token=topsecret",
  });
  const output = lines.join("\n");
  assert.equal(/user|secret|topsecret|Bearer|Authorization/.test(output), false);
  const parsedLog: unknown = JSON.parse(output);
  assert.equal(typeof parsedLog, "object");
  assert.notEqual(parsedLog, null);
  assert.equal(
    (parsedLog as Record<string, unknown>).run_id,
    "run:T:ABC-1",
  );
});

void test("default network access fails with network_not_enabled", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-offline-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    () =>
      runRemoteIngestion({
        sourceId: "hcp-ipc-2017-monthly",
        dataDir: root,
        now: FIXED_NOW,
        environment: {},
      }),
    /network_not_enabled/,
  );
});
