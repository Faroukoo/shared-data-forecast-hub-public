import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { LocalArtifactStore } from "@data-hub/artifact-store";
import { HCP_IPC_2017_SOURCE } from "@data-hub/source-registry";

function input(bytes = new TextEncoder().encode("official bytes")) {
  return {
    source: HCP_IPC_2017_SOURCE,
    originalUrl: "https://data.gov.ma/data/example.xlsx",
    retrievedAt: "2026-08-26T12:00:00.000Z",
    etag: null,
    lastModified: null,
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    originalFilename: "example.xlsx",
    sourcePublicationPeriod: null,
    predecessorSha256: null,
    bytes,
  };
}

void test("stores identical bytes once by SHA-256", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new LocalArtifactStore(root);

  const first = await store.putArtifact(input());
  const second = await store.putArtifact(input());

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.artifact.sha256, second.artifact.sha256);
  assert.deepEqual(await store.getArtifactBytes(first.artifact.sha256), input().bytes);
});

void test("never replaces bytes at an existing digest path", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-collision-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = new TextEncoder().encode("official bytes");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const artifactPath = join(
    root,
    "raw",
    "hcp-ipc-2017-monthly",
    digest,
    "artifact",
  );
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, "different bytes");

  const store = new LocalArtifactStore(root);
  await assert.rejects(
    () => store.putArtifact(input(bytes)),
    /artifact_digest_collision/,
  );
});

void test("cleans temporary files after a manifest write-failure", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-hub-write-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "manifests"), "blocks directory creation");
  const digest = createHash("sha256").update(input().bytes).digest("hex");
  const store = new LocalArtifactStore(root);

  await assert.rejects(() => store.putArtifact(input()));
  await assert.rejects(() =>
    access(join(root, "manifests", "artifacts", `${digest}.json`)),
  );
  const targetDirectory = join(root, "raw", "hcp-ipc-2017-monthly", digest);
  const entries = await readdir(targetDirectory).catch(() => []);
  assert.equal(entries.some((entry) => entry.startsWith(".tmp-")), false);
});
