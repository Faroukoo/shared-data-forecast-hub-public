import type { SourceDefinition } from "@data-hub/contracts";

import { safeFetch } from "./safe-http.js";

const DISCOVERY_MAX_BYTES = 1024 * 1024;
export const ARTIFACT_MAX_BYTES = 4 * 1024 * 1024;

export interface CkanResource {
  id: string;
  format: string;
  url: string;
  size: number | null;
  lastModified: string | null;
}

export interface CkanDiscovery {
  datasetId: string;
  title: string;
  metadataModified: string | null;
  licenceTitle: string | null;
  resource: CkanResource;
}

export interface ResourceProbe {
  finalUrl: string;
  contentType: string | null;
  contentLength: number | null;
  etag: string | null;
  lastModified: string | null;
}

export interface DownloadedResource extends ResourceProbe {
  bytes: Uint8Array;
  originalFilename: string;
}

function requireCkan(source: SourceDefinition) {
  if (source.connector.kind !== "ckan") {
    throw new Error(`connector_not_ckan:${source.source_id}`);
  }
  return source.connector;
}

function record(value: unknown, errorCode: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(errorCode);
  }
  return value as Record<string, unknown>;
}

function stringField(value: unknown, errorCode: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(errorCode);
  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function validateResourceUrl(rawUrl: string): void {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error("https_required");
  if (url.username || url.password) throw new Error("url_credentials_not_allowed");
  if (!["data.gov.ma", "www.data.gov.ma"].includes(url.hostname.toLowerCase())) {
    throw new Error("resource_host_not_allowed");
  }
}

export async function discoverCkanResource(
  source: SourceDefinition,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<CkanDiscovery> {
  const connector = requireCkan(source);
  const discoveryUrl = new URL("package_show", connector.api_base_url);
  discoveryUrl.searchParams.set("id", connector.dataset_id);
  const response = await safeFetch({
    url: discoveryUrl.toString(),
    fetchImpl,
    maxBytes: DISCOVERY_MAX_BYTES,
  });

  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(response.bytes));
  } catch (error) {
    throw new Error("malformed_ckan_json", { cause: error });
  }
  const root = record(decoded, "malformed_ckan_payload");
  if (root.success !== true) throw new Error("ckan_unsuccessful");
  const result = record(root.result, "malformed_ckan_result");
  if (result.id !== connector.dataset_id) throw new Error("ckan_dataset_id_mismatch");
  if (!Array.isArray(result.resources)) throw new Error("malformed_ckan_resources");

  const matches = result.resources.filter((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const format = (value as Record<string, unknown>).format;
    return typeof format === "string" &&
      format.trim().toUpperCase() === connector.required_resource_format;
  });
  if (matches.length !== 1) {
    throw new Error(`ckan_resource_count:${String(matches.length)}`);
  }
  const resource = record(matches[0], "malformed_ckan_resource");
  const resourceUrl = stringField(resource.url, "malformed_ckan_resource_url");
  validateResourceUrl(resourceUrl);
  const size = typeof resource.size === "number" && Number.isSafeInteger(resource.size)
    ? resource.size
    : null;
  if (size !== null && size > ARTIFACT_MAX_BYTES) throw new Error("artifact_too_large");

  return {
    datasetId: connector.dataset_id,
    title: stringField(result.title, "malformed_ckan_title"),
    metadataModified: nullableString(result.metadata_modified),
    licenceTitle: nullableString(result.license_title),
    resource: {
      id: stringField(resource.id, "malformed_ckan_resource_id"),
      format: connector.required_resource_format,
      url: resourceUrl,
      size,
      lastModified: nullableString(resource.last_modified),
    },
  };
}

export async function probeCkanResource(
  _source: SourceDefinition,
  discovery: CkanDiscovery,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ResourceProbe> {
  const response = await safeFetch({
    url: discovery.resource.url,
    fetchImpl,
    method: "HEAD",
    maxBytes: ARTIFACT_MAX_BYTES,
  });
  return {
    finalUrl: response.finalUrl,
    contentType: response.contentType,
    contentLength: response.contentLength,
    etag: response.etag,
    lastModified: response.lastModified,
  };
}

export async function downloadCkanResource(
  _source: SourceDefinition,
  discovery: CkanDiscovery,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<DownloadedResource> {
  const response = await safeFetch({
    url: discovery.resource.url,
    fetchImpl,
    maxBytes: ARTIFACT_MAX_BYTES,
  });
  const mimeIsXlsx = response.contentType
    ?.toLowerCase()
    .includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") ?? false;
  const hasZipSignature = response.bytes.length >= 4 &&
    response.bytes[0] === 0x50 &&
    response.bytes[1] === 0x4b &&
    response.bytes[2] === 0x03 &&
    response.bytes[3] === 0x04;
  if (!mimeIsXlsx && !hasZipSignature) throw new Error("invalid_xlsx_content");
  const pathname = new URL(response.finalUrl).pathname;
  const originalFilename = decodeURIComponent(pathname.split("/").at(-1) ?? "artifact.xlsx");
  return {
    finalUrl: response.finalUrl,
    contentType: response.contentType,
    contentLength: response.contentLength,
    etag: response.etag,
    lastModified: response.lastModified,
    bytes: response.bytes,
    originalFilename,
  };
}
