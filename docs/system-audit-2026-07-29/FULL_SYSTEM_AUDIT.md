# H+H Hub Full System Audit

Audit date: July 29, 2026
Production: `https://hh-portal.vercel.app`
Production commit: `98bafa76b76996e0bc2f1201fdf39f94a02acb33`
Method: read-only production database reconciliation, live Google Sheet comparison, production bundle inspection, isolated local runtime checks, public browser workflow measurement, code review, backend tests, lint, build, and dependency audit.

## Resolution record — v2.4.0

This document is the **pre-fix audit snapshot** for production commit `98bafa76`. Its original findings and release-hold language are intentionally preserved below as evidence. The stabilization work was merged through [PR #9](https://github.com/Aaron840588/H-H/pull/9).

| Original finding | v2.4.0 disposition |
|---|---|
| Three public zero-price products | Fixed in frontend, backend, database constraints, and production data; current active non-positive count is zero |
| Generic offline queue retained credentials and unsafe mutations | Fixed; generic replay removed and retired IndexedDB rows sanitized |
| Production missing price history and 18 snapshot columns | Fixed; reviewed migrations applied and migration history reconciled |
| Current-cost historical margin drift | Fixed with immutable reseller, consignment, and Market Event cost snapshots |
| Category precedence classified two sandwiches as spreads | Fixed in code and production categories |
| Zero-return closeout ledger noise | Fixed; zero-quantity return transactions are not created |
| Mobile preorder checkout too deep | Fixed with sticky summary and review bottom sheet |
| Google Sheet integration inactive | Code, sources, mappings, and migrations are ready; service-account credentials and Sheet source corrections still require external setup |
| Recipe, yield, supplier, and packaging gaps | Not fabricated; surfaced as source-data confidence issues and retained as owner data work |

Post-fix verification:

- Backend suite: 142 passing.
- Frontend regression suite: 4 passing.
- ESLint: zero warnings/errors.
- TypeScript and production build: passing.
- Public preorder catalog: zero non-positive prices.
- Supabase: 45 public tables, zero security advisor findings.
- GitHub Actions: replacement PR run `#166` and merged `main` run `#167` passed.
- Vercel: production deployment ready and `/api/health` healthy.

## Executive Summary

- **Do not deploy the current local implementation yet.** Production is missing one expected table and 18 cost-snapshot columns. The migrations must be reviewed and applied before the newer dashboard and Sheet-sync code is released.
- **Contain two production-critical workflow risks first.** Three public pre-order SKUs are orderable at PHP 0.00, and the generic offline layer can store a failed login body in IndexedDB and replay unsafe writes after an uncertain connection.
- **The owner’s Sheet edits are not auto-updating the Hub today.** The production integration is unconfigured, all Sheet-sync tables are empty, three unique Sheet SRPs differ from the Hub, three Full/Half pairs share duplicate Sheet SKUs, and jar cost has no canonical mapping.
- **The strongest core controls are the current Market Events POS idempotency and inventory mirror transactions.** They passed live reconciliation and the automated backend suite. The main weaknesses are source-data quality, legacy audit history, generic offline replay, and missing frontend offline tests.

## Release Decision

Status: **Hold deployment until the three critical findings are addressed.**

| Severity | Count | Release meaning |
|---|---:|---|
| Critical | 3 | Must be contained before deployment |
| High | 4 | Correct before relying on owner dashboard or automatic updates |
| Medium | 4 | Schedule into the stabilization release |
| Low | 1 | Document or clean up after the safety work |

## Critical Findings

### 1. Public pre-orders accept zero-priced active products

The following active SKUs have both retail and reseller price set to zero:

| SKU | Product | Size | Warehouse stock |
|---|---|---|---:|
| `CQM-HF-SW-SVR` | Pesto Croque Monsieur | Half | 0 |
| `CQMD-HF-SW-SVR` | Pesto Croque Madame | Half | 0 |
| `PPZ-HF-SW-SVR` | Pesto Pepperoni Pizza Sandwich | Half | 0 |

They appear in the live public catalog. A zero-price item can be added and the enabled action becomes `Submit PHP 0.00 pre-order`. The backend explicitly permits `retail_price >= 0` in both catalog and submission queries, so this is not only a display problem.

Required containment:

1. Disable the three SKUs on the public form or enter approved prices.
2. Change public catalog and submission validation to require `retail_price > 0`.
3. Add backend and frontend regression tests for zero-priced, inactive, and disabled products.

### 2. Generic offline replay can retain credentials and duplicate unsafe operations

The deployed client writes any failed non-GET request to `hh_offline_db` unless it matches a small denylist. `POST /login` is not excluded, so a network failure can persist the submitted username and passcode body in IndexedDB.

The same mechanism can queue or replay:

- authentication and account-management actions;
- product and ingredient stock updates;
- consignment deliveries and payment actions;
- warehouse transfers and batch intake;
- supplier, user, discount-tier, task, and administrative mutations;
- market-event administration and sale-undo operations.

This is unsafe because a request can reach the server while its response is lost. Replaying it can apply a second mutation. Market POS checkout itself is correctly excluded and uses a dedicated idempotent offline database; the defect is the generic queue around the rest of the app.

Required containment:

1. Replace the denylist with an explicit allowlist of proven-idempotent offline operations.
2. Never persist authentication, credentials, privileged settings, destructive actions, or financial/stock mutations in the generic queue.
3. Remove or quarantine obsolete sensitive and financial rows already in the queue.
4. Give users a visible manual-review and discard flow instead of leaving legacy financial rows permanently stuck.
5. Add automated offline, uncertain-delivery, reconnect, duplicate, and iOS IndexedDB tests.

### 3. Database schema is behind the current local code

Production is missing:

- table `ingredient_price_history`;
- six snapshot columns on `consignment_items`;
- six snapshot columns on `market_event_sale_items`;
- six snapshot columns on `reseller_order_items`.

The six columns are:

- `food_cost_snapshot`;
- `labor_cost_snapshot`;
- `utility_cost_snapshot`;
- `total_cost_snapshot`;
- `cost_status_snapshot`;
- `cost_snapshot_recorded_at`.

The currently deployed code is healthy because it predates these expectations. Deploying the local code without a successful reviewed migration would expose financial write paths and dashboard queries to schema errors.

Required containment:

1. Review the pending Supabase migrations.
2. Apply them in the normal migration workflow.
3. Run a schema preflight that compares SQLAlchemy metadata with production.
4. Deploy only after the migration succeeds and the production health and smoke checks pass.

## High-Priority Data and Workflow Findings

### Google Sheets is not live

Confirmed production state:

- all six Sheet-sync tables contain zero rows;
- the five required server environment variables are absent;
- automatic price application therefore cannot run;
- owner edits to SRP and jar cost have not reached the Hub.

Fresh Sheet-versus-Hub comparison:

| SKU | Sheet SRP | Hub SRP | Difference |
|---|---:|---:|---:|
| `GCP-SL` | PHP 90 | PHP 85 | PHP 5 |
| `SSS-SL` | PHP 150 | PHP 120 | PHP 30 |
| `TSLD-SL` | PHP 115 | PHP 105 | PHP 10 |

Three Full/Half pairs reuse one Sheet SKU and must remain blocked from automatic application:

- `PPZ-FL-SW-SVR`;
- `CQM-FL-SW-SVR`;
- `CQMD-FL-SW-SVR`.

Jar cost is not safely mapped. The workbook contains several jar prices and formulas, while the Hub has one zero-priced `Jar+shipping` ingredient and no stable external packaging code.

Safe activation order:

1. Correct the duplicate Full/Half SKUs in the workbook.
2. Create a canonical packaging master and stable jar code.
3. Apply the Sheet-sync migrations.
4. Configure the read-only service account environment.
5. Run **Check now** with automatic prices off.
6. Verify and accept one unique-SKU test price.
7. Enable bounded price auto-apply only after the dry run is clean.

The designed auto-update is owner-session polling, not an always-on server job: it checks after an owner opens or focuses the app and then at the configured interval while the app remains open.

### Cost and margin data needs source cleanup

The recursive costing engine’s control logic is healthy, but the production source data is not complete enough for fully trusted margins:

- five zero-priced ingredients affect 31 active products through 51 recipe links;
- eight active products have no recipe;
- eleven recipes have zero or negative yield;
- eight recipe items have nonpositive quantity;
- six raw recipe items lack an ingredient reference;
- `ST-SAM-SWT` computes to PHP 548.08 total cost against PHP 245 SRP.

Important zero-priced inputs include bread, ground parmesan, marshmallow, condensed milk, and crushed graham. A computed status of `ok` can still understate cost when an input price is zero, so the data-quality rule must sit before the costing status.

### Supplier-linked alerts are not ready

There are no supplier records and all 134 ingredients lack a supplier link. The deployed schema also lacks ingredient price history. As a result, supplier-specific price spikes, delayed procurement, and source traceability cannot yet be authoritative.

### Mobile pre-order flow is too long

Measured on the live public form:

- iPhone-sized `390x844`: order form begins about 10,497 CSS pixels down, or 12.4 screens;
- Android-sized `412x915`: order form begins about 10,213 CSS pixels down, or 11.2 screens;
- the catalog contains 46 product cards;
- the `Sandwiches & Salads` category control extends beyond the measured phone width.

Recommended workflow:

1. Start with a clear category/filter step.
2. Keep a sticky cart summary visible.
3. Open checkout in a bottom sheet or dedicated step.
4. Keep all category controls inside the viewport.
5. Enforce practical 44-pixel targets.

## Core Feature Results

### Market Events and POS

Current controls that passed:

- event allocation stock movement;
- oversell rollback;
- exact staff assignment and role checks;
- cash-tender validation and server-computed change;
- duplicate `client_reference` returning the original sale;
- sale-item, allocation, and total reconciliation;
- closeout, waste, and stock-return invariants;
- separate offline POS package, stock cache, pending-sale queue, device identity, package expiration, uncertain-delivery review, and receipt matching.

Live data has no current duplicate sale client references, no invalid sale totals, no negative allocations, and no orphan idempotency markers.

Legacy limitations:

- 12 sales lack `client_reference`;
- 10 historical cash sales lack `cash_received`;
- two historical sales lack an idempotency marker;
- one legacy `Mixed` payment remains although current checkout no longer permits new mixed payments.

These are historical traceability gaps, not failures of the current checkout path.

### Inventory

Healthy:

- zero SKU mirror drift at Main Facility;
- zero ingredient mirror drift at Main Facility;
- zero duplicate warehouse rows;
- zero negative live stock;
- transaction rollback tests pass when mirror synchronization fails.

Needs cleanup:

- four ingredient batch balances differ from available stock;
- 21 zero-quantity manual-adjustment rows were written during event closeout;
- three material batch gaps are legacy stock without matching batch rows.

The zero-quantity entries do not change stock, but they make the audit ledger noisy and misleading.

### Pre-orders

Healthy:

- public submission reference idempotency;
- server-owned price snapshots;
- status transition controls;
- owner/staff access restrictions;
- fulfillment recovery and price-drift protection.

Critical exception:

- the public path permits active zero-priced products and a zero-total order.

### Production Planner

The automated tests confirm:

- forecast scaling;
- subrecipe ordering;
- cycle rejection;
- invalid and inactive target rejection;
- draft upsert;
- atomic completion;
- warehouse mirror updates;
- full rollback on sync failure.

Production currently has two draft plans and no completed plan. The database therefore provides no real completed-plan evidence; release proof is test-based until a staged end-to-end completion is performed.

### Consignment and reseller flows

Reseller totals and stock records reconcile. There is one live reseller order and no current consignment delivery/item population, so consignment behavior is supported by code and tests rather than representative production history.

### Dashboard

The local owner-dashboard implementation is visually strong on the captured desktop and mobile states: the weekly hierarchy, KPI cards, action center, cost views, and product visualizer are clear and responsive.

It is not production-ready until:

- the schema migration is applied;
- source prices and recipes are repaired;
- supplier and price-history data exists;
- Sheet activation is completed;
- category classification is corrected.

Two products are currently classified as spreads because category checks run before sandwich SKU/name checks:

- `PCLB-HF-SW-SVR`;
- `WMS-HF-SW-SWT`.

This affects catalog grouping and owner-dashboard category summaries.

## Database and Security Review

- The configured live project is active and healthy.
- All 44 public tables have RLS enabled.
- Eleven newer tables have no RLS policy. This is a deny-all state for anon/authenticated roles, not a public exposure.
- The older tables use service-role access policies.
- Supabase’s current findings for the eleven no-policy tables are informational.
- The frontend production dependency audit reports zero known production vulnerabilities.

The higher-priority security issue is the client-side generic offline queue, not database exposure.

## UI and Device Coverage

Verified:

- live public pre-order DOM and layout at desktop, `390x844`, and `412x915`;
- current local owner dashboard screenshots at `1440x1024` and `390x844`;
- no desktop horizontal overflow on the live public form;
- iOS safe-area CSS and standalone PWA metadata exist;
- current lint and production build pass.

Evidence limitation:

- the in-app browser screenshot and raw CDP capture functions repeatedly timed out, including on fresh tabs;
- protected production routes require a real user session;
- the isolated local reverse-proxy session did not retain the refresh cookie through the development rewrite.

Protected-route findings therefore rely on existing same-day dashboard captures, DOM/code inspection, backend APIs, and test evidence. This audit does not claim full VoiceOver, TalkBack, Safari, Chrome Android, keyboard, or real-device certification.

## Verification Results

| Check | Result |
|---|---|
| Production health | Healthy; database online |
| Backend unit suite | 138 passed |
| Frontend ESLint | Passed; zero warnings |
| Next.js production build | Passed |
| Production dependency audit | 0 known vulnerabilities |
| Production schema comparison | Failed: 1 table and 18 columns missing |
| Sheet-to-Hub configuration | Failed: integration inactive |
| Main Facility stock mirrors | Passed |
| Current POS idempotency reconciliation | Passed |
| Public zero-price guard | Failed |
| Generic offline replay safety | Failed |

Passing tests do not override production data defects or missing browser-offline coverage.

## Recommended Fix Order

### Immediate containment

1. Disable or price the three zero-SRP Half products.
2. Require positive public prices in frontend and backend.
3. Stop generic offline storage of login, credential, admin, financial, and stock-changing mutations.
4. Hold deployment until the reviewed migrations are applied.

### Stabilization

5. Correct zero-priced cost inputs, invalid yields, missing references, and missing recipes.
6. Correct category precedence for sandwich SKUs.
7. Reconcile the four legacy batch balances and remove future zero-quantity ledger writes.
8. Redesign mobile pre-order browsing around a sticky cart and short checkout path.

### Integration activation

9. Correct duplicate Sheet SKUs.
10. Create canonical jar/packaging identifiers.
11. Configure the Sheet service account and run one manual dry run.
12. Enable bounded price auto-apply only after owner verification.

### Release proof

13. Add frontend offline and uncertain-delivery tests.
14. Run one staged end-to-end lifecycle for production planning, consignment, public pre-order fulfillment, Market POS offline capture, reconnect, and closeout.
15. Re-run the schema audit, 138 backend tests, lint, build, dependency audit, and mobile/browser smoke tests.

## Evidence Files

- `data_snapshot.json`: bounded aggregate production database snapshot, with no customer contact data.
- `sheet_price_comparison.json`: bounded live Sheet-versus-Hub price comparison.
- `findings.json`: structured finding register used for reporting.
- `audit_readonly.py`: reproducible read-only database audit.
- `docs/GOOGLE_SHEETS_SYNC.md`: activation contract and current production state.
- `design-qa.md`: same-day local dashboard visual comparison and responsive evidence.
