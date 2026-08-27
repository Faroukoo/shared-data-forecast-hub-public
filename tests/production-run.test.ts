import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { IngestionRun } from "@data-hub/contracts";
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

async function productionRunFixture(
  states: [IngestionRun["state"], IngestionRun["state"]],
) {
  const sources = listEnabledSourceDefinitions();
  let sourceIndex = 0;
  return runProductionIngestion({
    dataDir: "/tmp/not-read",
    codeSha: CODE_SHA,
    now: FIXED_NOW,
    sources,
    runSource: ({ sourceId }) => {
      const state = states[sourceIndex] ?? assert.fail("missing fixture state");
      sourceIndex += 1;
      return Promise.resolve(
        ingestionRunFactory({
          source_id: sourceId,
          run_id: `run:${sourceId}`,
          state,
        }),
      );
    },
    loadArtifact: (_dataDir, sha256) =>
      Promise.resolve(rawArtifactFactory({ sha256 })),
    loadQuality: () => Promise.resolve(qualityReport()),
  });
}

void test("continues all sources but blocks the batch after one failure", async () => {
  const called: string[] = [];
  const summary = await runProductionIngestion({
    dataDir: "/tmp/not-read",
    codeSha: CODE_SHA,
    now: FIXED_NOW,
    sources: listEnabledSourceDefinitions(),
    runSource: ({ sourceId }) => {
      called.push(sourceId);
      return Promise.resolve(
        ingestionRunFactory({
          source_id: sourceId,
          run_id: `run:${sourceId}`,
          state: sourceId.includes("ipc") ? "failed_retryable" : "no_change",
          failure_code: sourceId.includes("ipc") ? "request_timeout" : null,
        }),
      );
    },
    loadArtifact: (_dataDir, sha256) =>
      Promise.resolve(rawArtifactFactory({ sha256 })),
    loadQuality: () => Promise.resolve(null),
  });

  assert.deepEqual(called, [
    "hcp-ipc-2017-monthly",
    "hcp-ipp-2018-monthly",
  ]);
  assert.equal(summary.decision, "blocked");
});

void test("publishes only when at least one valid source changed", async () => {
  const summary = await productionRunFixture(["published", "no_change"]);

  assert.equal(summary.decision, "publishable");
  assert.match(renderProductionMarkdown(summary), /hcp-ipc-2017-monthly/);
});

void test("reports stale health for an unchanged old artifact", async () => {
  const source =
    listEnabledSourceDefinitions()[0] ?? assert.fail("missing enabled source");
  const summary = await runProductionIngestion({
    dataDir: "/tmp/not-read",
    codeSha: CODE_SHA,
    now: FIXED_NOW,
    sources: [source],
    runSource: ({ sourceId }) =>
      Promise.resolve(
        ingestionRunFactory({
          source_id: sourceId,
          run_id: `run:${sourceId}`,
        }),
      ),
    loadArtifact: (_dataDir, sha256) =>
      Promise.resolve(
        rawArtifactFactory({
          sha256,
          source_id: source.source_id,
          http_last_modified: "2026-04-01T00:00:00.000Z",
        }),
      ),
    loadQuality: () => Promise.resolve(null),
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
