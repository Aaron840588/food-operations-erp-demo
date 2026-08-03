# H+H Hub — Project Context and Operations Reference

> Canonical application version: **2.8.0**
> Last reconciled: **2026-08-04**
> Production: [https://hh-portal.vercel.app](https://hh-portal.vercel.app)

H+H Hub is the operations and business-control platform for Handmade+Homemade. It replaces disconnected spreadsheets with linked workflows for products, recipes, purchasing, inventory, production, sales, partners, events, pre-orders, costing, and owner reporting.

## 1. Users and product principles

### Owner

- Full access to financial reporting, margins, product and recipe configuration, users, Sheet synchronization, and system administration.
- Uses the weekly dashboard to understand sales, direct costs, contribution profit, data confidence, and urgent operational actions.

### Staff

- Uses guided operational screens for inventory, Market Events, pre-orders, facility tasks, and timesheets.
- Must not receive supplier prices, unit costs, margins, or owner-only business totals through either the UI or API schemas.

### Product principles

- Keep workflows understandable for operators who may otherwise use paper or chat.
- Show plain-language causes and next actions, not only status codes or raw records.
- Never invent missing prices, recipe yields, supplier relationships, or packaging costs.
- Preserve historical transaction truth with immutable sale-time snapshots.

## 2. Current stack

| Layer | Current implementation |
|---|---|
| Frontend | Next.js `16.2.12`, React `19.2.4`, App Router, Turbopack |
| Styling | Tailwind CSS v4 and existing warm sand/cocoa design tokens |
| Data fetching | Typed same-origin API client, SWR, bounded read caches |
| Charts and icons | Recharts `3.9.2`, Lucide React |
| Backend | FastAPI `0.139.2`, Python serverless runtime |
| ORM | SQLAlchemy `2.0.28`; 45 models in `backend/app/models.py` |
| Local database | SQLite for isolated development and tests |
| Production database | Supabase PostgreSQL `17.6`, project `lstdqfvbhimqrhhgrnqy` |
| Deployment | Vercel project `hh-hub`, production alias `hh-portal.vercel.app` |
| Source control | `Aaron840588/H-H`, production branch `main` |

## 3. Repository map

```text
H-H-main/
├── .github/workflows/quality.yml     # Release quality gate
├── backend/
│   ├── app/
│   │   ├── main.py                   # FastAPI app and version endpoint
│   │   ├── models.py                 # All 45 SQLAlchemy tables
│   │   ├── schemas.py                # Request/response contracts
│   │   ├── routers/                  # Domain APIs
│   │   └── services/                 # Costing, stock, Sheets, and domain services
│   └── tests/                        # Backend unittest suite
├── frontend/
│   ├── src/app/                      # Next.js routes
│   ├── src/components/               # Shared application UI
│   ├── src/lib/api.ts                # Typed API boundary
│   ├── src/lib/indexedDb.ts          # Legacy generic queue sanitization only
│   └── src/lib/marketEventOfflineDb.ts # Dedicated Market POS offline journal
├── supabase/migrations/              # Reviewed production migrations
├── docs/                             # Architecture, business rules, audits, and operations
├── AGENTS.md                         # Required engineering constraints
├── CHANGELOG.md                      # Application release history
├── PROJECT_STATUS.md                 # Current verified release status
└── SESSION_CONTEXT.md                # Resume-ready infrastructure and workflow context
```

## 4. Core workflows

### Owner weekly dashboard

`GET /dashboard/owner-weekly` returns owner-only weekly revenue, recognized sales, immutable cost snapshots, contribution profit, direct-cost composition, product comparisons, alerts, and data-confidence notes. The dashboard defaults to the current Asia/Manila business week and links alerts to their resolving workflows.

### Public pre-orders

Customers use `/preorder/[publicToken]`. The public catalog exposes only enabled, active Spreads & Sauces and Sandwiches & Salads SKUs with `retail_price > 0`. The backend repeats the same allowlist and positive-price validation on submission, so a manipulated client cannot submit a hidden or zero-price product.

### Market Events

Event activation deducts warehouse stock once. Each checkout has a stable `client_reference`; the backend returns the existing transaction on retry instead of applying it twice. The dedicated Market POS IndexedDB journal is the only offline financial-write path. Event completion returns eligible remaining stock once and excludes recorded waste.

The owner-confirmed current Market Events catalog has 26 active core products: 12 Spreads & Sauces and 14 Sandwiches & Salads/Pasta items. Catalog retirement uses `is_active = false`; it never deletes products or rewrites transaction snapshots. A retired SKU already at an open event remains visible to its POS and may be retained, reduced, sold, or reconciled, but cannot receive a new or larger allocation.

### Inventory and production

Ingredient and finished-good stock changes synchronize the Main Facility mirror. Production planning recursively expands recipes, detects cycles, checks shortages, and consumes ingredient batches FIFO. Invalid recipes, yields, or zero-cost inputs create explicit source-data warnings.

### Reseller and consignment

Financial writes are online-only. Orders and settlements preserve price and cost snapshots so later product-cost edits cannot rewrite historical margin results.

Consignment dispatches price each SKU from the partner's configured discount off the master SRP, round to a whole peso using half-up rounding, and freeze that value in `reseller_price_snapshot`. Delivery totals use dispatched quantity, not units sold, and are operational DR values rather than recognized revenue. Blank DR input receives a stable server-generated number after the delivery ID exists.

### Google Sheets

The Hub implements controlled, one-way Sheet ingestion through server-side allowlisted reads and an owner review queue. Production contains two active Sheet sources and seven active mappings. Google Sheets API, a dedicated service account, keyless Vercel OIDC federation, and all Vercel configuration values are ready. The approved Partner Inventory workbook still needs Viewer access for that service account before the first live read. Only retail and reseller prices can be enabled for bounded automatic application; structural changes always require review.

## 5. Database state

- Production project: `H+H SG` / `lstdqfvbhimqrhhgrnqy`
- Region: Singapore (`ap-southeast-1`)
- PostgreSQL: `17.6`
- Public tables / SQLAlchemy models: `45`
- Active products: `26`
- Active products with non-positive retail price: `0`
- Active Sheet sources: `2`
- Active Sheet mappings: `7`
- Supabase security advisor findings: `0`
- Performance advisor output: informational unused-index observations only; do not remove indexes without representative traffic evidence.

Reviewed migrations own production schema state. `Base.metadata.create_all` is disabled for production.

## 6. Security and correctness invariants

1. Access tokens stay in memory; refresh tokens are secure HttpOnly cookies.
2. Owner-only routes use `require_owner`; operational routes use authenticated role checks and minimized staff schemas.
3. Login credentials and generic mutations are never written to IndexedDB.
4. Uncertain administrative, inventory, reseller, consignment, and other financial requests are not replayed.
5. Market POS offline sales retain stable identity, price snapshots, local stock, and manual-review evidence.
6. Public pre-orders require a positive server-validated price.
7. Warehouse mirrors synchronize in the same transaction as stock mutations.
8. Recursive costing preserves memoization and cycle detection.
9. Google authentication is keyless through short-lived Vercel OIDC federation and is never committed or exposed to the browser.
10. Direct public database access is denied; the authenticated FastAPI service owns business data access.

## 7. Known operational data work

These are source-data tasks, not reasons to fabricate defaults:

- Add approved supplier records and link ingredients.
- Repair missing recipes and invalid yields.
- Create stable packaging codes and an authoritative jar/label cost table.
- Correct the three duplicate Full/Half SKUs in the owner Sheet.
- Share the Partner Inventory workbook with the dedicated Google reader as Viewer, then verify one manual Sheet run before enabling automatic prices.
- Complete physical iPhone, Android, Samsung Internet, and event-printer validation.

The dashboard and costing services surface these gaps and lower confidence instead of reporting precise but unsupported margins.

## 8. Release gate

Run all of the following before release:

```powershell
$env:PYTHONPATH="backend"; python -m unittest discover -s backend/tests -v
cd frontend
cmd /c "npm run test"
cmd /c "npm run lint"
cmd /c "npx tsc --noEmit"
cmd /c "npm run build"
cmd /c "npm audit --omit=dev"
cd ..
git diff --check
git status
```

Then verify GitHub Actions, the Vercel production deployment and `/api/health`, the public preorder catalog, and Supabase security advisors.
