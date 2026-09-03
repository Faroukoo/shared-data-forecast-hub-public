# ERP-Snack national macro context v3

Status: approved in conversation on 2026-09-03.

## Goal

Replace the unsuitable ERP-Snack public-data profile with a small, explicit contract that reflects the actual business context:

- Snack El JEBHA operates in Casablanca;
- purchasing usually happens in Casablanca, while suppliers and product origins may vary across Morocco;
- public HCP indices are macro context, not supplier prices and not an inferred product origin;
- actual purchase, receipt and invoice records remain the only operational authority for ingredient cost, margin and purchasing alerts.

The change must not rewrite or invalidate existing v1/v2 releases. It adds a parallel v3 candidate path and leaves every activation, promotion and deployment for a separate authorised step.

## Root cause and boundary

The v2 consumer contract hard-codes fifteen tuples: five categories across National, Tetouan and Al Hoceima. Only the national food tuple comes from the recent official HCP workbook; fourteen tuples come from the historical CKAN workbook ending in November 2024. The contract therefore transports locations unrelated to the snack and mixes current national context with stale detailed context.

Hiding two city cards only in the ERP would leave that unsuitable contract intact. The correction belongs at the consumer-profile boundary. The central Data Hub may continue to retain every qualified HCP city and historical series for archives, backtests and other consumers.

## Versioning decision

`erp-snack-observation-v1` and `erp-snack-observation-v2` remain byte- and semantics-compatible. A new family is introduced:

- contract and profile: `erp-snack-observation-v3`;
- payload: `consumer-v3.json`;
- checksum: `consumer-v3.json.sha256`;
- tag: `consumer-v3-YYYYMMDDTHHMMSSZ-<12-hex>`.

The existing v2 prerelease is immutable and remains a historical candidate. It is not overwritten, promoted or silently reinterpreted.

## Exact v3 public contract

The v3 payload contains exactly one source:

```text
hcp-ipc-2017-official-g1-monthly
```

It contains exactly twenty-four closed monthly observations for one canonical tuple:

```ts
{
  series_key: "hcp.ipc2017.01";
  label_fr: "Alimentation";
  category: "food_overall";
  usage: "macro_context_only";
  geography_type: "country";
  location_key: "ma";
  source_id: "hcp-ipc-2017-official-g1-monthly";
  context_role: "fresh_national_context";
  granularity: "division";
}
```

The payload also carries strict consumer context:

```ts
business_context: {
  operating_location_key: "ma:city:casablanca";
  procurement_location_mode: "erp_observed_only";
};
```

`procurement_location_mode` means that supplier market and product origin must come from private ERP purchase/receipt evidence when known. The Data Hub must never infer origin from a supplier address or from the national HCP index.

The existing public-safety literals remain mandatory:

```ts
contains_confidential_data: false;
decision_scope: "observation_only";
usage: "macro_context_only";
```

No correlation, coefficient, forecast, price recommendation, supplier price or automated action is added to v3.

## Projection and fail-closed rules

The v3 builder reads only the verified dataset bound to the official G1 source in the selected immutable snapshot. It validates the registered source definition, redistribution licence, snapshot state, source health and artifact evidence before reading canonical observations.

For the one tuple it:

1. accepts only `accepted` or `accepted_with_warning` canonical rows;
2. resolves the highest revision for each monthly period deterministically;
3. requires at least twenty-four distinct periods;
4. selects the latest twenty-four periods;
5. emits exactly twenty-four sorted observations and exactly one sorted source.

Missing data, an unexpected source/dataset, a licence mismatch, a quarantined snapshot source, an invalid health state, a future period, a duplicate revision or any tuple outside the exact matrix fails closed.

Source freshness continues to be derived from the official published `period_end`, never HTTP metadata. The payload may faithfully carry a late or stale source, but the ERP operational presentation decides whether it is recent enough to show.

## Release workflow

The release workflow accepts `v3` only as an explicit manual `verify` or `publish-prerelease` selection. Automatic runs remain v1. Both v2 and v3 are candidate-only: neither may be promoted by the automatic v1 path.

The workflow continues to create exactly three immutable assets, validates their names and SHA-256 digests, and rejects a tag collision. This implementation does not run the workflow, create a prerelease, promote a release or change production variables.

## ERP consumption contract

ERP-Snack will accept strict v1 and v3 bundles during transition and reject v2. A pinned v1 remains usable until an authorised v3 candidate test. Automatic stable discovery prefers a valid stable v3 when one exists and otherwise falls back to v1; it never discovers prereleases.

At the operational boundary the ERP uses only the latest `food_overall|ma` observation. It displays it only while current under the source warning threshold. Late, stale or expired observations remain hidden from operational cards. HCP context has zero decision weight: it cannot change internal KPI calculations, margin forecasts, alerts or the overall internal quality status.

## Compatibility and rollback

- Existing v1/v2 contracts, assets, tags and releases are unchanged.
- Existing stable data snapshots are unchanged.
- No database, Supabase policy, Vercel setting or production deployment is required.
- Before activation, ERP can continue using its current pinned v1 tag.
- Rollback is configuration-only: keep or restore the prior pinned v1 tag and disable the Data Hub observation flag if necessary.

## Verification

Data Hub tests must prove:

- exact one-source/one-tuple/twenty-four-period v3 schemas;
- deterministic projection from only the official G1 source;
- rejection of city, detailed-category, legacy-source and confidential/decision payload mutations;
- exact v3 bundle filenames and cross-file digest integrity;
- CLI support for exact `v1`, `v2` and `v3`, with v1 still the default;
- workflow v3 manual candidate-only policy and unchanged automatic v1 publication;
- all prior v1/v2 tests remain green.

ERP tests must prove:

- strict v1/v3 verification, exact asset selection and stable v3 preference with v1 fallback;
- pinned v1 and pinned v3 compatibility, while v2 is rejected;
- no Tetouan, Al Hoceima or stale 2024 value reaches the operational view;
- only recent national food context can render;
- internal metrics and status are identical with no HCP, valid HCP and failed HCP context;
- the UI explicitly describes HCP as national macro context and ERP purchases/receipts as the operational authority.

## Out of scope

- publishing or activating a v3 candidate;
- changing the central HCP registry or deleting historical city data;
- adding supplier origin fields or migrating ERP data;
- calibrating a causal forecast or connecting HCP to price/margin alerts;
- changing the wider dashboard layout, POS, stock, accounting or trajectory engine.
