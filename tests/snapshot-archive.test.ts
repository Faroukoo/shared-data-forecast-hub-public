import assert from "node:assert/strict";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  ProductionRunSummarySchema,
  SCHEMA_VERSION,
} from "@data-hub/contracts";
import {
  createSnapshot,
  restoreSnapshot,
  validateArchiveEntry,
  validateDataHubState,
  type CreateSnapshotInput,
} from "@data-hub/snapshot";

import { runRemoteIngestion } from "../apps/ingest-cli/src/run-ingestion.js";
import {
  createCkanFetchFixture,
  createIpcFixture,
} from "./fixture-workbooks.js";

const FIXED_NOW = "2026-08-26T12:00:00.000Z";
const CODE_SHA = "a".repeat(40);

async function snapshotInput(
  t: TestContext,
  suffix: string,
): Promise<CreateSnapshotInput> {
  const container = await mkdtemp(join(tmpdir(), "snapshot-archive-state-"));
  t.after(() => rm(container, { recursive: true, force: true }));
  const root = join(container, "data-hub-state");
  await runRemoteIngestion({
    sourceId: "hcp-ipc-2017-monthly",
    dataDir: root,
    fetchImpl: createCkanFetchFixture(await createIpcFixture()),
    now: FIXED_NOW,
  });
  const state = await validateDataHubState(root);
  return {
    dataDir: root,
    outputDir: join(root, suffix),
    summary: ProductionRunSummarySchema.parse({
      schema_version: SCHEMA_VERSION,
      production_run_id: `production:${FIXED_NOW}`,
      started_at: FIXED_NOW,
      completed_at: FIXED_NOW,
      code_sha: CODE_SHA,
      decision: "publishable",
      sources: state.sources,
    }),
    previousSnapshotTag: null,
  };
}

void test("rejects traversal, absolute and link archive entries", () => {
  for (const [path, type] of [
    ["../escape", "File"],
    ["/absolute", "File"],
    ["data-hub/raw/link", "SymbolicLink"],
    ["data-hub\\raw\\escape", "File"],
    ["data-hub/raw/bad\0name", "File"],
    ["data-hub/raw/./alias", "File"],
  ] as const) {
    assert.throws(() => {
      validateArchiveEntry(path, type);
    }, /unsafe_archive_entry/);
  }
  assert.doesNotThrow(() => {
    validateArchiveEntry("data-hub/raw/source/digest/artifact", "File");
  });
});

void test("rejects unsafe text in a public snapshot summary", async (t) => {
  const input = await snapshotInput(t, "out");
  const source = input.summary.sources[0] ?? assert.fail("missing source");
  const unsafeSummary = ProductionRunSummarySchema.parse({
    ...input.summary,
    sources: [
      {
        ...source,
        warning_codes: ["Authorization: Bearer private-value"],
      },
    ],
  });

  await assert.rejects(
    () => createSnapshot({ ...input, summary: unsafeSummary }),
    /unsafe_public_summary/,
  );
});

void test("cleans staging when the output path cannot be prepared", async (t) => {
  const input = await snapshotInput(t, "unused");
  const parent = join(input.dataDir, "..");
  const outputFile = join(parent, "output-is-a-file");
  await writeFile(outputFile, "occupied\n");
  const before = (await readdir(parent)).filter((name) =>
    name.startsWith(".snapshot-stage-"),
  );

  await assert.rejects(() =>
    createSnapshot({ ...input, outputDir: outputFile }),
  );

  assert.deepEqual(
    (await readdir(parent)).filter((name) =>
      name.startsWith(".snapshot-stage-"),
    ),
    before,
  );
});

void test("creates byte-identical archives from identical state", async (t) => {
  const firstInput = await snapshotInput(t, "out-1");
  const secondInput = {
    ...firstInput,
    outputDir: join(firstInput.dataDir, "out-2"),
  };

  const first = await createSnapshot(firstInput);
  const second = await createSnapshot(secondInput);

  assert.equal(first.index.snapshot_id, second.index.snapshot_id);
  assert.equal(first.index.archive.sha256, second.index.archive.sha256);
  assert.deepEqual(await readFile(first.archivePath), await readFile(second.archivePath));
});

void test("restores a verified snapshot into an absent target", async (t) => {
  const input = await snapshotInput(t, "out");
  const created = await createSnapshot(input);
  const target = join(input.dataDir, "restored-data-hub");

  const index = await restoreSnapshot({
    archivePath: created.archivePath,
    checksumPath: created.checksumPath,
    indexPath: created.indexPath,
    targetDataDir: target,
  });

  assert.equal(index.snapshot_id, created.index.snapshot_id);
  assert.deepEqual(
    (await validateDataHubState(target)).dataset_ids,
    created.index.dataset_ids,
  );
});

void test("rejects a corrupted snapshot sidecar", async (t) => {
  const input = await snapshotInput(t, "out");
  const created = await createSnapshot(input);
  await writeFile(
    created.checksumPath,
    `${"b".repeat(64)}  ${basename(created.archivePath)}\n`,
  );

  await assert.rejects(
    () =>
      restoreSnapshot({
        archivePath: created.archivePath,
        checksumPath: created.checksumPath,
        indexPath: created.indexPath,
        targetDataDir: join(input.dataDir, "restore-sidecar"),
      }),
    /checksum_sidecar_mismatch/,
  );
});

void test("rejects a corrupted snapshot archive byte", async (t) => {
  const input = await snapshotInput(t, "out");
  const created = await createSnapshot(input);
  await appendFile(created.archivePath, new Uint8Array([0]));

  await assert.rejects(
    () =>
      restoreSnapshot({
        archivePath: created.archivePath,
        checksumPath: created.checksumPath,
        indexPath: created.indexPath,
        targetDataDir: join(input.dataDir, "restore-archive"),
      }),
    /archive_(?:size|digest)_mismatch/,
  );
});

void test("rejects an index archive name that does not match its digest", async (t) => {
  const input = await snapshotInput(t, "out");
  const created = await createSnapshot(input);
  const encoded = await readFile(created.indexPath, "utf8");
  await writeFile(
    created.indexPath,
    encoded.replace(
      created.index.archive.name,
      `data-hub-${"f".repeat(64)}.tar.gz`,
    ),
  );

  await assert.rejects(
    () =>
      restoreSnapshot({
        archivePath: created.archivePath,
        checksumPath: created.checksumPath,
        indexPath: created.indexPath,
        targetDataDir: join(input.dataDir, "restore-index"),
      }),
    /invalid_snapshot_index/,
  );
});

void test("never overwrites an existing non-empty restore target", async (t) => {
  const input = await snapshotInput(t, "out");
  const created = await createSnapshot(input);
  const target = join(input.dataDir, "existing-target");
  await mkdir(target);
  const sentinel = join(target, "keep.txt");
  await writeFile(sentinel, "keep\n");

  await assert.rejects(
    () =>
      restoreSnapshot({
        archivePath: created.archivePath,
        checksumPath: created.checksumPath,
        indexPath: created.indexPath,
        targetDataDir: target,
      }),
    /restore_target_not_empty/,
  );
  assert.equal(await readFile(sentinel, "utf8"), "keep\n");
});
