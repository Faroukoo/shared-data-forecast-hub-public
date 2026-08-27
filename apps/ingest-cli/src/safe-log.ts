import type { IngestionRun } from "@data-hub/contracts";

type WriteLine = (line: string) => void;

export interface FailedLogEvent {
  sourceId: string;
  runId: string;
  state: "failed_retryable" | "failed_terminal";
  failureCode: string;
  requestTarget: string | null;
}

function safeCode(value: string): string {
  return /^[a-z0-9][a-z0-9_.:-]*$/.test(value) ? value : "unsafe_failure_code";
}

function safeIdentifier(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)
    ? value
    : "unsafe_identifier";
}

function safeUrl(rawUrl: string | null): string | null {
  if (rawUrl === null) return null;
  try {
    const url = new URL(rawUrl);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, "");
    return url.toString();
  } catch {
    return null;
  }
}

export function createSafeLogger(writeLine: WriteLine = console.log) {
  return {
    runCompleted(run: IngestionRun): void {
      writeLine(
        JSON.stringify({
          event: "ingestion_run_completed",
          source_id: safeCode(run.source_id),
          run_id: safeIdentifier(run.run_id),
          state: run.state,
          parsed_count: run.parsed_count,
          accepted_count: run.accepted_count,
          warned_count: run.warned_count,
          quarantined_count: run.quarantined_count,
          request_target: safeUrl(run.request_target),
        }),
      );
    },
    runFailed(event: FailedLogEvent): void {
      writeLine(
        JSON.stringify({
          event: "ingestion_run_failed",
          source_id: safeCode(event.sourceId),
          run_id: safeIdentifier(event.runId),
          state: event.state,
          failure_code: safeCode(event.failureCode),
          request_target: safeUrl(event.requestTarget),
        }),
      );
    },
  };
}

export type SafeLogger = ReturnType<typeof createSafeLogger>;
