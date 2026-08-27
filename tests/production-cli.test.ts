import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProductionRunSummarySchema } from "@data-hub/contracts";

import { executeProductionCommand } from "../apps/ingest-cli/src/production-command.js";
import { executeSnapshotCommand } from "../apps/ingest-cli/src/snapshot-command.js";
import { productionSummaryFactory } from "./test-factories.js";

const CODE_SHA = "a".repeat(40);

void test("production-run writes JSON and Markdown paths", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "production-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const summaryFile = join(root, "summary.json");
  const markdownFile = join(root, "summary.md");
  const exitCode = await executeProductionCommand(
    [
      "--data-dir",
      root,
      "--summary-file",
      summaryFile,
      "--markdown-file",
      markdownFile,
      "--code-sha",
      CODE_SHA,
    ],
    {
      runProduction: () =>
        Promise.resolve(productionSummaryFactory({ decision: "no_change" })),
    },
  );

  assert.equal(exitCode, 0);
  assert.equal(
    ProductionRunSummarySchema.parse(
      JSON.parse(await readFile(summaryFile, "utf8")) as unknown,
    ).decision,
    "no_change",
  );
  assert.match(await readFile(markdownFile, "utf8"), /no_change/);
});

void test("blocked production exits with code 2 after writing its summary", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "production-cli-blocked-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const summaryFile = join(root, "summary.json");
  const exitCode = await executeProductionCommand(
    [
      "--data-dir",
      root,
      "--summary-file",
      summaryFile,
      "--markdown-file",
      join(root, "summary.md"),
      "--code-sha",
      CODE_SHA,
    ],
    {
      runProduction: () =>
        Promise.resolve(productionSummaryFactory({ decision: "blocked" })),
    },
  );

  assert.equal(exitCode, 2);
  assert.equal(
    ProductionRunSummarySchema.parse(
      JSON.parse(await readFile(summaryFile, "utf8")) as unknown,
    ).decision,
    "blocked",
  );
});

void test("production command rejects missing pairs and duplicate options", async () => {
  assert.equal(await executeProductionCommand(["--data-dir"]), 64);
  assert.equal(
    await executeProductionCommand([
      "--data-dir",
      "one",
      "--data-dir",
      "two",
    ]),
    64,
  );
});

void test("production command rejects an invalid code SHA before ingestion", async () => {
  let called = false;
  const exitCode = await executeProductionCommand(
    [
      "--data-dir",
      "data",
      "--summary-file",
      "summary.json",
      "--markdown-file",
      "summary.md",
      "--code-sha",
      "not-a-sha",
    ],
    {
      runProduction: () => {
        called = true;
        return Promise.resolve(productionSummaryFactory());
      },
    },
  );

  assert.equal(exitCode, 64);
  assert.equal(called, false);
});

void test("snapshot create maps previous-tag none to null", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "snapshot-cli-create-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const summaryFile = join(root, "summary.json");
  await writeFile(
    summaryFile,
    `${JSON.stringify(productionSummaryFactory())}\n`,
  );
  let previousTag: string | null | undefined;

  const exitCode = await executeSnapshotCommand(
    [
      "create",
      "--data-dir",
      root,
      "--output-dir",
      join(root, "out"),
      "--summary-file",
      summaryFile,
      "--previous-tag",
      "none",
    ],
    {
      createSnapshot: (input) => {
        previousTag = input.previousSnapshotTag;
        return Promise.resolve(undefined);
      },
    },
  );

  assert.equal(exitCode, 0);
  assert.equal(previousTag, null);
});

void test("snapshot command rejects an unknown subcommand", async () => {
  assert.equal(await executeSnapshotCommand(["unknown"]), 64);
});

void test("snapshot create rejects a malformed previous tag as usage", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "snapshot-cli-tag-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const summaryFile = join(root, "summary.json");
  await writeFile(summaryFile, JSON.stringify(productionSummaryFactory()));

  assert.equal(
    await executeSnapshotCommand(
      [
        "create",
        "--data-dir",
        root,
        "--output-dir",
        join(root, "out"),
        "--summary-file",
        summaryFile,
        "--previous-tag",
        "latest",
      ],
      { createSnapshot: () => Promise.resolve(undefined) },
    ),
    64,
  );
});

void test("snapshot restore maps a non-empty target to integrity exit 4", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "snapshot-cli-restore-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "target");
  await mkdir(target);
  await writeFile(join(target, "keep.txt"), "keep\n");

  const exitCode = await executeSnapshotCommand([
    "restore",
    "--archive",
    join(root, "missing.tar.gz"),
    "--checksum",
    join(root, "missing.sha256"),
    "--index",
    join(root, "missing.json"),
    "--target-data-dir",
    target,
  ]);

  assert.equal(exitCode, 4);
  assert.equal(await readFile(join(target, "keep.txt"), "utf8"), "keep\n");
});
