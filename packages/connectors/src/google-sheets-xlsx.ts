import type { SourceDefinition } from "@data-hub/contracts";

import { ARTIFACT_MAX_BYTES } from "./ckan.js";
import {
  safeFetch,
  type SafeFetchHostPolicy,
} from "./safe-http.js";

const GOOGLE_SHEETS_REDIRECT_SUFFIX = ".sheets.googleusercontent.com";
const GOOGLE_SHEETS_HOST_POLICY: SafeFetchHostPolicy = {
  allowInitial: (url) => url.hostname === "docs.google.com",
  allowRedirect: (url) =>
    url.hostname.endsWith(GOOGLE_SHEETS_REDIRECT_SUFFIX) &&
    url.hostname.length > GOOGLE_SHEETS_REDIRECT_SUFFIX.length,
};

export interface DownloadedGoogleSheet {
  finalUrl: string;
  contentType: string | null;
  contentLength: number | null;
  etag: string | null;
  lastModified: string | null;
  bytes: Uint8Array;
  originalFilename: string;
}

function requireGoogleSheetsXlsx(source: SourceDefinition) {
  if (source.connector.kind !== "google-sheets-xlsx") {
    throw new Error(`connector_not_google_sheets_xlsx:${source.source_id}`);
  }
  return source.connector;
}

export function googleSheetsExportUrl(source: SourceDefinition): string {
  const connector = requireGoogleSheetsXlsx(source);
  const url = new URL(
    `https://docs.google.com/spreadsheets/d/${connector.spreadsheet_id}/export`,
  );
  url.searchParams.set("format", "xlsx");
  url.searchParams.set("gid", connector.sheet_gid);
  return url.toString();
}

export async function downloadGoogleSheetsXlsx(
  source: SourceDefinition,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<DownloadedGoogleSheet> {
  const connector = requireGoogleSheetsXlsx(source);
  const response = await safeFetch({
    url: googleSheetsExportUrl(source),
    fetchImpl,
    hostPolicy: GOOGLE_SHEETS_HOST_POLICY,
    maxBytes: ARTIFACT_MAX_BYTES,
  });
  const hasZipSignature = response.bytes.length >= 4 &&
    response.bytes[0] === 0x50 &&
    response.bytes[1] === 0x4b &&
    response.bytes[2] === 0x03 &&
    response.bytes[3] === 0x04;
  if (!hasZipSignature) throw new Error("invalid_xlsx_content");

  return {
    finalUrl: response.finalUrl,
    contentType: response.contentType,
    contentLength: response.contentLength,
    etag: response.etag,
    lastModified: response.lastModified,
    bytes: response.bytes,
    originalFilename: `sheet-${connector.sheet_gid}.xlsx`,
  };
}
