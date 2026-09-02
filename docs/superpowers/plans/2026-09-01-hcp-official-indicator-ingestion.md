# HCP Official Indicator Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five fresh official HCP monthly indicator feeds to the public Data Hub, with bounded Google Sheets XLSX downloads, fail-closed parsing, period-based freshness and semantic no-change detection.

**Architecture:** Preserve the two CKAN sources and their parser. Add one narrowly scoped connector and one HCP official-workbook parser, then route them through the existing immutable artifact, quality, canonical publication and public snapshot pipeline. Binary XLSX packaging changes are archived during the run but do not create a new dataset or public snapshot when canonical evidence is unchanged.

**Tech Stack:** Node.js `22.22.3`, TypeScript `5.9.3` strict mode, Zod `4.4.3`, ExcelJS `4.4.0`, npm workspaces, Node test runner through `tsx`, GitHub Actions and GitHub Releases.

**Spec:** `docs/superpowers/specs/2026-09-01-hcp-freshness-and-erp-material-coverage-design.md`

## Global Constraints

- Work only in the isolated public-repository worktree based on `public/main`; re-check the base SHA and a clean status before Task 1.
- Preserve `hcp-ipc-2017-monthly`, `hcp-ipp-2018-monthly`, `hcp-index-workbook` and every existing release contract.
- Build Google export URLs internally. Never accept an arbitrary URL, credentials, HTTP scheme or unrestricted redirect host.
- Keep the maximum XLSX body at 4 MiB, timeout at 15 seconds and redirect count at three.
- Archive downloaded bytes before parsing and never rewrite a raw artifact, dataset or manifest.
- Treat new labels, changed layout, invalid cells, future periods and coverage shrinkage as fail-closed conditions.
- Use `period_end` for Google Sheets freshness; do not substitute it into the `remote_last_modified` field.
- Add no dependency, service, database, container, Vercel project or paid resource.
- Normal tests use generated fixture workbooks and mocked HTTP only.
- Every code task follows red, green, refactor and ends in a focused commit.
- Run Node/npm commands through `fnm exec --using=22.22.3`.
- Do not dispatch a workflow, publish a release, merge or deploy in this plan.

## Planned File Map

### New files

- `packages/connectors/src/google-sheets-xlsx.ts` — URL construction, download and XLSX validation.
- `packages/parsers/src/hcp-official-indicator-workbook.ts` — five fixed profiles and exact label maps.
- `tests/google-sheets-connector.test.ts` — host, redirect, limit, signature and URL tests.
- `tests/hcp-official-indicator-parser.test.ts` — IPC/IPPI layout, values, missing marker and quarantine evidence tests.

### Modified files

- `packages/contracts/src/source-definition.ts` — connector and parser discriminants.
- `packages/source-registry/src/hcp.ts` — five official source definitions and constants.
- `packages/source-registry/src/index.ts` — export/register all seven sources.
- `packages/connectors/src/safe-http.ts` — call-scoped host policy without weakening CKAN.
- `packages/connectors/src/index.ts` — connector exports.
- `packages/parsers/src/index.ts` — official parser exports.
- `packages/quality/src/evaluate-quality.ts` — period freshness and base-year routing.
- `packages/quality/src/index.ts` — new freshness exports.
- `packages/canonical/src/revisions.ts` and `packages/canonical/src/index.ts` — shared semantic comparison.
- `apps/ingest-cli/src/run-ingestion.ts` — connector/parser dispatch and semantic no-change.
- `apps/ingest-cli/src/run-production.ts` — quality-based freshness for unchanged official sheets.
- `tests/fixture-workbooks.ts` — generated official-layout fixtures.
- `tests/source-registry.test.ts`, `tests/quality.test.ts`, `tests/ingestion-flow.test.ts`, `tests/production-run.test.ts`, `tests/workflow-policy.test.ts` — regression and policy coverage.
- `docs/operations/source-qualification.md`, `docs/operations/import-and-recovery.md`, `NOTICE-DATA.md` — source, licence and operational evidence.

## Task 1: Extend strict source contracts and register five sources

**Files:**
- Modify: `packages/contracts/src/source-definition.ts`
- Modify: `packages/source-registry/src/hcp.ts`
- Modify: `packages/source-registry/src/index.ts`
- Test: `tests/source-registry.test.ts`
- Test: `tests/contracts.test.ts`

**Interfaces:**
- Produces connector `google-sheets-xlsx` with `spreadsheet_id` and `sheet_gid`.
- Produces parser `hcp-official-indicator-workbook` with five literal profiles.
- Produces constants `HCP_IPC_2017_OFFICIAL_G1_SOURCE`, `HCP_IPC_2017_OFFICIAL_G2_SOURCE`, `HCP_IPPI_2018_OFFICIAL_G1_SOURCE`, `HCP_IPPI_2018_OFFICIAL_G2_SOURCE`, `HCP_IPPI_2018_OFFICIAL_G3_SOURCE`.

- [ ] **Step 1: Add failing schema and registry tests**

Assert that valid official definitions parse, all seven enabled sources are returned sorted, and the following are rejected: slash/dot in `spreadsheet_id`, non-numeric GID, unknown parser profile, HTTP official URL and unknown fields.

```ts
assert.deepEqual(
  listEnabledSourceDefinitions().map((source) => source.source_id),
  [
    "hcp-ipc-2017-monthly",
    "hcp-ipc-2017-official-g1-monthly",
    "hcp-ipc-2017-official-g2-monthly",
    "hcp-ipp-2018-monthly",
    "hcp-ippi-2018-official-g1-monthly",
    "hcp-ippi-2018-official-g2-monthly",
    "hcp-ippi-2018-official-g3-monthly",
  ],
);
```

- [ ] **Step 2: Run focused tests and record the expected failure**

Run:

```bash
fnm exec --using=22.22.3 npm exec -- tsx --test tests/contracts.test.ts tests/source-registry.test.ts
```

Expected: FAIL because the new discriminants and constants do not exist.

- [ ] **Step 3: Implement strict discriminated unions**

Add these schemas without changing the existing CKAN/manual branches:

```ts
const GoogleSheetsXlsxConnectorSchema = z.object({
  kind: z.literal("google-sheets-xlsx"),
  spreadsheet_id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  sheet_gid: z.string().regex(/^\d+$/),
}).strict();

const HcpOfficialIndicatorParserSchema = z.object({
  kind: z.literal("hcp-official-indicator-workbook"),
  profile: z.enum([
    "ipc-2017-official-g1",
    "ipc-2017-official-g2",
    "ippi-2018-official-g1",
    "ippi-2018-official-g2",
    "ippi-2018-official-g3",
  ]),
}).strict();
```

- [ ] **Step 4: Register exact source metadata**

Use the IDs, spreadsheet IDs, GIDs, official pages and CC BY 4.0 evidence fixed in the spec. Set `geography_scope: ["country"]`, IPC `series_scope: ["consumer_price_index"]`, IPPI `series_scope: ["producer_price_index"]`, monthly lag 45 days, poll 7, warning 60 and expiry 120.

- [ ] **Step 5: Run focused tests**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/source-definition.ts packages/source-registry/src/hcp.ts packages/source-registry/src/index.ts tests/contracts.test.ts tests/source-registry.test.ts
git commit -m "feat: register official HCP indicator sheets"
```

## Task 2: Add a bounded Google Sheets XLSX connector

**Files:**
- Create: `packages/connectors/src/google-sheets-xlsx.ts`
- Modify: `packages/connectors/src/safe-http.ts`
- Modify: `packages/connectors/src/index.ts`
- Test: `tests/google-sheets-connector.test.ts`
- Test: `tests/ckan-connector.test.ts`

**Interfaces:**

```ts
export interface DownloadedGoogleSheet {
  finalUrl: string;
  contentType: string | null;
  contentLength: number | null;
  etag: string | null;
  lastModified: string | null;
  bytes: Uint8Array;
  originalFilename: string;
}

export function googleSheetsExportUrl(source: SourceDefinition): string;
export function downloadGoogleSheetsXlsx(
  source: SourceDefinition,
  fetchImpl?: typeof fetch,
): Promise<DownloadedGoogleSheet>;
```

- [ ] **Step 1: Write failing connector tests**

Cover exact export URL/query order, a 307 redirect to `doc-xx-a8-sheets.googleusercontent.com`, rejection of `googleusercontent.com` without the exact Google Sheets export host shape, sibling/subdomain tricks, credentials, HTTP, fourth redirect, over-limit `content-length`, streamed over-limit body, non-ZIP bytes and use with a CKAN source.

- [ ] **Step 2: Run connector tests and verify failure**

```bash
fnm exec --using=22.22.3 npm exec -- tsx --test tests/google-sheets-connector.test.ts tests/ckan-connector.test.ts
```

Expected: FAIL because the Google connector is missing.

- [ ] **Step 3: Make safe-fetch policy call-scoped**

Replace the hard-coded host set with a required policy callback used before every request and redirect:

```ts
export interface SafeFetchHostPolicy {
  allowInitial(url: URL): boolean;
  allowRedirect(url: URL): boolean;
}
```

The CKAN caller supplies exact `data.gov.ma`/`www.data.gov.ma`; its tests must remain unchanged. The Google caller allows initial hostname exactly `docs.google.com` and redirects only to the observed strict shape `doc-<segments>-sheets.googleusercontent.com`.

- [ ] **Step 4: Implement the Google connector**

Construct the URL from the validated source, call `safeFetch` with `ARTIFACT_MAX_BYTES`, reject non-XLSX ZIP signatures and return `sheet-<gid>.xlsx` as a stable original filename. Do not interpret `lastModified` as source freshness.

- [ ] **Step 5: Run focused tests**

Run the Step 2 command. Expected: PASS, including all CKAN regressions.

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/src/safe-http.ts packages/connectors/src/google-sheets-xlsx.ts packages/connectors/src/index.ts tests/google-sheets-connector.test.ts tests/ckan-connector.test.ts
git commit -m "feat: download bounded HCP Google sheets"
```

## Task 3: Parse the five official workbook profiles fail closed

**Files:**
- Create: `packages/parsers/src/hcp-official-indicator-workbook.ts`
- Modify: `packages/parsers/src/index.ts`
- Modify: `tests/fixture-workbooks.ts`
- Test: `tests/hcp-official-indicator-parser.test.ts`
- Test: `tests/hcp-parser.test.ts`

**Interfaces:**

```ts
export interface ParseHcpOfficialIndicatorWorkbookInput {
  source: SourceDefinition;
  artifact: RawArtifact;
  bytes: Uint8Array;
  retrievedAt: string;
}

export function parseHcpOfficialIndicatorWorkbook(
  input: ParseHcpOfficialIndicatorWorkbookInput,
): Promise<ParsedDataset>;
```

- [ ] **Step 1: Generate exact in-memory fixture workbooks**

Add fixture builders for IPC rows 24/25 and IPPI rows 22/23. Include the exact `Mois` header, the official HCP footer, two months, every label from each group, mixed Excel `Date` and strict `YYYY/MM` cells for IPPI, strict `YYYY/MM` strings for IPC and `-` only in the refining column.

- [ ] **Step 2: Write failing parser tests**

Assert base year, country location, period month boundaries, decimal normalization, expected keys, source row/column provenance, all allowed labels and omission of the refining `-`. Assert parser errors for shifted header, duplicate label, unknown label, future/invalid month, unexpected string, wrong profile/source and empty observations. Re-run `tests/hcp-parser.test.ts` to protect the CKAN parser.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
fnm exec --using=22.22.3 npm exec -- tsx --test tests/hcp-official-indicator-parser.test.ts tests/hcp-parser.test.ts
```

Expected: FAIL because the official parser is missing.

- [ ] **Step 4: Implement fixed profile metadata**

Keep one immutable profile table containing header row, first data row, date column, first/last value columns, base year and exact label-to-key map. Reuse `parseHcpMonthHeader` for string dates and normalize Excel `Date` cells to UTC year/month. Do not discover arbitrary labels dynamically.

- [ ] **Step 5: Emit schema-valid candidates**

Use `natural_key = <series_key>|ma|<YYYY-MM>`, frequency `monthly`, unit `index`, currency `null`, scaling factor `1`, `geography_type = "country"` and `scalar_reproducible = true`. Preserve the exact cell label in `source_series_label`.

- [ ] **Step 6: Run focused tests**

Run the Step 3 command. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/parsers/src/hcp-official-indicator-workbook.ts packages/parsers/src/index.ts tests/fixture-workbooks.ts tests/hcp-official-indicator-parser.test.ts tests/hcp-parser.test.ts
git commit -m "feat: parse official HCP indicator workbooks"
```

## Task 4: Evaluate official-sheet freshness from the latest period

**Files:**
- Modify: `packages/quality/src/evaluate-quality.ts`
- Modify: `packages/quality/src/index.ts`
- Test: `tests/quality.test.ts`

**Interfaces:**

```ts
export interface AssessPeriodFreshnessInput {
  source: SourceDefinition;
  now: string;
  lastPeriodEnd: string | null;
}

export function assessPeriodFreshness(
  input: AssessPeriodFreshnessInput,
): FreshnessCode;
```

- [ ] **Step 1: Write failing period-freshness tests**

Cover 59/60/61 and 120/121-day boundaries, null period, invalid timestamps, future period and month-end calendar math. Assert official parser profiles select their declared base year and do not call the HTTP path.

- [ ] **Step 2: Run tests and verify failure**

```bash
fnm exec --using=22.22.3 npm exec -- tsx --test tests/quality.test.ts
```

Expected: FAIL because period freshness is not implemented.

- [ ] **Step 3: Implement explicit freshness routing**

Derive `lastPeriodEnd` from parsed observations. For `google-sheets-xlsx`, add `source_late`/`source_stale` through `assessPeriodFreshness`; for CKAN retain `assessFreshness(remoteLastModified)`. A future period is a mandatory `future_period` failure, not a negative age accepted as healthy.

- [ ] **Step 4: Run focused tests**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/quality/src/evaluate-quality.ts packages/quality/src/index.ts tests/quality.test.ts
git commit -m "feat: assess source freshness from published periods"
```

## Task 5: Prevent duplicate datasets from volatile XLSX packaging

**Files:**
- Modify: `packages/canonical/src/revisions.ts`
- Modify: `packages/canonical/src/index.ts`
- Modify: `apps/ingest-cli/src/run-ingestion.ts`
- Test: `tests/canonical-publisher.test.ts`
- Test: `tests/ingestion-flow.test.ts`

**Interfaces:**

```ts
export function hasSemanticObservationChanges(input: {
  candidates: ObservationCandidate[];
  previous: CanonicalObservation[];
}): boolean;
```

- [ ] **Step 1: Write failing canonical comparison tests**

Assert `false` when only artifact SHA, retrieval time, source row/column, quality status or warnings differ; `true` when a value, period, label, location, unit, scaling factor, source or natural-key membership differs; and an exception for conflicting duplicate candidates.

- [ ] **Step 2: Write failing ingestion tests for binary and semantic change**

Run two Google-sheet ingestions with different XLSX bytes but identical parsed values. Assert the second run is `no_change`, references the first dataset, persists a quality report and leaves the published dataset count at one. Then change one value and assert `published`, revision increment and two datasets.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
fnm exec --using=22.22.3 npm exec -- tsx --test tests/canonical-publisher.test.ts tests/ingestion-flow.test.ts
```

Expected: FAIL because binary identity is still the only early no-change path.

- [ ] **Step 4: Share semantic evidence with revision resolution**

Refactor `semanticEvidence` without changing its fields or existing revision output. The helper must compare the set of current natural keys and candidate keys in both directions; removed observations count as a change and remain protected by quality coverage gates.

- [ ] **Step 5: Dispatch connectors and parsers by discriminant**

In `runRemoteIngestion`, use CKAN discovery/download for `ckan` and `downloadGoogleSheetsXlsx` for `google-sheets-xlsx`. In `finishArtifact`, dispatch to the legacy or official parser. Keep `manual` remote ingestion rejected.

- [ ] **Step 6: Return semantic no-change after quality**

After `persistQuality` and before `publishDataset`, call the helper. Return the current dataset ID plus a `semanticNoChange` flag. Construct the terminal run as `no_change` when the flag is true. Do not create an artifact-to-dataset index whose manifest does not list that artifact.

- [ ] **Step 7: Run focused tests**

Run the Step 3 command. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/canonical/src/revisions.ts packages/canonical/src/index.ts apps/ingest-cli/src/run-ingestion.ts tests/canonical-publisher.test.ts tests/ingestion-flow.test.ts
git commit -m "fix: deduplicate semantically identical source updates"
```

## Task 6: Preserve freshness and production decisions across no-change runs

**Files:**
- Modify: `apps/ingest-cli/src/run-production.ts`
- Test: `tests/production-run.test.ts`
- Test: `tests/production-contracts.test.ts`

- [ ] **Step 1: Write failing production tests**

For an unchanged official sheet, assert that production loads the current dataset manifest/quality, reports July 2026 as the current period, derives healthy/late/stale from period age and returns global `no_change`. Assert a quarantined official source blocks publication while all seven source results are still present.

- [ ] **Step 2: Run tests and verify failure**

```bash
fnm exec --using=22.22.3 npm exec -- tsx --test tests/production-run.test.ts tests/production-contracts.test.ts
```

- [ ] **Step 3: Implement quality-first no-change health**

Load the quality report written for the current run when present. Otherwise load the verified current dataset manifest and latest compatible quality report. Use period freshness for Google sheets and HTTP freshness for CKAN. Never label a missing timestamp as healthy when a known last period is stale.

- [ ] **Step 4: Run focused tests and commit**

```bash
fnm exec --using=22.22.3 npm exec -- tsx --test tests/production-run.test.ts tests/production-contracts.test.ts
git add apps/ingest-cli/src/run-production.ts tests/production-run.test.ts tests/production-contracts.test.ts
git commit -m "fix: retain period health for unchanged sources"
```

## Task 7: Update public workflow policy and operator evidence

**Files:**
- Modify: `.github/workflows/data-refresh.yml`
- Modify: `tests/workflow-policy.test.ts`
- Modify: `docs/operations/source-qualification.md`
- Modify: `docs/operations/import-and-recovery.md`
- Modify: `NOTICE-DATA.md`

- [ ] **Step 1: Add failing workflow-policy assertions**

Assert the refresh remains weekly, public-gated, sequential and `cancel-in-progress: false`; uses no cache, Actions artifact, Supabase or Vercel; and does not enumerate only two source IDs. Existing pinned action SHAs and permission boundaries remain exact.

- [ ] **Step 2: Run the workflow test and verify failure**

```bash
fnm exec --using=22.22.3 npm exec -- tsx --test tests/workflow-policy.test.ts
```

- [ ] **Step 3: Generalize workflow wording, not security**

Keep one production command over the enabled registry. Update summaries and health text from “two sources” to “enabled qualified sources”. Do not enable any repository variable or dispatch a run.

- [ ] **Step 4: Document source and recovery details**

Record workbook IDs/GIDs, official pages, CC BY 4.0 evidence, last verified period, exact label-failure policy, semantic no-change behavior and operator response to redirect/layout/licence/freshness failures. State that a changed upstream label requires a reviewed registry/parser change, never an operator normalization.

- [ ] **Step 5: Run focused tests and commit**

```bash
fnm exec --using=22.22.3 npm exec -- tsx --test tests/workflow-policy.test.ts
git add .github/workflows/data-refresh.yml tests/workflow-policy.test.ts docs/operations/source-qualification.md docs/operations/import-and-recovery.md NOTICE-DATA.md
git commit -m "docs: qualify official HCP indicator refreshes"
```

## Task 8: Complete local verification and stop at the remote gate

**Files:**
- Review all files changed by Tasks 1–7.

- [ ] **Step 1: Run focused integration tests**

```bash
fnm exec --using=22.22.3 npm exec -- tsx --test tests/google-sheets-connector.test.ts tests/hcp-official-indicator-parser.test.ts tests/quality.test.ts tests/ingestion-flow.test.ts tests/production-run.test.ts tests/workflow-policy.test.ts
```

- [ ] **Step 2: Run complete validation**

```bash
fnm exec --using=22.22.3 npm test
fnm exec --using=22.22.3 npm run lint
fnm exec --using=22.22.3 npm run typecheck
fnm exec --using=22.22.3 npm run build
```

- [ ] **Step 3: Audit diff and secrets**

```bash
git status --short
git diff --check
git diff --stat public/main...HEAD
git diff --name-only public/main...HEAD
git grep -nE '(sb_(secret|service_role)|SUPABASE_SERVICE_ROLE_KEY|postgres(ql)?://[^ ]+:[^ ]+@|ghp_[A-Za-z0-9]{20,}|github_pat_)' public/main..HEAD -- . ':!package-lock.json'
```

Expected: no whitespace error, no generated workbook/data file, no credential, no change to old release assets or source IDs.

- [ ] **Step 4: Request code review and fix findings**

Use `superpowers:requesting-code-review`, then resolve every material finding with targeted tests. Re-run only affected focused tests, followed by the complete validation once.

- [ ] **Step 5: Create the local checkpoint**

If review fixes changed files, commit them as one focused fix. Record branch, base SHA, head SHA and validation evidence. Stop before push, PR, merge, workflow dispatch or release publication.

## Explicit Remote Gate

After this plan is locally complete, the next allowed action is only a user-authorized push and draft PR. The later sequence is: CI green, reviewed merge, manual `verify` workflow, source-period inspection, then separately authorized public snapshot publication. None of those actions is implied by this plan.
