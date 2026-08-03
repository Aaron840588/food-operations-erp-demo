# H+H Hub Table and Product UI Audit

Audit date: 2026-07-17

Current status: the shared table/product standards remain active in H+H Hub
v2.6.1. The August 3 consignment dispatch-value work, Market Events create-dialog fix, and owner-catalog reconciliation reuse delivery cards, the shared inventory checklist, product identity, currency formatting, and responsive controls; no
replacement design system was introduced.

## Global standard

- Product identity order: human-readable name, canonical SKU, canonical size badge, then business category/status when useful.
- Product identity component: `ProductDisplay`; use its compact variant in dense rows and selectors.
- Business categories: `Spreads & Sauces`, `Sandwiches & Salads`, then the explicit fallback `Uncategorized`. Unknown products must never silently fall into Sandwiches & Salads.
- Active sales-line guard: product consumers use `isCurrentLineupProduct` in addition to active/placeholder checks.
- Jar size display: the badge shows physical weight (`240g`/`200g` for Indulge and `100g` for Sampler), while hierarchy headings may show the commercial format and measurement together (`Indulge / 240g`).
- Sandwich size display: the badge shows the canonical commercial portion (`Full`, `Solo`, or `Half`).
- Standard table density: 12px uppercase headers with 16-20px horizontal and 12px vertical padding; 52-56px normal rows; compact rows only for printouts and genuinely dense editors.
- Standard controls: 40-44px inputs, 36-40px icon actions, 40px row actions, and numeric inputs at least 80px wide.
- Alignment: identity/text left, money and comparable numbers right, statuses and compact controls centered, actions last.
- Formatting: `formatCurrency`, `formatDate`, `formatDateTime`, `formatJars`, `formatUnits`, and `formatProductQuantity` are the display contracts.
- Responsive behavior: retain horizontal scrolling for comparison-heavy tables; use product cards for editing-heavy workflows; keep identity, quantity, status, and primary action visible.

## Audit matrix

| Page/component | Table purpose | Categorization | Product display | Header / row dimensions | Controls | Mobile strategy | Formatting | Main inconsistency | Shared correction |
|---|---|---|---|---|---|---|---|---|---|
| `inventory/StockList` finished desktop | Finished stock and owner edits | Shared major category plus local size classifier | `ProductDisplay` plus a duplicate raw size chip | 12px, `px-4/6 py-3/4.5`; normal rows | 40px stepper, 64-80px input | Desktop table | Mixed raw/unit/currency | Duplicate size and local subgroup rules | `ProductDisplay`, shared size groups, standard numeric editor |
| `inventory/StockList` finished cards | Responsive stock editing | Flat filtered products | `ProductDisplay` plus category/SRP | Card `p-5` | 36px stepper, 80px input | Card conversion | Mixed unit wording | Owner-only price/edit controls leaked into cards | Role-aware card schema and standard actions |
| `inventory/StockList` raw stock | Ingredient stock and supplier data | Search plus used-in groupings | Manual ingredient identity | Mixed 10-12px headers and 32-36px rows | Repeated steppers/edit controls | Cards for flat view; scroll tables for grouped view | Mixed `g`, `units`, supplier fallbacks, and decimals | Four copies of row/control logic | Shared ingredient row and table density |
| `inventory/InventoryChecklist` | Shipment/allocation picker | Dynamically sorted business categories | Manual name, SKU, size | 10px; `px-3 py-2.5` | 24px quantity controls | Horizontal/vertical scroll | `formatUnits` only | Controls too small; no lineup guard; duplicated identity | Compact `ProductDisplay`, ordered categories, numeric editor |
| `inventory/AuditLedger` | Inventory history | Transaction type filter | Item name only | Large `px-6 py-4/4.5` | 48px filters; large Load More | Horizontal scroll | Locale-dependent timestamps | Taller than other logs; no shared date/status | Standard log shell, date/status formatting |
| `inventory/BatchManager` | FIFO batch history | Batch status | Ingredient only | 10px; `px-6 py-3` | None | Horizontal scroll | Raw ISO dates; quantity lacks unit | Expired rows also counted as expiring | Standard table, date/quantity/status primitives |
| `inventory/MrpForecast` | Replenishment forecast | Backend risk status | Ingredient only | 10px; `px-6 py-3` | Generate PO | Horizontal scroll | Value/unit concatenation | No shared numeric/risk formatting | Standard table and quantity/status primitives |
| `inventory/WarehouseManager` | Location and location-stock directory | No business category | Manual mixed ingredient/product line | Card/list density | 36-44px actions | Responsive card grid | Inferred `g`/`pcs` | SKU fallback can be blank; wrong savory size context | Shared warehouse stock identity |
| `planner` production targets | Schedule product quantities | Shared major category plus local classifier | `ProductDisplay` | 12px; `px-4 py-3` | 32px quantity controls | Horizontal scroll | Raw `n units` | Duplicate grouping, undersized controls | Product hierarchy table and shared numeric editor |
| `planner` shopping checklist | BOM ingredient requirements | Ingredient category accordion | Ingredient text | 12px; `px-4 py-3` | Completion controls | Horizontal scroll within accordion | Raw values/units | Valid specialized hierarchy but local table/state styles | Standard table inside accessible accordion |
| `planner` recipe sheets/summary | Printable production instructions | Product targets | Manual name/SKU/size | Compact cards/lists | Print action | Responsive stack and print expansion | Manual `jars` grammar | Product identity differs from target table | Compact `ProductDisplay`, product-aware quantity |
| `recipes` costing ledger | Product costs/margins | Shared major category plus local classifier | `ProductDisplay` | 12px; `px-4 py-3` | Row opens BOM | Horizontal scroll | Currency decimals without grouping | Unknowns forced to sandwiches; row impersonates button | Product hierarchy table and explicit action cell |
| `recipes` gift-set builder/cards | Bundle quantities and margin summaries | Flat product list | Manual name and size | 11-12px; compact rows/cards | 28px steppers | Stack/grid | Mixed currency formats | No lineup guard; tiny controls; identity omits SKU | Compact `ProductDisplay`, numeric editor, money formatter |
| `recipes` overhead rates | Editable category costs | Database categories | Not applicable | `px-6 py-4/4.5` | 40px inputs/actions | Horizontal scroll | Mixed numeric precision | Strong layout but unlabeled row inputs | Editable standard table |
| `recipes` BOM editors/details | Editable/read-only recipe lines | Ingredient/sub-product | Manual option and sub-product text | 12px; `px-4/5 py-2/3.5` | 36px or smaller icons | Scroll/stack in modal | Mixed currency/unit | Sub-products lose shared identity; actions undersized | Specialized BOM table using common cells/actions |
| `market-events` POS/cart | Cashier product selection | Shared major category | Manual raw name/SKU/size | Card/compact-list density | 32px cart controls | 1-3-column cards and stacked cart | Mixed price decimals | Mouse-only cards; raw size labels; no lineup guard | Interactive product card, compact product cell, numeric editor |
| `market-events` scheduler/allocation | Event cards and stock allocations | Allocation list | Manual allocation chips | Card `p-6/8` | 40px actions | 1-2-column cards | Raw ISO dates and currency | Allocation identity omits SKU; raw size | Specialized event card with compact product cells |
| `market-events` analytics/conflicts | Ranked products and sync conflicts | Performance/status | Multiple manual product blocks | Compact rows/cards | Small actions | Stacked panels/cards | `jars` grammar and locale time | Size/status/identity differ by panel | Ranked/history product primitives and shared formatters |
| `market-events` journal/reports | Sales, return, preorder, and closeout tables | Event data/status | Manual item or product identity | From 10px print rows to normal rows | 32px closeout editors | Some tables scroll; some clip | Mixed money/date/quantity | Print density leaks into interactive editors; missing overflow | Normal/print table variants and standard editors |
| `resellers` product selection/cart | Wholesale POS | Shared major category plus hardcoded subgroups | Manual name/SKU/raw size | Cards `p-4/6`; compact cart | 32-40px controls | 1-2-column cards | Manual jar wording | Products outside hardcoded groups disappear; size differs from invoice | Shared size groups, `ProductDisplay`, numeric editor |
| `resellers` history/invoice | Read-only orders and print invoice | None | Flattened names in history; partial canonical invoice | 12px; `px-5/6 py-3/4` | 32px actions | Horizontal scroll/print | Dates raw; currency mostly fixed | History omits SKU/size and standard status | Log shell, product summary cell, date/status formatting |
| `consignment` partner/delivery ledger | Store selection, dispatch value, and shipment settlement | Store active state; no product grouping | Shared product identity in desktop/mobile delivery views | Table `px-6 py-4`; cards `p-5` | 40px inputs/save | Desktop table to mobile cards | Shared quantity/currency formatting | Responsive duplication remains intentional for dense editing; value placement is now aligned | Specialized delivery card using shared identity/formatters |
| `settings` discount tiers | Numeric configuration | Not applicable | Not applicable | `px-6 py-4` | ~36px delete | Horizontal scroll/stacked layout | Currency 2 decimals; percent 1 | Missing empty/error state and accessible delete label | Standard table, numeric cell, row action |
| `tasks` checklists/assets | Operational checklist and condition grid | Task cadence/area | Not applicable | Cards `p-4/6` | 30-44px actions | Responsive cards | Raw ISO dates | Repeated sections, small icon actions, weak selected semantics | Shared task row/status/action patterns |
| Dashboard alert/history lists | Low stock, margins, shipments, batches, targets | Mixed backend values | Manual product identity | Compact cards/rows | 32px actions | Flex rows with limited wrapping | Mixed money/date/pluralization | Duplicate lists and product hierarchy drift | Shared alert/action rows and compact product display |

## Intentional specialized layouts

- Consignment keeps delivery cards because DR, payment state, and settlement belong to the delivery run rather than to a flat global ledger.
- Market Events keeps event cards, cashier product cards, and printable closeout sheets because allocation, live checkout, and print density have different operational needs.
- Recipes keeps editable BOM rows and ingredient replacement controls because they are an editor, not a read-only ledger.
- Inventory keeps category and size group rows because the hierarchy materially improves stock scanning.
- Wholesale POS keeps product-selection cards because the main task is adding items quickly, not comparing many tabular columns.
- Tasks keeps checklist and maintenance cards because large touch targets and condition controls are more useful than a table on kitchen devices.

These exceptions still use the same product identity, categories, size badges, control dimensions, formatting, status semantics, and responsive priorities.

## Implementation outcome

### Shared layer

- Extended `ProductDisplay` with default, compact, and selector variants; two-line product names; optional icon/category/missing-size behavior; and canonical `ProductSizeBadge` use.
- Kept `ProductSizeBadge` as the only size-style renderer and documented commercial-format versus physical-weight labels through its tooltip.
- Added `DataTableShell`, `DataTableHeader`, `DataTableToolbar`, `DataTableScroll`, shared header/row/cell states, loading/empty states, and pagination primitives.
- Added `NumericQuantityInput` with 40px actions, an 80px value field, accessible labels, bounds, and spinner-safe number styling.
- Added `StatusBadge` with shared success, warning, danger, informational, and neutral mappings.
- Centralized the explicit `Uncategorized` fallback, current-lineup guard, product size groups, product-aware quantities, currency, date, and date-time formatting in `lib/utils.ts`.

### Updated table and table-like surfaces

- Inventory: finished-goods desktop table, finished-goods responsive cards, raw-material lists, shipment checklist, audit ledger, FIFO batch table, MRP forecast, warehouse directory, and warehouse transfer selector.
- Production Planner: smart suggestions, production-target table, shopping checklist, production summary, and printable recipe sheets.
- Recipes & Costing: costing ledger, gift-set builder and summary, overhead-rate editor, editable BOM, read-only BOM details, and sub-product selectors.
- Market Events: cashier product cards and cart, event allocation lists, analytics rankings, conflict cards, sales journal, return-stock report, preorder table, and closeout waste editor.
- Wholesale / Resellers: product selection cards, cart, frequent-customer/order inputs, order history, invoice summary, and print invoice.
- Consignment: partner directory, KPI cards, delivery headers, shipment tables, responsive shipment cards, and settlement/edit controls.
- Settings: discount-tier table, loading/error/empty states, delete actions, and creation controls.
- Facility Tasks: daily and periodic cleaning rows, maintenance asset cards, status/date treatment, and owner actions.
- Dashboard: low-stock, margin, missing-cost, shipment, batch, and production-target alert lists.

### Responsive evidence

- Baseline captures: `docs/audit-screenshots/before/`
- Final captures: `docs/audit-screenshots/after/`
- Matched route states were captured at 1440x1000 desktop, 900x1100 tablet, and 390x844 mobile viewports for Inventory, Planner, Recipes, Market Events, Wholesale, Consignment, Settings, and Tasks.

### Validation

- Backend unit tests: 144 passed in the v2.4.1 release gate.
- Frontend ESLint: passed with zero warnings.
- Frontend TypeScript and Next.js production build: passed.
- Git whitespace check: passed; no backend files or raw secrets were changed.
