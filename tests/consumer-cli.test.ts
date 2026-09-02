import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  CONSUMER_CONTRACT,
  CONSUMER_PROFILE,
  ConsumerPayloadSchema,
  SCHEMA_VERSION,
  SnapshotIndexSchema,
  type ConsumerPayload,
  type ConsumerV2Payload,
  type SnapshotIndex,
} from "@data-hub/contracts";
import { writeConsumerBundle } from "@data-hub/adapters";

import { executeConsumerCommand } from "../apps/ingest-cli/src/consumer-command.js";
import { main } from "../apps/ingest-cli/src/index.js";
import { consumerV2PayloadFixture } from "./consumer-v2-fixture.js";

const SNAPSHOT_ID = `9d3b77bbfc0c${"a".repeat(52)}`;
const SNAPSHOT_TAG = "data-20260827T095123Z-9d3b77bbfc0c";
const CREATED_AT = "2026-08-27T09:50:54.738Z";
const CODE_SHA = "c".repeat(40);
const PAYLOAD_DIGEST = "d".repeat(64);

function snapshot(): SnapshotIndex {
  return SnapshotIndexSchema.parse({
    schema_version: SCHEMA_VERSION,
    snapshot_id: SNAPSHOT_ID,
    created_at: CREATED_AT,
    code_sha: "a".repeat(40),
    previous_snapshot_tag: null,
    archive: {
      name: `data-hub-${"b".repeat(64)}.tar.gz`,
      byte_length: 1,
      sha256: "b".repeat(64),
    },
    manifest_sha256: "e".repeat(64),
    sources: [
      {
        source_id: "hcp-ipc-2017-monthly",
        run_id: "run:hcp-ipc-2017-monthly",
        state: "published",
        artifact_sha256: "f".repeat(64),
        dataset_id: `sha256:${"1".repeat(64)}`,
        health_status: "stale",
        warning_codes: ["source_stale"],
        failure_code: null,
      },
    ],
    dataset_ids: [`sha256:${"1".repeat(64)}`],
    contains_confidential_data: false,
  });
}

function payload(): ConsumerPayload {
  return ConsumerPayloadSchema.parse({
    schema_version: SCHEMA_VERSION,
    consumer_contract: CONSUMER_CONTRACT,
    source_snapshot_tag: SNAPSHOT_TAG,
    source_snapshot_id: SNAPSHOT_ID,
    generated_at: CREATED_AT,
    profile_id: CONSUMER_PROFILE,
    contains_confidential_data: false,
    decision_scope: "observation_only",
    coverage_start: "2024-11-01",
    coverage_end: "2024-11-30",
    sources: [
      {
        source_id: "hcp-ipc-2017-monthly",
        publisher_name: "Haut-Commissariat au Plan",
        official_base_url: "https://www.hcp.ma/",
        licence_id: "ODbL-1.0",
        licence_evidence_url: "https://data.gov.ma/data/fr/dataset/data_7_5",
        health_status: "stale",
        retrieved_at: CREATED_AT,
        last_period_end: "2024-11-30",
        warning_age_days: 60,
        expiry_age_days: 120,
        age_days_at_snapshot: 635,
        warning_codes: ["source_stale"],
      },
    ],
    observations: [
      {
        series_key: "hcp.ipc2017.01",
        label_fr: "Alimentation",
        category: "food_overall",
        usage: "macro_context_only",
        geography_type: "country",
        location_key: "ma",
        period_start: "2024-11-01",
        period_end: "2024-11-30",
        frequency: "monthly",
        value: "118.4",
        unit: "index",
        base_year: 2017,
        scaling_factor: "1",
        source_id: "hcp-ipc-2017-monthly",
        artifact_sha256: "f".repeat(64),
        retrieved_at: CREATED_AT,
        quality_status: "accepted",
        warning_codes: [],
        revision_number: 1,
      },
    ],
  });
}

function payloadV2(): ConsumerV2Payload {
  return consumerV2PayloadFixture({
    snapshotId: SNAPSHOT_ID,
    snapshotTag: SNAPSHOT_TAG,
    generatedAt: CREATED_AT,
  });
}

async function snapshotIndexFile(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "consumer-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "snapshot-index.json");
  await writeFile(path, `${JSON.stringify(snapshot())}\n`);
  return path;
}

async function captureLogs(
  operation: () => Promise<number>,
): Promise<{ exitCode: number; lines: string[] }> {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => {
    lines.push(values.map(String).join(" "));
  };
  try {
    return { exitCode: await operation(), lines };
  } finally {
    console.log = originalLog;
  }
}

function createArgs(
  snapshotIndex: string,
  contractVersion?: string,
): string[] {
  const args = [
    "create",
    "--data-dir",
    "/data/current",
    "--snapshot-index",
    snapshotIndex,
    "--source-tag",
    SNAPSHOT_TAG,
    "--output-dir",
    "/release/consumer",
    "--code-sha",
    CODE_SHA,
  ];
  if (contractVersion !== undefined) {
    args.push("--contract-version", contractVersion);
  }
  return args;
}

void test("consumer create defaults to the v1 builder and forwards the authoritative source tag", async (t) => {
  const snapshotIndex = await snapshotIndexFile(t);
  const consumerPayload = payload();
  let buildCalled = false;
  let writeCalled = false;

  const result = await captureLogs(() =>
    executeConsumerCommand(createArgs(snapshotIndex), {
      buildConsumer: (input) => {
        buildCalled = true;
        assert.equal(input.dataDir, "/data/current");
        assert.deepEqual(input.snapshot, snapshot());
        assert.equal(input.sourceTag, SNAPSHOT_TAG);
        return Promise.resolve(consumerPayload);
      },
      buildConsumerV2: () => {
        throw new Error("unexpected_v2_builder");
      },
      writeBundle: (input) => {
        writeCalled = true;
        assert.equal(input.outputDir, "/release/consumer");
        assert.equal(input.payload, consumerPayload);
        assert.equal(input.codeSha, CODE_SHA);
        return Promise.resolve({
          index: {
            source_snapshot_tag: SNAPSHOT_TAG,
            payload: { sha256: PAYLOAD_DIGEST },
          },
        });
      },
    }),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(buildCalled, true);
  assert.equal(writeCalled, true);
  assert.deepEqual(result.lines.map((line) => JSON.parse(line) as unknown), [
    {
      event: "consumer_bundle_created",
      source_tag: SNAPSHOT_TAG,
      payload_digest: PAYLOAD_DIGEST,
    },
  ]);
});

void test("consumer create selects the v2 builder only for exact v2", async (t) => {
  const snapshotIndex = await snapshotIndexFile(t);
  const consumerPayload = payloadV2();
  let v2BuildCalled = false;

  const result = await captureLogs(() =>
    executeConsumerCommand(createArgs(snapshotIndex, "v2"), {
      buildConsumer: () => {
        throw new Error("unexpected_v1_builder");
      },
      buildConsumerV2: (input) => {
        v2BuildCalled = true;
        assert.equal(input.dataDir, "/data/current");
        assert.deepEqual(input.snapshot, snapshot());
        assert.equal(input.sourceTag, SNAPSHOT_TAG);
        return Promise.resolve(consumerPayload);
      },
      writeBundle: (input) => {
        assert.equal(input.payload, consumerPayload);
        return Promise.resolve({
          index: {
            source_snapshot_tag: SNAPSHOT_TAG,
            payload: { sha256: PAYLOAD_DIGEST },
          },
        });
      },
    }),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(v2BuildCalled, true);
  assert.deepEqual(result.lines.map((line) => JSON.parse(line) as unknown), [
    {
      event: "consumer_bundle_created",
      source_tag: SNAPSHOT_TAG,
      payload_digest: PAYLOAD_DIGEST,
    },
  ]);
});

void test("consumer create rejects every contract version other than exact v1 or v2 without leaking it", async () => {
  const secretVersion = "v2-/private/token-credential_secret";
  const result = await captureLogs(() =>
    executeConsumerCommand(createArgs("/private/snapshot-index.json", secretVersion)),
  );

  assert.equal(result.exitCode, 64);
  assert.deepEqual(result.lines.map((line) => JSON.parse(line) as unknown), [
    {
      event: "consumer_command_failed",
      error_code: "invalid_contract_version",
    },
  ]);
  assert.equal(
    result.lines.some((line) =>
      /private|token|credential_secret|snapshot-index/.test(line),
    ),
    false,
  );
});

void test("consumer verify maps its three exact paths and logs the verified digest", async () => {
  let captured:
    | { indexPath: string; payloadPath: string; checksumPath: string }
    | undefined;
  const result = await captureLogs(() =>
    executeConsumerCommand(
      [
        "verify",
        "--index",
        "/bundle/consumer-index.json",
        "--payload",
        "/bundle/consumer-v1.json",
        "--checksum",
        "/bundle/consumer-v1.json.sha256",
      ],
      {
        verifyBundle: (input) => {
          captured = input;
          return Promise.resolve({
            source_snapshot_tag: SNAPSHOT_TAG,
            payload: { sha256: PAYLOAD_DIGEST },
          });
        },
      },
    ),
  );

  assert.deepEqual(captured, {
    indexPath: "/bundle/consumer-index.json",
    payloadPath: "/bundle/consumer-v1.json",
    checksumPath: "/bundle/consumer-v1.json.sha256",
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.lines.map((line) => JSON.parse(line) as unknown), [
    {
      event: "consumer_bundle_verified",
      source_tag: SNAPSHOT_TAG,
      payload_digest: PAYLOAD_DIGEST,
    },
  ]);
});

void test("consumer verify accepts a self-describing v2 bundle", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "consumer-cli-v2-verify-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const created = await writeConsumerBundle({
    outputDir: join(root, "bundle"),
    payload: payloadV2(),
    codeSha: CODE_SHA,
  });

  const result = await captureLogs(() =>
    executeConsumerCommand([
      "verify",
      "--index",
      created.indexPath,
      "--payload",
      created.payloadPath,
      "--checksum",
      created.checksumPath,
    ]),
  );

  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.lines.map((line) => JSON.parse(line) as unknown), [
    {
      event: "consumer_bundle_verified",
      source_tag: SNAPSHOT_TAG,
      payload_digest: created.index.payload.sha256,
    },
  ]);
});

void test("consumer create refuses a v2 payload whose source tag differs from the request", async (t) => {
  const snapshotIndex = await snapshotIndexFile(t);
  const mismatchedPayload: ConsumerV2Payload = {
    ...payloadV2(),
    source_snapshot_tag: "data-20260827T095123Z-aaaaaaaaaaaa",
  };
  let writeCalled = false;
  const result = await captureLogs(() =>
    executeConsumerCommand(createArgs(snapshotIndex, "v2"), {
      buildConsumerV2: () => Promise.resolve(mismatchedPayload),
      writeBundle: () => {
        writeCalled = true;
        throw new Error("unexpected_write");
      },
    }),
  );

  assert.equal(result.exitCode, 4);
  assert.equal(writeCalled, false);
  assert.deepEqual(result.lines.map((line) => JSON.parse(line) as unknown), [
    {
      event: "consumer_command_failed",
      error_code: "consumer_validation_failed",
    },
  ]);
});

void test("consumer commands reject a missing required option", async () => {
  const result = await captureLogs(() =>
    executeConsumerCommand([
      "verify",
      "--index",
      "index.json",
      "--payload",
      "payload.json",
    ]),
  );

  assert.equal(result.exitCode, 64);
});

void test("consumer commands reject duplicate options", async () => {
  const result = await captureLogs(() =>
    executeConsumerCommand([
      "verify",
      "--index",
      "one.json",
      "--index",
      "two.json",
      "--payload",
      "payload.json",
      "--checksum",
      "checksum.txt",
    ]),
  );

  assert.equal(result.exitCode, 64);
});

void test("consumer create and verify reject options outside their allowlists", async () => {
  const create = await captureLogs(() =>
    executeConsumerCommand([
      ...createArgs("snapshot-index.json"),
      "--payload",
      "payload.json",
    ]),
  );
  const verify = await captureLogs(() =>
    executeConsumerCommand([
      "verify",
      "--index",
      "index.json",
      "--payload",
      "payload.json",
      "--checksum",
      "checksum.txt",
      "--data-dir",
      "/data/current",
    ]),
  );

  assert.equal(create.exitCode, 64);
  assert.equal(verify.exitCode, 64);
});

void test("consumer create rejects an invalid source tag before dependencies run", async () => {
  let called = false;
  const args = createArgs("snapshot-index.json");
  args[args.indexOf(SNAPSHOT_TAG)] = "latest";
  const result = await captureLogs(() =>
    executeConsumerCommand(args, {
      buildConsumer: () => {
        called = true;
        return Promise.resolve(payload());
      },
    }),
  );

  assert.equal(result.exitCode, 64);
  assert.equal(called, false);
});

void test("consumer create rejects an invalid code SHA before dependencies run", async () => {
  let called = false;
  const args = createArgs("snapshot-index.json");
  args[args.indexOf(CODE_SHA)] = "not-a-sha";
  const result = await captureLogs(() =>
    executeConsumerCommand(args, {
      buildConsumer: () => {
        called = true;
        return Promise.resolve(payload());
      },
    }),
  );

  assert.equal(result.exitCode, 64);
  assert.equal(called, false);
});

void test("consumer create maps a source tag mismatch to validation exit 4", async (t) => {
  const snapshotIndex = await snapshotIndexFile(t);
  const args = createArgs(snapshotIndex);
  args[args.indexOf(SNAPSHOT_TAG)] =
    "data-20260827T095123Z-aaaaaaaaaaaa";
  let buildCalled = false;
  const result = await captureLogs(() =>
    executeConsumerCommand(args, {
      buildConsumer: () => {
        buildCalled = true;
        return Promise.resolve(payload());
      },
    }),
  );

  assert.equal(result.exitCode, 4);
  assert.equal(buildCalled, false);
});

void test("consumer failures never print arbitrary errors, paths or payload content", async (t) => {
  const snapshotIndex = await snapshotIndexFile(t);
  const result = await captureLogs(() =>
    executeConsumerCommand(createArgs(snapshotIndex), {
      buildConsumer: () => {
        throw new Error("credential_secret");
      },
    }),
  );

  assert.equal(result.exitCode, 4);
  assert.deepEqual(result.lines.map((line) => JSON.parse(line) as unknown), [
    {
      event: "consumer_command_failed",
      error_code: "consumer_validation_failed",
    },
  ]);
  assert.equal(
    result.lines.some((line) =>
      /credential_secret|snapshot-index|\/data\/|\/release\//.test(line),
    ),
    false,
  );
});

void test("consumer rejects unknown subcommands as usage errors", async () => {
  const result = await captureLogs(() => executeConsumerCommand(["publish"]));

  assert.equal(result.exitCode, 64);
});

void test("main routes consumer commands to the bounded consumer handler", async () => {
  const result = await captureLogs(() => main(["consumer", "publish"]));

  assert.equal(result.exitCode, 64);
  assert.deepEqual(result.lines.map((line) => JSON.parse(line) as unknown), [
    {
      event: "consumer_command_failed",
      error_code: "unknown_consumer_command",
    },
  ]);
});
