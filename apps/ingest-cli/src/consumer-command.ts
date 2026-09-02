import { readFile } from "node:fs/promises";

import {
  buildErpSnackConsumer,
  buildErpSnackConsumerV2,
  buildErpSnackConsumerV3,
  verifyConsumerBundle,
  writeConsumerBundle,
  type BuildErpSnackConsumerInput,
  type BuildErpSnackConsumerV2Input,
  type BuildErpSnackConsumerV3Input,
  type VerifyConsumerBundleInput,
  type WriteConsumerBundleInput,
} from "@data-hub/adapters";
import {
  SnapshotIndexSchema,
  type ConsumerPayload,
  type ConsumerV2Payload,
  type ConsumerV3Payload,
} from "@data-hub/contracts";

import {
  CliUsageError,
  parseCliOptions,
  requiredOption,
} from "./command-options.js";

const CREATE_OPTIONS = new Set([
  "--data-dir",
  "--snapshot-index",
  "--source-tag",
  "--output-dir",
  "--code-sha",
  "--contract-version",
]);
const VERIFY_OPTIONS = new Set(["--index", "--payload", "--checksum"]);
const SOURCE_TAG_PATTERN = /^data-\d{8}T\d{6}Z-[a-f0-9]{12}$/;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const PAYLOAD_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

interface ConsumerBundleIdentity {
  source_snapshot_tag: string;
  payload: { sha256: string };
}

export interface ConsumerCommandDependencies {
  buildConsumer?: (
    input: BuildErpSnackConsumerInput,
  ) => Promise<ConsumerPayload>;
  buildConsumerV2?: (
    input: BuildErpSnackConsumerV2Input,
  ) => Promise<ConsumerV2Payload>;
  buildConsumerV3?: (
    input: BuildErpSnackConsumerV3Input,
  ) => Promise<ConsumerV3Payload>;
  writeBundle?: (
    input: WriteConsumerBundleInput,
  ) => Promise<{ index: ConsumerBundleIdentity }>;
  verifyBundle?: (
    input: VerifyConsumerBundleInput,
  ) => Promise<ConsumerBundleIdentity>;
}

function assertBundleIdentity(
  identity: ConsumerBundleIdentity,
  expectedSourceTag?: string,
): void {
  if (
    !SOURCE_TAG_PATTERN.test(identity.source_snapshot_tag) ||
    !PAYLOAD_DIGEST_PATTERN.test(identity.payload.sha256) ||
    (expectedSourceTag !== undefined &&
      identity.source_snapshot_tag !== expectedSourceTag)
  ) {
    throw new Error("consumer_bundle_identity_invalid");
  }
}

function logSuccess(event: string, identity: ConsumerBundleIdentity): void {
  console.log(
    JSON.stringify({
      event,
      source_tag: identity.source_snapshot_tag,
      payload_digest: identity.payload.sha256,
    }),
  );
}

async function createConsumerBundle(
  args: string[],
  dependencies: ConsumerCommandDependencies,
): Promise<void> {
  const values = parseCliOptions(args, CREATE_OPTIONS);
  const dataDir = requiredOption(values, "--data-dir");
  const snapshotIndexPath = requiredOption(values, "--snapshot-index");
  const requestedSourceTag = requiredOption(values, "--source-tag");
  const outputDir = requiredOption(values, "--output-dir");
  const codeSha = requiredOption(values, "--code-sha");
  const contractVersion = values.get("--contract-version") ?? "v1";
  if (
    contractVersion !== "v1" &&
    contractVersion !== "v2" &&
    contractVersion !== "v3"
  ) {
    throw new CliUsageError("invalid_contract_version");
  }
  if (!SOURCE_TAG_PATTERN.test(requestedSourceTag)) {
    throw new CliUsageError("invalid_source_tag");
  }
  if (!GIT_SHA_PATTERN.test(codeSha)) {
    throw new CliUsageError("invalid_code_sha");
  }

  const snapshot = SnapshotIndexSchema.parse(
    JSON.parse(await readFile(snapshotIndexPath, "utf8")) as unknown,
  );
  if (requestedSourceTag.slice(-12) !== snapshot.snapshot_id.slice(0, 12)) {
    throw new Error("consumer_source_tag_snapshot_mismatch");
  }
  const builderInput = { dataDir, snapshot, sourceTag: requestedSourceTag };
  const payload = contractVersion === "v2"
    ? await (dependencies.buildConsumerV2 ?? buildErpSnackConsumerV2)(builderInput)
    : contractVersion === "v3"
    ? await (dependencies.buildConsumerV3 ?? buildErpSnackConsumerV3)(builderInput)
    : await (dependencies.buildConsumer ?? buildErpSnackConsumer)(builderInput);
  if (payload.source_snapshot_tag !== requestedSourceTag) {
    throw new Error("consumer_source_tag_mismatch");
  }
  const created = await (dependencies.writeBundle ?? writeConsumerBundle)({
    outputDir,
    payload,
    codeSha,
  });
  assertBundleIdentity(created.index, requestedSourceTag);
  logSuccess("consumer_bundle_created", created.index);
}

async function verifyBundle(
  args: string[],
  dependencies: ConsumerCommandDependencies,
): Promise<void> {
  const values = parseCliOptions(args, VERIFY_OPTIONS);
  const index = await (dependencies.verifyBundle ?? verifyConsumerBundle)({
    indexPath: requiredOption(values, "--index"),
    payloadPath: requiredOption(values, "--payload"),
    checksumPath: requiredOption(values, "--checksum"),
  });
  assertBundleIdentity(index);
  logSuccess("consumer_bundle_verified", index);
}

export async function executeConsumerCommand(
  args: string[],
  dependencies: ConsumerCommandDependencies = {},
): Promise<number> {
  try {
    const subcommand = args[0];
    if (subcommand === "create") {
      await createConsumerBundle(args.slice(1), dependencies);
    } else if (subcommand === "verify") {
      await verifyBundle(args.slice(1), dependencies);
    } else {
      throw new CliUsageError("unknown_consumer_command");
    }
    return 0;
  } catch (error) {
    const usage = error instanceof CliUsageError;
    console.log(
      JSON.stringify({
        event: "consumer_command_failed",
        error_code: usage ? error.message : "consumer_validation_failed",
      }),
    );
    return usage ? 64 : 4;
  }
}
