# ERP-Snack National Macro Context v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a strict ERP-Snack v3 consumer bundle containing only twenty-four recent national HCP food-index periods, without changing v1/v2 or publishing any release.

**Architecture:** Introduce a parallel v3 contract and deterministic official-source-only adapter. Extend the existing closed bundle, CLI and GitHub workflow version switches with v3 while retaining v1 as the automatic/default path and keeping v2/v3 candidate-only.

**Tech Stack:** Node.js `22.22.3`, npm workspaces, TypeScript `5.9.3`, Zod `4.4.3`, canonical JSON/SHA-256, Node test runner through `tsx`, GitHub Actions and Releases.

**Spec:** `docs/superpowers/specs/2026-09-03-erp-snack-national-macro-context-v3-design.md`

## Global Constraints

- Preserve every v1 and v2 schema literal, tuple, filename, tag, projection and release behavior.
- The v3 has exactly one source ID, one canonical tuple and twenty-four periods.
- Use only `hcp-ipc-2017-official-g1-monthly` for `food_overall|ma`; reject every city, detailed category and legacy CKAN source.
- Include `business_context.operating_location_key = "ma:city:casablanca"` and `business_context.procurement_location_mode = "erp_observed_only"`.
- Keep `decision_scope = "observation_only"`, `contains_confidential_data = false`, `usage = "macro_context_only"` and no decision, forecast, correlation or supplier-price fields.
- Normal tests are offline and deterministic.
- Add no dependency, database, runtime service, deployment or paid resource.
- Keep automatic publication on v1; v2 and v3 remain manual candidate-only.
- Follow test-driven development: record a real RED failure before production changes, then GREEN and refactor.
- Run Node/npm commands with `eval "$(fnm env --shell zsh)" && fnm use 22.22.3`.
- Do not publish a candidate, promote a release, merge or deploy.

## Planned File Map

### New files

- `packages/contracts/src/consumer-v3.ts` — strict v3 tuple, source, payload and index schemas.
- `packages/adapters/src/erp-snack-profile-v3.ts` — contract-owned exact national profile.
- `packages/adapters/src/build-erp-snack-consumer-v3.ts` — verified official-source-only projection.
- `tests/consumer-v3-fixture.ts` — hand-derived complete v3 fixture.
- `tests/consumer-v3-contracts.test.ts` — strict contract and mutation coverage.
- `tests/erp-snack-consumer-v3.test.ts` — adapter, snapshot, licence, revision and determinism coverage.

### Modified files

- `packages/contracts/src/index.ts` and `packages/adapters/src/index.ts` — additive v3 exports.
- `packages/adapters/src/write-consumer-bundle.ts` — closed v1/v2/v3 descriptors and unions.
- `apps/ingest-cli/src/consumer-command.ts` — exact v3 builder dispatch.
- `.github/workflows/consumer-release.yml` — manual v3 verification/candidate mapping only.
- `tests/architecture.test.ts`, `tests/consumer-bundle.test.ts`, `tests/consumer-cli.test.ts`, `tests/workflow-policy.test.ts` — end-to-end v3 and unchanged v1/v2 behavior.
- `docs/operations/consumer-releases.md` — v3 candidate and non-activation procedure.

### Task 1: Add the complete v3 producer path

**Files:** all files in the map above.

**Interfaces:**

```ts
export const CONSUMER_V3_CONTRACT = "erp-snack-observation-v3" as const;
export const CONSUMER_V3_PROFILE = "erp-snack-observation-v3" as const;
export const CONSUMER_V3_TUPLES = Object.freeze([{
  category: "food_overall",
  locationKey: "ma",
  seriesKey: "hcp.ipc2017.01",
  sourceId: "hcp-ipc-2017-official-g1-monthly",
  contextRole: "fresh_national_context",
  granularity: "division",
  geographyType: "country",
}] as const);

export type ConsumerV3Payload = {
  schema_version: "1.0.0";
  consumer_contract: "erp-snack-observation-v3";
  profile_id: "erp-snack-observation-v3";
  contains_confidential_data: false;
  decision_scope: "observation_only";
  business_context: {
    operating_location_key: "ma:city:casablanca";
    procurement_location_mode: "erp_observed_only";
  };
  sources: [ConsumerV3Source];
  observations: ConsumerV3Observation[];
};

export function projectErpSnackV3Observations(input: {
  observationsBySource: ReadonlyMap<string, readonly CanonicalObservation[]>;
  snapshot: SnapshotIndex;
  sources: readonly SourceDefinition[];
}): ConsumerV3Payload;

export function buildErpSnackConsumerV3(input: {
  dataDir: string;
  snapshot: SnapshotIndex;
  sourceTag: string;
}): Promise<ConsumerV3Payload>;
```

- [ ] **Step 1: Add failing v3 contract and adapter tests**

Create literal fixtures with twenty-five official national food months and distractors from the legacy source, cities and detailed categories. Expected observations are hand-derived and must not reuse the production tuple/filter logic. The tests must assert exactly one source, one tuple, latest twenty-four periods, Casablanca business context, deterministic ordering, highest-revision selection and rejection of every matrix/source/licence/snapshot mutation named in the spec.

Example invariant:

```ts
const parsed = ConsumerV3PayloadSchema.parse(validV3Payload());
assert.equal(parsed.sources.length, 1);
assert.equal(parsed.observations.length, 24);
assert.deepEqual(
  [...new Set(parsed.observations.map((row) => `${row.series_key}|${row.location_key}|${row.source_id}`))],
  ["hcp.ipc2017.01|ma|hcp-ipc-2017-official-g1-monthly"],
);
```

- [ ] **Step 2: Add failing bundle, CLI, architecture and workflow tests**

Assert exact v3 asset names, canonical bytes, checksum verification, self-consistent signed mutation rejection, CLI dispatch only for exact `v3`, invalid-version sanitisation, and public adapter exports. Extend workflow policy expectations to `options: [v1, v2, v3]`; require both v2 and v3 to fail outside manual mode while automatic execution still assigns `contract_version="v1"` and only v1 may pass the promotion guard.

- [ ] **Step 3: Run the focused RED suite**

```bash
eval "$(fnm env --shell zsh)"
fnm use 22.22.3 >/dev/null
npm exec -- tsx --test \
  tests/consumer-v3-contracts.test.ts \
  tests/erp-snack-consumer-v3.test.ts \
  tests/consumer-bundle.test.ts \
  tests/consumer-cli.test.ts \
  tests/architecture.test.ts \
  tests/workflow-policy.test.ts
```

Expected: FAIL because the v3 exports, builder, bundle descriptor, CLI branch and workflow branch do not exist. Record the failing assertions in the task report.

- [ ] **Step 4: Implement the strict standalone v3 contract**

Use a separate schema file rather than widening v2. Require exactly one sorted source and exactly twenty-four sorted, unique observations for the single tuple. Reuse primitive schemas only. Add cross-field checks for source period/age evidence, closed calendar months, positive bounded index values, source-tag/snapshot binding and exact index metadata. The payload descriptor must be exactly `consumer-v3.json`.

- [ ] **Step 5: Implement the official-source-only v3 projection**

Keep v2 source code untouched. Validate the exact registered official G1 source, its redistribution licence and its canonical definition. Validate snapshot state and verified dataset identity before reading JSONL. Select highest revision per period, then the latest twenty-four. Parse the final object with `ConsumerV3PayloadSchema`.

- [ ] **Step 6: Extend bundle and CLI through closed v1/v2/v3 switches**

Add v3 schemas and filenames to the existing descriptor map and payload/index unions. `consumer create` must default to v1, call the v2 builder only for `v2`, call the v3 builder only for `v3`, and reject every other value before reading external files. `consumer verify` remains self-describing from the strict index.

- [ ] **Step 7: Extend the workflow without enabling v3 production**

Add the exact v3 payload/checksum/tag branch in both verify and publish jobs. Use a candidate-only guard covering both `v2` and `v3`; preserve automatic `contract_version="v1"`, the single v1 promotion guard, exact three-asset validation, immutable release collision checks and pinned action SHAs. Update the operations document to state that this plan creates capability only and does not run it.

- [ ] **Step 8: Run GREEN and mutation checks**

Run the Step 3 command. Then temporarily mutate the v3 source/location or remove one v3 period and prove the corresponding test fails; restore immediately and rerun the focused suite.

- [ ] **Step 9: Run repository validation**

```bash
eval "$(fnm env --shell zsh)"
fnm use 22.22.3 >/dev/null
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Inspect `git diff --stat`, `git diff --name-status` and a secret-pattern scan limited to changed files. Do not run a workflow or contact a data source.

- [ ] **Step 10: Commit**

```bash
git add \
  packages/contracts/src/consumer-v3.ts \
  packages/contracts/src/index.ts \
  packages/adapters/src/erp-snack-profile-v3.ts \
  packages/adapters/src/build-erp-snack-consumer-v3.ts \
  packages/adapters/src/index.ts \
  packages/adapters/src/write-consumer-bundle.ts \
  apps/ingest-cli/src/consumer-command.ts \
  .github/workflows/consumer-release.yml \
  tests/consumer-v3-fixture.ts \
  tests/consumer-v3-contracts.test.ts \
  tests/erp-snack-consumer-v3.test.ts \
  tests/consumer-bundle.test.ts \
  tests/consumer-cli.test.ts \
  tests/architecture.test.ts \
  tests/workflow-policy.test.ts \
  docs/operations/consumer-releases.md
git commit -m "feat: add national ERP-Snack consumer v3"
```
