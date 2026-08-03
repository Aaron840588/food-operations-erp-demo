# H+H Hub — Active Session Context

Use this file to resume work without relying on stale handoff notes.

## Infrastructure

| Service | Current source of truth |
|---|---|
| Application version | `2.8.0` |
| Production URL | [https://hh-portal.vercel.app](https://hh-portal.vercel.app) |
| Vercel project | `hh-hub` (`prj_Eb8sx2BSZk15XyAjk61rysupI2vy`) |
| GitHub | [Aaron840588/H-H](https://github.com/Aaron840588/H-H), branch `main` |
| Supabase | `H+H SG`, ref `lstdqfvbhimqrhhgrnqy`, Singapore |
| PostgreSQL | `17.6` |
| Local database | SQLite through the test/development configuration |
| Environment | Root `.env`; never print or commit values |

Vercel deploys merged `main` changes. Confirm the actual production deployment and alias instead of relying on old project names in historical notes.

## Release checkpoint — v2.8.0 (2026-08-04)

- **Smart Recurring Event Series Grouping**: Multi-occurrence events in `/market-events` are grouped into single primary cards with expandable "Show Future Dates" accordions and a `Group Series` toggle.
- **6 Core Module QA Audit Fixes**: Resolved bugs across Inventory (`NaN` input handling), Market Events Analytics (unpaid pre-order filtering), Active booth stock returns, Wholesale POS & Consignment (orphaned `ProductionBatch` cleanup), and Consignment sequential validation.
- **Pre-Order Bug Fixes**: Added `total_units` to schemas/builders to show real jar counts in admin table, dynamic `form_id` resolution, and removed dead attribute assignment.
- **OTOP Dispatch Restoration**: Restored exact 39-jar shipment (`DR-20260803-00004`) for OTOP store: 15x Chili Garlic Oil Sampler 100g, 4x Creamy Matcha Sampler 100g, 8x Pesto Sampler 100g, 8x Yema Sampler 100g, and 4x Yema Indulge 240g (₱6,010.00 reseller value).
- **Consignment Table Sticky Header**: Pinned `Finished SKU` column to the left during horizontal table scrolling.

## Release checkpoint — v2.7.0 (2026-08-03)

- **Market Stock Loadout Manifest Modal**: Added packing manifest modal with WH1 stock comparison, shortage badges, load checkboxes, and 1-click print slips.
- **Planner Event Import**: Step 1 target dropdown to import product target quantities directly from active/draft Market Events.
- **Market Event Card Height Optimization**: Capped allocated inventory tray height (`max-h-36`) with custom scrollbars to prevent card stretching.
- **Print Closeout Report Optimization**: Ultra-compact print layout (1–2 pages max), hidden image thumbnails in print mode (`print:hidden`), flat inline badges, and `break-inside: avoid` rules.

## Release checkpoint — v2.6.1 (2026-08-03)

- PostgreSQL cold starts skip legacy schema creation and startup seeding.
- Production schema and seed changes are owned only by reviewed Supabase migrations.
- Local SQLite bootstrap behavior remains available for development and tests.

## Previous release checkpoint — v2.6.0 (2026-08-03)

- The owner-confirmed paper inventory sheet defines 26 active core Market Events products.
- Sweet Tablea with Peanuts 240g is `₱460`, Sweet Tablea S'mores Half is `₱75`, and Tiramisu Sandwich Half is `₱90` in the current master catalog.
- Bacon Mac and Cheese and Tuna Salad Sandwich Half are catalogued with zero starting stock and Main Facility mirrors.
- Legacy products are inactive rather than deleted; historical snapshots and stock records are preserved.
- Existing inactive event allocations remain sellable/reconcilable but cannot be newly added or increased.
- The separate Other Products table remains deferred pending channel, stock, and SKU confirmation.

## Previous release checkpoint — v2.5.1 (2026-08-03)

- Market Events **Create Event** opens without dereferencing a missing selected event.
- Create-mode and edit-mode inventory checklist identities have regression coverage.
- No event creation, allocation, stock, POS, or offline-write business rules changed.

## Previous release checkpoint — v2.5.0 (2026-08-03)

- Consignment history shows the total value sent using `qty_delivered × reseller_price_snapshot`.
- New-dispatch confirmation shows the estimated partner-price total.
- Blank DR input receives a stable `DR-YYYYMMDD-00001`-style server number after the row ID exists; staff can replace it with the official paper DR.
- OTOP master SRPs are reconciled from the owner tracker; future snapshots apply the partner's configured SRP discount with whole-peso, half-up rounding.
- Historical price/cost snapshots, stock deduction, and Main Facility synchronization remain unchanged.
- Invoice generation is explicitly deferred pending separate business rules.

## Previous release checkpoint — v2.4.1 (2026-07-29)

- Responsive UI hardening removes global browser downscaling, prevents planner card/control clipping, keeps checked shortages legible, and provides a mobile costing-card layout.
- Desktop, Android-sized, and iPhone-sized route matrices have no uncontained horizontal overflow.
- Google Sheets authentication uses Vercel OIDC and Google Workload Identity Federation; no long-lived private key is stored.
- Google token exchange and service-account impersonation have been verified live.
- Owner weekly dashboard with recognized sales, immutable cost snapshots, direct-cost charts, Action Center, product comparisons, and confidence notes.
- Positive-price guards in public preorder catalog, submission service, frontend UI, and PostgreSQL constraints.
- Mobile preorder flow shortened to a sticky summary and review bottom sheet.
- Generic offline mutation replay removed; credentials and uncertain writes are not persisted.
- Dedicated Market POS offline journal and backend `client_reference` idempotency preserved.
- Ingredient price history and reseller/consignment/Market Event cost snapshots added.
- Google Sheet review and bounded price auto-apply infrastructure applied to production.
- Verified Sheet-derived product prices and category corrections migrated to production.
- Production schema reconciled to all reviewed migrations.
- Application/API/sidebar/package versions synchronized at `2.4.1`.

## Current live facts

- 45 SQLAlchemy models and 45 public PostgreSQL tables.
- 26 active products; none has a non-positive retail price.
- Public preorder catalog is limited to enabled current-line products.
- Two active Sheet sources and seven active Sheet mappings exist.
- Eight keyless Google Sheet settings are configured in Vercel for Production, Preview, and Development.
- The workbook read remains blocked until the Partner Inventory workbook is shared with the dedicated service account as Viewer.
- Supabase security advisor returns no findings.
- Production dependency audit returns zero vulnerabilities.
- The remaining GitHub Dependabot advisory is development-only through the ESLint toolchain.

## Critical invariants

1. Public preorders require an enabled form, active current-line SKU, and `retail_price > 0`.
2. Never restore a catch-all offline mutation queue.
3. Market POS is the only offline financial-write flow and must keep stable client references and receipt reconciliation.
4. Reseller invoices, consignment settlement, event administration, inventory mutations, authentication, and destructive actions remain online-only.
5. Stock mutations synchronize the Main Facility warehouse mirror.
6. Recursive costing keeps DFS memoization and cycle detection.
7. Cost and price snapshots on historical transaction items are immutable.
8. Missing recipe, yield, supplier, or packaging data must surface as incomplete confidence, not a fabricated value.
9. Google Sheet reads remain server-side, bounded, allowlisted, and auditable.
10. Staff schemas must omit owner financial data.

## Main routes

| Route | Purpose | Access |
|---|---|---|
| `/` | Owner weekly dashboard | Owner |
| `/preorders` | Preorder operations | Owner, staff |
| `/preorder/[publicToken]` | Customer preorder form | Public |
| `/market-events` | Events, allocations, POS, closeout | Owner, staff |
| `/inventory` | Finished/raw stock, batches, warehouses | Owner, staff |
| `/planner` | Production planning and ingredient forecast | Owner |
| `/recipes` | Recipes, costs, margins, gift sets | Owner |
| `/consignment` | Partner deliveries and settlement | Owner |
| `/resellers` | Wholesale ordering and invoices | Owner |
| `/settings` | Users, settings, Sheet review | Owner |
| `/tasks` | Facility tasks | Owner, staff |
| `/timesheets` | Time records and approvals | Owner, staff |

## Resume checklist

1. Read `AGENTS.md`, `PROJECT_CONTEXT.md`, and `PROJECT_STATUS.md`.
2. Run `git status` and `git pull --ff-only`.
3. Verify the current GitHub Actions run, Vercel deployment identity, and Supabase project before changing production state.
4. Preserve existing user changes in a dirty worktree.
5. Run every quality gate in `AGENTS.md`.
6. Update `CHANGELOG.md`, release status, and the canonical app version when preparing a release.

## External setup still required

- Share Partner Inventory with `hh-sheets-sync@project-e6bf3250-19a9-4fd8-802.iam.gserviceaccount.com` as **Viewer**.
- Run **Settings → Google Sheets → Check now** with automatic prices off and review the initial proposals.
- Correct duplicate Sheet SKUs before enabling affected rows.
- Establish an authoritative Packaging Master before syncing jar/label costs.
- Complete physical iOS/Android/browser/printer validation before a live event.
