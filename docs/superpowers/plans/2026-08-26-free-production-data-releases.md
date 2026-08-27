# Zero-Cost Production Data Releases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the two qualified HCP ingestions weekly at no direct cost, restore state from immutable GitHub Release snapshots, fail closed on bad data, and prove anonymous disaster recovery before enabling the schedule.

**Architecture:** The existing one-shot TypeScript ingestion remains the only supplier path. A production orchestrator emits a validated machine summary; a new snapshot workspace validates, packs and restores the complete `.data-hub` state; tightly scoped GitHub workflows publish verified immutable release assets and synchronize source-health issues without an external database or persistent runner.

**Tech Stack:** Node.js `>=22.22.0 <23`, npm `11.15.0` workspaces, TypeScript `5.9.3`, Zod `4.4.3`, tar `7.5.22`, YAML `2.9.0`, tsx `4.23.12`, tsup `8.5.1`, Node test runner, GitHub Actions standard Ubuntu runners, GitHub CLI and GitHub Releases.

**Spec:** `docs/superpowers/specs/2026-08-26-free-production-data-releases-design.md`

## Global Constraints

- Keep `package.json` marked `"private": true`; public GitHub visibility must not enable npm publication.
- Add no Supabase project, Vercel deployment, resident service, Docker resource, self-hosted runner or global dependency.
- Only `hcp-ipc-2017-monthly` and `hcp-ipp-2018-monthly` may enter public snapshots in this lot.
- Reject any source whose registry entry is disabled, unqualified or does not permit redistribution.
- Preserve `raw/`, `manifests/`, `published/`, `runs/` and `quality/` together; never overwrite a published snapshot or dataset.
- Generated data remains under `.data-hub/` or a temporary directory and remains ignored by Git.
- Network remains denied unless `DATA_HUB_ALLOW_NETWORK=1` is explicitly set around ingestion.
- A `quarantined`, `failed_retryable` or `failed_terminal` source blocks the entire snapshot publication.
- A `late` source is reported; a `stale` source also opens a health issue, but neither status rewrites official values.
- Use one sequential production run and one concurrent workflow group with `cancel-in-progress: false`.
- Use no Actions cache and upload no Actions artifact; only GitHub Release assets persist data.
- Pin `actions/checkout` to `11bd71901bbe5b1630ceea73d27597364c9af683` and `actions/setup-node` to `49933ea5288caeca8642d1e84afbd3f7d6820020`.
- Default workflow permissions are empty or `contents: read`; grant `contents: write` only to the refresh/publisher job and `issues: write` only to the health job.
- Scheduled jobs must be skipped unless the repository is public and repository variable `DATA_HUB_PRODUCTION_ENABLED` equals `true`.
- Do not add a code licence. Add a distinct ODbL/HCP notice for released datasets.
- Every repository edit uses `apply_patch`; every code task follows red, green, refactor and ends in a focused commit.
- Remote visibility, release publication and schedule activation occur only after their explicit audit gates in Tasks 9 and 10.

---

## Planned File Map

### Production contracts and orchestration

- `packages/contracts/src/production.ts`: validated production summary, snapshot manifest and snapshot index contracts.
- `packages/contracts/src/index.ts`: public exports for the new contracts.
- `packages/source-registry/src/index.ts`: sorted enabled-source enumeration with no fallback.
- `packages/quality/src/evaluate-quality.ts`: exported freshness assessment reused for unchanged artifacts.
- `packages/quality/src/index.ts`: freshness export.
- `apps/ingest-cli/src/run-production.ts`: sequential all-source orchestration and atomic JSON/Markdown summaries.
- `apps/ingest-cli/src/index.ts`: new production, snapshot and health command routing.

### Snapshot package

- `packages/snapshot/package.json`: private workspace depending only on canonical helpers, contracts, source registry, Zod and tar.
- `packages/snapshot/src/validate-state.ts`: complete `.data-hub` integrity and redistribution validation.
- `packages/snapshot/src/archive-policy.ts`: fixed roots and safe tar-entry validation.
- `packages/snapshot/src/create-snapshot.ts`: low-copy staging, deterministic tar.gz and sidecar/index creation.
- `packages/snapshot/src/restore-snapshot.ts`: checksum-first inspection, extraction and atomic installation.
- `packages/snapshot/src/index.ts`: public snapshot exports.
- `package.json`, `package-lock.json`, `tsconfig.json`: workspace path, exact dependency and operator scripts.

### GitHub operations

- `apps/ingest-cli/src/github-health.ts`: idempotent issue synchronization through the GitHub REST API.
- `.github/workflows/ci.yml`: public, read-only validation workflow.
- `.github/workflows/data-refresh.yml`: guarded schedule/manual bootstrap/refresh/recovery workflow.
- `tests/workflow-policy.test.ts`: static permissions, trigger, pinning and no-artifact assertions.
- `README.md`: public scope, operating model and download instructions.
- `NOTICE-DATA.md`: HCP attribution and ODbL boundary for snapshot data.
- `docs/operations/import-and-recovery.md`: automated cadence, release restore and incident runbook.
- `docs/operations/public-production-checklist.md`: pre-public history audit and controlled activation evidence.

### Tests

- `tests/production-contracts.test.ts`: strict new schema behavior.
- `tests/production-run.test.ts`: decision matrix, source continuation, freshness and safe reports.
- `tests/test-factories.ts`: schema-valid production, run and artifact factories shared by later tests.
- `tests/snapshot-state.test.ts`: full-state verification and corruption failures.
- `tests/snapshot-archive.test.ts`: deterministic archive, dangerous entry refusal and clean restore.
- `tests/github-health.test.ts`: issue open/comment/close idempotence with mocked HTTP.
- `tests/architecture.test.ts`: package boundary, ignore and public-data-only invariants.

---

### Task 1: Version production and snapshot contracts

**Files:**
- Create: `packages/contracts/src/production.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `tests/production-contracts.test.ts`

**Interfaces:**
- Consumes: `SCHEMA_VERSION`, `IngestionRunStateSchema`, `Sha256Schema`, `SourceHealthStatusSchema`.
- Produces: `ProductionSourceResultSchema`, `ProductionRunSummarySchema`, `SnapshotFileSchema`, `SnapshotManifestSchema`, `SnapshotIndexSchema` and their inferred TypeScript types.

- [ ] **Step 1: Write failing strict-schema tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  ProductionRunSummarySchema,
  SCHEMA_VERSION,
  SnapshotIndexSchema,
} from "@data-hub/contracts";

const summary = {
  schema_version: SCHEMA_VERSION,
  production_run_id: "production:2026-08-26T12:00:00.000Z",
  started_at: "2026-08-26T12:00:00.000Z",
  completed_at: "2026-08-26T12:01:00.000Z",
  code_sha: "a".repeat(40),
  decision: "publishable",
  sources: [{
    source_id: "hcp-ipc-2017-monthly",
    run_id: "run-1",
    state: "published",
    artifact_sha256: "b".repeat(64),
    dataset_id: `sha256:${"c".repeat(64)}`,
    health_status: "healthy",
    warning_codes: [],
    failure_code: null,
  }],
};

void test("accepts a publishable production summary", () => {
  assert.equal(ProductionRunSummarySchema.parse(summary).decision, "publishable");
});

void test("rejects a confidential snapshot index", () => {
  assert.throws(() => SnapshotIndexSchema.parse({
    schema_version: SCHEMA_VERSION,
    snapshot_id: "d".repeat(64),
    created_at: "2026-08-26T12:01:00.000Z",
    code_sha: "a".repeat(40),
    previous_snapshot_tag: null,
    archive: { name: `data-hub-${"e".repeat(64)}.tar.gz`, byte_length: 10, sha256: "e".repeat(64) },
    manifest_sha256: "f".repeat(64),
    sources: summary.sources,
    dataset_ids: [`sha256:${"c".repeat(64)}`],
    contains_confidential_data: true,
  }));
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `npm test -- --test-name-pattern="production summary|confidential snapshot"`

Expected: FAIL because `ProductionRunSummarySchema` and `SnapshotIndexSchema` are not exported.

- [ ] **Step 3: Implement the exact strict contracts**

```ts
const DatasetIdSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const GitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);

export const ProductionSourceResultSchema = z.object({
  source_id: z.string().min(1),
  run_id: z.string().min(1),
  state: IngestionRunStateSchema,
  artifact_sha256: Sha256Schema.nullable(),
  dataset_id: DatasetIdSchema.nullable(),
  health_status: SourceHealthStatusSchema.nullable(),
  warning_codes: z.array(z.string().min(1)),
  failure_code: z.string().min(1).nullable(),
}).strict();

export const ProductionRunSummarySchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  production_run_id: z.string().min(1),
  started_at: IsoTimestampSchema,
  completed_at: IsoTimestampSchema,
  code_sha: GitShaSchema,
  decision: z.enum(["no_change", "publishable", "blocked"]),
  sources: z.array(ProductionSourceResultSchema).min(1),
}).strict().superRefine(requireSortedUniqueSources);
```

Define `SnapshotFileSchema` as strict `{ path, byte_length, sha256 }`; define `SnapshotManifestSchema` as strict `{ schema_version, snapshot_id, created_at, code_sha, files, sources, dataset_ids }`; define `SnapshotIndexSchema` with the exact fields exercised above and `contains_confidential_data: z.literal(false)`. Require unique file paths, unique source IDs and sorted arrays through Zod refinements.

Use these exact field contracts:

```ts
export const SnapshotFileSchema = z.object({
  path: z.string().min(1),
  byte_length: z.int().nonnegative(),
  sha256: Sha256Schema,
}).strict();

export const SnapshotManifestSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  snapshot_id: Sha256Schema,
  created_at: IsoTimestampSchema,
  code_sha: GitShaSchema,
  files: z.array(SnapshotFileSchema).min(1),
  sources: z.array(ProductionSourceResultSchema).min(1),
  dataset_ids: z.array(DatasetIdSchema).min(1),
}).strict().superRefine(requireSortedUniqueCollections);

export const SnapshotIndexSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  snapshot_id: Sha256Schema,
  created_at: IsoTimestampSchema,
  code_sha: GitShaSchema,
  previous_snapshot_tag: z.string().regex(/^data-\d{8}T\d{6}Z-[a-f0-9]{12}$/).nullable(),
  archive: z.object({
    name: z.string().regex(/^data-hub-[a-f0-9]{64}\.tar\.gz$/),
    byte_length: z.int().positive(),
    sha256: Sha256Schema,
  }).strict(),
  manifest_sha256: Sha256Schema,
  sources: z.array(ProductionSourceResultSchema).min(1),
  dataset_ids: z.array(DatasetIdSchema).min(1),
  contains_confidential_data: z.literal(false),
}).strict().superRefine(requireIndexConsistency);
```

`requireSortedUniqueSources` rejects unsorted or repeated production source IDs. `requireSortedUniqueCollections` rejects unsorted or repeated file paths, source IDs and dataset IDs. `requireIndexConsistency` applies the same source/dataset rules and also requires `archive.name === "data-hub-" + archive.sha256 + ".tar.gz"`.

- [ ] **Step 4: Run contract tests and typecheck**

Run: `npm test -- --test-name-pattern="production summary|confidential snapshot" && npm run typecheck`

Expected: focused tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/production.ts packages/contracts/src/index.ts tests/production-contracts.test.ts
git commit -m "feat: define production snapshot contracts"
```

---

### Task 2: Orchestrate all qualified sources and report freshness

**Files:**
- Modify: `packages/source-registry/src/index.ts`
- Modify: `packages/quality/src/evaluate-quality.ts`
- Modify: `packages/quality/src/index.ts`
- Create: `apps/ingest-cli/src/run-production.ts`
- Test: `tests/source-registry.test.ts`
- Test: `tests/quality.test.ts`
- Create: `tests/production-run.test.ts`
- Modify: `tests/test-factories.ts`

**Interfaces:**
- Consumes: `runRemoteIngestion(options): Promise<IngestionRun>`, artifact manifests and Task 1 contracts.
- Produces: `listEnabledSourceDefinitions(): SourceDefinition[]`, `assessFreshness(input: { source: SourceDefinition; now: string; remoteLastModified: string | null | undefined }): FreshnessCode`, `runProductionIngestion(options: RunProductionOptions): Promise<ProductionRunSummary>`, `writeProductionOutputs(input: WriteProductionOutputsInput): Promise<void>` and `renderProductionMarkdown(summary: ProductionRunSummary): string`.

- [ ] **Step 1: Write failing registry and freshness tests**

```ts
void test("lists enabled sources in stable source-id order", () => {
  assert.deepEqual(
    listEnabledSourceDefinitions().map((source) => source.source_id),
    ["hcp-ipc-2017-monthly", "hcp-ipp-2018-monthly"],
  );
});

void test("assesses unchanged source freshness without reparsing", () => {
  assert.equal(assessFreshness({
    source: HCP_IPC_2017_SOURCE,
    now: "2026-08-26T00:00:00.000Z",
    remoteLastModified: "2026-04-01T00:00:00.000Z",
  }), "source_stale");
});
```

- [ ] **Step 2: Run those tests and verify red**

Run: `npm test -- --test-name-pattern="stable source-id order|unchanged source freshness"`

Expected: FAIL because both functions are missing.

- [ ] **Step 3: Export stable enumeration and the existing freshness rule**

Implement `listEnabledSourceDefinitions()` as a defensive copied array filtered by `enabled` and `access_mode !== "disabled"`, sorted with `source_id.localeCompare`. Rename the private `freshnessWarning` helper to exported `assessFreshness`, keep its existing threshold semantics, and make `evaluateQuality` call the export.

```ts
export type FreshnessCode =
  | "source_stale"
  | "source_late"
  | "invalid_remote_timestamp"
  | null;

export function assessFreshness(input: {
  source: SourceDefinition;
  now: string;
  remoteLastModified: string | null | undefined;
}): FreshnessCode;
```

- [ ] **Step 4: Write failing orchestration tests**

```ts
void test("continues all sources but blocks the batch after one failure", async () => {
  const called: string[] = [];
  const summary = await runProductionIngestion({
    dataDir: "/tmp/not-read",
    codeSha: "a".repeat(40),
    now: "2026-08-26T12:00:00.000Z",
    sources: listEnabledSourceDefinitions(),
    runSource: async ({ sourceId }) => {
      called.push(sourceId);
      return ingestionRunFactory({
        source_id: sourceId,
        state: sourceId.includes("ipc") ? "failed_retryable" : "no_change",
        failure_code: sourceId.includes("ipc") ? "request_timeout" : null,
      });
    },
    loadArtifact: async () => rawArtifactFactory(),
    loadQuality: async () => null,
  });
  assert.deepEqual(called, ["hcp-ipc-2017-monthly", "hcp-ipp-2018-monthly"]);
  assert.equal(summary.decision, "blocked");
});

void test("publishes only when at least one valid source changed", async () => {
  const summary = await productionRunFixture(["published", "no_change"]);
  assert.equal(summary.decision, "publishable");
  assert.match(renderProductionMarkdown(summary), /hcp-ipc-2017-monthly/);
});
```

Add `ingestionRunFactory`, `rawArtifactFactory` and `productionSummaryFactory` to `tests/test-factories.ts`; each must build complete values through the runtime schemas and must not use type assertions to bypass contracts. Keep `productionRunFixture` local to `tests/production-run.test.ts` because it exercises injected orchestration rather than constructing a summary directly.

- [ ] **Step 5: Run the orchestration tests and verify red**

Run: `npm test -- --test-name-pattern="continues all sources|at least one valid source changed"`

Expected: FAIL because `run-production.ts` does not exist.

- [ ] **Step 6: Implement sequential orchestration and atomic outputs**

```ts
export interface RunProductionOptions {
  dataDir: string;
  codeSha: string;
  now?: string;
  sources?: SourceDefinition[];
  runSource?: typeof runRemoteIngestion;
  loadArtifact?: (dataDir: string, sha256: string) => Promise<RawArtifact>;
  loadQuality?: (dataDir: string, runId: string) => Promise<QualityReport | null>;
}

export async function runProductionIngestion(
  options: RunProductionOptions,
): Promise<ProductionRunSummary>;

export interface WriteProductionOutputsInput {
  summary: ProductionRunSummary;
  jsonPath: string;
  markdownPath: string;
}

export async function writeProductionOutputs(
  input: WriteProductionOutputsInput,
): Promise<void>;
```

Call each source with `await` inside a `for...of`; derive hard blocking from terminal state; read warning codes from quality evidence when present; assess unchanged-artifact freshness from `http_last_modified`; decide `blocked`, else `publishable` when any state is `published`, else `no_change`. Write JSON and Markdown through temporary files followed by rename. Markdown must contain only validated identifiers, counts, state, health and failure codes.

- [ ] **Step 7: Run focused and regression tests**

Run: `npm test -- --test-name-pattern="source-id order|freshness|continues all sources|valid source changed"`

Expected: all selected tests pass.

Run: `npm run typecheck && npm run lint`

Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/source-registry/src/index.ts packages/quality/src/evaluate-quality.ts packages/quality/src/index.ts apps/ingest-cli/src/run-production.ts tests/source-registry.test.ts tests/quality.test.ts tests/production-run.test.ts tests/test-factories.ts
git commit -m "feat: orchestrate qualified production sources"
```

---

### Task 3: Validate a complete redistributable Data Hub state

**Files:**
- Create: `packages/snapshot/package.json`
- Create: `packages/snapshot/src/validate-state.ts`
- Create: `packages/snapshot/src/index.ts`
- Modify: `tsconfig.json`
- Modify: `package-lock.json`
- Modify: `tests/architecture.test.ts`
- Create: `tests/snapshot-state.test.ts`

**Interfaces:**
- Consumes: raw, dataset, run and quality schemas plus the source registry.
- Produces: `validateDataHubState(dataDir: string): Promise<ValidatedDataHubState>` and `sha256File(path: string): Promise<string>`.

- [ ] **Step 1: Register the private workspace without adding tar yet**

Create `packages/snapshot/package.json` with version `0.1.0`, `private: true`, `type: module`, export `./src/index.ts`, and dependencies on `@data-hub/canonical@0.1.0`, `@data-hub/contracts@0.1.0`, `@data-hub/source-registry@0.1.0` and `zod@4.4.3`. Reuse `canonicalJson` and `sha256Hex` from `@data-hub/canonical`; do not duplicate canonical serialization. Add `@data-hub/snapshot` to TypeScript paths. Extend the architecture test so the new workspace must expose only its public index.

Run `npm install --no-audit --no-fund` immediately after adding the workspace so `package-lock.json` remains synchronized.

- [ ] **Step 2: Write failing validation tests from real offline ingestion output**

```ts
void test("validates all evidence from a published fixture state", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "snapshot-state-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await runRemoteIngestion({
    sourceId: "hcp-ipc-2017-monthly",
    dataDir: root,
    fetchImpl: createCkanFetchFixture(await createIpcFixture()),
    now: "2026-08-26T12:00:00.000Z",
  });
  const state = await validateDataHubState(root);
  assert.equal(state.sources[0]?.source_id, "hcp-ipc-2017-monthly");
  assert.equal(state.dataset_ids.length, 1);
});

void test("rejects one changed raw byte", async (t) => {
  const fixture = await createValidSnapshotState(t);
  await appendFile(fixture.rawArtifactPath, new Uint8Array([0]));
  await assert.rejects(() => validateDataHubState(fixture.root), /artifact_digest_mismatch/);
});
```

Add cases for a mismatched published directory, a malformed run, a missing quality report referenced by a non-`no_change` run and an artifact source whose registry licence has `permits_redistribution: false`.

- [ ] **Step 3: Run the snapshot-state tests and verify red**

Run: `npm test -- --test-name-pattern="fixture state|changed raw byte|mismatched published|malformed run|redistribution"`

Expected: FAIL because validation functions are missing.

- [ ] **Step 4: Implement complete state validation**

```ts
export interface ValidatedDataHubState {
  files: Array<{ path: string; byte_length: number; sha256: string }>;
  sources: ProductionSourceResult[];
  dataset_ids: string[];
}

export async function validateDataHubState(
  dataDir: string,
): Promise<ValidatedDataHubState>;
```

Walk only `raw`, `manifests`, `published`, `runs` and `quality` with `lstat`; reject symbolic links, hard links with `nlink > 1` in the source state, sockets, devices and FIFOs. Parse each JSON file with its exact schema. Resolve every stored relative path under `dataDir` and reject escape after `resolve`. Recompute raw and canonical SHA-256, row counts and dataset-directory identity. Require each artifact source to match a registered official enabled source that permits redistribution. Require each published-artifact index to reference an existing manifest and dataset. For every source, select the latest terminal run by `(completed_at, run_id)`, attach its validated quality warnings and current dataset, then sort returned files, sources and dataset IDs.

- [ ] **Step 5: Run focused tests, typecheck and architecture tests**

Run: `npm test -- --test-name-pattern="fixture state|changed raw byte|mismatched published|malformed run|redistribution|workspace package" && npm run typecheck`

Expected: selected tests and typecheck pass.

- [ ] **Step 6: Commit**

```bash
git add packages/snapshot tsconfig.json package-lock.json tests/snapshot-state.test.ts tests/architecture.test.ts
git commit -m "feat: validate complete snapshot state"
```

---

### Task 4: Create deterministic snapshots and restore them safely

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `packages/snapshot/package.json`
- Create: `packages/snapshot/src/archive-policy.ts`
- Create: `packages/snapshot/src/create-snapshot.ts`
- Create: `packages/snapshot/src/restore-snapshot.ts`
- Modify: `packages/snapshot/src/index.ts`
- Create: `tests/snapshot-archive.test.ts`

**Interfaces:**
- Consumes: `validateDataHubState`, Task 1 snapshot contracts.
- Produces: `createSnapshot(input): Promise<CreatedSnapshot>`, `restoreSnapshot(input): Promise<SnapshotIndex>` and `validateArchiveEntry(path, type): void`.

- [ ] **Step 1: Add the exact archive dependency**

Add `tar: "7.5.22"` to root dependencies and to `packages/snapshot` dependencies, then run `npm install --no-audit --no-fund`. Confirm `package-lock.json` records the integrity published for `tar@7.5.22` and no unpinned direct dependency is introduced.

- [ ] **Step 2: Write failing path-policy and deterministic archive tests**

```ts
void test("rejects traversal, absolute and link entries", () => {
  for (const [path, type] of [
    ["../escape", "File"],
    ["/absolute", "File"],
    ["data-hub/raw/link", "SymbolicLink"],
  ] as const) {
    assert.throws(() => validateArchiveEntry(path, type), /unsafe_archive_entry/);
  }
});

void test("creates byte-identical archives from identical state", async (t) => {
  const state = await createValidSnapshotState(t);
  const first = await createSnapshot(snapshotInput(state.root, join(state.root, "out-1")));
  const second = await createSnapshot(snapshotInput(state.root, join(state.root, "out-2")));
  assert.equal(first.index.snapshot_id, second.index.snapshot_id);
  assert.equal(first.index.archive.sha256, second.index.archive.sha256);
});
```

Add a restore test that starts with an absent target, verifies every file, then proves `validateDataHubState(target)` succeeds. Add corruption tests for the sidecar, archive byte and index archive name. Add a test proving an existing non-empty target is never overwritten.

- [ ] **Step 3: Run the archive tests and verify red**

Run: `npm test -- --test-name-pattern="traversal|byte-identical archives|absent target|sidecar|non-empty target"`

Expected: FAIL because archive functions are missing.

- [ ] **Step 4: Implement the fixed archive policy**

```ts
export const SNAPSHOT_ROOTS = [
  "raw",
  "manifests",
  "published",
  "runs",
  "quality",
] as const;

export function validateArchiveEntry(path: string, type: string): void {
  const normalized = posix.normalize(path);
  const allowed = normalized === "snapshot-manifest.json" ||
    SNAPSHOT_ROOTS.some((root) => normalized === `data-hub/${root}` || normalized.startsWith(`data-hub/${root}/`));
  if (!allowed || normalized.startsWith("/") || normalized.includes("../") || !["File", "Directory"].includes(type)) {
    throw new Error(`unsafe_archive_entry:${type}`);
  }
}
```

Reject backslashes and NUL explicitly before normalization.

- [ ] **Step 5: Implement low-copy deterministic creation**

```ts
export interface CreateSnapshotInput {
  dataDir: string;
  outputDir: string;
  summary: ProductionRunSummary;
  previousSnapshotTag: string | null;
}

export interface CreatedSnapshot {
  archivePath: string;
  checksumPath: string;
  indexPath: string;
  index: SnapshotIndex;
}

export async function createSnapshot(input: CreateSnapshotInput): Promise<CreatedSnapshot>;
```

Validate state first. Require the validated source/artifact/dataset tuples to match the production summary. When `previousSnapshotTag` is non-null require summary decision `publishable`; for the bootstrap only, allow `previousSnapshotTag: null` with `no_change` or `publishable`. Compute `snapshot_id` as SHA-256 of canonical JSON containing exactly `{ schema_version, files, sources, dataset_ids }`; exclude `snapshot_id`, `created_at` and `code_sha` from that identity input. Create a staging directory beside `dataDir`, hard-link each regular file into the computed path `data-hub/${relativePath}`, and fall back to `copyFile` only for `EXDEV`. Write canonical `snapshot-manifest.json`; create gzip level `1` with tar portable mode, sorted paths, normalized uid/gid/mode and epoch mtime. Hash the provisional archive, rename it to `data-hub-${archiveSha256}.tar.gz`, write the two-space SHA sidecar and strict `snapshot-index.json`, then remove only the exact staging directory in `finally`.

- [ ] **Step 6: Implement checksum-first restoration**

```ts
export interface RestoreSnapshotInput {
  archivePath: string;
  checksumPath: string;
  indexPath: string;
  targetDataDir: string;
}

export async function restoreSnapshot(input: RestoreSnapshotInput): Promise<SnapshotIndex>;
```

Require an absent or empty target. Parse the index, recompute archive size/digest, parse the sidecar without shell execution, list every tar entry through `validateArchiveEntry`, extract into a new sibling temporary directory with path preservation disabled, validate the internal manifest checksum and recompute `snapshot_id` from the same exact identity fields, validate every declared file, call `validateDataHubState`, then rename `data-hub` atomically to the target. A failure removes only the temporary extraction directory.

- [ ] **Step 7: Run archive, state and full tests**

Run: `npm test -- --test-name-pattern="snapshot|archive|target|traversal|corruption"`

Expected: all selected tests pass.

Run: `npm test && npm run typecheck && npm run lint`

Expected: full suite, typecheck and lint pass.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json packages/snapshot tests/snapshot-archive.test.ts
git commit -m "feat: pack and restore verified snapshots"
```

---

### Task 5: Expose production and snapshot CLI commands

**Files:**
- Create: `apps/ingest-cli/src/production-command.ts`
- Create: `apps/ingest-cli/src/snapshot-command.ts`
- Modify: `apps/ingest-cli/src/index.ts`
- Modify: `apps/ingest-cli/package.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsup.config.ts`
- Create: `tests/production-cli.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 4 functions.
- Produces commands `production-run`, `snapshot verify-state`, `snapshot create` and `snapshot restore` with stable exit codes.

- [ ] **Step 1: Write failing command-routing tests**

```ts
void test("production-run writes JSON and Markdown paths", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "production-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const exitCode = await executeProductionCommand([
    "--data-dir", root,
    "--summary-file", join(root, "summary.json"),
    "--markdown-file", join(root, "summary.md"),
    "--code-sha", "a".repeat(40),
  ], { runProduction: async () => productionSummaryFactory({ decision: "no_change" }) });
  assert.equal(exitCode, 0);
  assert.equal(ProductionRunSummarySchema.parse(JSON.parse(await readFile(join(root, "summary.json"), "utf8"))).decision, "no_change");
});

void test("blocked production exits with code 2 after writing its summary", async () => {
  const result = await runProductionCliFixture("blocked");
  assert.equal(result.exitCode, 2);
  assert.equal(result.summary.decision, "blocked");
});
```

Add argument tests for missing pairs, duplicate options, `previous-tag=none`, an unknown snapshot subcommand and restore into a non-empty target.

- [ ] **Step 2: Run CLI tests and verify red**

Run: `npm test -- --test-name-pattern="production-run writes|blocked production|previous-tag|unknown snapshot command"`

Expected: FAIL because command modules are missing.

- [ ] **Step 3: Implement command modules with injected dependencies**

Production exit codes are `0` for `no_change` or `publishable`, `2` for `blocked`, `4` for unexpected terminal errors and `64` for usage. Snapshot commands exit `0` on verified completion, `4` on integrity failure and `64` on usage. Keep the existing single-source `ingest` and `smoke` behavior unchanged.

Expose scripts exactly as:

```json
{
  "ingest:production": "tsx apps/ingest-cli/src/index.ts production-run",
  "snapshot": "tsx apps/ingest-cli/src/index.ts snapshot"
}
```

Add `@data-hub/snapshot: "0.1.0"` to `apps/ingest-cli/package.json`, then run `npm install --no-audit --no-fund` so the lockfile contains the new internal edge.

Bundle the same single CLI entry; do not create a second runtime or daemon.

- [ ] **Step 4: Run CLI regressions and build**

Run: `npm test -- --test-name-pattern="production|snapshot|default network|logs omit" && npm run typecheck && npm run build`

Expected: selected tests, typecheck and build pass; `dist/ingest-cli.js` supports `production-run` and `snapshot` subcommands.

- [ ] **Step 5: Commit**

```bash
git add apps/ingest-cli/src/production-command.ts apps/ingest-cli/src/snapshot-command.ts apps/ingest-cli/src/index.ts apps/ingest-cli/package.json package.json package-lock.json tsup.config.ts tests/production-cli.test.ts
git commit -m "feat: expose production snapshot commands"
```

---

### Task 6: Synchronize health issues without secrets or duplicates

**Files:**
- Create: `apps/ingest-cli/src/github-health.ts`
- Create: `apps/ingest-cli/src/health-command.ts`
- Modify: `apps/ingest-cli/src/safe-log.ts`
- Modify: `apps/ingest-cli/src/index.ts`
- Modify: `package.json`
- Create: `tests/github-health.test.ts`

**Interfaces:**
- Consumes: `ProductionRunSummary` or an explicit failed workflow result.
- Produces: `syncHealthIssues(input): Promise<HealthSyncResult>` and CLI command `health-sync`.

- [ ] **Step 1: Write failing mocked-HTTP tests**

```ts
void test("opens one marked issue for a blocked source", async () => {
  const api = githubFixture({ issues: [] });
  const result = await syncHealthIssues({
    repository: "Faroukoo/shared-data-forecast-hub-public",
    token: "test-token",
    summary: productionSummaryFactory({ decision: "blocked" }),
    workflowResult: "failure",
    runUrl: "https://github.com/Faroukoo/shared-data-forecast-hub-public/actions/runs/1",
    fetchImpl: api.fetch,
  });
  assert.deepEqual(result.created, ["hcp-ipc-2017-monthly"]);
  assert.match(api.requests.at(-1)?.body ?? "", /data-hub-health:hcp-ipc-2017-monthly/);
});
```

Add tests that a repeated incident comments on the same issue, a recovered healthy source closes it, a stale source opens it without blocking publication, a missing summary plus failed job uses source ID `snapshot-store`, and no request body contains the token or raw request URL.

- [ ] **Step 2: Run health tests and verify red**

Run: `npm test -- --test-name-pattern="marked issue|repeated incident|recovered healthy|stale source|snapshot-store"`

Expected: FAIL because health synchronization is missing.

- [ ] **Step 3: Implement the minimal GitHub issue client**

```ts
export interface SyncHealthIssuesInput {
  repository: string;
  token: string;
  summary: ProductionRunSummary | null;
  workflowResult: "success" | "failure" | "cancelled" | "skipped";
  runUrl: string;
  fetchImpl?: typeof fetch;
}

export interface HealthSyncResult {
  created: string[];
  commented: string[];
  closed: string[];
}

export async function syncHealthIssues(
  input: SyncHealthIssuesInput,
): Promise<HealthSyncResult>;
```

Rename the private logger helper to exported `sanitizeSafeCode(value: string): string` and keep existing log behavior unchanged. Validate repository against `/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/`; call only the computed `/repos/${owner}/${name}/issues` path and its numeric issue/comment descendants under `https://api.github.com`; set `Authorization: Bearer` only in headers; use marker `<!-- data-hub-health:${sourceId} -->` and title `[data-health] ${sourceId}`. List up to 100 open issues, ignore pull requests, and mutate only issues containing the exact marker. Create or comment for hard failures, quarantine and stale status; close on healthy/late recovery. Sanitize failure codes with `sanitizeSafeCode` before building Markdown.

- [ ] **Step 4: Add and test `health-sync` command**

The command reads `--summary-file`, `--repository`, `--workflow-result` and `--run-url`; summary file value `none` maps to `null`; token is read only from `GITHUB_TOKEN`. Missing token exits `4` with safe code `github_token_missing`. Add script:

```json
{
  "health:sync": "tsx apps/ingest-cli/src/index.ts health-sync"
}
```

- [ ] **Step 5: Run security and regression validation**

Run: `npm test -- --test-name-pattern="health|logs omit|authorization" && npm run typecheck && npm run lint`

Expected: tests pass and neither output nor failure objects contain `test-token`.

- [ ] **Step 6: Commit**

```bash
git add apps/ingest-cli/src/github-health.ts apps/ingest-cli/src/health-command.ts apps/ingest-cli/src/safe-log.ts apps/ingest-cli/src/index.ts package.json tests/github-health.test.ts
git commit -m "feat: synchronize data health issues"
```

---

### Task 7: Add public CI and guarded production workflows

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/data-refresh.yml`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tests/workflow-policy.test.ts`
- Modify: `tests/architecture.test.ts`

**Interfaces:**
- Consumes: CLI commands from Tasks 5 and 6, GitHub `GITHUB_TOKEN`, repository variable `DATA_HUB_PRODUCTION_ENABLED`.
- Produces: free public CI, manual bootstrap publication, manual restore drill and guarded weekly refresh.

- [ ] **Step 1: Add the exact YAML parser used only by policy tests**

Add `yaml: "2.9.0"` to root `devDependencies`, run `npm install --no-audit --no-fund`, and confirm the lockfile integrity is `sha512-2AvhNX3mb8zd6Zy7INTtSpl1F15HW6Wnqj0srWlkKLcpYl/gMIMJiyuGq2KeI2YFxUPjdlB+3Lc10seMLtL4cA==`. Do not add a workflow framework or action emulator.

- [ ] **Step 2: Write failing semantic workflow-policy tests**

```ts
import { parse } from "yaml";

interface WorkflowDocument {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  jobs: Record<string, {
    if?: string;
    permissions?: Record<string, string>;
    steps?: Array<{ uses?: string }>;
  }>;
}

async function loadWorkflow(path: string): Promise<WorkflowDocument> {
  return parse(await readFile(path, "utf8")) as WorkflowDocument;
}

void test("production workflow grants writes only to publisher and health jobs", async () => {
  const workflow = await loadWorkflow(".github/workflows/data-refresh.yml");
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(workflow.jobs.refresh?.permissions, { contents: "write" });
  assert.deepEqual(workflow.jobs.health?.permissions, {
    contents: "read",
    issues: "write",
  });
  assert.equal(workflow.concurrency?.["cancel-in-progress"], false);
});

void test("all referenced actions are pinned to approved full SHAs", async () => {
  for (const path of [".github/workflows/ci.yml", ".github/workflows/data-refresh.yml"]) {
    const workflow = await loadWorkflow(path);
    const uses = Object.values(workflow.jobs)
      .flatMap((job) => job.steps ?? [])
      .flatMap((step) => step.uses ? [step.uses] : []);
    assert.equal(uses.every((value) => /@[a-f0-9]{40}$/.test(value)), true, path);
    assert.equal(uses.some((value) => /actions\/(?:upload-artifact|cache)@/.test(value)), false, path);
  }
});
```

Add parsed-object assertions for the Monday `05:17` Europe/Paris schedule, exactly `schedule` and `workflow_dispatch` production triggers, absence of `pull_request_target`, the public-repository and production-variable job guards, and Node `22.22.3`. These assertions protect executable security behavior, not YAML formatting or wording.

- [ ] **Step 3: Run workflow tests and verify red**

Run: `npm test -- --test-name-pattern="production workflow|referenced actions|Europe/Paris"`

Expected: FAIL because workflows do not exist.

- [ ] **Step 4: Create read-only public CI**

Create `.github/workflows/ci.yml` for `pull_request` and pushes to `main`, with top-level `permissions: { contents: read }`. Use the pinned checkout/setup-node SHAs and `node-version: 22.22.3`; omit the setup-node `cache` input so caching stays disabled. Then run exactly:

```bash
npm ci --no-audit --no-fund
npm test
npm run typecheck
npm run lint
npm run build
npm audit --audit-level=high
```

Do not upload build output.

- [ ] **Step 5: Create guarded production workflow**

Create `.github/workflows/data-refresh.yml` with:

```yaml
on:
  schedule:
    - cron: "17 5 * * 1"
      timezone: "Europe/Paris"
  workflow_dispatch:
    inputs:
      mode:
        type: choice
        options: [refresh, publish-bootstrap, restore-drill]
        default: refresh
      bootstrap_release_id:
        type: string
        required: false
permissions: {}
concurrency:
  group: data-hub-production
  cancel-in-progress: false
```

The `refresh` job condition must require a public repository and either a manual event or `vars.DATA_HUB_PRODUCTION_ENABLED == 'true'`. Grant only `contents: write`. Its steps are:

1. checkout and Node setup at pinned SHAs, without cache ;
2. `npm ci --no-audit --no-fund` and `npm run build` ;
3. for normal refresh, select the newest non-draft, non-prerelease `data-*` release through `gh api`, download exactly the index, checksum and archive into `$RUNNER_TEMP/snapshot`, then run `snapshot restore` ;
4. run `DATA_HUB_ALLOW_NETWORK=1 npm run ingest:production` with summary and Markdown under `$RUNNER_TEMP` using `${GITHUB_SHA}` ;
5. append the Markdown to `$GITHUB_STEP_SUMMARY` ;
6. if `blocked`, expose the summary output and fail only after the health job can consume it ;
7. if `no_change`, create no release ;
8. if `publishable`, run `snapshot create`, refuse a public release whose body already records the same full `snapshot_id`, create a draft release named `data-${utcStamp}-${snapshotId.slice(0, 12)}`, upload exactly three assets, compare local SHA-256 with GitHub asset `digest`, then publish the draft ;
9. for `publish-bootstrap`, download assets of the exact numeric draft release ID, run snapshot restore and state validation, verify remote asset digests, then publish that draft ;
10. for `restore-drill`, restore the latest public snapshot to an empty path and run state validation without supplier access.

Expose the production summary as a base64 job output smaller than 64 KiB; do not use workflow artifacts. A final step returns failure for blocked or integrity-failed runs.

- [ ] **Step 6: Add the isolated health job**

The `health` job uses `if: always()`, depends on `refresh`, grants only `contents: read` and `issues: write`, reconstructs the optional summary from the job output under `$RUNNER_TEMP`, and calls `npm run health:sync` with `GITHUB_TOKEN: ${{ github.token }}` in that step's environment. If no summary exists and the refresh job failed, pass `--summary-file none` so the stable `snapshot-store` incident is opened. Every `gh` step in the publisher job similarly receives `GH_TOKEN: ${{ github.token }}` only in its environment.

- [ ] **Step 7: Run semantic workflow and full local validation**

Run: `npm test -- --test-name-pattern="workflow|tracked files|runtime and large binary" && npm run typecheck && npm run lint`

Expected: policy tests pass; no workflow uses an unpinned action, artifact or cache.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/data-refresh.yml package.json package-lock.json tests/workflow-policy.test.ts tests/architecture.test.ts
git commit -m "ci: add guarded public data refresh"
```

---

### Task 8: Publish operator documentation and licence boundaries

**Files:**
- Create: `README.md`
- Create: `NOTICE-DATA.md`
- Modify: `docs/operations/import-and-recovery.md`
- Create: `docs/operations/public-production-checklist.md`
- Modify: `docs/superpowers/specs/2026-08-26-free-production-data-releases-design.md`

**Interfaces:**
- Consumes: exact commands and workflow modes from Tasks 5–7.
- Produces: public operating contract, HCP attribution, recovery runbook and auditable activation checklist.

- [ ] **Step 1: Write the public README**

State exactly that the repository distributes qualified public macroeconomic series only; company purchases, sales, recipes, suppliers, margins and forecasts are prohibited. Document Node/npm versions, local tests, single-source import, production orchestration, snapshot verification and anonymous release download. State that absence of a code `LICENSE` means no code-use grant is made.

- [ ] **Step 2: Write `NOTICE-DATA.md`**

Name the Haut-Commissariat au Plan and the two exact data.gov.ma dataset URLs from the source registry. State that snapshot data preserves ODbL 1.0 evidence, provenance and checksums; distinguish the data notice from code rights; require downstream users to retain attribution and comply with the source licence.

- [ ] **Step 3: Extend recovery documentation with exact commands**

Document:

```bash
npm run ingest:production -- --data-dir .data-hub --summary-file .data-hub/production-summary.json --markdown-file .data-hub/production-summary.md --code-sha "$(git rev-parse HEAD)"
npm run snapshot -- verify-state --data-dir .data-hub
data_archive_name="$(node --input-type=module -e 'import fs from "node:fs"; process.stdout.write(JSON.parse(fs.readFileSync("/tmp/snapshot/snapshot-index.json", "utf8")).archive.name)')"
npm run snapshot -- restore --archive "/tmp/snapshot/$data_archive_name" --checksum "/tmp/snapshot/$data_archive_name.sha256" --index /tmp/snapshot/snapshot-index.json --target-data-dir /tmp/restored-data-hub
```

The operator obtains the exact archive basename from the downloaded index; executable automation never guesses an asset name.

- [ ] **Step 4: Create the production checklist**

Include checkboxes for full-history file inventory, secret-pattern scan, manual ambiguity review, clean Git state, local test/lint/typecheck/build, dependency audit, public visibility confirmation, CI exact SHA, bootstrap draft ID, three remote digests, anonymous restore path, no-change proof, repository variable activation and absence of Supabase/Vercel resources.

- [ ] **Step 5: Mark the spec implementation status without claiming release**

Change only the status line to state that implementation is ready for verification when all local tasks pass; do not mark production active in documentation before Task 10 evidence exists.

- [ ] **Step 6: Validate docs and commit**

Run: `git diff --check && ! rg -n "TBD|TODO|FIXME" README.md NOTICE-DATA.md docs/operations docs/superpowers/specs/2026-08-26-free-production-data-releases-design.md`

Expected: no whitespace error or placeholder marker.

```bash
git add README.md NOTICE-DATA.md docs/operations docs/superpowers/specs/2026-08-26-free-production-data-releases-design.md
git commit -m "docs: define public data operations"
```

---

### Task 9: Verify locally, build a clean public history, push and open the PR

**Files:**
- Modify only if a proven defect is found: files from Tasks 1–8.
- Evidence target: `docs/operations/public-production-checklist.md` checkboxes with command/result references, never secrets or full logs.

**Interfaces:**
- Consumes: complete audited tree from the private archive and the authorized new target `Faroukoo/shared-data-forecast-hub-public`.
- Produces: a two-commit public-safe history, public repository, pushed feature branch and draft PR while the source archive remains private.

- [ ] **Step 1: Run the complete local quality ladder once**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm audit --audit-level=high
git diff --check origin/main...HEAD
git status --short
```

Expected: all tests pass; typecheck/lint/build exit 0; audit has no high or critical advisory; diff check is empty; only intentionally edited checklist evidence may remain before its evidence commit.

- [ ] **Step 2: Prove local snapshot creation and empty-directory restoration**

Use a temporary copy of `/Users/mob/Documents/ChatGPT/Module data/.worktrees/data-hub-lot-1/.data-hub`; never mutate the original. Run state validation, production ingestion on the copy for both sources, snapshot creation and restore. Expected: original source hashes unchanged, restored state validates, and a second snapshot from identical inputs has the same digest.

- [ ] **Step 3: Audit every reachable Git object before visibility changes**

Run the exact read-only inventory:

```bash
git rev-list --objects --all | sort -k2
git log --all --stat --oneline
git log --all --name-status --format='%H %s'
git grep -I -l -E '(BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|SUPABASE_(SERVICE_ROLE|ANON)_KEY|DATABASE_URL|POSTGRES_URL|GITHUB_TOKEN|gh[pousr]_[A-Za-z0-9_]{20,}|Bearer [A-Za-z0-9._-]{20,})' $(git rev-list --all) -- .
```

Expected: the inventory contains only intended source/docs/tests; no private key, credential, ERP export or company-confidential record. Any ambiguous hit stops before the next step and is reviewed without printing its secret value into the checklist.

- [ ] **Step 4: Build and audit the clean public history**

Create one root commit from the audited `origin/main` tree and one feature commit from the final tree. Use `Faroukoo <98675913+Faroukoo@users.noreply.github.com>` for author and committer metadata. Audit only those two reachable commits and require the private archive commits to be unreachable.

- [ ] **Step 5: Create the authorized public repository and push both branches**

Run:

```bash
gh repo create Faroukoo/shared-data-forecast-hub-public --public --description "Verified public macroeconomic data snapshots for shared forecasting consumers"
git push git@github.com:Faroukoo/shared-data-forecast-hub-public.git "$public_base_sha:refs/heads/main"
git push git@github.com:Faroukoo/shared-data-forecast-hub-public.git "$public_feature_sha:refs/heads/codex/data-hub-free-production"
gh repo view Faroukoo/shared-data-forecast-hub-public --json visibility,nameWithOwner
```

Expected: target is `PUBLIC`, source archive remains `PRIVATE`, and only the clean history is reachable in the target.

- [ ] **Step 6: Create a draft PR**

Run:

```bash
gh pr create --repo Faroukoo/shared-data-forecast-hub-public --draft --base main --head codex/data-hub-free-production --title "feat: run verified data snapshots at zero cost" --body-file /tmp/data-hub-pr-body.md
```

Create `/tmp/data-hub-pr-body.md` using `apply_patch` with scope, security boundary, tests, cost guard, rollout gates and the fact that the scheduler remains disabled. Expected: branch is pushed and one draft PR URL is returned.

- [ ] **Step 7: Wait for public CI and review exact results**

Resolve the PR from `Faroukoo/shared-data-forecast-hub-public`, then run `gh pr checks "$data_pr_number" --repo Faroukoo/shared-data-forecast-hub-public --watch --interval 20`.

Expected: the CI workflow is green on the exact branch SHA. If it fails, use systematic debugging, fix locally through TDD, rerun only affected checks first, then push a focused repair commit.

- [ ] **Step 8: Commit final non-secret checklist evidence and update the PR**

Record only pass/fail, SHAs, PR number and public URLs. Commit with:

```bash
git add docs/operations/public-production-checklist.md
git commit -m "docs: record public production readiness"
git push git@github.com:Faroukoo/shared-data-forecast-hub-public.git HEAD:codex/data-hub-free-production
```

Expected: PR updates and CI reruns on the evidence commit.

---

### Task 10: Merge, bootstrap, restore and enable the free schedule

**Files:**
- Remote GitHub state only, plus a final documentation evidence commit if production identifiers need recording.
- Never modify or delete the preserved source `.data-hub` directory.

**Interfaces:**
- Consumes: green reviewed PR, audited local dataset state and guarded production workflow.
- Produces: merged exact SHA, first public `data-*` release, anonymous recovery proof, no-change proof and active weekly schedule.

- [ ] **Step 1: Mark the PR ready and merge only when all gates remain green**

Run:

```bash
data_pr_number="$(gh pr view codex/data-hub-free-production --repo Faroukoo/shared-data-forecast-hub-public --json number --jq .number)"
gh pr ready "$data_pr_number" --repo Faroukoo/shared-data-forecast-hub-public
gh pr checks "$data_pr_number" --repo Faroukoo/shared-data-forecast-hub-public
gh pr merge "$data_pr_number" --repo Faroukoo/shared-data-forecast-hub-public --squash --delete-branch=false
gh pr view "$data_pr_number" --repo Faroukoo/shared-data-forecast-hub-public --json state,mergedAt,mergeCommit
```

Expected: state `MERGED` and an exact merge SHA. Do not enable the production variable yet.

- [ ] **Step 2: Build the bootstrap from a temporary copy**

Create a task-owned `mktemp -d` directory, copy the preserved `.data-hub`, run `snapshot verify-state`, run both remote sources to prove current validity, then run `snapshot create` with `previous-tag=none` and the merged SHA. Recalculate all three asset digests. Expected: a valid index with `contains_confidential_data=false` and exactly the two HCP sources.

- [ ] **Step 3: Upload only a draft bootstrap release**

Read `snapshot_id` from the generated index, build the unique tag `data-${utcStamp}-${snapshotId.slice(0, 12)}`, and create its draft with `gh release create --draft`, attaching only the archive, sidecar and `snapshot-index.json`. Read back its numeric release ID and asset digests through `gh api`. Expected: draft true, exactly three assets and matching SHA-256 digests.

- [ ] **Step 4: Dispatch controlled bootstrap publication**

Run:

```bash
data_release_id="$(gh release view "$data_tag" --repo Faroukoo/shared-data-forecast-hub-public --json databaseId --jq .databaseId)"
gh workflow run data-refresh.yml --repo Faroukoo/shared-data-forecast-hub-public -f mode=publish-bootstrap -f bootstrap_release_id="$data_release_id" --ref main
data_run_id="$(gh run list --repo Faroukoo/shared-data-forecast-hub-public --workflow data-refresh.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$data_run_id" --repo Faroukoo/shared-data-forecast-hub-public --exit-status
```

Before watching, verify with `gh run view "$data_run_id" --json event,headSha,workflowName` that the run is the just-dispatched workflow on the expected main SHA. Expected: it restores and validates the draft, then changes only that release to public.

- [ ] **Step 5: Prove anonymous disaster recovery**

In a new empty temporary directory, unset `GITHUB_TOKEN`, download the three public assets through their `browser_download_url`, run `snapshot restore`, then `snapshot verify-state`. Expected: no authentication, both source datasets present, all raw/canonical checksums valid and no file outside the target.

- [ ] **Step 6: Prove idempotent supplier refresh**

Dispatch `mode=refresh` manually and watch it to completion. Expected: both sources return `no_change` and the count of public `data-*` releases does not increase. If HCP changed between bootstrap and this run, expected instead: passed quality gates and exactly one new snapshot; dispatch once more to obtain the no-change proof.

- [ ] **Step 7: Enable the schedule only after all production proofs pass**

Run:

```bash
gh variable set DATA_HUB_PRODUCTION_ENABLED --repo Faroukoo/shared-data-forecast-hub-public --body true
gh variable get DATA_HUB_PRODUCTION_ENABLED --repo Faroukoo/shared-data-forecast-hub-public
```

Expected: value `true`; workflow schedule is Monday `05:17` Europe/Paris; repository remains public; no Supabase or Vercel resource was created.

- [ ] **Step 8: Record final evidence and tag the software release**

Update only the production checklist and status line with merge SHA, workflow run IDs, data release tag, archive SHA-256, anonymous restore result and scheduler variable. Commit through a small follow-up PR; after it merges, create software tag `v0.2.0` on the exact documentation-complete main SHA. Do not alter or delete any `data-*` release.

- [ ] **Step 9: Final verification report**

Report separately: local validations, public CI, merge SHA, repository visibility, bootstrap release, anonymous restore, no-change result, scheduler state, unresolved dependency advisories and the fact that ERP consumer integration and forecasting remain later lots.
