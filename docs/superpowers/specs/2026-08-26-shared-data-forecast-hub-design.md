# Shared Data Forecast Hub — Architecture Design

Status: approved in chat on 2026-08-26 for specification. Implementation still requires review of this written specification.

## 1. Purpose

Build one reliable data foundation that can serve ERP-Snack first, then CasaNext, TournAxis, NSOGO and future projects without duplicating source ingestion or forecasting logic inside each application.

The hub must answer four separate questions:

1. What did an official or internal source publish, exactly and when?
2. Can the published artifact and its observations be trusted for a defined use?
3. Which immutable dataset version was used by a consumer or forecast?
4. What decision support can be produced without presenting an uncertain scenario as a fact?

The first implementation lot is deliberately limited to provenance, ingestion, quality control, quarantine and deterministic publication. It does not build a forecasting service or modify any consumer application.

## 2. Canonical repository and ownership

The canonical local repository is:

`/Users/mob/Documents/ChatGPT/Module data`

The empty repository `/Users/mob/Documents/ChatGPT/Module Data Prévision` remains untouched. No runtime or data file is shared implicitly between the two directories.

The hub is an independent product. ERP-Snack, CasaNext, TournAxis and NSOGO consume versioned contracts; none of them owns the hub's source ingestion.

CasaNext and TournAxis share the `construction_industry` data domain because their economic drivers overlap. They remain distinct consumers so permissions, mappings and decisions can differ without duplicating the underlying series.

## 3. Scope

### 3.1 First implementation lot

- Strict TypeScript repository using npm workspaces, without Nx or Turborepo.
- Versioned domain contracts and runtime validation.
- Source registry containing provenance, licence, access mode, geography, frequency and freshness policy.
- Generic CKAN discovery and download connector.
- HCP IPC base-2017 monthly and IPP base-2018 monthly source definitions based on the Moroccan Open Data CKAN API.
- Immutable raw-artifact archive with SHA-256 content addressing.
- Deterministic XLSX parsing for the selected HCP series, with explicit input limits.
- Canonical observation production in JSON Lines format.
- Quality gates, warnings and quarantine.
- Dataset version manifests and reproducible publication.
- Offline fixtures, unit tests, contract tests and an opt-in live smoke check.
- Operator documentation for automated and manual imports.

### 3.2 Explicitly excluded from the first lot

- Remote Supabase project, migration or Storage write.
- GitHub repository creation, scheduled workflow or secret creation.
- Vercel service or public API deployment.
- Changes in ERP-Snack, CasaNext, TournAxis or NSOGO.
- ONP scraping, ASAA scraping or undocumented endpoint reverse engineering.
- Forecasting, machine learning, automated purchasing or automatic business mutations.
- Large historical binaries or generated datasets committed to Git.

These exclusions make the first lot independently verifiable and prevent infrastructure decisions from hiding data-quality defects.

## 4. Architectural alternatives

### 4.1 Selected: independent headless Data Hub

One repository owns source connectors, validation, immutable evidence and canonical datasets. Consumers use adapters and never query suppliers directly.

Benefits:

- one source of truth and one revision history;
- source failures are isolated from consumer applications;
- shared construction/industrial signals are ingested once;
- provenance and licensing can be audited centrally;
- storage and scheduling can move from local to cloud without changing observation contracts.

### 4.2 Rejected: embed the module in ERP-Snack

This would deliver the first snack use case faster, but would make unrelated projects depend on ERP-specific releases, permissions and schema decisions.

### 4.3 Rejected: collection of scripts and spreadsheets

This would be inexpensive initially but would not provide idempotence, quarantine, revisions, consumer isolation or proof of which data powered a decision.

## 5. Logical architecture

```text
Official source or controlled manual file
                    |
                    v
             Source connector
                    |
                    v
       Immutable raw artifact + manifest
                    |
                    v
              Format parser
                    |
                    v
          Canonical observation rows
                    |
                    v
      Quality gates -----> Quarantine record
                    |
                    v
        Versioned published dataset
                    |
                    v
             Consumer adapter
```

Each layer has one responsibility and communicates through a versioned contract. A connector cannot publish. A parser cannot suppress a failed quality gate. A consumer cannot read raw supplier files as if they were canonical data.

## 6. Repository structure

The intended structure is:

```text
apps/
  ingest-cli/          One-shot operator and scheduler entry point
packages/
  contracts/           Versioned types and runtime schemas
  source-registry/     Qualified suppliers and freshness policies
  artifact-store/      Content-addressed local storage interface
  connectors/          CKAN and later supplier-specific connectors
  parsers/             Bounded XLSX and later CSV/PDF parsers
  quality/             Pure validation and quarantine decisions
  canonical/           Observation mapping and dataset manifests
  adapters/            Consumer contracts; empty until a consumer lot
tests/
  fixtures/            Small, licensed, non-sensitive test artifacts
docs/
  operations/          Import, recovery and source qualification guides
```

Workspace packages remain small and dependency-directed. `contracts` imports no other workspace package; connectors depend on contracts but not on consumers; adapters depend only on published contracts.

## 7. Core contracts

All contracts carry a `schema_version`. Unknown major versions fail closed.

### 7.1 SourceDefinition

Required fields:

- `source_id`: stable technical identifier;
- `publisher_name` and official base URL;
- `authority_level`: `official`, `licensed`, `internal`, or `candidate`;
- `access_mode`: `api`, `download`, `manual`, or `disabled`;
- licence identifier and evidence URL;
- expected publication frequency and normal publication lag;
- polling interval, warning age and expiry age;
- supported series, geography and units;
- connector identifier and parser identifier;
- redistribution and derived-use policy;
- owner and manual recovery procedure.

A candidate or disabled source cannot publish canonical observations.

### 7.2 IngestionRun

One run records:

- source and connector versions;
- start/end timestamps and terminal state;
- request target without credentials;
- HTTP status and safe response metadata;
- artifact checksum or explicit no-change result;
- counts for parsed, accepted, warned and quarantined rows;
- structured failure code and retry eligibility.

Terminal states are `no_change`, `published`, `quarantined`, `failed_retryable` and `failed_terminal`.

### 7.3 RawArtifact

A raw artifact is immutable and addressed by its SHA-256 digest. Its manifest records:

- source ID, original URL and retrieval time;
- HTTP `ETag` and `Last-Modified` when provided;
- content type, byte length and original filename;
- SHA-256 digest;
- parser contract expected for the artifact;
- source licence snapshot;
- optional source publication period;
- predecessor digest when the supplier revised a file.

Identical content is stored once even if polled repeatedly. A changed file creates a new artifact; it never overwrites the old one.

### 7.4 CanonicalObservation

An observation contains:

- deterministic observation ID;
- stable series key and source series label;
- period start/end and frequency;
- numeric value represented without binary-money drift;
- unit, currency and scaling factor;
- geography type and stable location key;
- product or indicator key when applicable;
- source ID, raw checksum and source row coordinates;
- retrieval/publication timestamps;
- quality status and warning codes;
- revision number and optional superseded observation ID.

The natural series-period-location key identifies revisions. The raw checksum and row coordinates identify the exact evidence.

### 7.5 QualityReport

The report contains every gate result, not only a final score. Status is:

- `accepted`: all mandatory gates pass and no material warning exists;
- `accepted_with_warning`: mandatory gates pass but freshness or non-critical coverage warnings exist;
- `quarantined`: at least one mandatory gate fails.

No numeric score can override a failed mandatory gate.

### 7.6 DatasetVersion

A version manifest records schema version, creation time, ordered input artifact hashes, canonical row checksum, row count, coverage bounds, series/location counts, warning counts and the exact tool versions used.

The dataset version ID is derived from canonical manifest content, so the same inputs and code produce the same ID.

## 8. Data lifecycle and idempotence

1. Discover supplier metadata.
2. Compare remote metadata with the last run, without trusting metadata as proof of equality.
3. Download within source-specific byte and time limits when change is possible.
4. Compute SHA-256 before parsing.
5. Return `no_change` when the content digest already exists.
6. Archive the artifact and manifest atomically.
7. Parse through a bounded, source-specific parser.
8. Normalize without silently inventing units, locations or missing periods.
9. Run quality gates.
10. Quarantine the whole artifact or the affected rows according to the declared source policy.
11. Publish a deterministic dataset version only after mandatory gates pass.

Interrupted runs leave no published partial dataset. Re-running the same artifact is safe and produces the same output.

Official revisions are append-only. The currently recommended observation is selected by an explicit revision rule while earlier values remain auditable.

## 9. Quality gates

Mandatory gates for the first lot:

- source is qualified and enabled;
- licence permits the intended internal reuse;
- transport succeeded and redirect targets remain allowlisted;
- byte length and MIME/signature match declared limits;
- workbook structure matches the source contract;
- all required columns and period labels are recognized;
- numeric values, scaling, units and base year are explicit;
- periods are valid and do not overlap unexpectedly;
- location/product keys resolve unambiguously;
- duplicate natural keys agree or are represented as revisions;
- row and series counts are within configured structural bounds;
- output contains no `NaN`, infinity or silently coerced value;
- canonical serialization and checksum are reproducible.

Warning gates include late publication, missing optional geography, a newly observed category, coverage shrinkage and a suspicious but still valid value change.

Cross-source disagreement is evidence for review, not permission to replace an official value automatically.

## 10. Source qualification and cadence

Polling frequency is distinct from publication frequency. A weekly poll does not pretend that a monthly series is weekly data.

| Source | Initial status | Access | Publication/use policy | First scheduling policy |
|---|---|---|---|---|
| Moroccan Open Data / HCP IPC and IPP | qualified official | CKAN API metadata plus XLSX | ODbL evidence stored with every artifact | weekly poll; publish only on checksum change |
| ONP | official, connector not qualified | official reports/manual file | no undocumented API or fragile production scraping | monthly controlled import after format review |
| Bank Al-Maghrib | official, later lot | downloads/publication calendar | source-specific daily, monthly or quarterly series | disabled in lot 1 |
| Office des Changes | official, later lot | visitor extraction/CSV | monthly trade series since 1998 | disabled in lot 1 |
| World Bank Pink Sheet | official international, later lot | monthly XLSX | macro proxy, not local purchase quote | disabled in lot 1 |
| Copernicus ERA5 | official international, credentials required | CDS API | historical weather feature, never current supplier price | disabled in lot 1 |
| LME | licensed | paid historical service | no scraping, redistribution or derived use without licence | disabled until licence recorded |
| ASAA and ONICL feeds | candidate/manual | unqualified | cannot publish automatically until official stable access and licence are proven | manual quarantine-only intake |
| ERP project data | confidential internal, later lot | consumer-specific export | tenant-isolated; never mixed into public macro datasets | disabled in lot 1 |

Every source has a health status: `healthy`, `late`, `stale`, `schema_changed`, `quarantined`, `disabled` or `licence_blocked`.

## 11. Manual import policy

Manual files are expected for sources without a stable public interface. Manual does not mean untracked.

An import requires the selected source definition, original file, claimed publication period and operator identity. The CLI computes the digest, records the evidence, validates the format and produces the same run/quality contracts as an automated connector.

The system never accepts an edited spreadsheet as an official artifact unless the edit is explicitly classified as an internal derived dataset with its own provenance.

Suggested operator review frequency:

- daily source: review within two business days after the warning age;
- weekly source: review weekly;
- monthly source: review five business days after expected publication;
- quarterly source: review ten business days after expected publication;
- annual/manual source: review against the publisher's release calendar.

## 12. Local storage in lot 1

Generated data lives under a Git-ignored runtime directory, never in source control:

```text
.data-hub/
  raw/<source-id>/<sha256>/artifact
  manifests/artifacts/<sha256>.json
  runs/<run-id>.json
  quarantine/<run-id>/
  published/<dataset-id>/observations.jsonl
  published/<dataset-id>/manifest.json
```

Writes use a temporary file in the same target filesystem, followed by checksum verification and atomic rename. A run cannot replace an existing digest with different bytes.

This storage interface is intentionally replaceable. A later infrastructure lot will map raw artifacts to private object storage and metadata/canonical rows to PostgreSQL without changing source, observation or dataset contracts.

Local data is execution evidence, not the long-term production backup. Production scheduling cannot begin until durable remote storage, backup and recovery are approved and validated.

## 13. Security, privacy and licensing

- Connectors use an explicit hostname allowlist and bounded redirects.
- Logs and manifests never contain credentials, cookies or authorization headers.
- Downloads have byte, duration and decompression limits.
- XLSX content is treated as untrusted input; macros, external links and formulas are never executed.
- Formula cells are accepted only when a cached scalar is present and the source contract permits them; otherwise they are quarantined.
- Test fixtures contain no confidential ERP data.
- Public macro series and confidential tenant data use different namespaces and publication policies.
- Each consumer receives only the series granted to its project scope.
- A licence-blocked source cannot be enabled by configuration alone; licence evidence and intended use must be reviewed.

## 14. Consumer boundaries

The hub will eventually expose three kinds of output:

1. Public/official market series such as inflation, production indices, exchange and commodity proxies.
2. Tenant-confidential internal series such as actual purchase prices, recipes, sales and margins.
3. Derived forecasts and recommendations tied to exact dataset and model versions.

ERP-Snack will be the first consumer adapter, but it will be implemented in a separate lot. The adapter will map hub series to existing ingredient/location identifiers and feed server-side decision logic without exposing confidential margins to unauthorized roles.

CasaNext and TournAxis will reuse the same construction/industry series, including HCP production indices, exchange, energy and licensed or proxy metal data. Project-specific mappings and alerts remain separate.

NSOGO and future projects consume only the smallest relevant series set. No consumer receives a general-purpose database credential.

## 15. Forecasting boundary

Forecasting starts only after the relevant series pass coverage, freshness and backtesting prerequisites.

Every future forecast must record:

- input dataset versions;
- model and feature versions;
- training window and excluded observations;
- forecast origin, horizon and geography;
- backtest metrics against declared baselines;
- uncertainty method and calibration evidence;
- known missing external signals.

P10/P50/P90 labels are used only when probabilistic intervals are empirically calibrated. Otherwise outputs are named prudent, central and favorable scenarios.

A long-term business trajectory is decision support, not a declaration of certain growth or bankruptcy. Insolvency cannot be assessed without cash, debt, maturity and financing data. Recommendations remain advisory and require human approval before price, recipe, quantity, menu or purchasing changes.

## 16. Failure handling and operations

- Retry only transport and explicitly transient supplier failures.
- Do not retry invalid schemas or licence failures automatically.
- Preserve the failed run and safe error code.
- Keep the last published valid dataset available when a new artifact is quarantined.
- Mark its health as stale once the configured expiry age is exceeded.
- Never silently fall back from an official source to an unrelated third party.
- Recovery reruns the same immutable artifact or fetches a newly published revision; it never edits a published dataset in place.

No daemon is required in lot 1. The CLI performs one bounded run and exits. This allows later scheduling through an approved CI or serverless mechanism without duplicating ingestion logic.

## 17. Testing strategy

Normal tests are offline and deterministic.

Required tests:

- contract version acceptance and rejection;
- identical content idempotence;
- changed supplier content creates a revision;
- malformed or oversized workbook quarantine;
- missing/renamed columns quarantine;
- unit, base-year and period validation;
- duplicate and conflicting observation handling;
- deterministic canonical IDs and dataset checksum;
- atomic publication and interrupted-run recovery;
- no credentials in structured logs/manifests;
- golden fixture mapping for the selected HCP IPC/IPP workbooks;
- consumer packages cannot import connector internals.

An opt-in live smoke test verifies only source reachability, metadata shape and bounded artifact headers. It does not make the standard test suite depend on the network and does not publish data.

## 18. First-lot acceptance criteria

The first lot is complete only when:

1. A fresh checkout installs with the repository lockfile and no global dependency.
2. Unit and contract tests pass without network access.
3. The opt-in CKAN smoke check reports safe metadata or an explicit supplier failure.
4. A qualified HCP artifact is archived with a verified SHA-256 manifest.
5. Re-running identical content returns `no_change`.
6. A valid fixture produces deterministic canonical observations and a dataset manifest.
7. Corrupt, ambiguous or structurally changed fixtures are quarantined and cannot publish.
8. No runtime artifacts, large binaries, credentials or confidential records are tracked by Git.
9. Lint, strict TypeScript, tests, build, diff and secret hygiene checks pass.
10. Operator documentation explains automated polling, manual import, quarantine review and recovery.

No production claim is allowed from these criteria alone. Production additionally requires durable storage, secrets, scheduler, backup, monitoring, consumer authentication and an explicitly authorized release.

## 19. Delivery sequence after lot 1

### Lot 2 — Durable hub infrastructure

Approve and provision dedicated storage, PostgreSQL metadata/canonical schema, backups, tenant isolation, scheduler, source-health monitoring and service authentication. Migrate local artifacts forward without rewriting their checksums.

### Lot 3 — ERP-Snack adapter

Map products and locations, ingest confidential actual purchase signals, connect approved market/weather series, backtest price forecasts and expose advisory alerts through the existing role-safe ERP contracts.

### Lot 4 — Construction/industry adapter

Serve CasaNext and TournAxis from one shared domain pipeline for HCP indices, exchange, energy, construction activity and legally usable metal series.

### Lot 5 — NSOGO and future adapters

Add only justified sources and project mappings, preserving tenant isolation and the same evidence contracts.

Each lot receives its own design/release gate when it introduces infrastructure, remote data, financial decisions or production deployment.

## 20. Fixed design decisions

- `Module data` is the canonical repository; the similarly named duplicate remains untouched.
- The hub is independent from every consumer repository.
- Data reliability precedes forecasting.
- Raw artifacts and revisions are immutable.
- Supplier metadata is advisory; content checksum is authoritative for equality.
- Quarantine is fail-closed.
- No undocumented scraping or unlicensed market data.
- Normal tests do not require network access.
- Lot 1 uses bounded one-shot execution and local replaceable storage.
- No remote write, migration, GitHub creation or production deployment is implicit.

## Appendix A — Source evidence reviewed for this design

The following evidence was checked on 2026-08-25. It qualifies an integration candidate; it does not guarantee that a supplier will preserve its interface or publication calendar.

- Moroccan Open Data API guide: `https://data.gov.ma/fr/guide-api`
- CKAN API root used for discovery: `https://data.gov.ma/data/api/3/action/`
- HCP IPC base-2017 monthly dataset ID observed through CKAN: `0ebb73ec-1f04-4854-b73e-a7868b0b18b0`
- HCP IPC base-2006 annual dataset ID retained as a possible legacy reference: `42376bb7-ca7d-4924-92ec-7bd39babec00`
- HCP IPP base-2018 dataset ID observed through CKAN: `59a68619-4bd8-4086-8bea-5a0e4757b4d8`
- Official ONP site: `https://onp.ma/`
- Bank Al-Maghrib statistics site: `https://www.bkam.ma/Statistiques/`
- Office des Changes foreign-trade database: `https://www.oc.gov.ma/fr/e-services/base-de-donnees-du-commerce-exterieur`
- World Bank Commodity Price Data: `https://thedocs.worldbank.org/en/doc/18675f1d1639c7a34d463f59263ba0a2-0050012025/worldbank-commodities-price-data-the-pink-sheet`
- Copernicus Climate Data Store API: `https://cds.climate.copernicus.eu/en/how-to-api`
- LME historical-data terms: `https://www.lme.com/Market-data/Accessing-market-data/Historical-data`

The live CKAN audit returned public XLSX resources for the selected HCP datasets. The IPC base-2017 workbook declares monthly periodicity and exposes national/city product groups; the IPP base-2018 workbook also declares monthly periodicity. Resource hash metadata was empty, and dataset modification time did not always prove that the underlying resource changed. Therefore the design treats supplier metadata as a discovery hint and locally computed SHA-256 as the equality proof.

No documented public ONP API, stable ASAA feed or stable ONICL feed was qualified during the audit. Their status remains manual, candidate or disabled until official access, licence and schema are verified.
