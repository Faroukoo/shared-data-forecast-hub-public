import type {
  ProductionRunSummary,
  ProductionSourceResult,
} from "@data-hub/contracts";

import { sanitizeSafeCode } from "./safe-log.js";

export type WorkflowResult = "success" | "failure" | "cancelled" | "skipped";

export interface SyncHealthIssuesInput {
  repository: string;
  token: string;
  summary: ProductionRunSummary | null;
  workflowResult: WorkflowResult;
  runUrl: string;
  fetchImpl?: typeof fetch;
}

export interface HealthSyncResult {
  created: string[];
  commented: string[];
  closed: string[];
}

interface GitHubIssue {
  number: number;
  body: string;
}

interface SourceHealthAction {
  sourceId: string;
  incident: boolean;
  recovery: boolean;
  state: string;
  health: string;
  failureCode: string;
}

function validatedRunUrl(repository: string, rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new Error("invalid_run_url", { cause: error });
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !url.pathname.startsWith(`/${repository}/actions/runs/`)
  ) {
    throw new Error("invalid_run_url");
  }
  return url.toString();
}

function parseIssues(value: unknown): GitHubIssue[] {
  if (!Array.isArray(value)) throw new Error("github_invalid_response");
  const issues: GitHubIssue[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("github_invalid_response");
    }
    const record = entry as Record<string, unknown>;
    if ("pull_request" in record) continue;
    if (
      typeof record.number !== "number" ||
      !Number.isSafeInteger(record.number) ||
      record.number <= 0 ||
      (typeof record.body !== "string" && record.body !== null)
    ) {
      throw new Error("github_invalid_response");
    }
    issues.push({ number: record.number, body: record.body ?? "" });
  }
  return issues;
}

function healthAction(source: ProductionSourceResult): SourceHealthAction {
  const hardFailure =
    source.state === "failed_retryable" ||
    source.state === "failed_terminal" ||
    source.state === "quarantined";
  const unhealthyStatus =
    source.health_status === "stale" ||
    source.health_status === "schema_changed" ||
    source.health_status === "quarantined" ||
    source.health_status === "licence_blocked";
  const recovery =
    !hardFailure &&
    (source.health_status === "healthy" || source.health_status === "late");
  return {
    sourceId: source.source_id,
    incident: hardFailure || unhealthyStatus,
    recovery,
    state: source.state,
    health: source.health_status ?? "unknown",
    failureCode: sanitizeSafeCode(source.failure_code ?? "none"),
  };
}

function actionsFrom(input: SyncHealthIssuesInput): SourceHealthAction[] {
  if (input.summary) {
    return input.summary.sources.map(healthAction).sort((left, right) =>
      left.sourceId.localeCompare(right.sourceId),
    );
  }
  if (input.workflowResult === "failure") {
    return [
      {
        sourceId: "snapshot-store",
        incident: true,
        recovery: false,
        state: "failed_terminal",
        health: "unknown",
        failureCode: "workflow_failure",
      },
    ];
  }
  if (input.workflowResult === "success") {
    return [
      {
        sourceId: "snapshot-store",
        incident: false,
        recovery: true,
        state: "no_change",
        health: "healthy",
        failureCode: "none",
      },
    ];
  }
  return [];
}

function marker(sourceId: string): string {
  return `<!-- data-hub-health:${sourceId} -->`;
}

function incidentBody(
  action: SourceHealthAction,
  workflowResult: WorkflowResult,
  runUrl: string,
): string {
  return [
    marker(action.sourceId),
    "Automated Data Hub health incident.",
    "",
    `- Workflow result: ${workflowResult}`,
    `- Source state: ${action.state}`,
    `- Health: ${action.health}`,
    `- Failure code: ${action.failureCode}`,
    `- [Workflow run](${runUrl})`,
  ].join("\n");
}

export async function syncHealthIssues(
  input: SyncHealthIssuesInput,
): Promise<HealthSyncResult> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository)) {
    throw new Error("invalid_github_repository");
  }
  if (!input.token) throw new Error("github_token_missing");
  const runUrl = validatedRunUrl(input.repository, input.runUrl);
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const baseUrl = `https://api.github.com/repos/${input.repository}`;

  async function request(
    path: string,
    method = "GET",
    body?: Record<string, unknown>,
  ): Promise<Response> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      redirect: "error",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${input.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      throw new Error(`github_http_status:${String(response.status)}`);
    }
    return response;
  }

  const listResponse = await request("/issues?state=open&per_page=100");
  const listedIssues: unknown = await listResponse.json();
  const issues = parseIssues(listedIssues);
  const result: HealthSyncResult = { created: [], commented: [], closed: [] };
  for (const action of actionsFrom(input)) {
    const safeSourceId = sanitizeSafeCode(action.sourceId);
    if (safeSourceId !== action.sourceId) throw new Error("unsafe_source_id");
    const exactMarker = marker(safeSourceId);
    const existing = issues.find((issue) => issue.body.includes(exactMarker));
    if (action.incident) {
      const body = incidentBody(action, input.workflowResult, runUrl);
      if (existing) {
        await request(`/issues/${String(existing.number)}/comments`, "POST", {
          body,
        });
        result.commented.push(safeSourceId);
      } else {
        await request("/issues", "POST", {
          title: `[data-health] ${safeSourceId}`,
          body,
        });
        result.created.push(safeSourceId);
      }
    } else if (action.recovery && existing) {
      await request(`/issues/${String(existing.number)}`, "PATCH", {
        state: "closed",
      });
      result.closed.push(safeSourceId);
    }
  }
  return result;
}
