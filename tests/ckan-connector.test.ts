import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverCkanResource,
  safeFetch,
  type SafeFetchHostPolicy,
} from "@data-hub/connectors";
import { HCP_IPC_2017_SOURCE } from "@data-hub/source-registry";

const MiB = 1024 * 1024;

const CKAN_HOST_POLICY: SafeFetchHostPolicy = {
  allowInitial: (url) => ["data.gov.ma", "www.data.gov.ma"].includes(url.hostname),
  allowRedirect: (url) => ["data.gov.ma", "www.data.gov.ma"].includes(url.hostname),
};

function ckanResponse(resources: unknown[]): Response {
  return new Response(
    JSON.stringify({
      success: true,
      result: {
        id: "0ebb73ec-1f04-4854-b73e-a7868b0b18b0",
        title: "Indice des prix à la consommation (Base 100 2017)",
        metadata_modified: "2025-02-06T12:15:45.127613",
        license_title: "Open Data Commons Open Database License (ODbL)",
        resources,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const exactResource = {
  id: "6b44bd34-87ca-479b-b8e6-460f184269fb",
  format: "XLSX",
  url: "https://data.gov.ma/data/dataset/0ebb/resource/6b44/download/i_7.5.xlsx",
  size: 1_032_957,
  last_modified: "2025-02-06T12:15:45.110238",
};

void test("selects one exact XLSX resource from CKAN", async () => {
  const fetchImpl: typeof fetch = () => Promise.resolve(ckanResponse([exactResource]));
  const result = await discoverCkanResource(HCP_IPC_2017_SOURCE, fetchImpl);
  assert.equal(result.resource.id, "6b44bd34-87ca-479b-b8e6-460f184269fb");
});

void test("rejects ambiguous CKAN resources", async () => {
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(
      ckanResponse([exactResource, { ...exactResource, id: "duplicate" }]),
    );
  await assert.rejects(
    () => discoverCkanResource(HCP_IPC_2017_SOURCE, fetchImpl),
    /ckan_resource_count:2/,
  );
});

void test("rejects a redirect outside the allowlist", async () => {
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.data.gov.ma/file.xlsx" },
      }),
    );
  await assert.rejects(
    () => discoverCkanResource(HCP_IPC_2017_SOURCE, fetchImpl),
    /redirect_host_not_allowed/,
  );
});

void test("rejects URL credentials before transport", async () => {
  let called = false;
  const fetchImpl: typeof fetch = () => {
    called = true;
    return Promise.resolve(new Response("unused"));
  };
  await assert.rejects(
    () =>
      safeFetch({
        url: "https://user:secret@data.gov.ma/file",
        fetchImpl,
        hostPolicy: CKAN_HOST_POLICY,
        maxBytes: 100,
      }),
    /url_credentials_not_allowed/,
  );
  assert.equal(called, false);
});

void test("rejects a declared artifact above 4 MiB", async () => {
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(
      new Response(null, {
        status: 200,
        headers: { "content-length": String(4 * MiB + 1) },
      }),
    );
  await assert.rejects(
    () =>
      safeFetch({
        url: "https://data.gov.ma/file",
        fetchImpl,
        hostPolicy: CKAN_HOST_POLICY,
        maxBytes: 4 * MiB,
      }),
    /artifact_too_large/,
  );
});

void test("rejects streamed bytes above 4 MiB", async () => {
  const bytes = new Uint8Array(4 * MiB + 1);
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(new Response(bytes, { status: 200 }));
  await assert.rejects(
    () =>
      safeFetch({
        url: "https://data.gov.ma/file",
        fetchImpl,
        hostPolicy: CKAN_HOST_POLICY,
        maxBytes: 4 * MiB,
      }),
    /artifact_too_large/,
  );
});

void test("turns an aborted transport into a timeout code", async () => {
  const fetchImpl: typeof fetch = async (_input, init) =>
    await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => {
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
  await assert.rejects(
    () =>
      safeFetch({
        url: "https://data.gov.ma/file",
        fetchImpl,
        hostPolicy: CKAN_HOST_POLICY,
        maxBytes: 100,
        timeoutMs: 5,
      }),
    /request_timeout/,
  );
});

void test("times out a stalled response body", async () => {
  const fetchImpl: typeof fetch = (_input, init) =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            const completion = setTimeout(() => {
              controller.enqueue(new Uint8Array([1]));
              controller.close();
            }, 25);
            init?.signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(completion);
                controller.error(new Error("aborted body"));
              },
              { once: true },
            );
          },
        }),
        { status: 200 },
      ),
    );
  await assert.rejects(
    () =>
      safeFetch({
        url: "https://data.gov.ma/file",
        fetchImpl,
        hostPolicy: CKAN_HOST_POLICY,
        maxBytes: 100,
        timeoutMs: 5,
      }),
    /request_timeout/,
  );
});

void test("rejects non-2xx status and malformed CKAN JSON", async () => {
  await assert.rejects(
    () =>
      safeFetch({
        url: "https://data.gov.ma/file",
        fetchImpl: () => Promise.resolve(new Response("no", { status: 503 })),
        hostPolicy: CKAN_HOST_POLICY,
        maxBytes: 100,
      }),
    /http_status:503/,
  );
  await assert.rejects(
    () =>
      discoverCkanResource(
        HCP_IPC_2017_SOURCE,
        () => Promise.resolve(new Response("not-json", { status: 200 })),
      ),
    /malformed_ckan_json/,
  );
});
