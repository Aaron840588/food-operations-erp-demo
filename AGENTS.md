# H+H Hub — AI Developer Operating Instructions

> **Important:** Read `PROJECT_CONTEXT.md` at the repository root before changing application code. The Hub has database-synchronized workflows and strict security boundaries.

## 1. Core architecture and code rules

1. **Next.js and frontend**
   - Framework: Next.js App Router `16.2.12` with Turbopack.
   - Styling: Tailwind CSS v4 with the existing warm sand design tokens. Reuse surrounding components and patterns.
   - State and data: React hooks, SWR, and bounded local fallbacks for read performance.
   - Current sales lineup: customer-facing and sales product lists must contain only active **Spreads & Sauces** and **Sandwiches & Salads** SKUs.
2. **FastAPI and backend**
   - All 45 SQLAlchemy tables remain unified in `backend/app/models.py`. Do not delete or rename existing columns without explicit approval and a reviewed migration.
   - Access tokens remain in memory; refresh tokens use secure HttpOnly cookies.
   - Preserve strict date and boolean casting to avoid invalid cloud PostgreSQL queries.
3. **Database and stock mappings**
   - Every mutation that changes ingredient `available_stock` or SKU `warehouse_stock` must call `sync_warehouse_stock_for_main_facility(db, ...)`.
   - PostgreSQL schema changes must use reviewed files under `supabase/migrations/`. Production must not rely on `Base.metadata.create_all`.

## 2. Sensitive areas

- **Recursive costing:** `backend/app/services/costing_service.py` uses memoized DFS and cycle detection. Preserve both.
- **Market POS idempotency:** `backend/app/routers/market_events.py` uses stable `client_reference` values to prevent duplicate checkout application.
- **Offline writes:** the removed generic mutation replay queue must not be reintroduced. Authentication, administrative, inventory, and financial writes are online-only unless they have a dedicated, reviewed, idempotent workflow.
- **Market POS offline mode:** only the isolated `hh_market_events_offline` IndexedDB workflow may retain cashier sales for replay. Reseller invoices and other financial writes remain blocked offline.
- **Positive preorder pricing:** public catalog and submission paths must require `retail_price > 0`.
- **Historical financial truth:** reseller, consignment, and Market Event sale items retain immutable price and cost snapshots.
- **Google Sheets:** reads are server-side, allowlisted, and auditable. Only explicitly enabled price fields may auto-apply within the safety band. Never place Google credentials in the repository or browser bundle.

## 3. Required validation

Before marking a change complete:

1. Backend:

   ```powershell
   $env:PYTHONPATH="backend"; python -m unittest discover -s backend/tests -v
   ```

   All discovered tests must pass.

2. Frontend:

   ```powershell
   cmd /c "npm run test"
   cmd /c "npm run lint"
   cmd /c "npx tsc --noEmit"
   cmd /c "npm run build"
   cmd /c "npm audit --omit=dev"
   ```

   Tests, lint, type-check, build, and the production dependency audit must pass with no warnings or errors.

3. Repository:

   ```powershell
   git diff --check
   git status
   ```

   Inspect all changes and confirm no temporary files, generated secrets, credentials, or unrelated user work are included.
