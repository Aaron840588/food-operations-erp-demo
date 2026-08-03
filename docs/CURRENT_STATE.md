# H+H Hub — Current State and Releases

Current as of **2026-08-03**.

## Active production

- App: [https://hh-portal.vercel.app](https://hh-portal.vercel.app)
- Vercel project: `hh-hub`
- Git branch: `main`
- Supabase project: `H+H SG` / `lstdqfvbhimqrhhgrnqy`
- PostgreSQL: `17.6`
- Application version: `2.6.1`
- Public database tables: `45`

## Release checkpoint — v2.6.1

### Production database startup

- PostgreSQL cold starts never run `Base.metadata.create_all` or legacy `ALTER TABLE`/seed statements.
- Reviewed Supabase migrations are the only production schema and seed authority.
- SQLite development/test bootstrap remains unchanged.

## Previous release checkpoint — v2.6.0

### Owner-confirmed Market Events catalog

- The active main lineup is the photographed 26-product core catalog: 12 spreads and sauces plus 14 sandwiches and pasta items.
- Bacon Mac and Cheese and Tuna Salad Sandwich Half were added with zero initial stock and Main Facility mirrors.
- Three current SRPs were corrected without changing historical sale, consignment, reseller, or event snapshots.
- Legacy products are inactive, not deleted. Existing event allocations remain operable but cannot be added to or increased.
- Ice candy, turon, gift bags, and Tablea de Cacao remain outside the main lineup pending separate operational rules.

## Previous release checkpoint — v2.5.1

### Market Events create flow

- **Create Event** opens safely when no existing event is selected.
- The inventory checklist uses a stable create-mode identity and preserves event/status identity for editing.
- Event creation, stock allocation, POS idempotency, and offline-sale rules are unchanged.

## Previous release checkpoint — v2.5.0

### Consignment delivery receipts

- Historical delivery cards show total value sent from dispatched quantity and immutable partner-price snapshots.
- The dispatch modal shows an estimated total before confirmation.
- Server-generated DR numbers provide stable identity when no paper number is entered and remain manually replaceable.
- Legacy blank DR metadata is backfilled from the existing delivery date and ID without changing stock or immutable financial snapshots.
- Partner prices derive from the configured SRP discount with whole-peso, half-up rounding; OTOP's current master SRPs are reconciled from the owner tracker.
- Dispatch value is not revenue, historical snapshots are not rewritten, and invoice generation remains deferred.

## Previous release checkpoint — v2.4.1

### UI and device layouts

- Normal browser text sizing replaces the previous global desktop/tablet scale reduction.
- Planner cards and quantity controls remain contained at common laptop widths.
- Checked shortage rows preserve warning emphasis and readable labels.
- Costing uses a complete desktop ledger and responsive mobile/tablet cards.
- Automated route matrices at 390x844 and 375x812 found no uncontained horizontal overflow.

### Google Sheets activation

- Google Sheets API and the dedicated `hh-sheets-sync` service account exist.
- The `hh-vercel` Workload Identity pool and `hh-hub` provider trust only the matching Vercel project and approved environments.
- Eight keyless Google settings are present in Vercel Production, Preview, and Development.
- Live Vercel OIDC exchange and short-lived service-account impersonation pass.
- Partner Inventory still needs Viewer sharing to the service account before the first read.

### Verification

- 144 backend tests pass.
- Four frontend regression tests pass.
- ESLint and TypeScript pass.
- Next.js production build passes.
- Production dependency audit reports zero vulnerabilities.

## Previous release checkpoint — v2.4.0

### Safety and data integrity

- Public preorder prices must be greater than zero in the UI, API, and database.
- Active production products with non-positive retail prices: `0`.
- Generic offline mutation replay has been removed and legacy rows are sanitized.
- Login credentials, admin changes, inventory changes, and non-idempotent financial writes are never queued.
- Market POS keeps its separate idempotent offline sales journal.
- Sale items preserve immutable price and cost snapshots.
- Ingredient price history records approved purchasing-price changes.

### Owner dashboard and workflow

- The default dashboard is the current Asia/Manila business week.
- Weekly sales, direct costs, contribution profit, collections, events, stock risks, and data confidence are linked.
- The product visualizer supports SRP versus margin and price versus food, labor, utility, and total cost.
- Alerts include direct actions for events, collections, inventory, pricing, and source-data repair.

### Preorders and mobile

- The public catalog exposes only active, enabled Spreads & Sauces and Sandwiches & Salads SKUs.
- Mobile browsing uses compact category controls, a sticky order summary, and a review bottom sheet.
- The server repeats all visibility and price checks at submission.

### Google Sheets

- Six audited Sheet-sync tables are deployed.
- Two active sources and seven active field mappings are seeded.
- Retail/reseller prices may be auto-applied only when explicitly enabled and within the 25% safety band.
- At the v2.4.0 checkpoint, production credentials were not configured and automatic reads reported setup required.
- Three duplicate Full/Half Sheet SKUs and packaging cost identifiers remain owner/source work.

### v2.4.0 verification

- 142 backend tests pass.
- Four frontend regression tests pass.
- ESLint passes with zero warnings.
- TypeScript and Next.js production builds pass.
- Production dependency audit reports zero vulnerabilities.
- Supabase security advisor reports zero findings.
- Vercel health reports `healthy`, `online`, and `production`.

## CI incident closure

GitHub Actions run `#165` failed because `.mts` test files imported `.ts` modules without `allowImportingTsExtensions`. The repository now enables that TypeScript option with `noEmit`.

- PR replacement run `#166`: passed
- Merged `main` run `#167`: passed

The workflow has also moved to current major GitHub actions and no longer ignores a failed production dependency audit.

## Earlier checkpoints

### v2.3.0 — 2026-07-23

- Public preorder subsystem and owner/staff management.
- POS preorder lookup, collectibles, adjustable discounts, add-ons, and gift sets.
- Three-part product costing and initial controlled Sheet review queue.

### v2.2.0 — 2026-07-18

- Shared product identity and size treatments.
- Typed frontend API contracts and zero-warning lint baseline.
- Multi-location inventory, production planning, reseller, consignment, and Market Event foundations.

## Known external/data limitations

- Partner Inventory Viewer sharing to the dedicated service account is still pending.
- The connected Google account cannot edit the three duplicate SKU cells with its current scope.
- Supplier links, missing recipes, invalid yields, and canonical jar/label costs require approved source data.
- Physical iOS, Android, Samsung Internet, and event-printer certification remains to be performed.
- A development-only `brace-expansion` advisory remains open through ESLint dependencies; it is not part of the deployed application.
