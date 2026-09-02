import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  CanonicalObservationSchema,
  type CanonicalObservation,
  type ObservationCandidate,
} from "@data-hub/contracts";
import {
  canonicalJson,
  findPublishedDatasetByArtifact,
  hasSemanticObservationChanges,
  publishDataset,
  resolveRevisions,
} from "@data-hub/canonical";
import { HCP_IPC_2017_SOURCE } from "@data-hub/source-registry";

import {
  candidate,
  qualityReport,
  rawArtifact,
} from "./test-factories.js";

function observation(
  overrides: Partial<CanonicalObservation> = {},
): CanonicalObservation {
  const base = candidate();
  const { scalar_reproducible: ignored, ...fields } = base;
  void ignored;
  return CanonicalObservationSchema.parse({
    ...fields,
    observation_id: `sha256:${"b".repeat(64)}`,
    quality_status: "accepted",
    warning_codes: [],
    revision_number: 1,
    supersedes_observation_id: null,
    ...overrides,
  });
}

async function publishFixture(
  t: TestContext,
  candidates: ObservationCandidate[],
) {
  const root = await mkdtemp(join(tmpdir(), "data-hub-publish-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return publishDataset({
    dataRoot: root,
    source: HCP_IPC_2017_SOURCE,
    artifact: rawArtifact(),
    candidates,
    quality: qualityReport("accepted"),
    previous: [],
    createdAt: "2026-08-26T12:00:00.000Z",
  });
}

void test("produces the same dataset ID regardless of input row order", async (t) => {
  const candidateA = candidate({ natural_key: "a|ma|2017-01", series_key: "a" });
  const candidateB = candidate({ natural_key: "b|ma|2017-01", series_key: "b" });
  const first = await publishFixture(t, [candidateB, candidateA]);
  const second = await publishFixture(t, [candidateA, candidateB]);
  assert.equal(first.dataset_id, second.dataset_id);
  assert.equal(first.canonical_sha256, second.canonical_sha256);
});

void test("adds a revision instead of rewriting an earlier value", () => {
  const naturalKey = "hcp.ipc2017.0113|ma|2017-01";
  const previousObservation = observation({
    natural_key: naturalKey,
    value: "100",
    revision_number: 1,
  });
  const [revised] = resolveRevisions({
    candidates: [candidate({ natural_key: naturalKey, value: "101" })],
    previous: [previousObservation],
  });
  assert.ok(revised);
  assert.equal(revised.revision_number, 2);
  assert.equal(
    revised.supersedes_observation_id,
    previousObservation.observation_id,
  );
});

void test("ignores provenance and quality-only differences in semantic observations", () => {
  const previous = observation({
    artifact_sha256: "b".repeat(64),
    source_row: 99,
    source_column: 12,
    retrieved_at: "2026-08-27T12:00:00.000Z",
    source_published_at: "2026-08-27T10:00:00.000Z",
    quality_status: "accepted_with_warning",
    warning_codes: ["stale_source"],
  });
  const repackaged = candidate({
    artifact_sha256: "c".repeat(64),
    source_row: 7,
    source_column: 8,
    retrieved_at: "2026-08-28T12:00:00.000Z",
    source_published_at: null,
    scalar_reproducible: false,
  });

  assert.equal(
    hasSemanticObservationChanges({ candidates: [repackaged], previous: [previous] }),
    false,
  );
});

const semanticMutations: ReadonlyArray<
  readonly [string, Partial<ObservationCandidate>]
> = [
  ["value", { value: "96.7" }],
  ["period", { period_start: "2017-02-01", period_end: "2017-02-28" }],
  ["label", { source_series_label: "POISSONS" }],
  ["location", { location_key: "ma:city:casablanca" }],
  ["unit", { unit: "percent" }],
  ["scaling factor", { scaling_factor: "100" }],
  ["source", { source_id: "hcp-other-monthly" }],
];

for (const [name, overrides] of semanticMutations) {
  void test(`detects a changed observation ${name}`, () => {
    assert.equal(
      hasSemanticObservationChanges({
        candidates: [candidate(overrides)],
        previous: [observation()],
      }),
      true,
    );
  });
}

void test("detects candidate natural-key additions and current-key removals", () => {
  const current = observation();
  const added = candidate({
    natural_key: "hcp.ipc2017.0115|ma|2017-01",
    series_key: "hcp.ipc2017.0115",
  });

  assert.equal(
    hasSemanticObservationChanges({
      candidates: [candidate(), added],
      previous: [current],
    }),
    true,
  );
  assert.equal(
    hasSemanticObservationChanges({ candidates: [], previous: [current] }),
    true,
  );
});

void test("rejects conflicting duplicate candidates during semantic comparison", () => {
  assert.throws(
    () =>
      hasSemanticObservationChanges({
        candidates: [candidate(), candidate({ value: "96.7" })],
        previous: [observation()],
      }),
    /conflicting_candidate:hcp\.ipc2017\.0113\|ma\|2017-01/,
  );
});

void test("refuses publication of a quarantined report", async () => {
  await assert.rejects(
    () =>
      publishDataset({
        dataRoot: ".data-hub-test",
        source: HCP_IPC_2017_SOURCE,
        artifact: rawArtifact(),
        candidates: [candidate()],
        quality: qualityReport("quarantined"),
        previous: [],
        createdAt: "2026-08-26T12:00:00.000Z",
      }),
    /publication_blocked/,
  );
});

void test("canonical JSON sorts keys and rejects non-finite values", () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}');
  assert.throws(() => canonicalJson({ invalid: Number.NaN }), /non_finite_number/);
});

void test("no_change lookup verifies the published dataset checksum", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-lookup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifact = rawArtifact();
  const dataset = await publishDataset({
    dataRoot: root,
    source: HCP_IPC_2017_SOURCE,
    artifact,
    candidates: [candidate()],
    quality: qualityReport("accepted"),
    previous: [],
    createdAt: "2026-08-26T12:00:00.000Z",
  });
  const observationsPath = join(
    root,
    "published",
    dataset.dataset_id,
    "observations.jsonl",
  );
  await writeFile(
    observationsPath,
    `${await readFile(observationsPath, "utf8")}\n`,
  );

  await assert.rejects(
    () => findPublishedDatasetByArtifact(root, artifact.sha256),
    /published_checksum_mismatch/,
  );
});

void test("no_change lookup rejects an index for a different artifact", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-index-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifact = rawArtifact();
  const dataset = await publishDataset({
    dataRoot: root,
    source: HCP_IPC_2017_SOURCE,
    artifact,
    candidates: [candidate()],
    quality: qualityReport("accepted"),
    previous: [],
    createdAt: "2026-08-26T12:00:00.000Z",
  });
  const otherSha256 = "c".repeat(64);
  const otherIndexPath = join(
    root,
    "manifests",
    "published-artifacts",
    `${otherSha256}.json`,
  );
  await writeFile(
    otherIndexPath,
    `${JSON.stringify({
      artifact_sha256: artifact.sha256,
      dataset_id: dataset.dataset_id,
    })}\n`,
  );

  await assert.rejects(
    () => findPublishedDatasetByArtifact(root, otherSha256),
    /invalid_published_index/,
  );
});
