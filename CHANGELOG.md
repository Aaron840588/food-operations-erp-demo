# Changelog

All notable H+H Hub changes are recorded here.

## [2.8.0] — 2026-08-04

### Added

- Added **Smart Recurring Event Series Grouping** (`/market-events`) to collapse multi-occurrence recurring events into a single primary card with an expandable "Show Future Dates" timeline accordion.
- Added **Group Series vs Show All Cards** view mode toggle in Market Events header for flexible list management.
- Added **Sticky Finished SKU Column** in `/consignment` table view to keep product names pinned on the left during horizontal table scrolling.

### Fixed

- **Pre-Order Admin Table**: Added missing `total_units` field to `PreorderSummaryOut` schema and `_summary_out()` builder so the admin pre-orders table displays actual jar counts instead of "undefined jars".
- **Pre-Order Form Customization**: Replaced hardcoded `form_id = 1` in preorders page with dynamic form resolution via `api.getPreorderForms()`.
- **Pre-Order Item Updates**: Removed dead assignment to unmapped `total_units` attribute in `update_preorder_items()`.
- **Inventory Costing**: Fixed `NaN` serialization bug on empty labor and utility cost inputs.
- **Market Events Revenue Analytics**: Filtered non-revenue sales (unpaid pre-orders) out of gross revenue calculations.
- **Market Events Active Edits**: Fixed booth stock removal during Active edits—unsold stock now returns to main warehouse stock and allocations update cleanly.
- **Wholesale POS & Consignment Deletions**: Added explicit deletion of linked `ProductionBatch` records on order or shipment deletion to prevent delivery metric corruption.
- **Wholesale POS Cart**: Sanitized `NaN` on quantity input backspacing to keep cart items intact.
- **Consignment Item Validation**: Enforced `(units_sold + qty_pulled_out) <= qty_delivered` on split `PATCH` updates.
- **OTOP Dispatch Restoration**: Restored exact 39-jar shipment log (`DR-20260803-00004`) for OTOP store: 15x Chili Garlic Oil Sampler 100g, 4x Creamy Matcha Sampler 100g, 8x Pesto Sampler 100g, 8x Yema Sampler 100g, and 4x Yema Indulge 240g (₱6,010.00 reseller value | ₱7,090.00 store SRP value).

## [2.7.0] — 2026-08-03

### Added

- Added **Market Pack & Loadout Manifest Modal** (`MarketPackManifestModal.tsx`) for event stock prep, featuring WH1 stock comparison, shortage indicators, interactive load checkboxes, and 1-click printable manifests.
- Added **Import Event Target** dropdown in Step 1 of the Production Planner (`/planner`) to auto-populate target product quantities from active/draft Market Events and compute BOM material shortages instantly.

### Changed

- Optimized Market Event card layout in `/market-events` by capping allocated inventory tray height (`max-h-36`) with custom scrollbars to prevent long product lists from stretching cards vertically across screens.
- Optimized printable **Market Event Closeout Report** CSS (`@media print`): hid thumbnail images and redundant badge styling in print mode, reduced padding, and enforced `page-break-inside: avoid` so closeout reports print cleanly within 1–2 pages.
- Synchronized canonical application, API, and package versions at `2.7.0`.

## [2.6.1] — 2026-08-03

### Fixed

- Production serverless cold starts no longer attempt legacy `ALTER TABLE` statements against Supabase or emit duplicate-column PostgreSQL errors.
- PostgreSQL schema and seed state are now managed exclusively through reviewed Supabase migrations; the local SQLite bootstrap remains available for development and tests.

### Tests

- Added regression coverage proving PostgreSQL startup skips both metadata creation and legacy startup seeding.

## [2.6.0] — 2026-08-03

### Added

- Added the owner-confirmed **Bacon Mac and Cheese** and **Tuna Salad Sandwich — Half** products at zero starting stock, including their Main Facility stock mirrors.
- Added regression coverage for retiring a product that is already allocated to a Draft or Active Market Event.

### Changed

- Reconciled the active sales catalog to the 26 core products shown on the owner's current paper inventory sheets: 12 spreads and sauces plus 14 sandwiches and pasta items.
- Corrected current master SRPs for Sweet Tablea with Peanuts 240g (`₱460`), Sweet Tablea S'mores Half (`₱75`), and Tiramisu Sandwich Half (`₱90`). Historical price and cost snapshots remain unchanged.
- Retired products are deactivated, never deleted. Staff cannot add or increase them in an event, but an existing allocation may be retained, reduced, sold, or reconciled safely.
- Market POS and its prepared offline package now retain already-allocated inactive products so an open event does not lose valid booth stock.
- Canonical application, API, package, and release documentation version is `2.6.0`.

### Deferred

- The paper sheet's separate **Other Products** table is not part of the main Market Events lineup. Ice candy, turon, gift bags, and Tablea de Cacao require separate channel, stock, and SKU confirmation before activation.

## [2.5.1] — 2026-08-03

### Fixed

- Opening **Create Event** no longer crashes when there is no previously selected Market Event.
- The inventory-allocation checklist now uses a null-safe create identity while retaining event-and-status identity for edit flows.

### Tests

- Added frontend regression coverage for create-mode and edit-mode checklist identity.

## [2.5.0] — 2026-08-03

### Added

- Delivery-level dispatch totals in historical consignment shipments, calculated from delivered quantity and the immutable partner-price snapshot.
- Estimated dispatch totals before a new delivery is confirmed.
- Stable server-generated DR numbers when staff leave the paper DR field blank, while preserving the manual replacement workflow.
- Regression coverage for generated DR identity and owner-tracker partner-price rounding.

### Changed

- Consignment deliveries now snapshot each partner's configured discount from master SRP using whole-peso, half-up rounding; generic reseller catalog prices no longer override partner terms.
- The active OTOP spread-and-sauce SRPs are reconciled idempotently from the owner-provided OTOP tracker. Historical delivery snapshots remain unchanged.
- Consignment product lookup uses a memoized SKU map to avoid repeated scans in delivery rendering and estimated-total calculations.
- Canonical application, API, package, sidebar, context, and release documentation version is `2.5.0`.

### Fixed

- Updated the development-only `brace-expansion` dependency to a patched release, clearing GitHub's high-severity denial-of-service advisory.
- Blank or whitespace-only DR input can no longer leave a delivery without a stable receipt reference.
- Legacy deliveries with a missing DR are backfilled from their existing delivery date and database ID without changing shipment or financial data.
- Clearing an edited DR restores the same system-generated reference, and duplicate manual DR replacements are rejected.
- Dispatch value is never counted as revenue; it is based on `qty_delivered × reseller_price_snapshot`.

### Deferred

- Invoice generation remains out of scope until its separate tax, settlement, and document-number rules are approved.

## [2.4.1] — 2026-07-29

### Added

- Keyless Google Sheets authentication through Vercel OIDC, Google Workload Identity Federation, and short-lived service-account impersonation.
- Owner-facing Google Sheets activation checklist and explicit runtime readiness details.
- Responsive costing cards for tablet and mobile layouts.
- Regression coverage for keyless Sheet authentication and configuration.

### Changed

- Removed global browser downscaling so desktop, tablet, Android, and iPhone layouts use normal readable sizing.
- Production Planner product selection uses stable two-column cards and larger material checkboxes.
- Recipe costing keeps the complete BOM action visible on desktop and switches to cards below the desktop comparison breakpoint.
- Shared table scroll and search-field padding behavior now remains visible and keyboard-focus safe.
- Canonical application, API, package, sidebar, context, and release documentation version is `2.4.1`.

### Fixed

- Planner quantity controls no longer extend outside product cards.
- Checked shortages retain their warning color and readable ingredient names.
- Search icons no longer overlap input or select text.
- Costing rows no longer crop the BOM action column at common laptop widths.

### External action

- Share Partner Inventory with `hh-sheets-sync@project-e6bf3250-19a9-4fd8-802.iam.gserviceaccount.com` as Viewer before the first live Sheet check.

## [2.4.0] — 2026-07-29

### Added

- Owner weekly dashboard with recognized sales, direct-cost composition, contribution profit, Action Center, product visualizer, and data-confidence notes.
- Immutable food, labor, utility, total-cost, status, and timestamp snapshots for reseller, consignment, and Market Event sale items.
- Ingredient price history.
- Controlled Google Sheet source/mapping/run/snapshot/change/event records.
- Owner-enabled, bounded automatic retail/reseller price application.
- Application version synchronization test across FastAPI and the frontend package.

### Changed

- Mobile public preorder browsing now uses compact controls, a sticky summary, and a review bottom sheet.
- Market Event zero-return closeout no longer creates zero-quantity inventory ledger entries.
- Sandwich classification takes precedence over ambiguous category text.
- GitHub Actions use current major checkout/setup actions and enforce the production dependency audit.
- Canonical application, API, package, sidebar, context, and release documentation version is `2.4.0`.

### Fixed

- Prevented active zero-price products from appearing in or being submitted through public preorders.
- Repaired the affected approved product prices and category assignments in production.
- Removed generic offline persistence of login credentials and unsafe/uncertain mutations.
- Sanitized the retired generic IndexedDB queue.
- Reconciled missing production migrations, cost-snapshot columns, price history, Sheet-sync records, indexes, and RLS policies.
- Fixed GitHub Actions TypeScript failure for `.mts` tests importing `.ts` modules.
- Removed duplicate product-size tooltip content.

### Security

- Authentication, administrative, inventory, reseller, consignment, and destructive writes are no longer eligible for generic offline replay.
- Dedicated Market POS idempotency and offline evidence are preserved.
- Supabase security advisor reports zero findings.
- Production frontend dependency audit reports zero vulnerabilities.

### Known external/data work

- Google service-account variables are not configured in Vercel.
- Three duplicate Full/Half SKUs remain in the owner Sheet because the connected account lacks write scope.
- Supplier links, missing recipes, invalid yields, and canonical jar/label costs require approved source data.
- Physical iOS/Android/browser/printer validation remains required.
- A development-only `brace-expansion` advisory remains open through ESLint dependencies and is not deployed.

## [2.3.0] — 2026-07-23

- Added public preorders and owner/staff preorder operations.
- Added POS preorder fulfillment, collectibles, adjustable discounts, add-ons, and gift sets.
- Added three-part costing and the initial controlled Sheet review workflow.

## [2.2.0] — 2026-07-18

- Established typed frontend API contracts and the zero-warning quality baseline.
- Unified product identity and size presentation across operations.
- Added multi-location inventory, production, reseller, consignment, and Market Event foundations.
