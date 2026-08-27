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
      /const consumerTagPattern = \/\^consumer-v1-/,
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
