const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 3;
const ALLOWED_HOSTS = new Set(["data.gov.ma", "www.data.gov.ma"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SafeFetchInput {
  url: string;
  fetchImpl?: typeof fetch;
  maxBytes: number;
  method?: "GET" | "HEAD";
  timeoutMs?: number;
  maxRedirects?: number;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  contentType: string | null;
  contentLength: number | null;
  etag: string | null;
  lastModified: string | null;
  bytes: Uint8Array;
}

function checkedUrl(rawUrl: string, redirect: boolean): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") {
    throw new Error("https_required");
  }
  if (url.username || url.password) {
    throw new Error("url_credentials_not_allowed");
  }
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(redirect ? "redirect_host_not_allowed" : "host_not_allowed");
  }
  return url;
}

function parseContentLength(value: string | null): number | null {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: URL,
  method: "GET" | "HEAD",
  timeoutMs: number,
): Promise<{
  controller: AbortController;
  response: Response;
  timer: ReturnType<typeof setTimeout>;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method,
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: method === "HEAD" ? "*/*" : "*/*" },
    });
    return { controller, response, timer };
  } catch (error) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new Error("request_timeout", { cause: error });
    }
    throw error;
  }
}

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader() as {
    read: () => Promise<{ done: boolean; value?: Uint8Array }>;
    cancel: (reason?: unknown) => Promise<void>;
    releaseLock: () => void;
  };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const readResult = await reader.read();
      if (readResult.done) break;
      const value = readResult.value;
      if (!value) throw new Error("invalid_response_chunk");
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("artifact_too_large");
        throw new Error("artifact_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function safeFetch(input: SafeFetchInput): Promise<SafeFetchResult> {
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 0) {
    throw new Error("invalid_max_bytes");
  }
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const method = input.method ?? "GET";
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = input.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let url = checkedUrl(input.url, false);

  for (let redirectCount = 0; ; redirectCount += 1) {
    const attempt = await fetchWithTimeout(fetchImpl, url, method, timeoutMs);
    try {
      const { response } = attempt;
      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirectCount >= maxRedirects) {
          throw new Error("too_many_redirects");
        }
        const location = response.headers.get("location");
        if (!location) throw new Error("redirect_without_location");
        url = checkedUrl(new URL(location, url).toString(), true);
        continue;
      }
      if (!response.ok) {
        throw new Error(`http_status:${String(response.status)}`);
      }

      const contentLength = parseContentLength(response.headers.get("content-length"));
      if (contentLength !== null && contentLength > input.maxBytes) {
        await response.body?.cancel("artifact_too_large");
        throw new Error("artifact_too_large");
      }

      return {
        finalUrl: url.toString(),
        status: response.status,
        contentType: response.headers.get("content-type"),
        contentLength,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        bytes:
          method === "HEAD"
            ? new Uint8Array()
            : await readBoundedBytes(response, input.maxBytes),
      };
    } catch (error) {
      if (attempt.controller.signal.aborted) {
        throw new Error("request_timeout", { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(attempt.timer);
    }
  }
}
