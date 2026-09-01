import assert from "node:assert/strict";
import test from "node:test";

import {
  downloadGoogleSheetsXlsx,
  googleSheetsExportUrl,
  safeFetch,
  type SafeFetchHostPolicy,
} from "@data-hub/connectors";
import {
  HCP_IPC_2017_OFFICIAL_G2_SOURCE,
  HCP_IPC_2017_SOURCE,
} from "@data-hub/source-registry";

const MiB = 1024 * 1024;
const EXPORT_URL =
  "https://docs.google.com/spreadsheets/d/1mwwtnpnnWH6rxnnLuz3j07QYsvxFVci6EKTCZea0t-8/export?format=xlsx&gid=1240277578";
const REDIRECT_URL =
  "https://doc-xx.sheets.googleusercontent.com/export/download.xlsx";
const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01]);

const GOOGLE_HOST_POLICY: SafeFetchHostPolicy = {
  allowInitial: (url) => url.hostname === "docs.google.com",
  allowRedirect: (url) => {
    const suffix = ".sheets.googleusercontent.com";
    return url.hostname.endsWith(suffix) && url.hostname.length > suffix.length;
  },
};

void test("builds the exact bounded Google Sheets XLSX export URL", () => {
  assert.equal(googleSheetsExportUrl(HCP_IPC_2017_OFFICIAL_G2_SOURCE), EXPORT_URL);
});

void test("follows one allowed 307 and returns bounded XLSX provenance", async () => {
  const requestedUrls: string[] = [];
  const fetchImpl: typeof fetch = (input) => {
    requestedUrls.push(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (requestedUrls.length === 1) {
      return Promise.resolve(
        new Response(null, {
          status: 307,
          headers: { location: REDIRECT_URL },
        }),
      );
    }
    return Promise.resolve(
      new Response(ZIP_BYTES, {
        status: 200,
        headers: {
          "content-length": String(ZIP_BYTES.byteLength),
          "content-type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          etag: '"sheet-v1"',
          "last-modified": "Tue, 01 Sep 2026 08:00:00 GMT",
        },
      }),
    );
  };

  const result = await downloadGoogleSheetsXlsx(
    HCP_IPC_2017_OFFICIAL_G2_SOURCE,
    fetchImpl,
  );

  assert.deepEqual(requestedUrls, [EXPORT_URL, REDIRECT_URL]);
  assert.equal(result.finalUrl, REDIRECT_URL);
  assert.equal(
    result.contentType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.equal(result.contentLength, ZIP_BYTES.byteLength);
  assert.equal(result.etag, '"sheet-v1"');
  assert.equal(result.lastModified, "Tue, 01 Sep 2026 08:00:00 GMT");
  assert.deepEqual(result.bytes, ZIP_BYTES);
  assert.equal(result.originalFilename, "sheet-1240277578.xlsx");
});

void test("keeps safe-fetch host authorization scoped to one call", async () => {
  let called = false;
  await assert.rejects(
    () =>
      safeFetch({
        url: "https://data.gov.ma/file",
        fetchImpl: () => {
          called = true;
          return Promise.resolve(new Response(ZIP_BYTES));
        },
        hostPolicy: GOOGLE_HOST_POLICY,
        maxBytes: 100,
      }),
    /host_not_allowed/,
  );
  assert.equal(called, false);
});

void test("rejects Google redirect host suffix and sibling tricks", async () => {
  const rejectedLocations = [
    "https://googleusercontent.com/file.xlsx",
    "https://doc-xx.googleusercontent.com/file.xlsx",
    "https://sheets.googleusercontent.com/file.xlsx",
    "https://doc-xx.sheets-googleusercontent.com/file.xlsx",
    "https://doc-xx.sheets.googleusercontent.com.evil.invalid/file.xlsx",
  ];

  for (const location of rejectedLocations) {
    let calls = 0;
    const fetchImpl: typeof fetch = () => {
      calls += 1;
      return Promise.resolve(
        new Response(null, { status: 307, headers: { location } }),
      );
    };
    await assert.rejects(
      () => downloadGoogleSheetsXlsx(HCP_IPC_2017_OFFICIAL_G2_SOURCE, fetchImpl),
      /redirect_host_not_allowed/,
      location,
    );
    assert.equal(calls, 1, location);
  }
});

void test("rejects redirect credentials and HTTP before the next transport", async () => {
  const rejectedLocations = [
    "https://user:secret@doc-xx.sheets.googleusercontent.com/file.xlsx",
    "http://doc-xx.sheets.googleusercontent.com/file.xlsx",
  ];

  for (const location of rejectedLocations) {
    let calls = 0;
    const fetchImpl: typeof fetch = () => {
      calls += 1;
      return Promise.resolve(
        new Response(null, { status: 307, headers: { location } }),
      );
    };
    await assert.rejects(
      () => downloadGoogleSheetsXlsx(HCP_IPC_2017_OFFICIAL_G2_SOURCE, fetchImpl),
      /url_credentials_not_allowed|https_required/,
      location,
    );
    assert.equal(calls, 1, location);
  }
});

void test("rejects a fourth redirect without making a fifth request", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = () => {
    calls += 1;
    return Promise.resolve(
      new Response(null, {
        status: 307,
        headers: { location: `${REDIRECT_URL}?attempt=${String(calls)}` },
      }),
    );
  };

  await assert.rejects(
    () => downloadGoogleSheetsXlsx(HCP_IPC_2017_OFFICIAL_G2_SOURCE, fetchImpl),
    /too_many_redirects/,
  );
  assert.equal(calls, 4);
});

void test("rejects a declared Google Sheet above 4 MiB", async () => {
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(
      new Response(null, {
        status: 200,
        headers: { "content-length": String(4 * MiB + 1) },
      }),
    );

  await assert.rejects(
    () => downloadGoogleSheetsXlsx(HCP_IPC_2017_OFFICIAL_G2_SOURCE, fetchImpl),
    /artifact_too_large/,
  );
});

void test("rejects a streamed Google Sheet above 4 MiB", async () => {
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(4 * MiB));
            controller.enqueue(new Uint8Array([0x01]));
            controller.close();
          },
        }),
        { status: 200 },
      ),
    );

  await assert.rejects(
    () => downloadGoogleSheetsXlsx(HCP_IPC_2017_OFFICIAL_G2_SOURCE, fetchImpl),
    /artifact_too_large/,
  );
});

void test("rejects non-ZIP bytes even with the XLSX content type", async () => {
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(
      new Response(new Uint8Array([0x00, 0x01, 0x02, 0x03]), {
        status: 200,
        headers: {
          "content-type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      }),
    );

  await assert.rejects(
    () => downloadGoogleSheetsXlsx(HCP_IPC_2017_OFFICIAL_G2_SOURCE, fetchImpl),
    /invalid_xlsx_content/,
  );
});

void test("rejects use with a CKAN source before transport", async () => {
  let called = false;
  const fetchImpl: typeof fetch = () => {
    called = true;
    return Promise.resolve(new Response(ZIP_BYTES));
  };

  assert.throws(
    () => googleSheetsExportUrl(HCP_IPC_2017_SOURCE),
    /connector_not_google_sheets_xlsx:hcp-ipc-2017-monthly/,
  );
  await assert.rejects(
    () => downloadGoogleSheetsXlsx(HCP_IPC_2017_SOURCE, fetchImpl),
    /connector_not_google_sheets_xlsx:hcp-ipc-2017-monthly/,
  );
  assert.equal(called, false);
});
