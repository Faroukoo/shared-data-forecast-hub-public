# ERP-Snack Data Hub v2 and Material Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let ERP-Snack safely read the mixed-freshness Data Hub v2 contract and show patron/admin whether material costs and margins are ready, partial or blocked, with precise corrective links and no invented historical data.

**Architecture:** Extend the existing strict three-asset Data Hub client with a closed v1/v2 protocol while retaining v1 fallback. Add one pure material-readiness domain function and one authorized, read-only loader over existing ERP tables/functions. Feed a compact dashboard strip and make missing theoretical costs explicit instead of silently treating them as zero. No schema migration or data mutation is needed.

**Tech Stack:** Next.js and React as pinned by ERP-Snack, TypeScript strict mode, Zod, Supabase existing schema, Node test runner through `tsx`, existing Tailwind/UI components and Vercel build tooling.

**Spec:** `docs/superpowers/specs/2026-09-01-hcp-freshness-and-erp-material-coverage-design.md`

**Prerequisites:**

- The Data Hub v2 plan is locally complete and its strict contract is frozen.
- Start from a fresh isolated ERP-Snack worktree based on the then-current `qc93170-a11y/ERP-SNACK/main`; do not implement on the existing observation worktree merely because it is available.
- Re-audit remote, base SHA, uncommitted changes, worktrees, running tasks and production SHA before editing.

## Global Constraints

- Preserve the currently deployed production behavior until a separate preview/production gate is authorized.
- Add no Supabase migration, table, RLS policy, Edge Function, cron, resident process or paid resource.
- Use only existing orders/order items, recipes/recipe items, purchase formats, stock receipts/items, stock movements/lots and review cases.
- Never write, backfill or infer July/August transactions. This lot is read-only for ERP business data.
- Keep the existing FIFO `marginComplete` rule; do not downgrade `incomplet` or `legacy_estime` to measured cost.
- Do not treat a missing recipe/replacement cost as zero.
- Use a rolling 30-day Casablanca period, never hard-code July or August.
- Show the new summary only to `patron` and `admin`; other roles retain the current dashboard.
- The summary is informational: no form, mutation, automatic alert creation or recommendation execution.
- V2 mixed freshness is represented per cell/source; one fresh national value never marks city data current.
- Follow TDD and focused commits. Use the Node version required by the ERP repository after checking its `package.json`/toolchain.
- Do not push, open a PR, migrate, deploy or promote production in this plan.

## Planned File Map

### New files

- `src/lib/data-hub/consumer-contract-v2.ts` — strict local v2 schemas matching the public contract.
- `src/lib/dashboard/material-data-readiness.ts` — pure readiness inputs, rules and actions.
- `src/lib/dashboard/load-material-data-readiness.ts` — authorized bounded Supabase loader.
- `src/components/dashboard/material-data-readiness-strip.tsx` — compact patron/admin display.
- `tests/data-hub-consumer-v2.test.ts` — v1/v2 discovery, assets, pinning and mixed freshness.
- `tests/material-data-readiness.test.ts` — pure ready/partial/blocked rules.
- `tests/material-data-readiness-integration.test.ts` — authorization and bounded loader behavior.
- `tests/material-data-readiness-strip.test.ts` — compact markup and role-safe text.

### Modified files

- `src/lib/data-hub/consumer-contract.ts` — common exported union/helpers only; existing v1 literals remain unchanged.
- `src/lib/data-hub/consumer-fetch.ts` — closed release specs for v1/v2 and stable discovery preference.
- `src/lib/data-hub/consumer-cache.ts` and `src/lib/data-hub/consumer-client.ts` — union result without changing enable/tag environment variables.
- `src/lib/dashboard/external-observation.ts` and `src/lib/dashboard/load-external-observation.ts` — consume per-cell v2 role/granularity without implying local freshness.
- `src/lib/pnl/paid-order-lines.ts` — replacement-cost coverage API beside the existing map wrapper.
- `src/lib/actions/dashboard-analytics.ts` — no zero fallback for missing theoretical cost.
- `src/components/dashboard/dashboard-food-cost-card.tsx`, `src/components/dashboard/dashboard-top-flop-table.tsx` — explicit non-exploitable states when coverage is incomplete.
- `src/components/dashboard/dashboard-panel.tsx` — compact readiness prop/render and replacement of the generic warning.
- `src/app/(app)/page.tsx` — load readiness only for patron/admin and pass it to the panel.
- Relevant existing dashboard, client and P&L tests — regression coverage.

## Task 0: Create and prove an isolated ERP worktree

**Files:** none.

- [ ] **Step 1: Inventory before global Git actions**

Run from the canonical ERP repository:

```bash
git remote -v
git status --short --branch
git worktree list --porcelain
git fetch origin main
git rev-parse origin/main
git log -1 --oneline origin/main
```

Confirm no active task owns the chosen branch/path. Do not stop or clean any process, worktree, cache or dependency tree.

- [ ] **Step 2: Create the isolated worktree**

Use branch `codex/erp-material-readiness-v2` and a path under the repository's ignored `.worktrees/` directory. If the branch/path already exists, inspect ownership and choose a unique suffixed name; never reset it.

- [ ] **Step 3: Install with the repository's pinned package manager and run the baseline**

Run the least expensive complete baseline (`npm ci` or the lockfile-equivalent, then the repository's test command). Record exact Node/package-manager versions, base SHA and test count before changes.

## Task 1: Accept Data Hub v1 and v2 as separate strict protocols

**Files:**
- Create: `src/lib/data-hub/consumer-contract-v2.ts`
- Modify: `src/lib/data-hub/consumer-contract.ts`
- Modify: `src/lib/data-hub/consumer-fetch.ts`
- Modify: `src/lib/data-hub/consumer-cache.ts`
- Modify: `src/lib/data-hub/consumer-client.ts`
- Test: `tests/data-hub-consumer-v2.test.ts`
- Test: `tests/data-hub-consumer-client.test.ts`

**Interfaces:**

```ts
export type SupportedDataHubConsumerPayload =
  | DataHubConsumerPayload
  | DataHubConsumerV2Payload;

export type SupportedDataHubConsumerIndex =
  | DataHubConsumerIndex
  | DataHubConsumerV2Index;

export interface VerifiedConsumerRelease {
  releaseTag: string;
  contractVersion: "v1" | "v2";
  payloadSha256: string;
  payload: SupportedDataHubConsumerPayload;
  fetchedAt: string;
}
```

- [ ] **Step 1: Write failing local v2 schema tests**

Mirror the frozen public v2 fields and refinements exactly. Assert strict rejection of unknown fields, mismatched roles/granularity, incorrect two-source set, v1 filenames and a fresh local city cell. Keep all v1 tests unchanged.

- [ ] **Step 2: Write failing fetch/discovery tests**

Cover:

- pinned stable v1 and pinned v2 prerelease, each with its exact three assets;
- no pin with only stable v1 returns v1;
- no pin with stable v1 and stable v2 returns the newest compatible v2;
- multiple stable v2 releases select by validated `index.created_at`, then tag;
- a malformed v2 candidate does not hide a valid v1 fallback;
- auto-discovery never selects a prerelease;
- mixed filenames, sidecars, tag prefixes or index/payload versions fail integrity.

- [ ] **Step 3: Run focused tests and verify failure**

Use the repository's test invocation for:

```text
tests/data-hub-consumer-v2.test.ts
tests/data-hub-consumer-client.test.ts
```

Expected: FAIL because only v1 patterns/assets are currently accepted.

- [ ] **Step 4: Add closed release specs**

Refactor constants into an immutable map:

```ts
const RELEASE_SPECS = {
  v1: {
    tag: /^consumer-v1-\d{8}T\d{6}Z-[a-f0-9]{12}$/,
    payloadName: "consumer-v1.json",
    sidecarName: "consumer-v1.json.sha256",
    parseIndex: DataHubConsumerIndexSchema,
    parsePayload: DataHubConsumerPayloadSchema,
  },
  v2: {
    tag: /^consumer-v2-\d{8}T\d{6}Z-[a-f0-9]{12}$/,
    payloadName: "consumer-v2.json",
    sidecarName: "consumer-v2.json.sha256",
    parseIndex: DataHubConsumerV2IndexSchema,
    parsePayload: DataHubConsumerV2PayloadSchema,
  },
} as const;
```

Determine version from the validated tag prefix, then require exactly that version's three names. Keep existing host allowlist, redirect limit, body limits, GitHub digest checks, canonical cross-file checks and timeout.

- [ ] **Step 5: Implement discovery preference and cache identity**

Pinned tags may target either version and keep existing prerelease-preview behavior. Automatic discovery filters stable releases, validates their index, prefers valid v2 candidates if any, otherwise v1, and sorts inside the chosen version. Include contract version in the cache key/result; retain `DATA_HUB_OBSERVATION_ENABLED` and `DATA_HUB_CONSUMER_RELEASE_TAG` unchanged.

- [ ] **Step 6: Run focused tests and commit**

Run the Step 3 tests. Expected: PASS.

```bash
git add src/lib/data-hub/consumer-contract-v2.ts src/lib/data-hub/consumer-contract.ts src/lib/data-hub/consumer-fetch.ts src/lib/data-hub/consumer-cache.ts src/lib/data-hub/consumer-client.ts tests/data-hub-consumer-v2.test.ts tests/data-hub-consumer-client.test.ts
git commit -m "feat: accept verified Data Hub consumer v2"
```

## Task 2: Preserve mixed freshness in the external observation model

**Files:**
- Modify: `src/lib/dashboard/external-observation.ts`
- Modify: `src/lib/dashboard/load-external-observation.ts`
- Modify: `src/components/dashboard/external-observation-card.tsx`
- Test: `tests/external-observation.test.ts`
- Test: `tests/external-observation-card.test.ts`
- Test: `tests/dashboard-external-observation-integration.test.ts`

**Interfaces:**

Extend cells with optional versioned provenance normalized by the loader:

```ts
type ExternalObservationCell = {
  // existing fields unchanged
  contextRole:
    | "fresh_national_context"
    | "historical_detailed_context";
  granularity: "division" | "group_of_products";
};
```

For v1, normalize `contextRole = "historical_detailed_context"`; infer granularity from category (`food_overall` division, otherwise group). For v2, copy validated contract values.

- [ ] **Step 1: Write failing mixed-freshness tests**

Build a v2 context with July 2026 national food and November 2024 detailed/city cells. Assert the overall external state remains usable but cell freshness/alignment is independent; the UI says national context is recent and local/detail context is historical. Assert it never says Tetouan/Al Hoceima are current, never calls an index a supplier price and preserves observation-only disclaimers.

- [ ] **Step 2: Run focused tests and verify failure**

Run the three listed test files. Expected: FAIL because cells do not expose role/granularity.

- [ ] **Step 3: Normalize v1/v2 at the loader boundary**

Keep the downstream view model version-neutral. Compute age and alignment from each observation's own `periodEnd`. Keep correlation disabled/null when periods are not aligned; do not align by copying the national period.

- [ ] **Step 4: Update only the audit/detail text**

Keep the simple `Tendance activite` summary and one details panel. Add short source-role labels in details; do not create another dashboard card or automatic recommendation.

- [ ] **Step 5: Run focused tests and commit**

Run the Step 2 tests. Expected: PASS.

```bash
git add src/lib/dashboard/external-observation.ts src/lib/dashboard/load-external-observation.ts src/components/dashboard/external-observation-card.tsx tests/external-observation.test.ts tests/external-observation-card.test.ts tests/dashboard-external-observation-integration.test.ts
git commit -m "feat: preserve Data Hub observation granularity"
```

## Task 3: Stop converting missing theoretical costs to zero

**Files:**
- Modify: `src/lib/pnl/paid-order-lines.ts`
- Modify: `src/lib/actions/dashboard-analytics.ts`
- Modify: `src/components/dashboard/dashboard-food-cost-card.tsx`
- Modify: `src/components/dashboard/dashboard-top-flop-table.tsx`
- Test: `tests/pnl-financial-summary.test.ts`
- Add or modify: `tests/dashboard-analytics-material-coverage.test.ts`
- Modify: relevant dashboard component tests discovered in Task 0.

**Interfaces:**

```ts
export type ReplacementCostCoverage = {
  costPerPortion: Map<string, number>;
  requestedProductIds: string[];
  coveredProductIds: string[];
  missingProductIds: string[];
  complete: boolean;
};

export async function buildReplacementCostPerPortionCoverage(
  productIds: string[],
): Promise<ReplacementCostCoverage>;
```

Keep `buildReplacementCostPerPortionMap(productIds)` as a compatibility wrapper returning only `.costPerPortion` for existing callers until they are migrated.

- [ ] **Step 1: Write failing coverage tests**

Assert deterministic sorted requested/covered/missing IDs; complete when all unique requested products resolve; incomplete for absent recipe, empty recipe, invalid portions, recursion cycle, missing ingredient purchase reference or incomplete sub-recipe. Assert legitimate cost `0` remains covered and distinguishable from missing.

- [ ] **Step 2: Write failing dashboard aggregation tests**

For one covered and one uncovered sold product, assert theoretical food cost and top/flop margin are not presented as complete and the missing product does not contribute zero. For complete coverage, existing numeric outputs remain unchanged.

- [ ] **Step 3: Run focused tests and verify failure**

Run the files listed for this task. Expected: FAIL at the current `costMap.get(productId) ?? 0` path.

- [ ] **Step 4: Implement the coverage API once**

Reuse the existing recursive recipe costing and memoization. Produce coverage from the same result rather than re-querying. In `aggregateSales`, carry `theoreticalComplete` and missing IDs. Do not calculate product ranking when any sold product lacks cost; return an explicit incomplete model.

- [ ] **Step 5: Render non-exploitable states**

Food cost and top/flop components display a compact “cout theorique incomplet” state and route to `/recipes`. Do not render a false 0 MAD, 0 % or negative margin.

- [ ] **Step 6: Run focused tests and commit**

Run the Step 3 tests. Expected: PASS.

```bash
git add src/lib/pnl/paid-order-lines.ts src/lib/actions/dashboard-analytics.ts src/components/dashboard/dashboard-food-cost-card.tsx src/components/dashboard/dashboard-top-flop-table.tsx tests/pnl-financial-summary.test.ts tests/dashboard-analytics-material-coverage.test.ts
git commit -m "fix: expose incomplete theoretical material costs"
```

Before committing, add each additional dashboard component test by its exact inspected path, then inspect `git diff --cached --name-only`; never stage the entire `tests/` directory.

## Task 4: Implement pure material-readiness rules

**Files:**
- Create: `src/lib/dashboard/material-data-readiness.ts`
- Test: `tests/material-data-readiness.test.ts`

**Interfaces:**

```ts
export type MaterialDataReadinessStatus = "ready" | "partial" | "blocked";

export type MaterialDataReadinessInput = {
  period: { start: string; end: string };
  soldProductIds: string[];
  recipeCoveredProductIds: string[];
  requiredIngredientIds: string[];
  purchaseFormatCoveredIngredientIds: string[];
  verifiedYieldIngredientIds: string[];
  valuationCoverage: ValuationCoverage;
  recentReceiptIds: string[];
  reliableReceiptItemIds: string[];
};

export function buildMaterialDataReadiness(
  input: MaterialDataReadinessInput,
): MaterialDataReadiness;
```

- [ ] **Step 1: Write the complete status decision table as failing tests**

Cover:

- blocked by one sold product without complete recipe;
- blocked by any `incompleteQuantity`;
- blocked when eligible products exist and reliable plus incomplete quantities total zero;
- partial for a missing active format;
- partial for an unverified yield;
- partial for no reliable recent receipt despite otherwise complete valuation;
- partial when `legacyEstimeQuantity` is positive even if `incompleteQuantity` is zero;
- ready only when every requirement is met;
- no sales returns partial, null coverage and no false 100 %;
- `legacyEstimeQuantity` counts in the denominator but not `reliableQuantity`;
- action counts are missing unique entities, sorted by fixed priority and deduplicated.

- [ ] **Step 2: Run the pure test and verify failure**

Run `tests/material-data-readiness.test.ts`. Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement deterministic math and actions**

Set:

```ts
reliableQuantity = fifoMesureQuantity + fifoCalculeQuantity;
totalQuantity = reliableQuantity + legacyEstimeQuantity + incompleteQuantity;
coveragePct = totalQuantity > 0
  ? round1((reliableQuantity / totalQuantity) * 100)
  : null;
```

Use exact links and labels from the spec. Action priority is recipes, formats, yields, receipts, FIFO shortages. Never use labels as keys.

- [ ] **Step 4: Run tests and commit**

```bash
# Use the repository's focused test command for tests/material-data-readiness.test.ts
git add src/lib/dashboard/material-data-readiness.ts tests/material-data-readiness.test.ts
git commit -m "feat: classify material data readiness"
```

## Task 5: Load readiness from existing ERP data without writes

**Files:**
- Create: `src/lib/dashboard/load-material-data-readiness.ts`
- Test: `tests/material-data-readiness-integration.test.ts`

**Interfaces:**

```ts
export type LoadMaterialDataReadinessInput = { asOfDate: string };

export type MaterialReadinessDependencies = {
  requirePermission: typeof requirePermission;
  fetchPaidOrderLineCoverage: typeof fetchPaidOrderLineCoverage;
  buildReplacementCostPerPortionCoverage:
    typeof buildReplacementCostPerPortionCoverage;
  fetchRealizedMaterialCost: typeof fetchRealizedMaterialCost;
  loadRecipeGraph: (productIds: string[]) => Promise<RecipeGraphRows>;
  loadActivePurchaseFormats: (ingredientIds: string[]) => Promise<PurchaseFormatReadinessRow[]>;
  loadRecentReceipts: (start: string, end: string) => Promise<ReceiptReadinessRows>;
};

export function createMaterialDataReadinessLoader(
  dependencies: MaterialReadinessDependencies,
): (input: LoadMaterialDataReadinessInput) => Promise<MaterialDataReadiness>;

export function getMaterialDataReadiness(
  input: LoadMaterialDataReadinessInput,
): Promise<MaterialDataReadiness>;
```

- [ ] **Step 1: Write authorization-first failing tests**

Assert `requirePermission("dashboard", "read")` is the first awaited dependency and denial starts no reader. Invalid ISO date returns/throws the existing safe dashboard error before reads. After authorization, independent reads start in parallel where dependencies permit.

- [ ] **Step 2: Write bounded query/result tests**

Use dependency injection, not a live database. Assert period `asOfDate - 29 days` through `asOfDate`; sold products come only from eligible paid order coverage; recipe traversal follows direct ingredients and sub-recipes with cycle protection; active formats are batched by required ingredient IDs; receipts are bounded by `received_on`; reliable items are only `fifo_mesure` or `fifo_calcule`; duplicate rows do not inflate counts.

- [ ] **Step 3: Run focused test and verify failure**

Run `tests/material-data-readiness-integration.test.ts`. Expected: FAIL because the loader is missing.

- [ ] **Step 4: Implement read-only queries over existing tables**

Use `fetchAllPages`/`fetchAllUnknownPages`, stable ordering and batches of at most 100 IDs. Select only required columns from `recipes`, `recipe_items`, `purchase_formats`, `stock_receipts` and `stock_receipt_items`. Do not call an RPC, insert/update/delete, `revalidatePath` or create review cases.

- [ ] **Step 5: Reuse the same replacement coverage**

Call `buildReplacementCostPerPortionCoverage` once for unique sold product IDs. The recipe graph provides required ingredient coverage; the replacement result provides recipe-cost completeness. Pass normalized unique IDs and the realized valuation coverage into the pure builder.

- [ ] **Step 6: Run focused tests and commit**

Run the Step 3 test. Expected: PASS.

```bash
git add src/lib/dashboard/load-material-data-readiness.ts tests/material-data-readiness-integration.test.ts
git commit -m "feat: load material readiness from ERP records"
```

## Task 6: Add one compact patron/admin readiness strip

**Files:**
- Create: `src/components/dashboard/material-data-readiness-strip.tsx`
- Modify: `src/components/dashboard/dashboard-panel.tsx`
- Modify: `src/app/(app)/page.tsx`
- Test: `tests/material-data-readiness-strip.test.ts`
- Modify: `tests/dashboard-decision-cockpit.test.ts`
- Modify: `tests/external-observation-card.test.ts` if its DashboardPanel fixtures require the new optional prop.

**Interfaces:**

```ts
type DashboardPanelProps = {
  // existing props
  materialDataReadiness?: MaterialDataReadiness | null;
};
```

- [ ] **Step 1: Write failing component tests**

Assert:

- title `Fiabilite des couts` and one status badge;
- concise recipe and FIFO coverage values;
- at most three prioritized action links with exact hrefs;
- no form/button/mutation language;
- no July/August wording;
- no “marge fiable” for partial/blocked;
- the generic `Donnees insuffisantes` banner is hidden when exact readiness exists;
- absent/null prop preserves current markup for other roles.

- [ ] **Step 2: Run focused UI tests and verify failure**

Run the listed component files. Expected: FAIL because the strip does not exist.

- [ ] **Step 3: Implement the compact strip**

Use an existing bordered section/badge style, not a full new large `Card`. Render after the existing missing-CA/review notices and before decision/observation analytics. Keep responsive single-column wrapping and accessible link text.

- [ ] **Step 4: Load only for patron/admin**

In `src/app/(app)/page.tsx`, determine `dashboardMode` before launching the readiness promise. Include it in the existing `Promise.all` only for patron/admin; catch operational reader errors to `null` but rethrow `PermissionDeniedError`. Pass `todayIsoCasablanca()` explicitly.

- [ ] **Step 5: Run focused tests and commit**

Run the Step 2 tests. Expected: PASS.

```bash
git add src/components/dashboard/material-data-readiness-strip.tsx src/components/dashboard/dashboard-panel.tsx src/app/'(app)'/page.tsx tests/material-data-readiness-strip.test.ts tests/dashboard-decision-cockpit.test.ts tests/external-observation-card.test.ts
git commit -m "feat: show material data reliability on dashboard"
```

Before committing, include only test files actually changed.

## Task 7: Complete local validation and visual proof

**Files:**
- Review all files changed by Tasks 1–6.

- [ ] **Step 1: Run focused regression suite**

Run the repository-specific test command for:

```text
tests/data-hub-consumer-client.test.ts
tests/data-hub-consumer-v2.test.ts
tests/external-observation.test.ts
tests/external-observation-card.test.ts
tests/dashboard-external-observation-integration.test.ts
tests/pnl-financial-summary.test.ts
tests/dashboard-analytics-material-coverage.test.ts
tests/material-data-readiness.test.ts
tests/material-data-readiness-integration.test.ts
tests/material-data-readiness-strip.test.ts
tests/dashboard-decision-cockpit.test.ts
```

- [ ] **Step 2: Run complete repository validation**

Use the scripts present in ERP-Snack `package.json`: complete tests, lint, typecheck if separate, and production build. Do not invent a missing script; record the exact executed commands and results.

- [ ] **Step 3: Audit database and deployment boundaries**

Confirm no file under `supabase/migrations/` changed, no SQL/RLS mutation exists, no Vercel configuration/environment write occurred, and no production URL was touched.

- [ ] **Step 4: Audit diff and secrets**

```bash
git status --short
git diff --check
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
git grep -nE '(sb_(secret|service_role)|SUPABASE_SERVICE_ROLE_KEY|postgres(ql)?://[^ ]+:[^ ]+@|ghp_[A-Za-z0-9]{20,}|github_pat_)' origin/main..HEAD -- . ':!package-lock.json'
```

- [ ] **Step 5: Request code review**

Use `superpowers:requesting-code-review`. Require review of authorization ordering, database query bounds, recipe recursion/cycles, FIFO coverage math, v1 fallback, v2 integrity and dashboard regression. Fix every material finding with targeted tests.

- [ ] **Step 6: Produce a minimal local visual proof**

Only after automated tests pass, reuse an existing local server if it belongs to this worktree; otherwise start one bounded dev process owned by this task. Open the smallest dashboard route needed and verify one ready/partial/blocked fixture or a deterministic test harness at desktop and narrow width. Do not browse production or alter real data. Stop only the process started by this task.

- [ ] **Step 7: Create the local checkpoint**

Commit review/visual fixes if any. Record base SHA, head SHA, tests, build and visual evidence. Stop before push, PR, preview, merge, environment-variable change, Supabase action or Vercel production deployment.

## Explicit Remote and Production Gates

1. Push and draft PR require explicit GitHub write authorization.
2. Preview deployment and a pinned v2 candidate require explicit authorization after CI.
3. Stable v2 discovery, merge to ERP main and Vercel production promotion are three separate decisions.
4. No Supabase migration is expected. If implementation discovers one is genuinely required, stop and request a new architecture approval before creating or applying it.
5. Rollback is code/config only: retain v1 stable, clear or repin the v2 tag in preview, and deploy the previously verified ERP SHA. No transaction row is rewritten.
