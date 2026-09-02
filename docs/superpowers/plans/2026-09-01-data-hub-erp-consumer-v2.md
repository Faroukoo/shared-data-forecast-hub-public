# Data Hub ERP-Snack Consumer v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a separately versioned ERP-Snack observation contract that combines one fresh national HCP food index with fourteen historical detailed national/city contexts, while preserving consumer v1 byte and release compatibility.

**Architecture:** Add strict v2 contracts and a deterministic v2 projection beside v1. Reuse the verified snapshot state, bundle integrity rules and GitHub release workflow through version-aware internal helpers. Keep v1 as the default and require an explicit v2 selection for candidate creation; no stable v2 or ERP activation occurs in this plan.

**Tech Stack:** Node.js `22.22.3`, TypeScript `5.9.3` strict mode, Zod `4.4.3`, npm workspaces, canonical JSON/SHA-256 helpers, Node test runner through `tsx`, GitHub Actions and Releases.

**Spec:** `docs/superpowers/specs/2026-09-01-hcp-freshness-and-erp-material-coverage-design.md`

**Prerequisite:** `2026-09-01-hcp-official-indicator-ingestion.md` is locally complete and the source `hcp-ipc-2017-official-g1-monthly` exists in a validated snapshot fixture. Do not start this plan by mocking an unregistered production source.

## Global Constraints

- Preserve every v1 schema literal, filename, sidecar format, tag pattern, projection rule and stable release.
- Keep `consumer create` behavior v1 when `--contract-version` is omitted.
- The v2 has exactly two source IDs and exactly fifteen `(category, location)` tuples; no fuzzy label or location matching.
- Use the official source only for `food_overall|ma`; never synthesize or substitute fresh city values.
- Keep `decision_scope: "observation_only"`, `contains_confidential_data: false`, `usage: "macro_context_only"` and no correlation/causality/recommendation fields.
- Keep at most 24 observations per exact tuple, independently selected from its source.
- A missing tuple, duplicate tuple, unqualified source, invalid licence, quarantined dataset or mismatched snapshot fails closed.
- Normal tests are offline and deterministic.
- Add no runtime service, database, deployment or paid resource.
- Every code task follows red, green, refactor and ends in a focused commit.
- Run Node/npm commands through `fnm exec --using=22.22.3`.
- Do not publish a candidate, promote a release, merge or deploy in this plan.

## Planned File Map

### New files

- `packages/contracts/src/consumer-v2.ts` — strict v2 source, observation, payload and index schemas.
- `packages/adapters/src/erp-snack-profile-v2.ts` — exact two-source/15-tuple matrix.
- `packages/adapters/src/build-erp-snack-consumer-v2.ts` — verified deterministic v2 projection.
- `tests/consumer-v2-contracts.test.ts` — v2 strictness and matrix invariants.
- `tests/erp-snack-consumer-v2.test.ts` — source selection, 24-month cap and determinism.

### Modified files

- `packages/contracts/src/index.ts` — v2 exports without changing v1 exports.
- `packages/adapters/src/index.ts` — v2 exports.
- `packages/adapters/src/write-consumer-bundle.ts` — version-aware names through a closed v1/v2 descriptor.
- `apps/ingest-cli/src/consumer-command.ts` — optional `--contract-version`, default v1.
- `.github/workflows/consumer-release.yml` — manual version input and version-aware verification/publication.
- `docs/operations/consumer-releases.md` — v1/v2 compatibility, candidate and rollback procedure.
- `tests/consumer-contracts.test.ts`, `tests/erp-snack-consumer.test.ts`, `tests/consumer-bundle.test.ts`, `tests/consumer-cli.test.ts`, `tests/workflow-policy.test.ts`, `tests/architecture.test.ts` — v1 regression and v2 behavior.

## Task 1: Define a separate strict v2 contract

**Files:**
- Create: `packages/contracts/src/consumer-v2.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `tests/consumer-v2-contracts.test.ts`
- Test: `tests/consumer-contracts.test.ts`

**Interfaces:**

```ts
export const CONSUMER_V2_CONTRACT = "erp-snack-observation-v2" as const;
export const CONSUMER_V2_PROFILE = "erp-snack-observation-v2" as const;
export const ConsumerV2SourceSchema: z.ZodType<ConsumerV2Source>;
export const ConsumerV2ObservationSchema: z.ZodType<ConsumerV2Observation>;
export const ConsumerV2PayloadSchema: z.ZodType<ConsumerV2Payload>;
export const ConsumerV2IndexSchema: z.ZodType<ConsumerV2Index>;
```

- [ ] **Step 1: Write failing valid/invalid v2 contract tests**

Build a valid payload containing exactly the two sorted sources and fifteen latest-cell fixtures. Assert rejection of unknown fields, v1 filenames/literals, confidential data, supplier-price usage, duplicate or unsorted observations, source/observation mismatch, an invalid context role/granularity combination and any source set other than the exact two.

```ts
const V2_SOURCE_IDS = [
  "hcp-ipc-2017-monthly",
  "hcp-ipc-2017-official-g1-monthly",
] as const;
```

- [ ] **Step 2: Run contract tests and verify failure**

```bash
fnm exec --using=22.22.3 npm exec -- tsx --test tests/consumer-v2-contracts.test.ts tests/consumer-contracts.test.ts
```

Expected: FAIL because v2 exports do not exist; all existing v1 tests still pass independently.

- [ ] **Step 3: Implement strict v2 schemas**

Copy no mutable v1 literal into a union. Define a distinct schema file. Reuse common primitive schemas only. `ConsumerV2ObservationSchema` has all v1 observation fields, a source union, and:

```ts
context_role: z.enum([
  "fresh_national_context",
  "historical_detailed_context",
]),
granularity: z.enum(["division", "group_of_products"]),
```

Add cross-field refinements:

- `fresh_national_context` requires source `hcp-ipc-2017-official-g1-monthly`, category `food_overall`, location `ma`, series `hcp.ipc2017.01` and granularity `division`;
- every other observation requires source `hcp-ipc-2017-monthly` and `historical_detailed_context`;
- `food_overall` requires `division`; the other four categories require `group_of_products`.

The index payload descriptor is exactly `consumer-v2.json`; `source_ids` is the exact sorted pair.

- [ ] **Step 4: Run contract tests**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/consumer-v2.ts packages/contracts/src/index.ts tests/consumer-v2-contracts.test.ts tests/consumer-contracts.test.ts
git commit -m "feat: define ERP-Snack consumer v2 contract"
```

## Task 2: Project the exact two-source observation matrix

**Files:**
- Create: `packages/adapters/src/erp-snack-profile-v2.ts`
- Create: `packages/adapters/src/build-erp-snack-consumer-v2.ts`
- Modify: `packages/adapters/src/index.ts`
- Modify: `tests/architecture.test.ts`
- Test: `tests/erp-snack-consumer-v2.test.ts`
- Test: `tests/erp-snack-consumer.test.ts`

**Interfaces:**

```ts
export type ErpSnackV2Tuple = {
  category: ErpSnackCategory;
  locationKey: ErpSnackLocation;
  seriesKey: string;
  sourceId:
    | "hcp-ipc-2017-monthly"
    | "hcp-ipc-2017-official-g1-monthly";
  contextRole:
    | "fresh_national_context"
    | "historical_detailed_context";
  granularity: "division" | "group_of_products";
};

export const ERP_SNACK_V2_TUPLES: readonly ErpSnackV2Tuple[];

export function projectErpSnackV2Observations(input: {
  observationsBySource: ReadonlyMap<string, readonly CanonicalObservation[]>;
  snapshot: SnapshotIndex;
  sources: readonly SourceDefinition[];
}): ConsumerV2Payload;

export function buildErpSnackConsumerV2(input: {
  dataDir: string;
  snapshot: SnapshotIndex;
  sourceTag: string;
}): Promise<ConsumerV2Payload>;
```

- [ ] **Step 1: Write failing profile and projection tests**

Generate 25 months for each exact tuple plus distracting rows. Assert:

- `ERP_SNACK_V2_TUPLES` has 15 unique `(category, location)` pairs;
- only `food_overall|ma` maps to the official source;
- the other 14 map to legacy CKAN;
- each tuple emits its latest 24 rows;
- the payload has two sorted sources and 360 observations;
- fresh and historical roles/granularity are exact;
- missing either dataset or any tuple throws a stable error code;
- input order and wall-clock time do not affect canonical payload bytes.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
fnm exec --using=22.22.3 npm exec -- tsx --test tests/erp-snack-consumer-v2.test.ts tests/erp-snack-consumer.test.ts tests/architecture.test.ts
```

Expected: FAIL because the v2 adapter is missing; v1 tests remain green separately.

- [ ] **Step 3: Implement the fixed matrix**

Build the tuple array from existing `ERP_SNACK_SERIES` and `ERP_SNACK_LOCATIONS`, but override only the national `food_overall` source. Sort tuples and final observations by the contract comparison, not locale-dependent display labels.

- [ ] **Step 4: Load only verified snapshot datasets**

Call `validateDataHubState(dataDir)` first. Match both snapshot source results to verified dataset IDs, parse each JSONL row with `CanonicalObservationSchema`, and reject an absent/unexpected source or dataset. Preserve source health/licence evidence in the payload.

- [ ] **Step 5: Run focused tests**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/adapters/src/erp-snack-profile-v2.ts packages/adapters/src/build-erp-snack-consumer-v2.ts packages/adapters/src/index.ts tests/erp-snack-consumer-v2.test.ts tests/erp-snack-consumer.test.ts tests/architecture.test.ts
git commit -m "feat: project mixed-freshness ERP observations"
```

## Task 3: Make bundle writing and CLI version-aware without changing v1

**Files:**
- Modify: `packages/adapters/src/write-consumer-bundle.ts`
- Modify: `apps/ingest-cli/src/consumer-command.ts`
- Test: `tests/consumer-bundle.test.ts`
- Test: `tests/consumer-cli.test.ts`

**Interfaces:**

```ts
export type SupportedConsumerPayload = ConsumerPayload | ConsumerV2Payload;

export interface WriteConsumerBundleInput {
  outputDir: string;
  payload: SupportedConsumerPayload;
  codeSha: string;
}
```

CLI syntax:

```text
consumer create --data-dir <data-dir> --snapshot-index <snapshot-index> --source-tag <data-tag> --output-dir <bundle-dir> --code-sha <40-hex-sha> --contract-version <v1-or-v2>
consumer verify --index <consumer-index.json> --payload <consumer-v1-or-v2.json> --checksum <consumer-v1-or-v2.json.sha256>
```

Omission of `--contract-version` means `v1`.

- [ ] **Step 1: Add failing byte-compatibility and v2 bundle tests**

Keep the existing v1 expected filenames/bytes. Add v2 assertions for exactly `consumer-index.json`, `consumer-v2.json`, `consumer-v2.json.sha256`, matching sidecar, index descriptor, corruption refusal, mixed v1/v2 asset refusal and non-empty target refusal.

- [ ] **Step 2: Add failing CLI tests**

Assert default v1 builder selection, explicit v2 builder selection, rejection of other values, v2 verification, source-tag consistency and safe JSON errors without paths/tokens.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
fnm exec --using=22.22.3 npm exec -- tsx --test tests/consumer-bundle.test.ts tests/consumer-cli.test.ts
```

- [ ] **Step 4: Refactor through a closed contract descriptor**

Use one internal descriptor selected by `payload.consumer_contract`:

```ts
const BUNDLE_SPEC = {
  "erp-snack-observation-v1": {
    payloadName: "consumer-v1.json",
    checksumName: "consumer-v1.json.sha256",
  },
  "erp-snack-observation-v2": {
    payloadName: "consumer-v2.json",
    checksumName: "consumer-v2.json.sha256",
  },
} as const;
```

Keep atomic temporary-directory creation, symlink/special-file refusal, digest verification and index consistency unchanged. The verifier selects schema only after reading the strict index discriminant and then requires matching payload/sidecar names.

- [ ] **Step 5: Route CLI builders explicitly**

Add the option to `CREATE_OPTIONS`; default to v1 and call `buildErpSnackConsumerV2` only for exact `v2`. `verify` remains self-describing from the index.

- [ ] **Step 6: Run focused tests and commit**

```bash
fnm exec --using=22.22.3 npm exec -- tsx --test tests/consumer-bundle.test.ts tests/consumer-cli.test.ts
git add packages/adapters/src/write-consumer-bundle.ts apps/ingest-cli/src/consumer-command.ts tests/consumer-bundle.test.ts tests/consumer-cli.test.ts
git commit -m "feat: create versioned consumer bundles"
```

## Task 4: Add guarded v2 candidate workflow support

**Files:**
- Modify: `.github/workflows/consumer-release.yml`
- Modify: `tests/workflow-policy.test.ts`
- Modify: `docs/operations/consumer-releases.md`

- [ ] **Step 1: Write failing static workflow tests**

Assert a manual `contract_version` choice `[v1, v2]` defaulting to v1; version-derived payload/sidecar/tag names; exact three assets; v1 automatic publication unchanged; v2 manual candidate allowed only through `publish-prerelease`; no stable promotion, mutable release update, cache, Actions artifact or added permission.

- [ ] **Step 2: Run workflow tests and verify failure**

```bash
fnm exec --using=22.22.3 npm exec -- tsx --test tests/workflow-policy.test.ts
```

- [ ] **Step 3: Parameterize local asset logic safely**

Set `contract_version` from the trusted workflow input for manual runs and hard-code `v1` for `workflow_run`. Pass `--contract-version`. Derive names and tag regex from an explicit shell `case`; reject every other value before network writes. Keep the current draft/prerelease collision and digest checks for both versions.

- [ ] **Step 4: Document candidate and rollback procedure**

Document verify-only, v2 prerelease creation, ERP pinned test, stable promotion as a later separate gate, and immediate rollback by repinning v1. State that releases are immutable and a defective candidate is not edited in place.

- [ ] **Step 5: Run focused tests and commit**

```bash
fnm exec --using=22.22.3 npm exec -- tsx --test tests/workflow-policy.test.ts
git add .github/workflows/consumer-release.yml tests/workflow-policy.test.ts docs/operations/consumer-releases.md
git commit -m "feat: verify ERP consumer v2 candidates"
```

## Task 5: Complete local verification and stop before publication

**Files:**
- Review all files changed by Tasks 1–4.

- [ ] **Step 1: Prove v1 and v2 focused behavior together**

```bash
fnm exec --using=22.22.3 npm exec -- tsx --test tests/consumer-contracts.test.ts tests/consumer-v2-contracts.test.ts tests/erp-snack-consumer.test.ts tests/erp-snack-consumer-v2.test.ts tests/consumer-bundle.test.ts tests/consumer-cli.test.ts tests/workflow-policy.test.ts tests/architecture.test.ts
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
git grep -nE '(sb_(secret|service_role)|SUPABASE_SERVICE_ROLE_KEY|postgres(ql)?://[^ ]+:[^ ]+@|ghp_[A-Za-z0-9]{20,}|github_pat_)' public/main..HEAD -- . ':!package-lock.json'
```

- [ ] **Step 4: Request review and resolve findings**

Use `superpowers:requesting-code-review`. Require explicit evidence that v1 tests and bytes remain compatible, the matrix has exactly fifteen tuples and no v2 workflow path publishes stable automatically.

- [ ] **Step 5: Create the local checkpoint**

Commit review fixes if any. Record base/head SHA and validation evidence. Stop before push, PR, merge, workflow dispatch, prerelease or stable release.

## Explicit Remote Gate

The next action after local completion is a user-authorized push and draft PR. A v2 prerelease requires another explicit authorization after merge. Stable promotion and ERP auto-discovery remain separate later decisions, with v1 retained as the tested rollback.
