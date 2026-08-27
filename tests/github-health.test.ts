import assert from "node:assert/strict";
import test from "node:test";

import { executeHealthCommand } from "../apps/ingest-cli/src/health-command.js";
import {
  syncHealthIssues,
  type SyncHealthIssuesInput,
} from "../apps/ingest-cli/src/github-health.js";
import { productionSummaryFactory } from "./test-factories.js";

interface FixtureIssue {
  number: number;
  title: string;
  body: string | null;
  pull_request?: Record<string, never>;
}

interface RecordedRequest {
  url: string;
  method: string;
  body: string;
  authorization: string | null;
}

function githubFixture(initialIssues: FixtureIssue[]) {
  const issues = [...initialIssues];
  const requests: RecordedRequest[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : "";
    requests.push({
      url,
      method,
      body,
      authorization: headers.get("authorization"),
    });
    if (method === "GET") {
      return Promise.resolve(
        new Response(JSON.stringify(issues), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ number: 99 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { fetch, requests };
}

const BASE_INPUT = {
  repository: "Faroukoo/shared-data-forecast-hub-public",
  token: "test-token",
  workflowResult: "failure" as const,
  runUrl:
    "https://github.com/Faroukoo/shared-data-forecast-hub-public/actions/runs/1",
};

void test("opens one marked issue for a blocked source", async () => {
  const api = githubFixture([]);

  const result = await syncHealthIssues({
    ...BASE_INPUT,
    summary: productionSummaryFactory({ decision: "blocked" }),
    fetchImpl: api.fetch,
  });

  assert.deepEqual(result.created, ["hcp-ipc-2017-monthly"]);
  assert.match(
    api.requests.at(-1)?.body ?? "",
    /data-hub-health:hcp-ipc-2017-monthly/,
  );
});

void test("comments on the same marked issue for a repeated incident", async () => {
  const api = githubFixture([
    {
      number: 7,
      title: "[data-health] hcp-ipc-2017-monthly",
      body: "<!-- data-hub-health:hcp-ipc-2017-monthly -->",
    },
  ]);

  const result = await syncHealthIssues({
    ...BASE_INPUT,
    summary: productionSummaryFactory({ decision: "blocked" }),
    fetchImpl: api.fetch,
  });

  assert.deepEqual(result.commented, ["hcp-ipc-2017-monthly"]);
  assert.equal(api.requests.at(-1)?.url.endsWith("/issues/7/comments"), true);
});

void test("closes the marked issue after a healthy recovery", async () => {
  const api = githubFixture([
    {
      number: 8,
      title: "[data-health] hcp-ipc-2017-monthly",
      body: "<!-- data-hub-health:hcp-ipc-2017-monthly -->",
    },
  ]);

  const result = await syncHealthIssues({
    ...BASE_INPUT,
    workflowResult: "success",
    summary: productionSummaryFactory(),
    fetchImpl: api.fetch,
  });

  assert.deepEqual(result.closed, ["hcp-ipc-2017-monthly"]);
  assert.equal(api.requests.at(-1)?.method, "PATCH");
  assert.match(api.requests.at(-1)?.body ?? "", /"state":"closed"/);
});

void test("opens a stale source issue without blocking publication", async () => {
  const api = githubFixture([]);
  const healthySource =
    productionSummaryFactory().sources[0] ?? assert.fail("missing source");
  const summary = productionSummaryFactory({
    sources: [
      {
        ...healthySource,
        health_status: "stale",
        warning_codes: ["source_stale"],
      },
    ],
  });

  const result = await syncHealthIssues({
    ...BASE_INPUT,
    workflowResult: "success",
    summary,
    fetchImpl: api.fetch,
  });

  assert.deepEqual(result.created, ["hcp-ipc-2017-monthly"]);
});

void test("uses snapshot-store when a failed workflow has no summary", async () => {
  const api = githubFixture([]);

  const result = await syncHealthIssues({
    ...BASE_INPUT,
    summary: null,
    fetchImpl: api.fetch,
  });

  assert.deepEqual(result.created, ["snapshot-store"]);
  assert.match(api.requests.at(-1)?.body ?? "", /data-hub-health:snapshot-store/);
});

void test("keeps tokens and unsafe failure text out of request bodies", async () => {
  const api = githubFixture([]);
  const blocked = productionSummaryFactory({ decision: "blocked" });
  const source = blocked.sources[0] ?? assert.fail("missing source");
  const summary = productionSummaryFactory({
    decision: "blocked",
    sources: [
      {
        ...source,
        failure_code: "https://user:secret@data.gov.ma/file?token=private",
      },
    ],
  });

  await syncHealthIssues({ ...BASE_INPUT, summary, fetchImpl: api.fetch });

  assert.equal(
    api.requests.some((request) =>
      /test-token|private|secret|data\.gov\.ma/.test(request.body),
    ),
    false,
  );
  assert.equal(
    api.requests.some(
      (request) => request.authorization === "Bearer test-token",
    ),
    true,
  );
});

void test("health-sync reads its token only from the environment", async () => {
  let captured: SyncHealthIssuesInput | undefined;
  const exitCode = await executeHealthCommand(
    [
      "--summary-file",
      "none",
      "--repository",
      BASE_INPUT.repository,
      "--workflow-result",
      "failure",
      "--run-url",
      BASE_INPUT.runUrl,
    ],
    {
      environment: { GITHUB_TOKEN: "environment-token" },
      syncHealth: (input) => {
        captured = input;
        return Promise.resolve({ created: [], commented: [], closed: [] });
      },
    },
  );

  assert.equal(exitCode, 0);
  const input = captured ?? assert.fail("health sync was not called");
  assert.equal(input.summary, null);
  assert.equal(input.token, "environment-token");
});

void test("health-sync exits 4 without a GitHub token", async () => {
  let called = false;
  const exitCode = await executeHealthCommand(
    [
      "--summary-file",
      "none",
      "--repository",
      BASE_INPUT.repository,
      "--workflow-result",
      "failure",
      "--run-url",
      BASE_INPUT.runUrl,
    ],
    {
      environment: {},
      syncHealth: () => {
        called = true;
        return Promise.resolve({ created: [], commented: [], closed: [] });
      },
    },
  );

  assert.equal(exitCode, 4);
  assert.equal(called, false);
});
