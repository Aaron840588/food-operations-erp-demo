# Controlled Google Sheets Synchronization

This document is the implementation contract for the one-way, controlled Google Sheets integration. The owner may temporarily use the approved Partner Inventory Sheet as the source for SRP and reseller price while learning the Hub. H+H Hub remains authoritative for operational and transactional records.

## Audited sources

The source audit used the three shared Google workbooks and the three local `.xlsx` reference copies supplied by the owner on 2026-07-22. Ranges below are deliberately bounded; row numbers are references only and are never record identifiers.

| Workbook | Spreadsheet ID | Audited tabs | Source observations | Initial decision |
| --- | --- | --- | --- | --- |
| H+H Food System Trackers | `14Ha7QnZ14VcigXaO1popUmSgsBNTVQ92P-4lb569INg` | Food Costing Template, Gift Sets, Reseller Rate, Analysis, Utility/Labor/Supplies | The costing template is a sample layout. Analysis and most costing tabs are formula-heavy reporting surfaces. Reseller Rate has prices but no SKU. Gift Sets uses wide repeated blocks and merged cells. | Connected for visibility, but no auto-active field mapping until stable identifiers are added. Analysis/reporting cells are ignored. |
| H+H Production Inventory Management | `11r5JTvYFL4Ud_xtOk0wzghEcrYBnOVNZ2aQeIUi0GsA` | Adjustable recipe tabs, Supply Inventory, Production Records, Warehouse Inventory, Tracker, Partner Stock Summary | Recipe tabs use repeated horizontal blocks keyed by display name rather than product SKU. Supply Inventory contains several irregular tables and stock quantities. Production/Warehouse tabs are transactional ledgers. | Recipe candidates are high-risk and disabled pending a SKU crosswalk. All stock and production quantities are reconciliation-only or ignored. |
| Partner Inventory Management | `1cwxsw5sm00eSyMvaCAeLyJ2RZ5prSGNtsCFpdBH1qi4` | SKUs, RTE Food Info, Product Master, Discount Engine, Fixed Packages, Build Your Own, partner trackers | `SKUs` and `RTE Food Info` contain stable-looking SKU columns. RTE cost/price cells are partly `IMPORTRANGE`/derived formulas. Product Master and package sheets do not contain stable SKUs. Partner tabs contain operational consignment data. | `SKUs` and selected RTE product master fields are the only initial mapping candidates. Partner transactions and derived reports are never imported. |

### Source quality findings

- `SKUs!A4:F200` has a usable header on row 4 and uses SKU as the intended identifier. Blank separator rows are harmless.
- Three Full/Half pairs currently reuse the Full SKU and are therefore ambiguous: `PPZ-FL-SW-SVR`, `CQM-FL-SW-SVR`, and `CQMD-FL-SW-SVR`. The sync must reject all duplicate matches instead of choosing the first row.
- `RTE Food Info!B5:H200` repeats those duplicate identifiers. Its `H+H Price` is imported from the Food Tracker and `Reseller's Price` is formula-derived. The owner approved these two price results as a temporary automatic source on 2026-07-29. `Cost/Unit` and `Profit Margin` remain non-authoritative reporting outputs.
- `RTE Food Info` labels the size-like values `Solo`, `Full`, and `Half` as `Category`. That column is not mapped until the owner confirms its meaning.
- The production recipe tabs have recipe names and ingredient names but no canonical product/ingredient IDs. Row position or display name alone is not safe enough for automatic matching.
- The production Supply Inventory sheet mixes multiple tables, merged regions, brands, vendors, shopping lists, and live quantities. It must not be treated as a flat master table.
- Workbook formatting, colors, comments, charts, dashboards, pivots, summary formulas, blank-row movement, and row sorting are outside the synchronization contract.

## Source-of-truth matrix

| Data category | Authoritative source | Sheet behavior |
| --- | --- | --- |
| Product display name, active state, category, size | H+H Hub after owner approval | Sheet may propose a mapped change. Manual review is the default. |
| Retail and reseller price | Partner Inventory `RTE Food Info` while automatic prices are enabled; otherwise H+H Hub | A unique-SKU price difference may auto-apply after full validation. Historical sale snapshots are unchanged. |
| Supplier and raw-ingredient descriptive master data | H+H Hub after owner approval | Deferred until a stable external identifier exists in the source. |
| Recipe/BOM components, quantities, yield | H+H Hub after atomic owner approval | Deferred until SKU and ingredient identifiers are unambiguous. A future proposal must be grouped as one recipe revision. |
| Warehouse/raw stock, FIFO batches, inventory ledger | H+H Hub | Reconciliation warning only. Never assign stock directly from a Sheet value. |
| Production completions, wholesale, consignment, event allocations/POS, preorders after acceptance | H+H Hub | Never imported by the general sync. |
| Payments, receivables, discounts applied to sales, event closeouts | H+H Hub | Never imported by the general sync. |
| Users, roles, sessions, audit history | H+H Hub | Never imported. |
| Dashboard totals, COGS, profit, pivots, charts, reports | H+H Hub computed data | Ignored. |

## Allowlist and field behavior

All mappings start in `Manual Review`. The owner can opt only `retail_price` and `reseller_price` into `Auto Apply`; no other field can inherit that mode.

| Source tab and bounded range | Stable identifier | Source header | Destination | Type | Risk / behavior |
| --- | --- | --- | --- | --- | --- |
| Partner Inventory / `SKUs!A4:F200` | `SKU` | Product Name | `product_skus.product_name` | string | Low; manual review |
| Partner Inventory / `SKUs!A4:F200` | `SKU` | Size | `product_skus.size` | string | High; explicit confirmation |
| Partner Inventory / `SKUs!A4:F200` | `SKU` | Category | `product_skus.category` | string | High; explicit confirmation and allowed-category validation |
| Partner Inventory / `SKUs!A4:F200` | `SKU` | Pack QTY | `product_skus.pack_qty` | non-negative integer | Manual review; blank means no proposal |
| Partner Inventory / `RTE Food Info!B5:H200` | `SKU` | Product Name | `product_skus.product_name` | string | Low; manual review |
| Partner Inventory / `RTE Food Info!B5:H200` | `SKU` | H+H Price | `product_skus.retail_price` | decimal money | High; owner may enable controlled auto-apply |
| Partner Inventory / `RTE Food Info!B5:H200` | `SKU` | Reseller's Price | `product_skus.reseller_price` | decimal money | High; owner may enable controlled auto-apply |

The client continues to expose only the active Spreads & Sauces and Sandwiches & Salads lines. Source rows outside that currently approved lineup remain visible as unmapped/deferred; they are not silently activated.

## Change and conflict rules

- Match columns by normalized header name and records by stable identifier, never by row number.
- Normalize strings, booleans, integers, and decimal currency deterministically. `250`, `250.00`, and `₱250.00` compare as the same decimal value.
- A stable fingerprint includes source, tab, mapping version, stable ID, destination field, normalized incoming value, and row hash. Repeated checks do not duplicate unresolved changes.
- Missing identifiers, duplicate identifiers, unknown headers, invalid types, negative money/quantity, and ambiguous destination matches become conflicts.
- A missing source row never deletes or deactivates an H+H record. Missing-row detection is deferred until the owner approves a source-baseline policy.
- Acceptance re-reads the destination value. If it differs from the value captured at detection, the change becomes a conflict instead of using last-write-wins.
- Automatic application uses the same revalidation, transaction, domain validation, and audit events as an owner acceptance. It is not a direct Sheet-to-table write.
- A zero price or a price change greater than 25% remains in manual review even when automatic prices are enabled. This catches likely misplaced decimals and formula spikes.
- When two approved price fields for the same SKU arrive together, the controlled first update rebases only its still-pending sibling from the same captured product state. An unrelated Hub edit still creates a conflict.
- Applying an accepted change uses the destination domain validation in one database transaction, records the owner actor, invalidates affected caches, and preserves historical transaction snapshots.
- Stock differences can only lead to a separate, reasoned inventory adjustment through the normal stock-adjustment service.

## Authentication and discovery architecture

- A dedicated Google service account receives Viewer access only to the approved workbooks.
- Production uses Vercel OIDC, Google Workload Identity Federation, and short-lived service-account impersonation. No long-lived Google private key is created or stored.
- The Workload Identity provider accepts only the `aarontagapan-8987s-projects` Vercel issuer, `hh-hub` project, and approved deployment environments.
- Non-secret identity and allowlist settings remain server-side in Vercel environment variables. Missing configuration disables sync without affecting the rest of H+H Hub.
- Both the environment spreadsheet allowlist and the server-side source/range/field allowlist must approve a read.
- Manual **Check now** remains available. When automatic prices are enabled, an authenticated owner session checks on open/focus and every five minutes while the Hub remains open.
- An optional installable Apps Script edit trigger may send minimal, signed metadata to a FastAPI webhook. The webhook validates the secret and allowlist, stores the event idempotently, and performs a selective Sheets API read; it never trusts cell values in the webhook body.
- Always-on server polling is not selected because the current Vercel Hobby deployment cannot provide the required frequent background schedule. An Apps Script push trigger remains a future near-real-time option.
- Reads are bounded and batched, with short timeouts, capped exponential backoff, jitter, and run-level request/row/change metrics.

## Requires Owner Validation

- Correct the three duplicated Full/Half SKUs in both `SKUs` and `RTE Food Info` before enabling those affected rows.
- Confirm whether its `Category` column is actually the product size.
- Add stable SKU and ingredient identifiers to recipe source blocks before enabling recipe synchronization.
- Add stable ingredient/supplier codes before enabling raw-ingredient or supplier master mappings.
- Confirm whether Product Master, Discount Engine, and Fixed Packages are planning tools or authoritative proposal sources.
- Confirm whether an Apps Script trigger should be installed after manual synchronization is validated.

No Google credential is stored in this repository and no Sheet is written to. Production changes are possible only through the authenticated Hub API and the validated mappings above.

## Implemented workflow

The implementation is one-way with a narrow owner-controlled automatic mode:

1. The owner opens **Settings → Google Sheets**.
2. **Check now** asks the backend to read only the two code-registered Partner Inventory ranges.
3. The backend retrieves spreadsheet metadata before values, validates the exact spreadsheet/tab/range, and normalizes only mapped fields.
4. Each returned row is stored as an immutable run snapshot. Duplicate, invalid, blank-identifier, and unknown-product rows are excluded from proposals and counted in the run summary.
5. Meaningful field differences become auditable changes with a deterministic fingerprint. Repeated checks suppress the same unresolved proposal.
6. If automatic prices are off, every difference waits in the owner review queue.
7. If automatic prices are on, only unique-SKU `H+H Price` and `Reseller's Price` differences within the 25% safety band proceed automatically. Larger jumps and all product name, size, category, and pack-quantity changes still wait for review.
8. Every apply revalidates the code mapping and destination record version. A newer H+H edit produces a conflict; it is never overwritten silently.
9. A successful apply uses the same commit-neutral `ProductSKUUpdate` validation service as the normal owner product editor. Accepted and applied remain separate audit events.
10. Reject and Ignore preserve the proposal and append the owner decision. No Sheet mutation is queued for offline replay.

The migration creates `sheet_sync_sources`, `sheet_sync_mappings`, `sheet_sync_runs`, `sheet_sync_snapshots`, `sheet_sync_changes`, and `sheet_sync_change_events`. Direct `anon` and `authenticated` access is revoked, RLS is enabled, and the `service_role` policy is the only PostgREST policy. Production `Base.metadata.create_all` is disabled; reviewed migrations own the PostgreSQL schema.

## Current production state checked 2026-07-29

- All six Sheet-sync tables exist in production.
- Two active sources and seven active mappings are seeded.
- Run, snapshot, change, and event rows remain empty until a credentialed check executes.
- The production Vercel project is `hh-hub`, serving `https://hh-portal.vercel.app`.
- Google Sheets API and the dedicated `hh-sheets-sync` service account are active.
- The `hh-vercel` Workload Identity pool and `hh-hub` provider are active, and service-account impersonation is restricted to that project identity.
- Eight keyless Google Sheet settings are configured in Vercel Production, Preview, and Development.
- A live Vercel development OIDC token successfully exchanged through Google STS and impersonated the dedicated service account.
- The final workbook read correctly returns access denied until the owner shares Partner Inventory with that service account as Viewer.
- The three owner-approved SRP corrections were migrated directly to the Hub during the v2.4.0 stabilization release; they were not produced by automatic Sheet synchronization.
- Future owner Sheet edits—including jar changes—will not reach the Hub until workbook Viewer access and one manual run are verified.
- The connected Google account lacked write scope, so the three duplicate Full/Half SKU cells could not be corrected from this workspace.

## Server setup checklist

Do not create or store a service-account JSON key. The organization policy correctly blocks service-account key creation.

1. [x] Enable Google Sheets, IAM, IAM Credentials, Security Token Service, and Resource Manager APIs.
2. [x] Create `hh-sheets-sync@project-e6bf3250-19a9-4fd8-802.iam.gserviceaccount.com` without project-wide editor access.
3. [x] Create the `hh-vercel` pool and `hh-hub` OIDC provider with project/environment claim restrictions.
4. [x] Grant only the matching workload identity permission to impersonate the service account.
5. [ ] Share Partner Inventory with that account as **Viewer**.
6. [x] Confirm that `20260722120000_controlled_google_sheet_sync` and `20260729024532_enable_controlled_price_auto_apply` remain present in production migration history. They were applied during the v2.4.0 stabilization release.
7. [x] Configure server-only environment variables:
   - `GOOGLE_SHEETS_SYNC_ENABLED=true`
   - `GOOGLE_SHEETS_AUTH_MODE=vercel_oidc`
   - `GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_SHEETS_PROJECT_ID`
   - `GOOGLE_SHEETS_PROJECT_NUMBER`
   - `GOOGLE_SHEETS_WORKLOAD_IDENTITY_POOL_ID`
   - `GOOGLE_SHEETS_WORKLOAD_IDENTITY_PROVIDER_ID`
   - `GOOGLE_SHEETS_ALLOWED_SPREADSHEET_IDS` as a comma-separated audited allowlist
8. [x] Redeploy v2.4.1 and verify Settings reports **Configured**. This confirms the server setup, not workbook access.
9. [ ] Run **Check now** with automatic prices still off. Review invalid/duplicate counts and compare proposed values with the workbook.
10. [ ] Accept one test price, verify its audit history and unchanged historical sale snapshots, then reject/ignore the remaining test proposals as appropriate.
11. [ ] Turn on automatic prices in Settings only after the dry run. Verify one unique-SKU SRP change from Sheet to Hub.
12. [ ] Correct the duplicate SKUs; affected duplicate rows remain blocked until then.

## Canonical jar-cost path

Jar cost is not safe to connect to the current workbook layout:

- Live workbook sections contain several different jar purchase prices and total-cost-per-jar formulas.
- `Supply Inventory` lists `Big Jars` and `Small Jars` without a usable canonical cost table.
- The production Hub has one `Jar+shipping` ingredient with a zero price and no stable external packaging code.

Before jar cost can auto-update, create one bounded **Packaging Master** table with at least:

`Packaging Code | Packaging Name | Purchase Price | Pack Quantity | Unit | Effective Date`

Use one row per real packaging item, for example separate codes for small jar, large jar, lid, label, and shipping box. Add the same stable code to the matching Hub ingredient. Only `Purchase Price` and `Pack Quantity` should be eligible for controlled sync; recipe-level `Total Cost/Jar` remains computed by the Hub.

## Deliberately deferred

- Apps Script/webhook installation;
- automatic jar/packaging costs until the canonical table and codes above exist;
- always-on background synchronization while no owner has the Hub open;
- writes back to Google Sheets;
- stock, production, POS, payment, receivable, user, or audit imports;
- recipe/BOM, supplier, ingredient, package, promotion, and active-state mappings;
- missing-row deletion/deactivation proposals;
- bulk acceptance and auto-apply for non-price fields.

The fake-transport and in-memory workflow tests exercise exact-range reads, retries, normalization, duplicate exclusion, idempotent checks, conflict handling, owner decisions, two-price automatic application, structural-field blocking, validated application, and historical sale-price preservation without network access or production data.
