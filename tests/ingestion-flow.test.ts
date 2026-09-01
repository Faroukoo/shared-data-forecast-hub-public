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

import ExcelJS from "exceljs";

import { LocalArtifactStore } from "@data-hub/artifact-store";
import {
  HCP_IPC_2017_OFFICIAL_G1_SOURCE,
  HCP_IPC_2017_SOURCE,
} from "@data-hub/source-registry";

import { runManualIngestion, runRemoteIngestion } from "../apps/ingest-cli/src/run-ingestion.js";
import { createSafeLogger } from "../apps/ingest-cli/src/safe-log.js";
import {
  createCkanFetchFixture,
  createHcpOfficialIpcFixture,
  createIpcFixture,
} from "./fixture-workbooks.js";

const FIXED_NOW = "2026-08-26T12:00:00.000Z";
const OFFICIAL_NOW = "2026-09-01T12:00:00.000Z";
const OFFICIAL_EXPORT_URL =
  "https://docs.google.com/spreadsheets/d/1mwwtnpnnWH6rxnnLuz3j07QYsvxFVci6EKTCZea0t-8/export?format=xlsx&gid=0";

async function repackageOfficialFixture(input: {
  bytes: Uint8Array;
  creator: string;
  firstValue?: number;
}): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(input.bytes).buffer);
  workbook.creator = input.creator;
  if (input.firstValue !== undefined) {
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error("missing_fixture_sheet");
    sheet.getCell(25, 3).value = input.firstValue;
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function createGoogleSheetsFetchSequence(
  responses: readonly Uint8Array[],
  requestedUrls: string[],
): typeof fetch {
  let index = 0;
  return (input) => {
    requestedUrls.push(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    const responseBytes = responses[index];
    index += 1;
    if (!responseBytes) {
      return Promise.resolve(new Response("fixture exhausted", { status: 500 }));
    }
    return Promise.resolve(
      new Response(responseBytes, {
        status: 200,
        headers: {
          "content-length": String(responseBytes.byteLength),
          "content-type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          etag: `"sheet-${String(index)}"`,
          "last-modified": "Tue, 01 Sep 2026 08:00:00 GMT",
        },
      }),
    );
  };
}

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

void test("deduplicates repackaged Google XLSX values and revises semantic changes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-google-semantic-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const base = await createHcpOfficialIpcFixture("ipc-2017-official-g1");
  const firstBytes = await repackageOfficialFixture({
    bytes: base,
    creator: "first-package",
  });
  const repackagedBytes = await repackageOfficialFixture({
    bytes: base,
    creator: "second-package",
  });
  const changedBytes = await repackageOfficialFixture({
    bytes: base,
    creator: "third-package",
    firstValue: 101.5,
  });
  assert.notDeepEqual(firstBytes, repackagedBytes);

  const requestedUrls: string[] = [];
  const fetchImpl = createGoogleSheetsFetchSequence(
    [firstBytes, repackagedBytes, changedBytes],
    requestedUrls,
  );
  const first = await runRemoteIngestion({
    sourceId: HCP_IPC_2017_OFFICIAL_G1_SOURCE.source_id,
    dataDir: root,
    fetchImpl,
    now: OFFICIAL_NOW,
  });
  const second = await runRemoteIngestion({
    sourceId: HCP_IPC_2017_OFFICIAL_G1_SOURCE.source_id,
    dataDir: root,
    fetchImpl,
    now: "2026-09-01T12:01:00.000Z",
  });

  assert.equal(first.state, "published");
  assert.equal(second.state, "no_change");
  assert.notEqual(first.artifact_sha256, second.artifact_sha256);
  assert.equal(second.dataset_id, first.dataset_id);
  await access(join(root, "quality", `${second.run_id}.json`));
  assert.equal((await readdir(join(root, "published"))).length, 1);
  await assert.rejects(() =>
    access(
      join(
        root,
        "manifests",
        "published-artifacts",
        `${second.artifact_sha256 ?? "missing"}.json`,
      ),
    )
  );
  const firstManifest = JSON.parse(
    await readFile(
      join(root, "published", first.dataset_id ?? "missing", "manifest.json"),
      "utf8",
    ),
  ) as { artifact_sha256s: string[] };
  assert.deepEqual(firstManifest.artifact_sha256s, [first.artifact_sha256]);

  const changed = await runRemoteIngestion({
    sourceId: HCP_IPC_2017_OFFICIAL_G1_SOURCE.source_id,
    dataDir: root,
    fetchImpl,
    now: "2026-09-01T12:02:00.000Z",
  });

  assert.equal(changed.state, "published");
  assert.notEqual(changed.dataset_id, first.dataset_id);
  assert.equal((await readdir(join(root, "published"))).length, 2);
  const observations = (
    await readFile(
      join(root, "published", changed.dataset_id ?? "missing", "observations.jsonl"),
      "utf8",
    )
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { value: string; revision_number: number });
  assert.equal(
    observations.some(
      (entry) => entry.value === "101.5" && entry.revision_number === 2,
    ),
    true,
  );
  assert.deepEqual(requestedUrls, [
    OFFICIAL_EXPORT_URL,
    OFFICIAL_EXPORT_URL,
    OFFICIAL_EXPORT_URL,
  ]);
  assert.equal(second.request_target, OFFICIAL_EXPORT_URL);
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
