# H+H Hub — Current Project Status

> **Last updated:** 2026-08-04
> **Current release:** v2.8.0
> **Production:** [https://hh-portal.vercel.app](https://hh-portal.vercel.app)
> **Vercel project:** `hh-hub`
> **Supabase project:** `lstdqfvbhimqrhhgrnqy`

## Release summary

Version 2.8.0 introduces **Smart Recurring Event Series Grouping** with an expandable "Show Future Dates" accordion, sticky Finished SKU table headers in Consignment, pre-order admin table bug fixes (`total_units`), 6 core module QA audit fixes (inventory `NaN` inputs, analytics unpaid pre-orders, active booth stock returns, wholesale & consignment production batch cleanup, and consignment validation), and the exact 39-jar OTOP dispatch log restoration (`DR-20260803-00004`, ₱6,010.00 reseller value).

| Gate | Verified result | Status |
|---|---:|---|
| Backend unit tests | 150 passing | Pass |
| Frontend regression tests | 8 passing | Pass |
| ESLint | 0 warnings / 0 errors | Pass |
| TypeScript | 0 errors | Pass |
| Next.js production build | Successful | Pass |
| Production dependency audit | 0 vulnerabilities | Pass |
| Supabase migrations | Reviewed OTOP reconciliation migration | Pass |
| Supabase security advisor | 0 findings | Pass |
| Public active zero-price products | 0 | Pass |
| Vercel health | Healthy, database online | Pass |
| Google keyless runtime identity | OIDC exchange and impersonation verified | Pass |
| Google workbook Viewer access | Pending one owner share | Owner action |
| Physical iOS/Android device certification | Not completed | Owner/device validation |

## GitHub Actions error shown in run #165

The screenshot of quality run `#165` is historical. Its TypeScript check failed because `.mts` tests import `.ts` modules while `allowImportingTsExtensions` was not enabled.

Resolution:

- `frontend/tsconfig.json` now enables `allowImportingTsExtensions` with `noEmit`.
- Replacement PR run [#166](https://github.com/Aaron840588/H-H/actions/runs/30423766978) passed.
- Merged `main` run [#167](https://github.com/Aaron840588/H-H/actions/runs/30423901005) passed.
- The quality workflow now uses current major GitHub actions and treats a failed production dependency audit as a real failure.

## Implemented system state

### Consignment and OTOP pricing

- Historical shipments show the total DR dispatch value from delivered quantity and immutable partner-price snapshots.
- New dispatches show the estimated total before confirmation.
- Blank DR numbers are generated server-side only after the delivery ID exists and remain editable.
- The one pre-release OTOP delivery without a DR was backfilled to its stable system identifier; no operational or financial fields were changed.
- Partner dispatch prices use the configured discount from master SRP with whole-peso, half-up rounding; the OTOP tracker SRPs are reconciled without rewriting historical shipments.
- Dispatch value is stock-in-transit context, not recognized sales revenue. Invoice generation remains deferred.

### Owner dashboard

- Current Asia/Manila business week and previous-week comparison.
- Weekly recognized sales, direct costs, contribution profit, collections, and product margin views.
- Action Center covering events, stock, delayed collections, price changes, and source-data confidence.
- Immutable sale-time cost snapshots for reseller, consignment, and Market Event sales.

### Pre-orders

- Public catalog and submission both require positive prices.
- Only active, enabled current-line products are orderable.
- Mobile checkout uses a sticky order summary and short review bottom sheet.
- Production has no active non-positive-price products.

### Offline and Market Events

- Generic mutation replay was removed.
- Login credentials, administrative writes, stock writes, and non-idempotent financial writes are never stored for replay.
- Legacy generic queue rows are sanitized once.
- Market POS retains its isolated, idempotent offline sales journal.
- The active owner-confirmed lineup contains 26 core products; retired products are hidden from new allocations.
- An inactive SKU already allocated to an event remains available to that event's online/offline POS and can only be retained or reduced during edits.

### Inventory, production, and costing

- Main Facility stock mirrors remain transactionally synchronized.
- Production planning retains recursive BOM, cycle, shortage, FIFO, and rollback protections.
- Missing recipes, invalid yields, missing suppliers, and zero-cost inputs are visible source-data issues.
- Unknown jar or packaging costs are not replaced with invented defaults.

### Google Sheets

- Controlled one-way ingestion, snapshots, review events, conflict checks, and bounded price auto-apply are implemented.
- Production contains two active sources and seven mappings.
- Google Sheets API, the dedicated service account, Workload Identity pool/provider, and eight Vercel settings are configured.
- A live OIDC token exchange and short-lived service-account impersonation pass without storing a private key.
- The first workbook read remains blocked until Partner Inventory is shared to the service account as Viewer.
- Three ambiguous Full/Half Sheet SKUs and canonical jar-cost mapping still require owner/source correction.

## Database checkpoint

- PostgreSQL `17.6`
- 45 public tables matching 45 SQLAlchemy models
- 26 active products
- 0 active products with `retail_price <= 0`
- 0 Supabase security advisor findings
- Performance advisor observations are informational unused-index notices on a low-traffic database.

## Remaining work

1. Share Partner Inventory with `hh-sheets-sync@project-e6bf3250-19a9-4fd8-802.iam.gserviceaccount.com` as Viewer, then run the first manual check.
2. Correct duplicate Sheet SKUs.
3. Add canonical packaging identifiers and approved jar/label costs.
4. Complete missing recipes, yields, and supplier links.
5. Run physical-device Market Event and preorder checks on the actual iOS/Android hardware and printer.
6. Monitor the open development-only `brace-expansion` advisory until compatible upstream ESLint dependencies are available; production dependencies are unaffected.
