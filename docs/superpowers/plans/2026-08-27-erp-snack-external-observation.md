# ERP-Snack External Observation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a patron/admin-only July–August observation card that reads a verified public Data Hub consumer release while leaving the current trajectory, decisions and production behavior unchanged when disabled.

**Architecture:** A server-only client validates and caches the three small `consumer-v1-*` assets. Existing ERP revenue, stock-cost, closure and monthly-P&L sources feed a pure calendar-normalized comparison engine. The dashboard receives one additive view-model; Data Hub failure degrades only that card.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict mode, Zod 4, Supabase server client, Node test runner through `tsx`, Vercel preview.

**Spec:** `/Users/mob/Documents/ChatGPT/Module data/.worktrees/erp-snack-observation-design/docs/superpowers/specs/2026-08-27-erp-snack-external-observation-design.md`

## Global Constraints

- Re-audit `qc93170-a11y/ERP-SNACK/main`, its exact production deployment SHA and active worktrees before editing; the audited baseline on 2026-08-27 was `886799923148d534ee74c901252c86dbbaf12743`.
- Work in a new isolated branch/worktree; do not reuse or modify `release/full-morning` or `design/kds-multidest-printing`.
- `DATA_HUB_OBSERVATION_ENABLED` is false unless its exact value is `true`; when false, perform zero Data Hub network calls and render the existing dashboard path unchanged.
- Do not modify `src/lib/forecast/business-trajectory.ts` or `src/lib/dashboard/decision-actions.ts`.
- Add no Supabase migration, table, Storage object, RLS policy, remote write, persistent cache, service or paid resource.
- Query at most 62 days and use bounded, paginated batch reads; never issue one remote query per day.
- Keep July 2026 complete and August 2026 capped at the Casablanca `as_of_date`; no unlabelled extrapolation.
- HCP IPC is `macro_context_only`, never a supplier price, ingredient forecast or causal proof.
- Do not merge, deploy production, alter a production environment variable or enable the feature in production without the explicit gates in Tasks 7 and 8.

---

## File Structure

### New files

- `src/lib/data-hub/consumer-contract.ts` — local strict reader contract for `consumer-v1-*`.
- `src/lib/data-hub/consumer-fetch.ts` — pure bounded GitHub discovery/download/verification.
- `src/lib/data-hub/consumer-cache.ts` — pure enablement and 24-hour cache state machine.
- `src/lib/data-hub/consumer-client.ts` — server-only environment and 24-hour in-memory cache wrapper.
- `src/lib/dashboard/external-observation.ts` — pure July–August normalization, projection and quality model.
- `src/lib/dashboard/load-external-observation.ts` — server-only authorized bounded ERP data loader and orchestration.
- `src/components/dashboard/external-observation-card.tsx` — additive patron/admin card.
- `tests/data-hub-consumer-client.test.ts` — fetch, integrity, timeout, version and cache tests.
- `tests/daily-observation-sources.test.ts` — pure revenue/material daily grouping tests.
- `tests/external-observation.test.ts` — calendar normalization, coverage and projection tests.
- `tests/external-observation-card.test.ts` — server-rendered states and copy tests.
- `tests/dashboard-external-observation-integration.test.ts` — flag, role and no-regression source contract.
- `docs/operations/data-hub-observation.md` — preview, failure and rollback guide.

### Modified files

- `src/lib/dashboard/revenue-sources.ts` — add one bounded daily revenue reader while preserving current exports.
- `src/lib/pnl/financial-ledger.ts` — add pure per-date material-cost summarization.
- `src/lib/pnl/paid-order-lines.ts` — add one bounded per-date realized-cost reader and preserve aggregate output.
- `src/app/(app)/page.tsx` — call observation orchestration only when role and flag allow it.
- `src/components/dashboard/dashboard-panel.tsx` — accept and place the optional card.
- `.env.example` — document the two non-secret server variables.

## Task 1: Validate and fetch the public consumer release

**Files:**
- Create: `src/lib/data-hub/consumer-contract.ts`
- Create: `src/lib/data-hub/consumer-fetch.ts`
- Create: `src/lib/data-hub/consumer-cache.ts`
- Create: `src/lib/data-hub/consumer-client.ts`
- Test: `tests/data-hub-consumer-client.test.ts`

**Interfaces:**
- Consumes: public GitHub release JSON and the Data Hub `consumer-index.json`, `consumer-v1.json`, `consumer-v1.json.sha256` assets.
- Produces: `fetchVerifiedConsumerRelease(options): Promise<VerifiedConsumerRelease>`, `createDataHubConsumerCache(options)`, `isDataHubObservationEnabled(env)`, and `getDataHubConsumerContext(): Promise<DataHubContextResult>`.

- [ ] **Step 1: Write failing contract and transport tests**

Use a fully synthetic public payload with the five category enums and three location enums from the Data Hub plan. Tests import only the pure contract, fetch and cache modules; `consumer-client.ts` is checked as a server-only wrapper. A fake `fetch` must cover:

- pinned pre-release accepted only when `DATA_HUB_CONSUMER_RELEASE_TAG` is supplied;
- automatic discovery examines at most 30 releases and excludes drafts/pre-releases;
- automatic discovery chooses by validated `consumer-index.json.created_at`, not the mutable GitHub list order or release timestamp;
- release must contain exactly three uniquely named assets;
- index, sidecar, payload and source snapshot IDs must agree;
- a GitHub asset `digest` is compared when the API exposes one;
- one-byte corruption, unknown major schema, oversized body and invalid redirect host fail closed;
- the whole operation aborts at one shared three-second budget;
- disabled configuration calls fake fetch zero times;
- a valid cache entry is reused for 24 hours, then an expired failed refresh returns unavailable.

```ts
const disabled = createDataHubConsumerCache({
  env: { DATA_HUB_OBSERVATION_ENABLED: "false" },
  fetchImpl: async () => assert.fail("network must remain unused"),
  now: () => new Date("2026-08-27T12:00:00Z"),
});
assert.deepEqual(await disabled.getContext(), { status: "disabled" });
```

- [ ] **Step 2: Run the focused test and verify missing-module failure**

Run: `npm exec -- tsx --test tests/data-hub-consumer-client.test.ts`

Expected: FAIL because the data-hub modules do not exist.

- [ ] **Step 3: Implement the local strict schemas**

Mirror the published v1 fields exactly with Zod `.strict()` objects. Do not accept a generic source ID, arbitrary location or arbitrary usage.

```ts
export const DataHubConsumerPayloadSchema = z.object({
  schema_version: z.literal("1.0.0"),
  consumer_contract: z.literal("erp-snack-observation-v1"),
  source_snapshot_tag: z.string().regex(/^data-\d{8}T\d{6}Z-[a-f0-9]{12}$/),
  source_snapshot_id: z.string().regex(/^[a-f0-9]{64}$/),
  generated_at: z.iso.datetime({ offset: true }),
  profile_id: z.literal("erp-snack-observation-v1"),
  contains_confidential_data: z.literal(false),
  decision_scope: z.literal("observation_only"),
  coverage_start: z.iso.date(),
  coverage_end: z.iso.date(),
  sources: z.array(DataHubConsumerSourceSchema).min(1),
  observations: z.array(DataHubConsumerObservationSchema).min(1),
}).strict();
```

Add the same sorted/unique composite-key check as the producer. Schema divergence must be caught in contract tests, not tolerated at runtime.

- [ ] **Step 4: Implement bounded discovery and asset verification**

```ts
export interface FetchVerifiedConsumerOptions {
  repository: "Faroukoo/shared-data-forecast-hub-public";
  pinnedTag: string | null;
  fetchImpl: typeof fetch;
  now: () => Date;
  timeoutMs: 3000;
}

export interface VerifiedConsumerRelease {
  releaseTag: string;
  payloadSha256: string;
  payload: DataHubConsumerPayload;
  fetchedAt: string;
}
```

Use one `AbortController` for the whole operation. Bound release metadata to 256 KiB, index to 64 KiB, payload to 1 MiB and sidecar to 256 bytes. After discovery, fetch the three assets in parallel. Follow at most three manual redirects and accept only `api.github.com`, `github.com`, `objects.githubusercontent.com` and `release-assets.githubusercontent.com`; reject protocol changes away from HTTPS. For stable discovery, validate candidate indexes and select the greatest `created_at`, with tag as a deterministic tie-breaker. Compare any GitHub `sha256:` asset digest to the locally computed digest without making its presence mandatory.

- [ ] **Step 5: Implement the server-only cache wrapper**

`consumer-cache.ts` owns the testable factory, exact enablement rule and closure cache containing only successful verified results and their fetch time. `consumer-client.ts` starts with `import "server-only"`, creates one production singleton from `process.env` and exports only `getDataHubConsumerContext`. Do not persist the cache.

```ts
export type DataHubContextResult =
  | { status: "disabled" }
  | { status: "available"; release: VerifiedConsumerRelease }
  | { status: "unavailable"; code: DataHubFailureCode };
```

Read `DATA_HUB_CONSUMER_RELEASE_TAG` only after the enable flag is true. A pinned tag may be a pre-release; automatic discovery may not.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npm exec -- tsx --test tests/data-hub-consumer-client.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 7: Commit the verified client**

```bash
git add src/lib/data-hub tests/data-hub-consumer-client.test.ts
git commit -m "feat: read verified Data Hub releases"
```

## Task 2: Add bounded daily ERP observation sources

**Files:**
- Modify: `src/lib/dashboard/revenue-sources.ts`
- Modify: `src/lib/pnl/financial-ledger.ts`
- Modify: `src/lib/pnl/paid-order-lines.ts`
- Test: `tests/daily-observation-sources.test.ts`

**Interfaces:**
- Consumes: existing eligible revenue rules, `fetchAllPages`, FIFO valuation and supplier adjustment semantics.
- Produces: `getDailyRevenueInRange(start, end)`, `summarizeRealizedMaterialCostsByDate(input)` and `fetchRealizedMaterialCostsByDate(start, end)`.

- [ ] **Step 1: Write failing pure grouping tests**

Test these cases without Supabase:

- historical daily revenue before `pos_reopen_date` remains explicit and has `orderCount: null`;
- eligible paid orders after reopen group once per date and retain counter/Glovo basket inputs;
- cancelled, voided and `daily_total`/`basket_total` orders do not enter itemized metrics;
- reversed FIFO movements disappear from the correct date;
- supplier adjustments group by `recognized_on`;
- incomplete valuation on one day does not contaminate another day;
- aggregating all daily realized results reproduces the existing whole-range result.

```ts
assert.deepEqual(
  summarizeRealizedMaterialCostsByDate({
    movements: [
      { id: "m1", date: "2026-08-01", quantity: 2, valuationMethod: "fifo_mesure", totalCostMad: 40 },
      { id: "m2", date: "2026-08-02", quantity: 1, valuationMethod: "incomplet", totalCostMad: null },
    ],
    reversedMovementIds: new Set(),
    adjustments: [{ date: "2026-08-01", amountMad: 5 }],
  }).map((row) => [row.date, row.cost.totalKnownCostMad, row.cost.marginComplete]),
  [["2026-08-01", 45, true], ["2026-08-02", 0, false]],
);
```

- [ ] **Step 2: Run the grouping test and verify failure**

Run: `npm exec -- tsx --test tests/daily-observation-sources.test.ts`

Expected: FAIL because the three exports are missing.

- [ ] **Step 3: Add the pure per-date FIFO summarizer**

In `financial-ledger.ts`, add dated input types and return a date-sorted array:

```ts
export type DailyRealizedMaterialCost = {
  date: string;
  cost: RealizedMaterialCost;
};

export function summarizeRealizedMaterialCostsByDate(input: {
  movements: readonly {
    id: string; date: string; quantity: number;
    valuationMethod: ValuationMethod; totalCostMad: number | null;
  }[];
  reversedMovementIds: ReadonlySet<string>;
  adjustments: readonly { date: string; amountMad: number }[];
}): DailyRealizedMaterialCost[];
```

Call the existing `summarizeRealizedMaterialCost` once per populated date; do not duplicate valuation rules.

- [ ] **Step 4: Refactor the bounded database loader once, preserving aggregate output**

Extract one internal `loadRealizedMaterialInputs(startDate, endDate)` in `paid-order-lines.ts`. Both `fetchRealizedMaterialCost` and the new per-date export use that one batch. Keep the existing public function's return value byte-for-byte equal on its current tests.

```ts
export async function fetchRealizedMaterialCostsByDate(
  startDate: string,
  endDate: string,
): Promise<DailyRealizedMaterialCost[]>;
```

Reject an invalid or greater-than-62-day range before querying.

- [ ] **Step 5: Add daily revenue grouping without changing current callers**

Expand the existing paid-order select only with fields required for order source and basket computation. Preserve `sumCaInRange`, `getWeekCa`, `getMonthlyVentesByMonth` and current eligibility behavior.

```ts
export type DailyRevenueObservation = {
  date: string;
  revenueMad: number;
  orderCount: number | null;
  counterRevenueMad: number | null;
  counterOrderCount: number | null;
  glovoRevenueMad: number | null;
  glovoOrderCount: number | null;
  source: "historical_daily_revenue" | "paid_orders";
};
```

Return only dates explicitly represented by historical rows or eligible paid orders. Do not invent zero for an absent open day.
Reject an invalid or greater-than-62-day range before querying, using the same date-range guard as realized material cost.

- [ ] **Step 6: Run focused and existing financial tests**

Run: `npm exec -- tsx --test tests/daily-observation-sources.test.ts tests/valuation-coverage.test.ts tests/pnl-financial-summary.test.ts tests/dashboard-revenue-order-eligibility.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the bounded data sources**

```bash
git add src/lib/dashboard/revenue-sources.ts src/lib/pnl/financial-ledger.ts src/lib/pnl/paid-order-lines.ts tests/daily-observation-sources.test.ts
git commit -m "feat: expose bounded daily observation data"
```

## Task 3: Build the pure July–August comparison engine

**Files:**
- Create: `src/lib/dashboard/external-observation.ts`
- Test: `tests/external-observation.test.ts`

**Interfaces:**
- Consumes: daily revenue/material rows, closed dates, rest day, `MonthlyPLRow[]`, and optional verified Data Hub payload.
- Produces: `buildExternalObservation(input): ExternalObservationViewModel`.

- [ ] **Step 1: Write failing calendar and quality tests**

Cover:

- reference fixed at `2026-07-01..2026-07-31`;
- observation fixed at `2026-08-01..min(asOf, 2026-08-31)` in Casablanca;
- closed/rest days excluded from expected open days;
- July weekday means weighted by the weekday composition of valid August days;
- raw and normalized totals both retained;
- July and August coverage both affect quality;
- missing July weekday makes that metric non-exploitable;
- ratios are rebuilt from total numerators/denominators, not averaged percentages;
- a zero required denominator returns `null` and degrades that metric instead of producing `Infinity` or `NaN`;
- 90 % plus 14 days is reliable, 70 % plus 7 days is watch, otherwise unusable;
- monthly charges/payroll/result are shown but never projected;
- no aligned external period produces watch and no correlation;
- an external integrity failure preserves valid internal metrics but makes the overall status non-exploitable;
- November 2024 HCP data is stale on 2026-08-27;
- projection is absent below seven valid days and labelled descriptive otherwise.

```ts
assert.equal(result.window.reference.start, "2026-07-01");
assert.equal(result.window.observed.end, "2026-08-27");
assert.equal(result.external.alignment, "not_aligned");
assert.equal(result.overallStatus, "a_surveiller");
assert.equal(result.decisionScope, "observation_only");
```

- [ ] **Step 2: Run the engine test and verify failure**

Run: `npm exec -- tsx --test tests/external-observation.test.ts`

Expected: FAIL because `buildExternalObservation` is missing.

- [ ] **Step 3: Define narrow domain types**

```ts
export type ObservationQuality = "fiable" | "a_surveiller" | "non_exploitable";

export type MetricComparison = {
  metric: "revenue" | "orders" | "basket" | "material_cost" | "food_cost";
  julyRaw: number | null;
  augustRaw: number | null;
  julyNormalized: number | null;
  changePct: number | null;
  julyCoveragePct: number;
  augustCoveragePct: number;
  validAugustDays: number;
  quality: ObservationQuality;
  projection: null | {
    central: number;
    lower: number;
    upper: number;
    intervalKind: "descriptive_not_probabilistic";
  };
};
```

`ExternalObservationViewModel` contains window, metrics, monthly booking state, external summary, separate internal/external statuses, overall status, warnings and `decisionScope: "observation_only"`.

- [ ] **Step 4: Implement weekday normalization and coverage**

For each metric, calculate July means by Casablanca weekday. Build the July normalized comparator by summing the July weekday mean for every valid August date of that weekday. Coverage is valid open days divided by expected open days separately for July and August; use the lower ratio for thresholds.

For food cost, sum material cost and revenue across admitted days, then divide. Never average daily percentages.

- [ ] **Step 5: Implement the descriptive month-end range**

For additive daily metrics with at least seven valid August days:

1. add observed August values;
2. forecast each remaining open day from the August mean for the same weekday, falling back to the overall August mean only when that weekday has no sample;
3. calculate sample standard deviation of residuals around weekday means;
4. set uncertainty to `standardDeviation * sqrt(remainingOpenDays)`;
5. clamp lower bound at zero.

The range is descriptive, not P10/P50/P90. Do not project charges, payroll, result or ratios.

- [ ] **Step 6: Implement external freshness and alignment**

Calculate current age from each latest `period_end` to `asOfDate`, using source warning/expiry thresholds. Alignment is `aligned` only when an observation period intersects July or August 2026. Do not calculate correlation when unaligned. Preserve all five profile categories for Tétouan, Al Hoceima and national context.

- [ ] **Step 7: Run the engine tests**

Run: `npm exec -- tsx --test tests/external-observation.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the pure engine**

```bash
git add src/lib/dashboard/external-observation.ts tests/external-observation.test.ts
git commit -m "feat: compare July and August operations"
```

## Task 4: Orchestrate authorized reads without blocking the dashboard

**Files:**
- Create: `src/lib/dashboard/load-external-observation.ts`
- Modify: `src/app/(app)/page.tsx`
- Test: `tests/dashboard-external-observation-integration.test.ts`

**Interfaces:**
- Consumes: `getDailyRevenueInRange`, `fetchRealizedMaterialCostsByDate`, `fetchPaidOrderLines`, `buildReplacementCostPerPortionMap`, `getClosedDaysInRange`, `getRestDayOfWeek`, `getDataHubConsumerContext`, `buildExternalObservation`, and the already loaded `data.monthlyPL`.
- Produces: `getDashboardExternalObservation(input): Promise<ExternalObservationViewModel | null>`.

- [ ] **Step 1: Write failing integration-source tests**

The tests inspect the source and pure orchestration seams. Assert:

- `page.tsx` calls observation only when `dashboardMode` is patron/admin and the exact enable flag is true;
- disabled mode does not invoke `getDataHubConsumerContext`;
- already loaded `data.monthlyPL` is passed in, so no second P&L query occurs;
- external fetch and internal bounded reads are independent;
- an external failure still returns internal results with `external.status="unavailable"`;
- no import is added to `business-trajectory.ts` or `decision-actions.ts`;
- no Supabase insert/update/delete/upsert/rpc appears in the new loader.

- [ ] **Step 2: Run the integration test and verify failure**

Run: `npm exec -- tsx --test tests/dashboard-external-observation-integration.test.ts`

Expected: FAIL because the server-only loader and page wiring are absent.

- [ ] **Step 3: Implement the bounded server orchestration**

Start the file with `import "server-only"`; do not expose it as a callable Server Action. Require dashboard read permission. Validate the fixed start `2026-07-01`, cap the end at `2026-08-31`, and reject more than 62 days.

```ts
export async function getDashboardExternalObservation(input: {
  asOfDate: string;
  monthlyPL: readonly MonthlyPLRow[];
}): Promise<ExternalObservationViewModel>;
```

Load daily revenue, daily realized cost, paid order lines, replacement costs, closures, rest day and Data Hub context with bounded parallelism. Group theoretical recipe cost by date in memory. Do not make a query inside a date loop.

Catch Data Hub errors into an external unavailable union. Let permission errors propagate; convert other observation-specific failures into a safe internal non-exploitable model rather than crashing the page.

- [ ] **Step 4: Wire the page after existing dashboard data is loaded**

Keep the existing initial `Promise.all`, trajectory build and decision build unchanged. After `data` and `dashboardMode` exist, call the new loader only under `isDataHubObservationEnabled(process.env)` and the role gate. Pass the result as a new optional `externalObservation` prop.

```ts
const externalObservation =
  dashboardMode && isDataHubObservationEnabled(process.env)
    ? await getDashboardExternalObservation({
        asOfDate: todayIsoCasablanca(),
        monthlyPL: data.monthlyPL,
      })
    : null;
```

- [ ] **Step 5: Run focused tests and existing trajectory tests**

Run: `npm exec -- tsx --test tests/dashboard-external-observation-integration.test.ts tests/business-trajectory.test.ts tests/dashboard-decision-actions.test.ts`

Expected: PASS with all existing trajectory data still reporting `externalSignals: "not_connected"`.

- [ ] **Step 6: Commit orchestration**

```bash
git add src/lib/dashboard/load-external-observation.ts 'src/app/(app)/page.tsx' tests/dashboard-external-observation-integration.test.ts
git commit -m "feat: orchestrate dashboard observation"
```

## Task 5: Render the additive patron/admin card

**Files:**
- Create: `src/components/dashboard/external-observation-card.tsx`
- Modify: `src/components/dashboard/dashboard-panel.tsx`
- Test: `tests/external-observation-card.test.ts`

**Interfaces:**
- Consumes: `ExternalObservationViewModel | null`.
- Produces: `ExternalObservationCard` and one optional `DashboardPanel` prop.

- [ ] **Step 1: Write failing server-render tests**

Cover available/watch/unavailable/internal-insufficient states. Assert the exact safety copy and absence of forms, mutation controls and causal claims.

```ts
assert.match(html, /Contexte externe — phase d’observation/);
assert.match(html, /Aucune décision automatique/);
assert.match(html, /Données HCP les plus récentes : novembre 2024/);
assert.match(html, /période non alignée sur juillet–août 2026/);
assert.doesNotMatch(html, /<form|Acheter|Modifier le prix|Réduire la portion/);
```

- [ ] **Step 2: Run the card test and verify failure**

Run: `npm exec -- tsx --test tests/external-observation-card.test.ts`

Expected: FAIL because the component is missing.

- [ ] **Step 3: Implement one focused responsive card**

Use existing `Card`, `Badge`, `formatMad` and `formatPct`. Show:

- as-of date and July/August windows;
- revenue and food-cost comparisons with raw/normalized labels;
- both coverage percentages and valuation completeness;
- projected August central/lower/upper only when present, labelled descriptive;
- five external categories with Tétouan, Al Hoceima and national values;
- source period and stale/alignment warnings;
- fixed observation-only disclaimer.

Do not add charts, tabs, buttons or a dashboard refactor in this lot.

- [ ] **Step 4: Place the card after the existing decision cockpit**

Add `externalObservation?: ExternalObservationViewModel | null` to `DashboardPanelProps`, default it to `null`, and render the card immediately after `dashboard-decision-cockpit`. Do not change the order or layout of current cockpit children.

- [ ] **Step 5: Run card, cockpit and responsive tests**

Run: `npm exec -- tsx --test tests/external-observation-card.test.ts tests/dashboard-decision-cockpit.test.ts tests/dashboard-charts-responsive.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the UI**

```bash
git add src/components/dashboard/external-observation-card.tsx src/components/dashboard/dashboard-panel.tsx tests/external-observation-card.test.ts
git commit -m "feat: show external observation card"
```

## Task 6: Document configuration and complete local verification

**Files:**
- Modify: `.env.example`
- Create: `docs/operations/data-hub-observation.md`
- Review: all files changed in Tasks 1–5

**Interfaces:**
- Consumes: completed ERP observation code.
- Produces: safe operator instructions and a clean reviewable branch.

- [ ] **Step 1: Document the non-secret variables**

Add:

```dotenv
# Disabled unless the exact value is true.
DATA_HUB_OBSERVATION_ENABLED=false
# Required in preview to pin the approved consumer-v1 pre-release.
DATA_HUB_CONSUMER_RELEASE_TAG=
```

The operations guide must explain disabled, pinned preview, stable discovery, cache expiry, external unavailable behavior, stale November 2024 source interpretation, rollback by disabling the flag and the prohibition on production changes without approval.

- [ ] **Step 2: Run tiered validation**

Run focused tests first, then:

```bash
npm test
npm run lint
npm run typecheck
npm run build
git diff --check origin/main...HEAD
```

Expected: all commands exit 0. Record test counts and build SHA; do not paste secrets or full environment output.

- [ ] **Step 3: Prove the anti-regression boundary**

Run `git diff --name-only origin/main...HEAD` and verify:

- no Supabase migration or SQL file changed;
- `src/lib/forecast/business-trajectory.ts` did not change;
- `src/lib/dashboard/decision-actions.ts` did not change;
- no production configuration file or generated dataset is tracked;
- disabling the flag yields zero fake-fetch calls and no observation-card markup;
- all existing business trajectory and decision tests pass.

- [ ] **Step 4: Commit documentation**

```bash
git add .env.example docs/operations/data-hub-observation.md
git commit -m "docs: operate Data Hub observation safely"
```

- [ ] **Step 5: Push and open a draft PR if GitHub writing remains authorized**

Push without force to `qc93170-a11y/ERP-SNACK` using its scoped GitHub account/token, without changing the global active account. Open or update one draft PR. State the exact base SHA, test evidence, no migration, flag default off, no production deployment and dependency on the approved Data Hub candidate tag.

- [ ] **Step 6: STOP before preview environment changes**

Do not modify Vercel environment variables, redeploy a preview, connect to production Supabase for July/August observation, merge or deploy production. Report branch SHA, PR, CI and the exact gates still pending.

## Task 7: Preview observation after explicit authorization

**Files:**
- No source edit expected unless preview reveals a reproducible defect.

**Interfaces:**
- Consumes: verified Data Hub pre-release tag, green ERP PR SHA and existing preview deployment.
- Produces: read-only July/August observation evidence, never a production mutation.

- [ ] **Step 1: Confirm authority and exact accounts**

Require a fresh explicit instruction to modify preview configuration and read production ERP data. Reconfirm the ERP Vercel scope, ERP GitHub account, Supabase project, PR SHA, candidate release tag and that no other task owns the preview.

- [ ] **Step 2: Configure preview only**

Set `DATA_HUB_OBSERVATION_ENABLED=true` and the exact `DATA_HUB_CONSUMER_RELEASE_TAG` for Preview only. Do not change Production variables or aliases. Redeploy only the PR preview SHA if required.

- [ ] **Step 3: Verify system state before visual testing**

Use GitHub/Vercel APIs or CLIs first to prove preview SHA and successful deployment. Confirm read-only Supabase access and no migration drift operation. Do not run `db push`, migration repair or any write query.

- [ ] **Step 4: Observe July and August read-only**

Collect only aggregate outputs already returned by the new view-model: as-of date, expected/valid days, coverage, CA, cost, food-cost ratio, projection range, external period and statuses. Do not export customer/order/furnisher row data into logs or the Data Hub.

- [ ] **Step 5: Perform one focused UI proof**

Use existing automated/headless tests first. If a signed-in graphical proof is still necessary, open only the dashboard preview, confirm patron/admin rendering, responsive layout, stale November 2024 warning and absence for unauthorized roles, then stop the browser interaction.

- [ ] **Step 6: Produce the observation report**

Separate:

- internal July/August facts;
- internal coverage limitations;
- external HCP context and real period;
- descriptive August projection;
- unavailable causal conclusions;
- defects requiring code correction.

Do not recommend production activation when overall status is `non_exploitable`. If a defect is found, return to a local test-first fix and repeat full validation; do not patch production.

- [ ] **Step 7: STOP for stable-release and production decisions**

Report the preview deployment ID/SHA, candidate Data Hub tag/SHA, observation statuses and any code defect. Ask separately whether to publish the consumer release stable and whether to merge/deploy ERP; neither is implied by successful preview.

## Task 8: Controlled production release after two explicit approvals

**Files:**
- No unreviewed source edit allowed.

**Interfaces:**
- Consumes: approved stable Data Hub release, approved ERP PR, green CI/preview and observation report.
- Produces: an optional ERP production deployment with the feature still disabled, followed by a separately approved activation.

- [ ] **Step 1: Publish or promote the stable consumer release only when authorized**

Verify the three assets anonymously and record tag, release ID, payload SHA, source snapshot and workflow run. Do not set automatic publication variable unless the user separately authorizes continuous stable updates.

- [ ] **Step 2: Merge and deploy ERP only when authorized**

Re-run tests against the final merge candidate, merge without rewriting history, deploy the exact merge SHA and verify production alias/health. Keep `DATA_HUB_OBSERVATION_ENABLED=false`.

- [ ] **Step 3: Prove zero-regression production state**

Verify login redirect, dashboard availability, existing trajectory/decision behavior and flag-off zero Data Hub calls through logs or controlled instrumentation that exposes no private data.

- [ ] **Step 4: Activate the production flag only when separately authorized**

Set the stable release tag or enable stable discovery, set the exact flag to true and redeploy the same reviewed SHA. Run one patron/admin smoke and one unauthorized-role absence check. Roll back immediately by setting the flag false if the card delays or breaks the dashboard.

- [ ] **Step 5: Report final evidence**

Distinguish Data Hub release, ERP merge, CI, preview, production deployment and flag activation. Include exact SHAs/IDs, data freshness, internal coverage and the reminder that HCP remains macro context and the 2030 model is unchanged.
