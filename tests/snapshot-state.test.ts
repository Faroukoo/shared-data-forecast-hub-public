import assert from "node:assert/strict";
import {
  appendFile,
  mkdtemp,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { validateDataHubState } from "@data-hub/snapshot";
import { HCP_IPC_2017_SOURCE } from "@data-hub/source-registry";

import { runRemoteIngestion } from "../apps/ingest-cli/src/run-ingestion.js";
import {
  createCkanFetchFixture,
  createIpcFixture,
} from "./fixture-workbooks.js";

const FIXED_NOW = "2026-08-26T12:00:00.000Z";

async function createValidSnapshotState(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "snapshot-state-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = await runRemoteIngestion({
    sourceId: HCP_IPC_2017_SOURCE.source_id,
    dataDir: root,
    fetchImpl: createCkanFetchFixture(await createIpcFixture()),
    now: FIXED_NOW,
  });
  assert.equal(run.state, "published");
  const artifactSha256 =
    run.artifact_sha256 ?? assert.fail("published run has no artifact");
  const datasetId = run.dataset_id ?? assert.fail("published run has no dataset");
  return {
    root,
    run,
    rawArtifactPath: join(
      root,
      "raw",
      HCP_IPC_2017_SOURCE.source_id,
      artifactSha256,
      "artifact",
    ),
    qualityPath: join(root, "quality", `${run.run_id}.json`),
    publishedDirectory: join(root, "published", datasetId),
  };
}

void test("validates all evidence from a published fixture state", async (t) => {
  const fixture = await createValidSnapshotState(t);

  const state = await validateDataHubState(fixture.root);

  assert.equal(state.sources[0]?.source_id, HCP_IPC_2017_SOURCE.source_id);
  assert.equal(state.dataset_ids.length, 1);
});

void test("rejects one changed raw byte", async (t) => {
  const fixture = await createValidSnapshotState(t);
  await appendFile(fixture.rawArtifactPath, new Uint8Array([0]));

  await assert.rejects(
    () => validateDataHubState(fixture.root),
    /artifact_digest_mismatch/,
  );
});

void test("rejects a mismatched published directory", async (t) => {
  const fixture = await createValidSnapshotState(t);
  await rename(
    fixture.publishedDirectory,
    join(fixture.root, "published", "mismatched-dataset"),
  );

  await assert.rejects(
    () => validateDataHubState(fixture.root),
    /published_directory_mismatch/,
  );
});

void test("rejects a malformed terminal run", async (t) => {
  const fixture = await createValidSnapshotState(t);
  await writeFile(
    join(fixture.root, "runs", `${fixture.run.run_id}.json`),
    "not-json\n",
  );

  await assert.rejects(
    () => validateDataHubState(fixture.root),
    /invalid_run/,
  );
});

void test("rejects a missing quality report for a published run", async (t) => {
  const fixture = await createValidSnapshotState(t);
  await unlink(fixture.qualityPath);

  await assert.rejects(
    () => validateDataHubState(fixture.root),
    /missing_quality_report/,
  );
});

void test("rejects an artifact whose registry licence forbids redistribution", async (t) => {
  const fixture = await createValidSnapshotState(t);
  const original = HCP_IPC_2017_SOURCE.licence.permits_redistribution;
  HCP_IPC_2017_SOURCE.licence.permits_redistribution = false;
  t.after(() => {
    HCP_IPC_2017_SOURCE.licence.permits_redistribution = original;
  });

  await assert.rejects(
    () => validateDataHubState(fixture.root),
    /redistribution_not_permitted/,
  );
});
