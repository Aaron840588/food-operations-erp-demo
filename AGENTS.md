# H+H Hub — AI Developer Operating Instructions

> **IMPORTANT**: You must read `PROJECT_CONTEXT.md` at the project root before making any application changes. This project has customized, highly optimized database-synchronized workflows and strict security restrictions.

---

## 🏗️ 1. Core Architectural & Code Rules

1. **Next.js & Frontend Constraints**:
   * **Framework**: Next.js App Router (Next `16.2.10` with Turbopack).
   * **Styling**: Tailwind CSS `v4` with custom CSS variables (Cozy Warm Sand theme `#f4eee3`, Deeper Beige `#dfd5c6`). Use vanilla Tailwind classes, mimicking surrounding layouts.
   * **State**: Use React state hooks. Prefetch data using `SWR` with local storage fallbacks for instant page loading.
   * **Current Sales Lineup Guard**: The client must restrict product lists to active **Spreads & Sauces** and **Sandwiches & Salads** product lines. Filter out other categories.
2. **FastAPI & Backend Constraints**:
   * **Models**: All 31 tables are defined in `backend/app/models.py`. Keep them unified there. Do not delete or rename existing columns without explicit instruction.
   * **Dual-Token Auth**: Access tokens are stored in-memory; refresh tokens are secure HttpOnly cookies. Access endpoints using the token-authorized header.
   * **Date & Boolean Type Casting**: Enforce strict casting rules (e.g. `Union[str, date]` or clean boolean filters) to avoid database timeout retries in cloud PostgreSQL.
3. **Database & Stock Mappings**:
   * **Warehouse Stock Synchronization**: All mutations modifying `available_stock` (ingredients) or `warehouse_stock` (SKUs) must trigger `sync_warehouse_stock_for_main_facility(db, ...)` to keep multi-location warehouse inventories in sync.

---

## 🚫 2. Sensitive & Risky Areas (Do NOT Modify Lightly)

* **DFS Recursive Costing**: `backend/app/services/costing_service.py` calculates recursive ingredient and packaging costs. Ensure you preserve memoized cache structures and DFS cycle detection.
* **Idempotent Bazaar Cashiering**: `backend/app/routers/market_events.py` uses `client_reference` hashes in transaction logs to protect cashier POS booths against double-click submissions. Preserve this idempotency check.
* **Offline Operations Queue**: `api.ts` queues write mutations to IndexedDB (`offlineDb`) when offline, EXCEPT for reseller invoices and bazaar cashier checkouts. Keep these financial writes strictly blocked from offline queues.

---

## 📋 3. Step-by-Step Validation & Quality Gate

Before marking any task as complete, you **must** run the following quality checks:

1. **Verify Backend Unit Tests**:
   * Execute:
     ```powershell
     $env:PYTHONPATH="backend"; python -m unittest discover -s backend/tests -v
     ```
   * All 31 tests must pass cleanly.
2. **Verify Frontend ESLint Rules**:
   * Execute:
     ```powershell
     cmd /c "npm run lint"
     ```
   * Must compile with **zero ESLint warnings**.
3. **Verify Next.js Production Compilation**:
   * Execute:
     ```powershell
     cmd /c "npm run build"
     ```
   * Build must compile successfully without TypeScript or hydration errors.
4. **Inspect Git Changes**:
   * Inspect status:
     ```powershell
     git status
     ```
   * Verify diffs and check that no temporary files or raw secrets are staged.
