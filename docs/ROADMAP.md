# H+H Hub — Roadmap

Current release: **v2.6.1**.

## Completed foundations

- [x] Typed frontend API contracts and zero-warning quality gate.
- [x] Responsive product identity, size badges, tables, and operational cards.
- [x] Multi-location warehouse records and Main Facility mirror synchronization.
- [x] Recursive production planning, shortage checks, FIFO consumption, and rollback.
- [x] Reseller, consignment, and Market Event workflows.
- [x] Dedicated idempotent Market POS offline journal.
- [x] Public preorder form and owner/staff preorder operations.
- [x] Positive-price preorder guards.
- [x] Owner weekly dashboard, Action Center, cost views, and product visualizer.
- [x] Immutable sale-time cost snapshots and ingredient price history.
- [x] Controlled Google Sheet sources, mappings, review queue, and bounded price auto-apply.
- [x] Production schema reconciliation and Supabase security review.
- [x] Canonical v2.6.1 application/API/package versioning.
- [x] Migration-only PostgreSQL startup with no legacy schema or seed writes.
- [x] Null-safe Market Events create dialog with regression coverage.
- [x] Owner-confirmed 26-product Market Events lineup, SRP reconciliation, and safe retirement of legacy allocations.
- [x] Consignment DR dispatch totals, pre-confirmation estimates, and stable automatic DR identity.
- [x] OTOP owner-tracker SRP reconciliation and partner-discount price snapshots.
- [ ] Define invoice tax, numbering, settlement, and document rules before building consignment invoices.
- [x] Responsive desktop, Android-sized, and iPhone-sized UI hardening.
- [x] Keyless Vercel OIDC and Google Workload Identity authentication.

## Activation and data completion

### 1. Activate Google Sheet reads

- [x] Create the dedicated Viewer-only service account.
- [x] Configure keyless Google Workload Identity Federation.
- [x] Configure the eight server-only Vercel identity and allowlist values.
- [ ] Share Partner Inventory with the service account as Viewer.
- [ ] Run one manual check with automatic prices disabled.
- [ ] Accept one verified price and confirm its audit history.
- [ ] Enable bounded price auto-apply only after the dry run passes.

### 2. Repair Sheet identifiers

- [ ] Correct the three duplicate Full/Half SKUs in `SKUs` and `RTE Food Info`.
- [ ] Confirm the meaning of the RTE `Category` column.
- [ ] Add stable identifiers before proposing recipe, ingredient, or supplier mappings.

### 3. Complete costing source data

- [ ] Create a canonical Packaging Master with stable codes for jars, lids, labels, and shipping materials.
- [ ] Link the matching Hub ingredients.
- [ ] Repair missing recipes and invalid yields.
- [ ] Enter approved zero-cost ingredient prices.
- [ ] Create supplier records and link ingredients.

## Operational proof

### 4. Physical device validation

- [ ] iPhone Safari keyboard, safe-area, lock/recovery, and home-screen behavior.
- [ ] Android Chrome/Edge process eviction and battery-saver recovery.
- [ ] Samsung Internet IndexedDB persistence.
- [ ] Actual event printer and receipt layout.
- [ ] Two-device cashier handoff policy.

### 5. Staged end-to-end business cycles

- [ ] Production plan forecast through completion and inventory reconciliation.
- [ ] Consignment dispatch through settlement and pull-out.
- [ ] Public preorder through POS fulfillment.
- [ ] Market Event preparation, offline sale, reconnect, replay, and closeout.
- [ ] Sheet price edit through review/auto-apply and dashboard refresh.

## Future product work

### 6. General expense ledger

Add a reviewed expense model for costs outside food, labor, utility, and event closeout. Keep contribution profit separate until expense coverage is complete.

### 7. Payment notifications

Add provider-specific, signed webhook integrations only after the owner selects the supported GCash/bank/payment providers and reconciliation policy.

### 8. Alert lifecycle

Add owner acknowledgement, snooze, assignment, resolution history, and configurable thresholds after current alerts have enough live usage data.

### 9. Near-real-time Sheet trigger

Consider a signed Apps Script metadata trigger after manual Sheet synchronization is trusted. The webhook must never accept cell values as authoritative input.

## Ongoing maintenance

- Keep production dependencies and GitHub actions current without force-upgrading incompatible toolchains.
- Review the development-only `brace-expansion` advisory when ESLint plugins support the patched dependency line.
- Treat unused-index advisor findings as observations until representative production traffic exists.
- Update `CHANGELOG.md`, `PROJECT_STATUS.md`, `SESSION_CONTEXT.md`, and package/API/sidebar versions together for every release.

