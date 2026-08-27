import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parse } from "yaml";

const CI_PATH = ".github/workflows/ci.yml";
const PRODUCTION_PATH = ".github/workflows/data-refresh.yml";
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
  for (const path of [CI_PATH, PRODUCTION_PATH]) {
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

void test("CI is read-only and both workflows use Node 22.22.3 without cache", async () => {
  const ci = await loadWorkflow(CI_PATH);
  assert.deepEqual(ci.permissions, { contents: "read" });
  const ciTriggers = record(ci.on, "ci.on");
  assert.deepEqual(Object.keys(ciTriggers).sort(), ["pull_request", "push"]);
  assert.deepEqual(record(ciTriggers.push, "push").branches, ["main"]);

  for (const workflow of [ci, await loadWorkflow(PRODUCTION_PATH)]) {
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
