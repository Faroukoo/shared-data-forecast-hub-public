import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parse } from "yaml";

const CI_PATH = ".github/workflows/ci.yml";
const PRODUCTION_PATH = ".github/workflows/data-refresh.yml";
const CONSUMER_PATH = ".github/workflows/consumer-release.yml";
const CHECKOUT_SHA = "11bd71901bbe5b1630ceea73d27597364c9af683";
const SETUP_NODE_SHA = "49933ea5288caeca8642d1e84afbd3f7d6820020";

function record(value: unknown, label: string): Record<string, unknown> {
  assert.equal(typeof value, "object", label);
  assert.notEqual(value, null, label);
  assert.equal(Array.isArray(value), false, label);
  return value as Record<string, unknown>;
}

function records(value: unknown, label: string): Array<Record<string, unknown>> {
  assert.equal(Array.isArray(value), true, label);
  return (value as unknown[]).map((entry, index) =>
    record(entry, `${label}[${String(index)}]`),
  );
}

async function loadWorkflow(path: string): Promise<Record<string, unknown>> {
  const parsed: unknown = parse(await readFile(path, "utf8"));
  return record(parsed, path);
}

function jobs(workflow: Record<string, unknown>): Record<string, unknown> {
  return record(workflow.jobs, "jobs");
}

function steps(job: unknown): Array<Record<string, unknown>> {
  return records(record(job, "job").steps, "steps");
}

function commands(job: unknown): string {
  return steps(job)
    .flatMap((step) => (typeof step.run === "string" ? [step.run] : []))
    .join("\n");
}

function mutateNth(
  source: string,
  before: string,
  after: string,
  occurrence: number,
): string {
  let index = -1;
  for (let current = 0; current <= occurrence; current += 1) {
    index = source.indexOf(before, index + 1);
  }
  assert.notEqual(index, -1, `mutation target not found: ${before}`);
  return `${source.slice(0, index)}${after}${source.slice(index + before.length)}`;
}

function mutateFirst(source: string, before: string, after: string): string {
  return mutateNth(source, before, after, 0);
}

const EXPECTED_CONTRACT_CASE = [
  'case "$contract_version" in',
  "  v1)",
  '    payload_name="consumer-v1.json"',
  '    checksum_name="consumer-v1.json.sha256"',
  '    consumer_tag_prefix="consumer-v1"',
  "    consumer_tag_pattern='^consumer-v1-\\d{8}T\\d{6}Z-[a-f0-9]{12}$'",
  "    ;;",
  "  v2)",
  '    payload_name="consumer-v2.json"',
  '    checksum_name="consumer-v2.json.sha256"',
  '    consumer_tag_prefix="consumer-v2"',
  "    consumer_tag_pattern='^consumer-v2-\\d{8}T\\d{6}Z-[a-f0-9]{12}$'",
  "    ;;",
  "  *)",
  '    echo "unsupported consumer contract version" >&2',
  "    exit 4",
  "    ;;",
  "esac",
] as const;

function namedStep(job: unknown, name: string): Record<string, unknown> {
  const matches = steps(job).filter((step) => step.name === name);
  assert.equal(matches.length, 1, name);
  return matches[0] as Record<string, unknown>;
}

function stepRun(step: Record<string, unknown>, label: string): string {
  assert.equal(typeof step.run, "string", label);
  return step.run as string;
}

function assertClosedContractCase(run: string, label: string): void {
  const lines = run.split("\n");
  const caseStart = lines.indexOf('case "$contract_version" in');
  assert.notEqual(caseStart, -1, `${label}.case`);
  const caseEnd = lines.indexOf("esac", caseStart);
  assert.notEqual(caseEnd, -1, `${label}.esac`);
  assert.deepEqual(
    lines.slice(caseStart, caseEnd + 1),
    EXPECTED_CONTRACT_CASE,
    `${label}.case arms`,
  );
  const firstGh = lines.findIndex((line) => line.trimStart().startsWith("gh "));
  assert.notEqual(firstGh, -1, `${label}.first gh`);
  assert.ok(caseEnd < firstGh, `${label}.case before gh`);
}

function boundedShellIf(
  lines: readonly string[],
  opening: string,
): { start: number; end: number; lines: readonly string[] } {
  const start = lines.findIndex((line) => line.trim() === opening);
  assert.notEqual(start, -1, opening);
  let depth = 0;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (/^if\b.*; then$/.test(line)) depth += 1;
    if (line === "fi") {
      depth -= 1;
      if (depth === 0) {
        return { start, end: index, lines: lines.slice(start, index + 1) };
      }
    }
  }
  assert.fail(`unterminated shell block: ${opening}`);
}

function assertHardenedConsumerReleasePolicy(
  workflow: Record<string, unknown>,
): void {
  const consumerJobs = jobs(workflow);
  const verifyStep = namedStep(
    consumerJobs.verify,
    "Restore source and verify deterministic consumer bundle",
  );
  const publishStep = namedStep(
    consumerJobs.publish,
    "Restore, verify and publish immutable consumer release",
  );

  assert.deepEqual(record(verifyStep.env, "verify.env"), {
    GH_TOKEN: "${{ github.token }}",
    SOURCE_RELEASE_TAG: "${{ inputs.source_release_tag }}",
    CONTRACT_VERSION: "${{ inputs.contract_version }}",
    CODE_SHA: "${{ github.sha }}",
  });
  assert.deepEqual(record(publishStep.env, "publish.env"), {
    GH_TOKEN: "${{ github.token }}",
    EVENT_NAME: "${{ github.event_name }}",
    REQUESTED_SOURCE_TAG: "${{ inputs.source_release_tag }}",
    REQUESTED_CONTRACT_VERSION: "${{ inputs.contract_version }}",
    MANUAL_CODE_SHA: "${{ github.sha }}",
    AUTOMATIC_CODE_SHA: "${{ github.event.workflow_run.head_sha }}",
  });

  const verifyRun = stepRun(verifyStep, "verify.run");
  const publishRun = stepRun(publishStep, "publish.run");
  assertClosedContractCase(verifyRun, "verify");
  assertClosedContractCase(publishRun, "publish");

  const publishLines = publishRun.split("\n");
  const patchMentions = publishLines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line.includes("--method PATCH"));
  assert.equal(patchMentions.length, 1, "one PATCH command");
  const patchIndex = patchMentions[0]?.index ?? -1;
  assert.deepEqual(
    publishLines.slice(patchIndex, patchIndex + 2).map((line) => line.trim()),
    [
      'gh api --method PATCH "/repos/$GITHUB_REPOSITORY/releases/$candidate_id" \\',
      '-F prerelease=false > "$work_root/after-promotion.json"',
    ],
    "PATCH changes prerelease only",
  );

  const existingReleaseBlock = boundedShellIf(
    publishLines,
    'if [ "$existing_release_id" != "none" ]; then',
  );
  const guardLines = existingReleaseBlock.lines
    .map((line) => line.trim())
    .filter((line) => line === 'test "$contract_version" = "v1"');
  assert.equal(guardLines.length, 1, "one v1 guard in existing release block");
  const guardIndex = existingReleaseBlock.lines.findIndex(
    (line) => line.trim() === 'test "$contract_version" = "v1"',
  );
  assert.ok(existingReleaseBlock.start + guardIndex < patchIndex, "v1 guard before PATCH");

  const createMentions = publishLines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line.startsWith("gh release create "));
  assert.equal(createMentions.length, 1, "one release creation command");
  const createIndex = createMentions[0]?.index ?? -1;
  assert.deepEqual(
    publishLines.slice(createIndex, createIndex + 8).map((line) => line.trim()),
    [
      'gh release create "$consumer_tag" \\',
      '--target "$code_sha" \\',
      '--title "$consumer_tag" \\',
      '--notes "Verified ERP-Snack observation bundle from $source_tag. Payload SHA-256: $payload_sha" \\',
      '"${release_flags[@]}" \\',
      '"$bundle_dir/consumer-index.json" \\',
      '"$bundle_dir/$payload_name" \\',
      '"$bundle_dir/$checksum_name"',
    ],
    "release creation arguments",
  );

  const releaseFlagInitializers = publishLines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line === "release_flags=()");
  assert.equal(releaseFlagInitializers.length, 1, "one release flag initializer");
  const releaseFlagsIndex = releaseFlagInitializers[0]?.index ?? -1;
  assert.deepEqual(
    publishLines.slice(releaseFlagsIndex, createIndex).map((line) => line.trim()),
    [
      "release_flags=()",
      'expected_prerelease="false"',
      'if [ "$operation" = "manual" ]; then',
      "release_flags+=(--prerelease)",
      'expected_prerelease="true"',
      "fi",
    ],
    "manual prerelease flags remain live until creation",
  );
}

void test("production workflow grants writes only to publisher and health jobs", async () => {
  const workflow = await loadWorkflow(PRODUCTION_PATH);
  assert.deepEqual(workflow.permissions, {});
  const productionJobs = jobs(workflow);
  assert.deepEqual(record(productionJobs.refresh, "refresh").permissions, {
    contents: "write",
  });
  assert.deepEqual(record(productionJobs.health, "health").permissions, {
    contents: "read",
    issues: "write",
  });
  assert.equal(
    record(workflow.concurrency, "concurrency")["cancel-in-progress"],
    false,
  );
});

void test("all referenced actions are pinned to approved full SHAs", async () => {
  for (const path of [CI_PATH, PRODUCTION_PATH, CONSUMER_PATH]) {
    const workflow = await loadWorkflow(path);
    const uses = Object.values(jobs(workflow)).flatMap((job) =>
      steps(job).flatMap((step) =>
        typeof step.uses === "string" ? [step.uses] : [],
      ),
    );
    assert.equal(
      uses.every((value) => /@[a-f0-9]{40}$/.test(value)),
      true,
      path,
    );
    assert.equal(
      uses.every(
        (value) =>
          value === `actions/checkout@${CHECKOUT_SHA}` ||
          value === `actions/setup-node@${SETUP_NODE_SHA}`,
      ),
      true,
      path,
    );
    assert.equal(
      uses.some((value) => /actions\/(?:upload-artifact|cache)@/.test(value)),
      false,
      path,
    );
  }
});

void test("production runs Monday 05:17 Europe/Paris with manual modes only", async () => {
  const workflow = await loadWorkflow(PRODUCTION_PATH);
  const triggers = record(workflow.on, "on");
  assert.deepEqual(Object.keys(triggers).sort(), [
    "schedule",
    "workflow_dispatch",
  ]);
  assert.deepEqual(triggers.schedule, [
    { cron: "17 5 * * 1", timezone: "Europe/Paris" },
  ]);
  const dispatch = record(triggers.workflow_dispatch, "workflow_dispatch");
  const inputs = record(dispatch.inputs, "inputs");
  const mode = record(inputs.mode, "mode");
  assert.deepEqual(mode.options, [
    "refresh",
    "publish-bootstrap",
    "restore-drill",
  ]);
  assert.equal(mode.default, "refresh");
  assert.equal("pull_request_target" in triggers, false);
});

void test("CI is read-only and all workflows use Node 22.22.3 without cache", async () => {
  const ci = await loadWorkflow(CI_PATH);
  assert.deepEqual(ci.permissions, { contents: "read" });
  const ciTriggers = record(ci.on, "ci.on");
  assert.deepEqual(Object.keys(ciTriggers).sort(), ["pull_request", "push"]);
  assert.deepEqual(record(ciTriggers.push, "push").branches, ["main"]);

  for (const workflow of [
    ci,
    await loadWorkflow(PRODUCTION_PATH),
    await loadWorkflow(CONSUMER_PATH),
  ]) {
    const setupSteps = Object.values(jobs(workflow)).flatMap((job) =>
      steps(job).filter(
        (step) => step.uses === `actions/setup-node@${SETUP_NODE_SHA}`,
      ),
    );
    assert.equal(setupSteps.length > 0, true);
    for (const setup of setupSteps) {
      const withOptions = record(setup.with, "setup-node.with");
      assert.equal(withOptions["node-version"], "22.22.3");
      assert.equal("cache" in withOptions, false);
    }
  }
});

void test("consumer releases run only from explicit dispatch or trusted refresh completion", async () => {
  const workflow = await loadWorkflow(CONSUMER_PATH);
  const triggers = record(workflow.on, "consumer.on");
  assert.deepEqual(Object.keys(triggers).sort(), [
    "workflow_dispatch",
    "workflow_run",
  ]);
  assert.equal("pull_request" in triggers, false);
  assert.equal("pull_request_target" in triggers, false);

  const dispatch = record(triggers.workflow_dispatch, "workflow_dispatch");
  const inputs = record(dispatch.inputs, "workflow_dispatch.inputs");
  assert.deepEqual(record(inputs.mode, "mode").options, [
    "verify",
    "publish-prerelease",
  ]);
  assert.equal(record(inputs.mode, "mode").required, true);
  assert.equal(
    record(inputs.source_release_tag, "source_release_tag").required,
    true,
  );
  const contractVersion = record(inputs.contract_version, "contract_version");
  assert.equal(contractVersion.type, "choice");
  assert.deepEqual(contractVersion.options, ["v1", "v2"]);
  assert.equal(contractVersion.default, "v1");
  assert.equal(contractVersion.required, true);

  const workflowRun = record(triggers.workflow_run, "workflow_run");
  assert.deepEqual(workflowRun.workflows, ["Verified public data refresh"]);
  assert.deepEqual(workflowRun.types, ["completed"]);
  assert.deepEqual(workflowRun.branches, ["main"]);

  const consumerJobs = jobs(workflow);
  assert.match(String(record(consumerJobs.verify, "verify").if), /workflow_dispatch/);
  const publishCondition = String(record(consumerJobs.publish, "publish").if);
  assert.match(
    publishCondition,
    /github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/,
  );
  assert.match(publishCondition, /workflow_run\.conclusion == 'success'/);
  assert.match(publishCondition, /workflow_run\.event == 'schedule'/);
  assert.match(
    publishCondition,
    /workflow_run\.event == 'workflow_dispatch'/,
  );
  assert.doesNotMatch(publishCondition, /workflow_run\.event\s*!=/);
  assert.match(
    publishCondition,
    /workflow_run\.head_repository\.full_name == github\.repository/,
  );
  assert.match(
    publishCondition,
    /workflow_run\.head_branch == github\.event\.repository\.default_branch/,
  );
  assert.match(
    publishCondition,
    /vars\.DATA_HUB_CONSUMER_PRODUCTION_ENABLED == 'true'/,
  );

  const checkout = steps(consumerJobs.publish).find(
    (step) => step.uses === `actions/checkout@${CHECKOUT_SHA}`,
  );
  assert.notEqual(checkout, undefined);
  assert.equal(
    record(checkout?.with, "publish.checkout.with").ref,
    "${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || github.sha }}",
  );
});

void test("consumer verification is read-only and only its publisher can write contents", async () => {
  const workflow = await loadWorkflow(CONSUMER_PATH);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const consumerJobs = jobs(workflow);
  assert.equal("permissions" in record(consumerJobs.verify, "verify"), false);
  assert.deepEqual(record(consumerJobs.publish, "publish").permissions, {
    contents: "write",
  });
  for (const [jobName, job] of Object.entries(consumerJobs)) {
    assert.equal("services" in record(job, jobName), false);
  }
  assert.deepEqual(workflow.concurrency, {
    group: "data-hub-consumer-publication",
    "cancel-in-progress": false,
  });
});

void test("consumer jobs restore and verify one exact three-asset data release in runner temp", async () => {
  const workflow = await loadWorkflow(CONSUMER_PATH);
  const consumerJobs = jobs(workflow);
  for (const jobName of ["verify", "publish"]) {
    const jobCommands = commands(consumerJobs[jobName]);
    assert.match(jobCommands, /\^data-\\d\{8\}T\\d\{6\}Z-\[a-f0-9\]\{12\}\$/);
    assert.match(jobCommands, /release\.assets\.length !== 3/);
    assert.match(jobCommands, /\$RUNNER_TEMP/);
    assert.match(jobCommands, /snapshot -- restore/);
    assert.match(jobCommands, /snapshot -- verify-state/);
    assert.match(jobCommands, /consumer -- create/);
    assert.match(jobCommands, /consumer -- verify/);
    assert.match(jobCommands, /gh api --paginate --slurp/);
    assert.match(
      jobCommands,
      /const consumerTagPattern = new RegExp\(consumerTagPatternSource\)/,
    );
    assert.doesNotMatch(jobCommands, /\.\/\.data-hub|\$GITHUB_WORKSPACE\/.data-hub/);
  }
  assert.doesNotMatch(commands(consumerJobs.verify), /gh release create|--method PATCH/);
});

void test("consumer jobs keep the selected data release tag authoritative", async () => {
  const workflow = await loadWorkflow(CONSUMER_PATH);
  const consumerJobs = jobs(workflow);
  const snapshotCreatedAt = "2026-08-27T09:50:54.738Z";
  const selectedReleaseTag = "data-20260827T095123Z-9d3b77bbfc0c";

  assert.notEqual(
    selectedReleaseTag,
    `data-${snapshotCreatedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-9d3b77bbfc0c`,
  );
  for (const jobName of ["verify", "publish"]) {
    const jobCommands = commands(consumerJobs[jobName]);
    assert.match(
      jobCommands,
      /requestedTag\.slice\(-12\) !== index\.snapshot_id\.slice\(0, 12\)/,
    );
    assert.doesNotMatch(
      jobCommands,
      /`data-\$\{timestamp\}-\$\{index\.snapshot_id\.slice\(0, 12\)\}`/,
    );
  }
});

void test("consumer jobs pass their validated selected tag to the consumer CLI", async () => {
  const workflow = await loadWorkflow(CONSUMER_PATH);
  const consumerJobs = jobs(workflow);

  assert.match(
    commands(consumerJobs.verify),
    /--source-tag "\$SOURCE_RELEASE_TAG"/,
  );
  assert.match(
    commands(consumerJobs.publish),
    /--source-tag "\$source_tag"/,
  );
});

void test("consumer jobs derive their contract assets from a closed version choice before GitHub access", async () => {
  const workflow = await loadWorkflow(CONSUMER_PATH);
  const consumerJobs = jobs(workflow);

  for (const jobName of ["verify", "publish"]) {
    const jobCommands = commands(consumerJobs[jobName]);
    assert.match(jobCommands, /case "\$contract_version" in/);
    assert.match(
      jobCommands,
      /v1\)[\s\S]*payload_name="consumer-v1\.json"[\s\S]*checksum_name="consumer-v1\.json\.sha256"[\s\S]*consumer_tag_prefix="consumer-v1"/,
    );
    assert.match(
      jobCommands,
      /v2\)[\s\S]*payload_name="consumer-v2\.json"[\s\S]*checksum_name="consumer-v2\.json\.sha256"[\s\S]*consumer_tag_prefix="consumer-v2"/,
    );
    assert.match(jobCommands, /\*\)[\s\S]*exit 4/);
    assert.match(jobCommands, /--contract-version "\$contract_version"/);
    assert.match(jobCommands, /--payload "\$bundle_dir\/\$payload_name"/);
    assert.match(jobCommands, /--checksum "\$bundle_dir\/\$checksum_name"/);
    assert.match(
      jobCommands,
      /const expected = \["consumer-index\.json", payloadName, checksumName\]/,
    );
    assert.ok(jobCommands.indexOf('case "$contract_version" in') < jobCommands.indexOf("gh api"));
    assert.doesNotMatch(jobCommands, /actions\/(?:upload-artifact|cache)/);
  }
});

void test("consumer v2 is manual candidate-only while automatic stable publication remains v1", async () => {
  const workflow = await loadWorkflow(CONSUMER_PATH);
  const publishJob = record(jobs(workflow).publish, "publish");
  const publishEnvironment = record(
    steps(publishJob).find((step) => typeof step.run === "string" && step.run.includes("gh release create"))?.env,
    "publish.env",
  );
  assert.equal(
    publishEnvironment.REQUESTED_CONTRACT_VERSION,
    "${{ inputs.contract_version }}",
  );

  const publishCommands = commands(publishJob);
  assert.match(
    publishCommands,
    /operation="manual"[\s\S]*contract_version="\$REQUESTED_CONTRACT_VERSION"/,
  );
  assert.match(
    publishCommands,
    /operation="automatic"[\s\S]*contract_version="v1"/,
  );
  assert.match(
    publishCommands,
    /\[ "\$contract_version" = "v2" \] && \[ "\$operation" != "manual" \]/,
  );
  assert.match(
    publishCommands,
    /if \[ "\$operation" = "manual" \]; then[\s\S]*release_flags\+=\(--prerelease\)/,
  );
  const stableV1Guard = publishCommands.indexOf('test "$contract_version" = "v1"');
  const promotion = publishCommands.indexOf("gh api --method PATCH");
  assert.ok(stableV1Guard >= 0);
  assert.ok(promotion > stableV1Guard);
});

void test("consumer release policy rejects mutations of every guarded write invariant", async (t) => {
  const source = await readFile(CONSUMER_PATH, "utf8");
  const workflow = record(parse(source), CONSUMER_PATH);
  assert.doesNotThrow(() => {
    assertHardenedConsumerReleasePolicy(workflow);
  });

  const mutations: ReadonlyArray<{
    name: string;
    apply: (value: string) => string;
  }> = [
    {
      name: "verify contract input is no longer bound",
      apply: (value) => mutateFirst(value, "          CONTRACT_VERSION: ${{ inputs.contract_version }}\n", ""),
    },
    {
      name: "publish contract input is no longer bound",
      apply: (value) => mutateFirst(value, "          REQUESTED_CONTRACT_VERSION: ${{ inputs.contract_version }}\n", ""),
    },
    {
      name: "v1 payload assignment changes",
      apply: (value) => mutateFirst(value, '              payload_name="consumer-v1.json"', '              payload_name="consumer-v2.json"'),
    },
    {
      name: "v2 checksum assignment changes",
      apply: (value) => mutateFirst(value, '              checksum_name="consumer-v2.json.sha256"', '              checksum_name="consumer-v1.json.sha256"'),
    },
    {
      name: "v2 tag prefix changes",
      apply: (value) => mutateFirst(value, '              consumer_tag_prefix="consumer-v2"', '              consumer_tag_prefix="consumer-v1"'),
    },
    {
      name: "v2 tag regex changes",
      apply: (value) => mutateFirst(value, "              consumer_tag_pattern='^consumer-v2-\\d{8}T\\d{6}Z-[a-f0-9]{12}$'", "              consumer_tag_pattern='^consumer-v1-\\d{8}T\\d{6}Z-[a-f0-9]{12}$'"),
    },
    {
      name: "an extra accepted version arm is inserted",
      apply: (value) => mutateFirst(value, "            *)\n", "            v3)\n              payload_name=consumer-v3.json\n              ;;\n            *)\n"),
    },
    {
      name: "the verify case runs after GitHub access",
      apply: (value) => {
        const caseStart = value.indexOf('          case "$contract_version" in');
        const caseEnd = value.indexOf("          esac", caseStart) + "          esac".length;
        assert.ok(caseStart >= 0 && caseEnd > caseStart);
        const caseBlock = value.slice(caseStart, caseEnd);
        const ghLine = '          gh api "/repos/$GITHUB_REPOSITORY/releases/tags/$SOURCE_RELEASE_TAG" > "$source_root/release.json"';
        return mutateFirst(value, `${caseBlock}\n\n${ghLine}`, `${ghLine}\n\n${caseBlock}`);
      },
    },
    {
      name: "the default arm no longer exits",
      apply: (value) => mutateFirst(value, "              exit 4\n              ;;", "              ;;"),
    },
    {
      name: "the publish case payload assignment changes",
      apply: (value) => mutateNth(value, '              payload_name="consumer-v1.json"', '              payload_name="consumer-v2.json"', 1),
    },
    {
      name: "the publish case tag regex changes",
      apply: (value) => mutateNth(value, "              consumer_tag_pattern='^consumer-v2-\\d{8}T\\d{6}Z-[a-f0-9]{12}$'", "              consumer_tag_pattern='^consumer-v1-\\d{8}T\\d{6}Z-[a-f0-9]{12}$'", 1),
    },
    {
      name: "the publish case accepts an extra version arm",
      apply: (value) => mutateNth(value, "            *)\n", "            v3)\n              payload_name=consumer-v3.json\n              ;;\n            *)\n", 1),
    },
    {
      name: "the publish case runs after GitHub access",
      apply: (value) => mutateNth(value, '          case "$contract_version" in', '          gh api "/mutation-before-version-validation"\n          case "$contract_version" in', 1),
    },
    {
      name: "the publish default arm no longer exits",
      apply: (value) => mutateNth(value, "              exit 4\n              ;;", "              ;;", 1),
    },
    {
      name: "a second PATCH command is added",
      apply: (value) => mutateFirst(value, '              -F prerelease=false > "$work_root/after-promotion.json"', '              -F prerelease=false > "$work_root/after-promotion.json"\n            gh api --method PATCH "/repos/$GITHUB_REPOSITORY/releases/$candidate_id" -F name=mutated'),
    },
    {
      name: "the PATCH mutates a second field",
      apply: (value) => mutateFirst(value, '              -F prerelease=false > "$work_root/after-promotion.json"', '              -F prerelease=false \\\n              -F name=mutated > "$work_root/after-promotion.json"'),
    },
    {
      name: "the v1 promotion guard is moved outside its release block",
      apply: (value) => {
        const withoutGuard = mutateFirst(value, '            test "$contract_version" = "v1"\n', "");
        return mutateFirst(withoutGuard, '          if [ "$existing_release_id" != "none" ]; then', '          test "$contract_version" = "v1"\n          if [ "$existing_release_id" != "none" ]; then');
      },
    },
    {
      name: "manual mode no longer adds prerelease",
      apply: (value) => mutateFirst(value, "            release_flags+=(--prerelease)\n", ""),
    },
    {
      name: "release flags are cleared before creation",
      apply: (value) => mutateFirst(value, '          gh release create "$consumer_tag" \\\n', '          release_flags=()\n          gh release create "$consumer_tag" \\\n'),
    },
    {
      name: "release creation adds a fourth asset",
      apply: (value) => mutateFirst(value, '            "$bundle_dir/$payload_name" \\\n            "$bundle_dir/$checksum_name"', '            "$bundle_dir/$payload_name" \\\n            "$bundle_dir/unexpected.json" \\\n            "$bundle_dir/$checksum_name"'),
    },
    {
      name: "release creation stops using the derived payload asset",
      apply: (value) => mutateFirst(value, '            "$bundle_dir/$payload_name" \\\n            "$bundle_dir/$checksum_name"', '            "$bundle_dir/consumer-v1.json" \\\n            "$bundle_dir/$checksum_name"'),
    },
  ];

  for (const mutation of mutations) {
    await t.test(mutation.name, () => {
      const mutatedSource = mutation.apply(source);
      const mutatedWorkflow = record(parse(mutatedSource), mutation.name);
      assert.throws(() => {
        assertHardenedConsumerReleasePolicy(mutatedWorkflow);
      });
    });
  }
});

void test("consumer publication is immutable, bounded to three assets and candidate-first", async () => {
  const workflow = await loadWorkflow(CONSUMER_PATH);
  const publishCommands = commands(jobs(workflow).publish);
  assert.match(publishCommands, /consumer-index\.json/);
  assert.match(publishCommands, /consumer-v1\.json/);
  assert.match(publishCommands, /consumer-v1\.json\.sha256/);
  assert.match(publishCommands, /unexpected_consumer_assets/);
  assert.match(publishCommands, /consumer-v1-\\d\{8\}T\\d\{6\}Z-\[a-f0-9\]\{12\}/);
  assert.match(publishCommands, /existing stable release.*no_change/is);
  assert.match(publishCommands, /existing candidate.*no_change/is);
  assert.match(publishCommands, /gh release create/);
  assert.match(publishCommands, /--prerelease/);
  assert.match(publishCommands, /--method PATCH/);
  assert.match(publishCommands, /-F prerelease=false/);
  assert.doesNotMatch(publishCommands, /gh release edit/);
  assert.doesNotMatch(
    publishCommands,
    /--method PATCH[^\n]*(?:tag_name|name=|body=|assets?=)/,
  );
  assert.match(publishCommands, /release\.body !== expectedNotes/);
  assert.match(
    publishCommands,
    /const expectedNotes = `Verified ERP-Snack observation bundle from \$\{sourceTag\}\. Payload SHA-256: \$\{payloadSha\}`/,
  );
  assert.match(
    publishCommands,
    /index\.code_sha !== release\.target_commitish/,
  );
  assert.match(publishCommands, /consumer_release_provenance_mismatch/);
  assert.ok(
    publishCommands.indexOf("consumer_release_provenance_mismatch") <
      publishCommands.indexOf("--method PATCH"),
  );
  assert.match(publishCommands, /uploaded_asset_digest_mismatch/);
});

void test("production jobs require public visibility and guarded scheduling", async () => {
  const workflow = await loadWorkflow(PRODUCTION_PATH);
  const productionJobs = jobs(workflow);
  for (const jobName of ["refresh", "health"]) {
    const condition = record(productionJobs[jobName], jobName).if;
    assert.ok(typeof condition === "string");
    assert.match(condition, /repository\.visibility == 'public'/);
    assert.match(condition, /event_name == 'workflow_dispatch'/);
    assert.match(condition, /DATA_HUB_PRODUCTION_ENABLED == 'true'/);
  }
  assert.match(
    String(record(productionJobs.health, "health").if),
    /always\(\)/,
  );
  assert.equal(record(productionJobs.health, "health").needs, "refresh");
  assert.equal(
    record(workflow.concurrency, "concurrency").group,
    "data-hub-production",
  );
});

void test("publisher uses releases, bounded summary output and no workflow artifacts", async () => {
  const workflow = await loadWorkflow(PRODUCTION_PATH);
  const productionJobs = jobs(workflow);
  const refresh = record(productionJobs.refresh, "refresh");
  const commands = steps(refresh)
    .flatMap((step) => (typeof step.run === "string" ? [step.run] : []))
    .join("\n");
  assert.match(commands, /snapshot -- restore/);
  assert.match(commands, /ingest:production/);
  assert.match(commands, /snapshot -- create/);
  assert.match(commands, /gh api/);
  assert.match(commands, /gh release create/);
  assert.match(commands, /gh release edit/);
  assert.match(commands, /snapshot_id/);
  assert.match(commands, /65536/);
  assert.doesNotMatch(commands, /upload-artifact|actions\/cache/);
  for (const step of steps(refresh).filter(
    (entry) => typeof entry.run === "string" && entry.run.includes("gh "),
  )) {
    assert.equal(
      record(step.env, "gh.env").GH_TOKEN,
      "${{ github.token }}",
    );
  }
  const healthCommands = steps(productionJobs.health)
    .flatMap((step) => (typeof step.run === "string" ? [step.run] : []))
    .join("\n");
  assert.match(healthCommands, /health:sync/);
  const healthSyncStep = steps(productionJobs.health).find(
    (step) => typeof step.run === "string" && step.run.includes("health:sync"),
  );
  assert.notEqual(healthSyncStep, undefined);
  assert.equal(
    record(healthSyncStep?.env, "health.env").GITHUB_TOKEN,
    "${{ github.token }}",
  );
});
