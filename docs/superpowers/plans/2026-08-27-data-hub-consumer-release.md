# Data Hub Consumer Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an immutable, lightweight `consumer-v1-*` release from a verified Data Hub snapshot without modifying the existing three-asset `data-*` contract.

**Architecture:** A strict consumer contract lives in `@data-hub/contracts`. A focused adapter restores the current validated state, selects an exact ERP-Snack allowlist, and writes a deterministic three-asset consumer bundle. A separate GitHub workflow verifies or publishes that bundle and never edits a `data-*` release.

**Tech Stack:** Node.js 22, TypeScript 5.9 strict mode, Zod 4, npm workspaces, Node test runner through `tsx`, GitHub Actions and GitHub Releases.

**Spec:** `docs/superpowers/specs/2026-08-27-erp-snack-external-observation-design.md`

## Global Constraints

- Start from a fresh isolated worktree based on the current public `Faroukoo/shared-data-forecast-hub-public/main`; re-audit the SHA before writing code.
- Keep every existing `data-*` release immutable and keep its restoration contract at exactly three assets.
- Publish no confidential or ERP transaction data; every consumer bundle must contain `contains_confidential_data: false`.
- The consumer profile is macro context only; never label IPC as a supplier quote or MAD/kg price.
- Add no runtime service, Supabase project, Vercel project, container, global dependency or paid resource.
- Normal tests remain offline and deterministic.
- Do not create a GitHub release, repository variable, stable release, merge or deployment without the explicit gate in Task 6.
- Preserve Node `>=22.22.0 <23`, npm `11.15.0`, the existing lockfile and current exact dependency versions.

---

## File Structure

### New files

- `packages/contracts/src/consumer.ts` — strict public schemas and inferred TypeScript types.
- `packages/adapters/package.json` — private workspace package metadata.
- `packages/adapters/src/erp-snack-profile.ts` — exact Jebha-oriented series/location allowlist and category labels.
- `packages/adapters/src/build-erp-snack-consumer.ts` — verified-state reader and deterministic projection.
- `packages/adapters/src/write-consumer-bundle.ts` — atomic three-file bundle writer and verifier.
- `packages/adapters/src/index.ts` — narrow package exports.
- `apps/ingest-cli/src/consumer-command.ts` — `consumer create` and `consumer verify` CLI boundary.
- `tests/consumer-contracts.test.ts` — strict schema and ordering tests.
- `tests/erp-snack-consumer.test.ts` — allowlist, 24-month cap, stale source and determinism tests.
- `tests/consumer-bundle.test.ts` — writer, checksum, corruption and collision tests.
- `tests/consumer-cli.test.ts` — command parsing and safe failure tests.
- `.github/workflows/consumer-release.yml` — isolated candidate/stable publication workflow.
- `docs/operations/consumer-releases.md` — operator and recovery procedure.

### Modified files

- `packages/contracts/src/index.ts` — export consumer schemas and types.
- `package.json` — add a local `consumer` script only.
- `package-lock.json` — register the new private workspace; no new dependency version.
- `tsconfig.json` — add `@data-hub/adapters` path mapping.
- `apps/ingest-cli/package.json` — depend on `@data-hub/adapters`.
- `apps/ingest-cli/src/index.ts` — route the `consumer` command.
- `tests/architecture.test.ts` — enforce dependency direction.
- `tests/workflow-policy.test.ts` — enforce public-workflow permissions and asset rules.

## Task 1: Define the consumer contracts

**Files:**
- Create: `packages/contracts/src/consumer.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `tests/consumer-contracts.test.ts`

**Interfaces:**
- Consumes: `SCHEMA_VERSION`, `IsoDateSchema`, `IsoTimestampSchema`, `DecimalStringSchema`, `QualityStatusSchema`, `Sha256Schema`, `SourceHealthStatusSchema`.
- Produces: `ConsumerIndexSchema`, `ConsumerPayloadSchema`, `ConsumerSourceSchema`, `ConsumerObservationSchema` and inferred types with the same names.

- [ ] **Step 1: Write failing strict-contract tests**

Create fixtures whose source is `hcp-ipc-2017-monthly`, whose profile is `erp-snack-observation-v1`, and whose observation usage is `macro_context_only`. Assert that a valid fixture parses and that unknown fields, duplicate observation keys, unsorted arrays, a confidential flag, a supplier-price usage, a non-normalized decimal, an invalid snapshot tag and an invalid payload descriptor are rejected.

```ts
void test("consumer payload is strict, public and deterministically ordered", () => {
  const parsed = ConsumerPayloadSchema.parse(validPayload());
  assert.equal(parsed.profile_id, "erp-snack-observation-v1");
  assert.equal(parsed.contains_confidential_data, false);
  assert.throws(() => ConsumerPayloadSchema.parse({ ...validPayload(), extra: true }));
  assert.throws(() => ConsumerPayloadSchema.parse({
    ...validPayload(),
    observations: [...validPayload().observations].reverse(),
  }), /observations_must_be_sorted_and_unique/);
});
```

- [ ] **Step 2: Run the contract test and verify the missing export failure**

Run: `npm exec -- tsx --test tests/consumer-contracts.test.ts`

Expected: FAIL because `ConsumerPayloadSchema` and `ConsumerIndexSchema` are not exported.

- [ ] **Step 3: Implement the strict schemas**

Use these stable discriminants and fields; add `.strict()` at every object boundary and a `superRefine` that requires sources to be sorted by `source_id` and observations by `series_key|location_key|period_start|revision_number` with no duplicate composite key.

```ts
export const CONSUMER_CONTRACT = "erp-snack-observation-v1" as const;
export const CONSUMER_PROFILE = "erp-snack-observation-v1" as const;

export const ConsumerSourceSchema = z.object({
  source_id: z.literal("hcp-ipc-2017-monthly"),
  publisher_name: z.string().min(1),
  official_base_url: z.url(),
  licence_id: z.string().min(1),
  licence_evidence_url: z.url(),
  health_status: SourceHealthStatusSchema,
  retrieved_at: IsoTimestampSchema,
  last_period_end: IsoDateSchema,
  warning_age_days: z.int().positive(),
  expiry_age_days: z.int().positive(),
  age_days_at_snapshot: z.int().nonnegative(),
  warning_codes: z.array(z.string().min(1)),
}).strict();

export const ConsumerObservationSchema = z.object({
  series_key: z.string().min(1),
  label_fr: z.string().min(1),
  category: z.enum([
    "food_overall", "bread_cereals", "fish_seafood", "oils_fats", "vegetables",
  ]),
  usage: z.literal("macro_context_only"),
  geography_type: z.enum(["country", "city"]),
  location_key: z.enum(["ma", "ma:city:tetouan", "ma:city:al-hoceima"]),
  period_start: IsoDateSchema,
  period_end: IsoDateSchema,
  frequency: z.literal("monthly"),
  value: DecimalStringSchema,
  unit: z.literal("index"),
  base_year: z.literal(2017),
  scaling_factor: DecimalStringSchema,
  source_id: z.literal("hcp-ipc-2017-monthly"),
  artifact_sha256: Sha256Schema,
  retrieved_at: IsoTimestampSchema,
  quality_status: QualityStatusSchema,
  warning_codes: z.array(z.string().min(1)),
  revision_number: z.int().positive(),
}).strict();
```

`ConsumerPayloadSchema` must include the snapshot identifiers, profile, coverage bounds, `contains_confidential_data: false`, `decision_scope: "observation_only"`, sources and observations. `ConsumerIndexSchema` must contain the same schema/contract/snapshot/public-boundary discriminants plus `created_at`, a 40-hex `code_sha`, `indicator_count`, `observation_count`, `coverage_start`, `coverage_end`, a sorted unique `source_ids` array, and one strict payload descriptor `{ name: "consumer-v1.json", byte_length, sha256 }`. Cross-file consistency is verified by the bundle verifier in Task 3.

- [ ] **Step 4: Export the contracts and run the focused tests**

Run: `npm exec -- tsx --test tests/consumer-contracts.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add packages/contracts/src/consumer.ts packages/contracts/src/index.ts tests/consumer-contracts.test.ts
git commit -m "feat: define consumer release contracts"
```

## Task 2: Build the deterministic ERP-Snack projection

**Files:**
- Create: `packages/adapters/package.json`
- Create: `packages/adapters/src/erp-snack-profile.ts`
- Create: `packages/adapters/src/build-erp-snack-consumer.ts`
- Create: `packages/adapters/src/index.ts`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Modify: `tests/architecture.test.ts`
- Test: `tests/erp-snack-consumer.test.ts`

**Interfaces:**
- Consumes: `validateDataHubState(dataDir)`, `SnapshotIndex`, `CanonicalObservationSchema`, `ConsumerPayloadSchema`.
- Produces: `ERP_SNACK_SERIES`, `ERP_SNACK_LOCATIONS`, `projectErpSnackObservations(input): ConsumerPayload`, and `buildErpSnackConsumer(input): Promise<ConsumerPayload>`.

- [ ] **Step 1: Write failing projection tests with explicit schema-valid rows**

Generate 25 monthly `CanonicalObservationSchema` rows in memory for each of the 15 allowlisted `(series, location)` tuples, plus one IPP row and one Casablanca row. Test the pure `projectErpSnackObservations` function with those rows. Add one integration test using `runRemoteIngestion` with `createIpcFixture()` and assert that `buildErpSnackConsumer` validates the state before returning `consumer_profile_series_missing` for that deliberately incomplete profile. Assert:

- only five exact series and three exact locations are emitted;
- at most the latest 24 observations per series/location survive;
- IPP and Casablanca rows are absent;
- the payload is byte-identical for the same snapshot;
- missing any allowlisted tuple fails with `consumer_profile_series_missing`;
- a disabled/non-official source or a source/artifact whose redistribution licence is not permitted is rejected by `validateDataHubState` before projection;
- the observed November 2024 end date produces `source_stale` in the source warnings when the snapshot date is 2026-08-27.

```ts
const expectedSeries = [
  "hcp.ipc2017.01",
  "hcp.ipc2017.0111",
  "hcp.ipc2017.0113",
  "hcp.ipc2017.0115",
  "hcp.ipc2017.0117",
];
assert.deepEqual([...new Set(payload.observations.map((row) => row.series_key))], expectedSeries);
assert.equal(payload.observations.length, 5 * 3 * 24);
```

- [ ] **Step 2: Run the projection test and verify failure**

Run: `npm exec -- tsx --test tests/erp-snack-consumer.test.ts`

Expected: FAIL because `@data-hub/adapters` does not exist.

- [ ] **Step 3: Add the private workspace package and exact profile**

The profile must be data, not fuzzy string matching:

```ts
export const ERP_SNACK_SERIES = [
  { seriesKey: "hcp.ipc2017.01", category: "food_overall", labelFr: "Alimentation" },
  { seriesKey: "hcp.ipc2017.0111", category: "bread_cereals", labelFr: "Pain et céréales" },
  { seriesKey: "hcp.ipc2017.0113", category: "fish_seafood", labelFr: "Poisson et fruits de mer" },
  { seriesKey: "hcp.ipc2017.0115", category: "oils_fats", labelFr: "Huiles et graisses" },
  { seriesKey: "hcp.ipc2017.0117", category: "vegetables", labelFr: "Légumes" },
] as const;

export const ERP_SNACK_LOCATIONS = [
  "ma",
  "ma:city:al-hoceima",
  "ma:city:tetouan",
] as const;
```

Add `@data-hub/adapters` to `tsconfig.json` paths. Its package dependencies are contracts, canonical, snapshot and source-registry at `0.1.0`; it introduces no third-party package.

- [ ] **Step 4: Implement verified-state selection and projection**

Use `validateDataHubState` first so authority, enablement, redistribution licence, artifact licence snapshot and dataset quality are admitted before projection. Match `snapshot.dataset_ids` and the validated dataset IDs exactly. Select the dataset referenced by the snapshot source result for `hcp-ipc-2017-monthly`, parse every JSONL row with `CanonicalObservationSchema`, group by exact `(series_key, location_key)`, sort by `(period_start, revision_number)`, retain 24 rows, then sort the final array by the consumer composite key.

```ts
export interface BuildErpSnackConsumerInput {
  dataDir: string;
  snapshot: SnapshotIndex;
}

export function projectErpSnackObservations(input: {
  observations: readonly CanonicalObservation[];
  snapshot: SnapshotIndex;
  source: SourceDefinition;
}): ConsumerPayload;

export async function buildErpSnackConsumer(
  input: BuildErpSnackConsumerInput,
): Promise<ConsumerPayload> {
  const state = await validateDataHubState(input.dataDir);
  assertSameDatasetIds(state.dataset_ids, input.snapshot.dataset_ids);
  const rows = await readCurrentIpcObservations(input.dataDir, input.snapshot);
  return projectErpSnackObservations({
    observations: rows,
    snapshot: input.snapshot,
    source: HCP_IPC_2017_SOURCE,
  });
}
```

`generated_at` is the snapshot `created_at`, not wall-clock execution time. Compute `age_days_at_snapshot` from the latest `period_end` and snapshot date so identical input produces identical payload bytes.

- [ ] **Step 5: Enforce architecture boundaries**

Extend `tests/architecture.test.ts` so adapters may import contracts, canonical, snapshot and source-registry, while connectors/parsers/quality cannot import adapters and contracts still import no workspace package.

- [ ] **Step 6: Install only to register the workspace and run focused tests**

Run: `npm install --ignore-scripts`

Expected: lockfile changes only for the new local workspace.

Run: `npm exec -- tsx --test tests/erp-snack-consumer.test.ts tests/architecture.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the projection**

```bash
git add packages/adapters package-lock.json tsconfig.json tests/erp-snack-consumer.test.ts tests/architecture.test.ts
git commit -m "feat: project ERP-Snack macro context"
```

## Task 3: Write and verify the three-asset consumer bundle

**Files:**
- Create: `packages/adapters/src/write-consumer-bundle.ts`
- Modify: `packages/adapters/src/index.ts`
- Test: `tests/consumer-bundle.test.ts`

**Interfaces:**
- Consumes: `ConsumerPayload`, `canonicalJson(value)`, `sha256Hex(bytes)`.
- Produces: `writeConsumerBundle(input): Promise<CreatedConsumerBundle>` and `verifyConsumerBundle(input): Promise<ConsumerIndex>`.

- [ ] **Step 1: Write failing bundle tests**

Assert exact file names, canonical bytes, standard sidecar format, matching digests, refusal of non-empty output, and detection of a corrupted payload, index or sidecar.

```ts
assert.deepEqual((await readdir(outputDir)).sort(), [
  "consumer-index.json",
  "consumer-v1.json",
  "consumer-v1.json.sha256",
]);
assert.equal(
  await readFile(sidecarPath, "utf8"),
  `${created.index.payload.sha256}  consumer-v1.json\n`,
);
```

- [ ] **Step 2: Run the bundle test and verify failure**

Run: `npm exec -- tsx --test tests/consumer-bundle.test.ts`

Expected: FAIL because the writer is missing.

- [ ] **Step 3: Implement atomic creation and verification**

Serialize the payload as `${canonicalJson(payload)}\n`; hash the exact UTF-8 bytes including the newline. Write into a sibling temporary directory, verify all bytes, then rename to an absent target. Refuse symlinks, special files, an existing non-empty target, mismatched snapshot IDs and unexpected files.

```ts
export interface WriteConsumerBundleInput {
  outputDir: string;
  payload: ConsumerPayload;
  codeSha: string;
}

export interface CreatedConsumerBundle {
  index: ConsumerIndex;
  indexPath: string;
  payloadPath: string;
  checksumPath: string;
}
```

Set index `created_at` to `payload.generated_at`; code SHA is audit metadata and does not alter payload identity.

- [ ] **Step 4: Run bundle and contract tests**

Run: `npm exec -- tsx --test tests/consumer-contracts.test.ts tests/consumer-bundle.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the bundle writer**

```bash
git add packages/adapters/src/write-consumer-bundle.ts packages/adapters/src/index.ts tests/consumer-bundle.test.ts
git commit -m "feat: create verified consumer bundles"
```

## Task 4: Add the bounded consumer CLI

**Files:**
- Create: `apps/ingest-cli/src/consumer-command.ts`
- Modify: `apps/ingest-cli/src/index.ts`
- Modify: `apps/ingest-cli/package.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/consumer-cli.test.ts`

**Interfaces:**
- Consumes: `buildErpSnackConsumer`, `writeConsumerBundle`, `verifyConsumerBundle`.
- Produces: `executeConsumerCommand(args, dependencies?): Promise<number>` and CLI commands below.

- [ ] **Step 1: Write failing command tests**

Cover exact allowed options, missing/duplicate/unknown options, invalid source tag, invalid code SHA, safe JSON log output and dependency injection.

```text
consumer create --data-dir <dir> --snapshot-index <file> --source-tag <data-tag> --output-dir <dir> --code-sha <40-hex>
consumer verify --index <file> --payload <file> --checksum <file>
```

- [ ] **Step 2: Run the CLI test and verify failure**

Run: `npm exec -- tsx --test tests/consumer-cli.test.ts`

Expected: FAIL because `executeConsumerCommand` is missing.

- [ ] **Step 3: Implement parsing and safe terminal behavior**

Reuse `parseCliOptions` and `requiredOption`. Return `64` for usage errors and `4` for validation failures. Log only event names, source tag, payload digest and safe error code; never dump payload or filesystem content.

```ts
if (command === "consumer") {
  return executeConsumerCommand(argv.slice(1));
}
```

Add `"consumer": "tsx apps/ingest-cli/src/index.ts consumer"` and the local adapter dependency.

- [ ] **Step 4: Run focused tests, typecheck and build**

Run: `npm exec -- tsx --test tests/consumer-cli.test.ts tests/consumer-bundle.test.ts`

Expected: PASS.

Run: `npm run typecheck && npm run build`

Expected: both exit 0.

- [ ] **Step 5: Commit the CLI**

```bash
git add apps/ingest-cli package.json package-lock.json tests/consumer-cli.test.ts
git commit -m "feat: add consumer bundle CLI"
```

## Task 5: Add an isolated release workflow and operations guide

**Files:**
- Create: `.github/workflows/consumer-release.yml`
- Create: `docs/operations/consumer-releases.md`
- Modify: `tests/workflow-policy.test.ts`

**Interfaces:**
- Consumes: the current three-asset `data-*` restore flow and the Task 4 CLI.
- Produces: manual `verify`/`publish-prerelease` modes and optional post-refresh stable publication guarded by `DATA_HUB_CONSUMER_PRODUCTION_ENABLED=true`.

- [ ] **Step 1: Extend workflow-policy tests before adding the workflow**

Assert that the new workflow:

- never runs on `pull_request` or fork code;
- has `contents: read` globally and `contents: write` only on its publishing job;
- pins checkout and setup-node to the same full SHAs as existing CI;
- does not use cache, services or `actions/upload-artifact`;
- selects only a `data-*` source release with exactly three assets;
- creates only `consumer-index.json`, `consumer-v1.json` and its sidecar;
- creates a pre-release in manual candidate mode;
- skips automatic publication unless the repository variable is exactly `true`;
- never calls `gh release edit` on a `data-*` tag.

- [ ] **Step 2: Run the workflow test and verify failure**

Run: `npm exec -- tsx --test tests/workflow-policy.test.ts`

Expected: FAIL because `.github/workflows/consumer-release.yml` is absent.

- [ ] **Step 3: Implement the workflow**

Use `workflow_dispatch` with required `source_release_tag` and `mode` (`verify` or `publish-prerelease`). Add a `workflow_run` trigger for successful completion of `Verified public data refresh`; guard its job with `vars.DATA_HUB_CONSUMER_PRODUCTION_ENABLED == 'true'`. Manual runs use the exact input tag. Automatic runs ignore manual inputs and select the newest published, non-prerelease `data-*` release after validating its tag and index.

The job must:

1. fetch release metadata and verify the exact `data-*` tag and three assets;
2. download and restore into `$RUNNER_TEMP`, never the checkout;
3. run `snapshot verify-state`;
4. run `consumer create` into a new output directory;
5. run `consumer verify`;
6. search existing `consumer-v1-*` releases for the payload SHA; return `no_change` for an existing stable release or an existing candidate in manual mode;
7. in verify mode, stop without any write;
8. derive the exact tag `consumer-v1-YYYYMMDDTHHMMSSZ-<payload-sha-prefix>` from validated `index.created_at` and the first 12 payload digest characters;
9. in manual publish mode, create a `--prerelease` with exactly three assets;
10. in automatic enabled mode, create a normal immutable release, or promote the exact already-verified candidate by changing only its `prerelease` flag; never replace its tag, notes or assets;
11. re-download and hash every uploaded asset before completing.

Use a concurrency group that permits one consumer publication at a time and never cancels an in-progress publication.

- [ ] **Step 4: Document operation and recovery**

`docs/operations/consumer-releases.md` must include the exact commands for local create/verify, candidate workflow dispatch, integrity checks, stable promotion policy, `no_change`, stale-source interpretation, rollback by pinning an earlier immutable tag, and the two authorization gates.

- [ ] **Step 5: Run workflow, CLI and bundle tests**

Run: `npm exec -- tsx --test tests/workflow-policy.test.ts tests/consumer-cli.test.ts tests/consumer-bundle.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit workflow and operations**

```bash
git add .github/workflows/consumer-release.yml docs/operations/consumer-releases.md tests/workflow-policy.test.ts
git commit -m "ci: add verified consumer releases"
```

## Task 6: Validate locally and prepare the Data Hub review gate

**Files:**
- Review: all files changed in Tasks 1–5
- No production file is created in this task.

**Interfaces:**
- Consumes: completed consumer implementation.
- Produces: a clean, reviewable Data Hub branch and local bundle evidence.

- [ ] **Step 1: Build a consumer bundle from a temporary restored copy**

Use a `mktemp -d` directory. Download the three assets of the exact public tag `data-20260827T095123Z-9d3b77bbfc0c` anonymously once, verify their published digests, and restore them into a fresh target. Do not write into the historical `.data-hub` directory and do not retain the temporary archive after the validation checkpoint is recorded.

Run the CLI with source tag `data-20260827T095123Z-9d3b77bbfc0c` and the current branch SHA. Verify that the bundle contains 360 observations, ends at `2024-11-30`, contains the five allowlisted series and three locations, and contains no IPP or confidential record.

- [ ] **Step 2: Run tiered validation**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
git diff --check origin/main...HEAD
```

Expected: all commands exit 0.

- [ ] **Step 3: Review secret and public-boundary hygiene**

Inspect `git diff --name-only origin/main...HEAD`, search the changed tree for private keys, tokens, `.env` values, ERP identifiers and generated datasets, and verify that no `.data-hub`, archive, build output or `node_modules` file is tracked.

- [ ] **Step 4: Create a final validation commit only if documentation evidence changed**

If no tracked file changed, do not create an empty commit. If the operations guide gained measured bundle facts, commit only that file:

```bash
git add docs/operations/consumer-releases.md
git commit -m "docs: record consumer bundle validation"
```

- [ ] **Step 5: Push and open a draft PR if GitHub writing remains authorized**

Push the task branch to `Faroukoo/shared-data-forecast-hub-public` without force. Open or update one draft PR that states: no `data-*` mutation, no release created, exact tests, five series, three locations, current external data ending November 2024, and the separate candidate-release gate.

- [ ] **Step 6: STOP for review and explicit pre-release authorization**

Do not dispatch `publish-prerelease`, create a repository variable, publish a stable consumer release or merge. Report the branch SHA, PR, CI, local payload SHA and exact absence of remote releases created by the task.

## Task 7: Candidate release after explicit authorization

**Files:**
- No source edit expected.

**Interfaces:**
- Consumes: merged or explicitly approved Data Hub code SHA and the immutable current `data-*` tag.
- Produces: one verified public `consumer-v1-*` pre-release for ERP preview testing.

- [ ] **Step 1: Confirm authority and re-audit remote state**

Require a fresh explicit user instruction to create the pre-release. Confirm the Data Hub code SHA, source snapshot tag, workflow identity, repository visibility, free runner, clean CI and absence of an equivalent payload release.

- [ ] **Step 2: Dispatch only candidate publication**

Dispatch `.github/workflows/consumer-release.yml` with `mode=publish-prerelease` and the exact source tag. Do not set `DATA_HUB_CONSUMER_PRODUCTION_ENABLED`.

- [ ] **Step 3: Verify remote assets anonymously**

Download the three assets without `GITHUB_TOKEN` or `GH_TOKEN` into a fresh temporary directory. Run `consumer verify`, compare GitHub asset digests and confirm the payload snapshot ID, 360 observations, November 2024 end date and public-only flag.

- [ ] **Step 4: Record the handoff**

Report exact tag, release ID, payload SHA, workflow run, code SHA and anonymous verification. This pre-release authorizes only ERP preview integration; it does not authorize a stable consumer release, ERP production deployment or flag activation.
