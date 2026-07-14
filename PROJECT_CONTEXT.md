# H+H Hub — Project Context & Operations Reference

> **H+H Hub** (Handmade+Homemade) is an enterprise resource planning (ERP) and operations management platform designed for premium food manufacturing and retail operations. It unifies operations, inventory tracking, recipe costing, production planning, wholesale, consignment, and pop-up retail sales into a high-performance web application.

---

## 🥪 1. Product Overview & User Base

H+H Hub manages jarred spreads and sauces (e.g., synthetic gourmet spreads, pesto) and prepared sandwiches and salads in kitchen and warehouse facilities.

### Intended Users
1. **The Owner (`owner` role)**:
   * Has full administrative control.
   * Accesses financial dashboards, synthetic corporate revenues, margin analysis, and net profit margins.
   * Configures product catalog settings, reseller pricing setups, wholesale discount brackets, and SKU labor/utility costs.
   * Manages system backups, data wipes, and staff registrations.
2. **Operations Staff (`staff` role)**:
   * Accesses simplified "Station Views" optimized for kitchen work.
   * Manages daily production planner setups, checklist logs, consignment dispatches, and manual inventory adjustments.
   * Operates Pop-Up Bazaar cashier POS booths.
   * All sensitive costing figures, net profit margins, and revenue curves are strictly redacted from staff views.

---

## 💻 2. Technology Stack & Architecture

The application is built as a **serverless monorepo** with a decoupled frontend client and a high-performance backend API.

| Layer | Technology | Key Details |
|---|---|---|
| **Frontend** | Next.js | Modern React framework with Turbopack compiler and App Router |
| **Styling** | Tailwind CSS / Vanilla CSS | Tailwind with custom CSS variables (Warm Cozy Sand theme) |
| **Visuals** | Recharts & Lucide Icons | Responsive SVG icons and KPI charts (margins donut, revenue trends) |
| **Offline Cache**| IndexedDB & LocalStorage | Offline cashiering buffers, offline queue replaying, SWR local fallback |
| **Backend** | FastAPI (Python) | ASGI python server |
| **ORM** | SQLAlchemy | Mapping relationships eagerly via `joinedload` |
| **Security** | PyJWT & passlib[bcrypt] | BCrypt password hashing, JWT sessions, HttpOnly cookies |
| **Database** | SQLite (Local) / Supabase (Cloud)| SQLite: `backend/happy_noether.db` / Supabase: PostgreSQL (Demo Sandbox) |
| **Deployments**| Vercel & GitHub | Frontend & backend hosted unified |

---

## 📂 3. Repository Structure & Responsibility

```
.
├── .github/workflows/          # CI Quality Gate pipeline
├── docs/                       # High-level architecture, business rules, and roadmap docs
├── migration/                  # Supabase PostgreSQL schema migrations and seeding
├── scripts/                    # Maintenance, re-seeding, and import utilities
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI bootstrap, auth routers, and startup event hooks
│   │   ├── database.py         # DB engines, pools, and Main Facility stock sync
│   │   ├── models.py           # Single file containing all 31 SQLAlchemy database tables
│   │   ├── schemas.py          # Unified Pydantic request/response contract schemas
│   │   ├── auth.py             # BCrypt cryptography & dual-token authenticated guards
│   │   ├── notifications.py    # VAPID webpush browser alert dispatchers
│   │   └── services/
│   │       ├── costing_service.py  # Recursive DFS recipe costs compiler and cache
│   │       └── fifo_service.py     # FIFO batch inventory decrement and fallback logs
│   └── tests/                  # Backend unit testing suite (unittest framework)
└── frontend/
    ├── src/
    │   ├── app/                # App router pages (dashboard, inventory, planner, etc.)
    │   ├── components/         # UI design library (Buttons, Modals, Badges, Layout)
    │   └── lib/
    │       ├── api.ts          # Centralized typed HTTP API boundaries and offline queues
    │       ├── indexedDb.ts    # IndexedDB actions store for local offline operations
    │       └── utils.ts        # Shared format helpers and active-line guards
    ├── public/                 # Static vector assets, logos, and PWA manifest / sw.js
    ├── package.json            # Node.js dependencies, scripts, and overrides
    └── tsconfig.json           # Strict TypeScript compilation parameters
```

---

## 🏁 4. Key End-to-End Traced Workflows

### Flow A: B2B Reseller (Wholesale) POS Order & Billing
* **Entry Point**: `/resellers` page.
* **UI Action**: Split-pane interface. Staff searches SKUs, enters quantities, selects preset frequent customers, or overrides volume discount tiers manually.
* **State & Validation**: Subtotal, discount percentage, VAT, and grand total are calculated in real time. Input quantity is capped by `available_stock`.
* **API Call**: `POST /resellers/orders` containing array of items.
* **Backend Logic**: Eagerly locks SKU stock rows. Compares requested qty vs `warehouse_stock`. Subtracts stock and logs a decrement transaction under `"consume"` in `inventory_transactions`.
* **DB Entities**: Writes to `reseller_orders` and `reseller_order_items`. Decrements `product_skus.warehouse_stock` and triggers bi-directional synchronization with `warehouse_stocks` for physical Main Facility (ID: 1).
* **State Feedback**: Success prompts the billing invoice print statement view (print-optimized card layouts). Error aborts safely and keeps items in POS cart. Offline attempts raise `UnconfirmedFinancialMutationError` as financial writes cannot be queued.

### Flow B: Pop-Up Market Bazaar Cashier POS
* **Entry Point**: `/market-events` -> Click "Sales Mode" on an Active event.
* **UI Action**: Full-screen, tablet-optimized cashier grid. Cashier filters by category pill, taps to add items to cart, opens numeric keypad, computes change.
* **State & Validation**: Optimistic offline cart. Uses a unique client-side UUID `client_reference` to prevent duplicate transaction replay.
* **API Call**: `POST /market-events/{event_id}/sales`.
* **Backend Logic**: Idempotency guard checks if `client_reference` exists as an active transaction hash in `inventory_transactions`. If so, returns previous transaction. If fresh, validates that allocations have enough stock, decrements `market_event_allocations.quantity` (keeping remaining jars count for audit), and logs cashier sale.
* **DB Entities**: Writes to `market_event_sales`, `market_event_sale_items`, and logs idempotency hash.
* **Offline Resilience**: If the internet disconnects, the frontend caches the sale in IndexedDB (`offlineDb`). When internet restores, a background SWR hook replays pending sales automatically. Cashiers can undo un-synced sales locally with 1 click to avoid double submissions.

### Flow C: B2B Consignment Dispatch, Sold, and Write-Off
* **Entry Point**: `/consignment` page.
* **UI Action**: Staff delivers products to partner stores. Weekly, staff records "Units Sold" and "Pull-outs" (expired jars returned to kitchen).
* **State & Validation**: Tracks Delivery Receipt (DR) numbers. Quantities sold + pull-outs must equal delivered. Captures snapshot prices (store price, reseller price, unit cost) at transaction time to preserve historical margins.
* **API Call**: `PUT /consignment/delivery-items/{id}` to record weekly counts.
* **Backend Logic**: Receives quantities. Calculates partner margins and write-offs. For each pulled-out expired item, logs a transaction under `"waste"` in `inventory_transactions`.
* **DB Entities**: Writes to `consignment_items` and `inventory_transactions`.

### Flow D: Production Planner (BOM DFS explosion & FIFO deduction)
* **Entry Point**: `/planner` page.
* **UI Action**: Staff creates a plan date, adds SKU production targets. Clicking "Forecast" compiles a Bill of Materials. Clicking "Complete Plan" triggers stock deduction.
* **State & Validation**: Displays alerts if a target SKU has no recipe ("Missing BOM"). Compiles aggregated raw ingredients needed and shows a deficits checklist. If available stock is insufficient, "Complete" is disabled or blocked.
* **API Call**: `POST /production/plans/{id}/complete`.
* **Backend Logic**: Computes aggregate ingredients recursively using Deep-First Search (DFS). Verifies warehouse ingredient stocks. Deducts stock from `ingredient_batches` in FIFO order (sorted by `expiry_date ASC`, nulls last). If deficit still happens, records in `BATCH-OVERFLOW-DEFICIT`.
* **DB Entities**: Writes to `production_plans`, `production_targets`, `inventory_transactions`, and decrements `ingredient_batches` and `raw_ingredients.available_stock` (syncing Main Facility warehouse stock).

---

## 🗄️ 5. Database Schema (31 Tables)

The database models map physical entities, transactional ledgers, and configurations.

```
                                  +-------------------+
                                  |    suppliers      |
                                  +---------+---------+
                                            | 1
                                            | N
  +------------------+  1         N +-------v---------+
  |  users (RBAC)    +--------------+ raw_ingredients |
  +--------+---------+              +-------+---------+
           | 1                              | 1
           | N                              | N
  +--------v---------+              +-------v---------+
  |  refresh_tokens  |              |ingredient_batches| (FIFO expiries)
  +------------------+              +-----------------+
           |
           | 1                      +-----------------+
           | N                      |   warehouses    |
  +--------v---------+              +-------+---------+
  | push_subscript's |                      | 1
  +------------------+                      | N
                                    +-------v---------+
                                    |warehouse_stocks | (Multi-Location)
                                    +-----------------+

  +------------------+ 1          N +-----------------+
  |   product_skus   +--------------+  recipe_items   | (Junction)
  +--------+---------+              +-------^---------+
           | 1                              | N
           | 1 (uselist=False)              | 1
  +--------v---------+                      |
  |     recipes      +----------------------+
  +------------------+

  +------------------+ 1          N +-----------------+
  | reseller_orders  +--------------+reseller_order_it|
  +------------------+              +-----------------+

  +-------------------+ 1         N +-----------------+
  |consignment_partner+-------------+consignment_deliv|
  +-------------------+             +-------+---------+
                                            | 1
                                            | N
                                    +-------v---------+
                                    |consignment_items|
                                    +-----------------+

  +------------------+ 1          N +------------------+
  |  market_events   +--------------+market_event_alloc|
  +--------+---------+              +------------------+
           | 1
           | N
  +--------v---------+ 1          N +------------------+
  |market_event_sales+--------------+market_event_sale_i|
  +------------------+              +------------------+
```

### Table Dictionary
1. **`users`**: Passcode-accessed profiles with role definitions (`owner` / `staff`).
2. **`suppliers`**: Contact credentials mapping ingredient origins.
3. **`raw_ingredients`**: Raw materials catalogs showing purchasing unit prices and stocks.
4. **`product_skus`**: Finished sellable products. Stores product-specific `labor_cost` and `utility_cost`.
5. **`recipes`**: Portion yield weights and formulas linked to product SKUs.
6. **`recipe_items`**: Ingredients mapping within recipes. Supports sub-recipe SKUs recursively.
7. **`discount_tiers`**: Database-backed reseller volume discounts threshold ranges.
8. **`reseller_orders`**: Log of reseller transactions and pricing subtotals.
9. **`reseller_order_items`**: Line items inside reseller orders.
10. **`consignment_partners`**: Store partners, discount schedules, and collection profiles.
11. **`consignment_deliveries`**: Individual delivery dispatches tracking payment states.
12. **`consignment_items`**: Item snapshots (sold, wasted) inside consignment deliveries.
13. **`inventory_transactions`**: Double-entry transactional ledger recording all material movements.
14. **`maintenance_assets`**: Facility asset tracking checklists.
15. **`cleaning_tasks`**: Daily sanitation progress trackers.
16. **`warehouses`**: Directories of physical storage locations.
17. **`warehouse_stocks`**: Junction stocks table allocating quantities per location.
18. **`push_subscriptions`**: Device credential profiles for web browser push alerts.
19. **`market_events`**: Weekend pop-up bazaar schedules and states.
20. **`market_event_allocations`**: Stock reserved and dispatched to pop-up bazaar booths.
21. **`market_event_sales`**: POS transactions completed by bazaar booth cashiers.
22. **`market_event_sale_items`**: Snapshot logs of items sold inside each cashier sale.
23. **`ingredient_batches`**: FIFO batch records tracking ingredient expiry dates.
24. **`refresh_tokens`**: Sessions rotating keys mapping secure HttpOnly tokens.
25. **`category_overhead_rates`**: Category default labor/utility costs used as backfalls.
26. **`overhead_configs`**: Allocated monthly overhead budgets.
27. **`production_batches`**: Completed production yield records.
28. **`production_plans`**: Master calendars showing production setups.
29. **`production_targets`**: Target outputs defined inside plans.
30. **`gift_sets`**: Customizable pre-packed product bundles.
31. **`gift_set_items`**: Quantities of SKUs packed inside gift sets.

---

## 🔒 6. Security & Access Control

1. **Dual-Token Authentication**:
   * Short-lived 15-minute access tokens are held in-memory.
   * Long-lived 14-day refresh tokens are managed via secure, HttpOnly, SameSite=Strict cookies.
   * Silent refresh updates expired tokens transparently.
2. **Access Control (RBAC)**:
   * Endpoints are protected by dependency guards (`require_owner`, `get_current_user`).
   * Financial analytics and pricing configuration routes are restricted to the `owner` role.
   * Operational views are tailored for standard `staff` role with sensitive margins redacted.
3. **Database Security**: Configured with Row Level Security (RLS) for cloud environments, bypassing serverless pools while blocking direct public API connections.
4. **HTML Sanitization**: Input fields in critical CRUD forms are automatically sanitized server-side.
