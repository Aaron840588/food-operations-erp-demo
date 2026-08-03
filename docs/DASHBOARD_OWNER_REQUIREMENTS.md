# H+H Hub Owner Dashboard — Product Requirements and Implementation Guide

> **Document status:** Implemented in H+H Hub v2.4.0
> **Prepared from:** Owner feedback and the supplied dashboard reference image
> **Prepared on:** 2026-07-29
> **Primary user:** H+H owner
> **Supporting users:** Operations staff, with financial information redacted

## Implementation record

The dashboard described here is now implemented in `frontend/src/app/page.tsx` and the owner-only weekly dashboard backend service.

- Current Asia/Manila business week and previous-week comparison are live.
- Recognized weekly sales, immutable cost snapshots, contribution profit, direct-cost charts, Action Center, and five requested product analysis modes are implemented.
- Alerts link to Market Events, collections, inventory, costing, production, and Sheet setup workflows.
- Missing recipes, invalid yields, zero-cost ingredients, missing suppliers, and Sheet configuration lower the displayed confidence instead of producing false precision.
- Desktop `1440x1024` and mobile `390x844` visual and interaction checks passed; evidence is recorded in `design-qa.md`.
- Physical iOS/Android accessibility and printer validation remains an operational follow-up.

## 1. Purpose

The owner wants the dashboard to become the first place she checks to answer five questions:

1. **How much did we sell this week?**
2. **How much did the products sold this week cost us?**
3. **Are we profitable, and which costs are driving the result?**
4. **What needs immediate attention?**
5. **Which products are healthy or risky when price, food cost, labor, utility, and margin are compared?**

The dashboard should not be another spreadsheet or a collection of disconnected cards. It should connect sales, product costing, expenses, inventory movements, partner collections, and events into one owner-facing weekly view.

## 2. Owner Request, Restated as Product Requirements

### Required dashboard content

- Weekly food-cost computation linked to:
  - actual recognized sales;
  - product and ingredient costs;
  - recorded expenses;
  - inventory usage, waste, and stock movement.
- Top alerts:
  - upcoming and active events;
  - price increases;
  - delayed partner collections;
  - low stock and expiring inventory;
  - invalid or incomplete cost records;
  - other system red flags.
- Sales for the current week.
- A selectable product analysis chart with these views:
  - SRP versus profit margin;
  - price versus food cost;
  - price versus labor cost;
  - price versus utility cost;
  - all costs per product.

### Intended owner experience

The owner should be able to open the dashboard and understand the state of the business in under one minute. Every warning or number that needs investigation should link to the relevant screen and filtered record.

## 3. Reference Image Interpretation

The supplied image is a **layout and information-hierarchy reference**, not a visual theme to copy exactly.

Useful ideas to retain:

- one compact top row of headline metrics;
- one consolidated alert table with clear priority and direct links;
- weekly cost charts directly below the alerts;
- a dedicated product cost and margin visualizer with a chart selector;
- visible date scope and last-updated information.

Ideas to adapt for H+H:

- retain the existing H+H warm sand, beige, cocoa, and gold design tokens;
- avoid the bright all-blue card treatment;
- use color mainly for status and chart meaning;
- use existing H+H components such as `Card`, `StatusBadge`, `ProductDisplay`, `ProductSizeBadge`, and shared formatters;
- keep the dashboard usable on a 390px mobile screen without forcing users to interpret a desktop table.

## 4. Pre-v2.4 Application Baseline

This table records the gaps that existed before the v2.4.0 implementation. It is retained as product-decision history; use the implementation record above and `PROJECT_STATUS.md` for the current state.

| Owner need | Existing support | Remaining gap |
| --- | --- | --- |
| Period selection | All activity, last 7 days, last 30 days, and custom range | Default should be **This Week**, with an explicit previous-week comparison |
| Weekly sales | Combined consignment, reseller, and market-event revenue can be date filtered | Revenue treatment must be standardized across VAT, tips, discounts, complimentary sales, and receivables |
| Food cost / COGS | Combined material COGS is calculated | Reseller and market-event sales use the product’s current cost instead of an immutable cost-at-sale snapshot |
| Profit and margin | Combined sales, COGS, net profit, and margin are displayed | The current “net profit” does not include every weekly expense, actual labor, or actual utility expense |
| Collections | Unpaid consignment value and deliveries are displayed | No explicit due date or centralized overdue rule in the dashboard response |
| Cost comparison | Category averages and top/bottom margins exist | Owner wants selectable, per-product comparisons |
| Price-hike alert | Ingredient prices can be updated | No durable price-history record or price-increase alert rule |
| Event alert | Market Events module exists | Upcoming events and readiness risks are not included in the dashboard summary |
| Inventory alert | Low stock and expiring batches exist | Alerts need business priority, impact, owner action, and direct navigation |
| Expenses | Market-event closeout expenses and timesheet labor exist | No unified general expense ledger across the business |

## 5. Proposed Dashboard Information Architecture

The owner dashboard should be reorganized into five primary sections.

### Section 1 — Reporting controls and data confidence

Place this directly beneath the page title.

Controls:

- **This Week** — default, Monday 00:00 through Sunday 23:59 in `Asia/Manila`;
- Last Week;
- Last 7 Days;
- Last 30 Days;
- Custom Dates.

Display:

- selected date range;
- last refreshed time;
- data status:
  - `Complete`;
  - `Estimated`;
  - `Needs Review`.

The confidence label is essential. The dashboard must not present estimated margin as final profit when cost snapshots or expense allocations are incomplete.

### Section 2 — Weekly business summary cards

Use four primary cards on desktop and a two-column grid on mobile.

#### Card 1: Weekly Sales

Primary value:

- net recognized sales for the selected period.

Supporting information:

- percentage change versus the equivalent previous period;
- transaction or order count;
- optional channel breakdown: Market Events, Resellers, Consignment.

Click behavior:

- opens a sales breakdown drawer or scrolls to the channel breakdown;
- each channel links to its source page.

#### Card 2: Weekly Food Cost

Primary value:

- food and portion-packaging COGS attributable to products sold during the period.

Supporting information:

- food cost percentage of net sales;
- change versus previous period;
- confidence label if any sale item lacks a historical cost snapshot.

Click behavior:

- opens the weekly cost breakdown;
- links to Recipes & Costing for invalid product costs.

#### Card 3: Contribution Profit and Margin

Primary value:

- sales minus direct product cost, allocated labor, allocated utility, and directly linked operating expenses.

Supporting information:

- margin percentage;
- comparison with previous period;
- `Estimated` label until the unified expense ledger is complete.

The UI should not call this **Net Profit** until all agreed operating expenses are captured. Use **Contribution Profit** during the first implementation phase.

#### Card 4: Pending Collectibles

Primary value:

- unpaid partner and eligible reseller receivables.

Supporting information:

- overdue amount;
- count of overdue records;
- oldest overdue age.

Click behavior:

- opens Consignment or Resellers with `Unpaid` or `Overdue` already selected.

### Section 3 — Top Alerts and Events

Use one consolidated list instead of several unrelated warning cards.

Recommended columns on desktop:

| Priority | Type | What happened | Impact | Status / Due | Action |
| --- | --- | --- | --- | --- | --- |

Recommended mobile presentation:

- one alert card per item;
- type and priority at the top;
- short plain-language explanation;
- due date or age;
- one large action button.

#### Alert priority

- **Critical:** financial or inventory integrity risk requiring action now.
- **Warning:** action should happen within the next few days.
- **Information:** upcoming event or useful reminder.

#### Alert types and initial rules

| Alert type | Initial rule | Example owner-facing copy | Destination |
| --- | --- | --- | --- |
| Price increase | Ingredient purchase price rises by at least 5%, or causes a product margin drop of at least 2 percentage points | `Butter increased 8% and affects 4 active products.` | Inventory ingredient editor or Recipes |
| Delayed collectible | Unpaid consignment delivery is past its due date; temporary fallback is 15 days after delivery | `Partner A has ₱4,500 overdue by 12 days.` | Consignment partner and delivery |
| Upcoming event | Event is within 14 days | `Weekend Market is in 6 days.` | Market Events |
| Event readiness risk | Event is within 7 days and has missing cashier assignment, no allocation, low warehouse stock, unresolved offline sale, or incomplete preparation | `Weekend Market has 3 allocation shortages.` | Market Event edit/readiness view |
| Low stock | Available quantity is at or below reorder level | `Basil is below its reorder level.` | Inventory |
| Expiring stock | Ingredient batch expires within 15 days | `Cream batch expires in 4 days.` | FIFO batches |
| Margin risk | Valid product margin falls below the configured threshold | `Yema Sampler margin fell to 42%.` | Recipes & Costing |
| Cost configuration error | Missing recipe, invalid cost, non-positive cost, or cost at/above selling price | `Pesto Solo has an invalid cost basis.` | Recipes & Costing |
| Inventory reconciliation | Computed stock and warehouse mirror disagree | `Main Facility stock needs reconciliation.` | Warehouse Management |
| Data freshness | Required source has not been updated within the agreed window | `Partner sales have not been updated for 10 days.` | Relevant partner or integration |

#### Alert ranking

Alerts should be ordered by:

1. criticality;
2. financial or stock impact;
3. overdue age or days until event;
4. newest detection time.

Do not show multiple duplicate alerts for the same record and rule. Alerts should have a stable fingerprint and remain acknowledged until the underlying condition is resolved or the owner dismisses them with a reason.

### Section 4 — Weekly Cost Computation

This section should explain where the week’s sales went.

#### Chart A: Weekly direct cost by category

Recommended chart:

- grouped or stacked bars;
- categories on the horizontal axis;
- components:
  - food ingredients;
  - portion packaging;
  - labor;
  - utility;
  - direct event or channel expense.

Recommended categories:

- Spreads & Sauces;
- Sandwiches & Salads;
- Pasta / Ready-to-Eat, if confirmed as an active reporting category;
- Gift Sets & Packages;
- Add-ons & Packaging, if they carry real cost.

Do not silently omit active categories. Category reporting policy must match the active product-line policy used by sales and costing.

#### Chart B: Overall weekly cost breakdown

Recommended chart:

- donut chart for share of total direct cost;
- center label displays total cost;
- legend displays both amount and percentage.

#### Weekly inventory reconciliation

Display a compact reconciliation strip:

```text
Opening inventory
+ purchases and adjustments in
+ production returns
- production consumption
- sales-related consumption
- waste and write-offs
= expected closing inventory
```

Compare expected closing inventory with recorded closing inventory. Any difference should become an alert; the dashboard should never silently “fix” stock.

## 6. Product Cost and Margin Visualizer

This section implements the owner’s requested chart dropdown.

### Common controls

- chart view dropdown;
- product category dropdown;
- search by product name or SKU;
- `Top 10`, `Bottom 10`, or `All`;
- sort by margin, price, or selected cost;
- optional `Per Unit` versus `Selected-Period Total`.

Default:

- `SRP vs Profit Margin`;
- active current-line products only;
- lowest-margin products first, because this is the most actionable owner view.

### View 1: SRP vs Profit Margin

Use a combination chart:

- bars: SRP in pesos;
- line: profit margin percentage;
- left axis: pesos;
- right axis: percentage.

Do not put pesos and percentages on one scale.

Tooltip:

- product and size;
- SKU;
- SRP;
- total cost;
- contribution profit per unit;
- margin percentage;
- costing confidence.

### View 2: Price vs Food Cost

Use paired bars:

- selling price;
- food and portion-packaging cost.

Supporting tooltip:

- food cost percentage of price;
- primary high-cost ingredient;
- last cost recalculation date.

### View 3: Price vs Labor Cost

Use paired bars:

- selling price;
- labor cost per unit.

Label labor as:

- `Actual allocated labor` when derived from approved timesheets allocated to production;
- `Standard labor estimate` when using the current SKU or category fallback.

### View 4: Price vs Utility Cost

Use paired bars:

- selling price;
- utility allocation per unit.

Label the utility value as an estimate until actual bills are allocated through an approved policy.

### View 5: All Costs per Product

Use stacked bars:

- food;
- packaging;
- labor;
- utility;
- direct expenses;
- remaining contribution profit.

Optional line:

- selling price.

If the stacked cost exceeds selling price, highlight the product and create a margin-risk alert.

## 7. Financial Definitions and Calculation Contract

The dashboard needs explicit accounting definitions before implementation. These definitions should be applied consistently across every sales channel.

### Recommended revenue basis

```text
Net recognized sales
= item selling amounts
- promotions
- manual discounts
- refunds
```

Exclude from sales revenue:

- VAT or other tax collected on behalf of government;
- tips;
- opening cash float;
- cash overages or shortages;
- owner cash injections;
- complimentary or free items.

Track separately:

- tips;
- taxes;
- paid versus receivable sales;
- complimentary quantities;
- refunds;
- cash variance.

### Recommended weekly food cost

```text
Weekly food cost
= sum of sold quantity × immutable food-and-packaging cost snapshot
```

The snapshot must represent the cost when the sale was recorded or fulfilled. Historical sales must not change when a supplier price or recipe changes later.

### Recommended contribution profit

```text
Contribution profit
= net recognized sales
- food and packaging COGS
- allocated direct labor
- allocated utility
- direct channel or event expenses
```

### Recommended contribution margin

```text
Contribution margin %
= contribution profit ÷ net recognized sales × 100
```

### Recommended food cost percentage

```text
Food cost %
= food and packaging COGS ÷ net recognized sales × 100
```

When net sales are zero, show `—`, not `0%`, because a percentage cannot be interpreted.

## 8. Data Integrity Requirements

### 8.1 Historical cost snapshots

Current consignment items already store `cost_per_unit_snapshot`. Reseller and market-event sale items currently store price snapshots but use the product’s current cost for dashboard COGS.

Required change:

- add immutable cost fields to reseller order items and market-event sale items;
- at minimum:
  - food and packaging cost snapshot;
  - labor cost snapshot;
  - utility cost snapshot;
  - total unit cost snapshot;
  - cost-source or costing-version reference.

This is required before calling historical weekly margin final or auditable.

### 8.2 Unified expenses

The application has event closeout expenses and approved timesheet labor, but no general business-expense ledger.

Recommended new entity: `expense_entries`.

Suggested fields:

- `id`;
- `expense_date`;
- `category`;
- `amount`;
- `description`;
- `supplier_id`, optional;
- `market_event_id`, optional;
- `production_plan_id`, optional;
- `consignment_partner_id`, optional;
- `sales_channel`, optional;
- `receipt_reference`, optional;
- `created_by`;
- `created_at`;
- `is_voided`;
- `void_reason`.

Initial categories:

- ingredient purchase;
- packaging purchase;
- direct labor;
- utilities;
- event booth fee;
- delivery or transport;
- marketing;
- refunds;
- repairs and maintenance;
- other approved operating expense.

Ingredient and packaging purchases should not automatically become same-week COGS. They increase inventory first; COGS is recognized when the related inventory is consumed and sold.

### 8.3 Ingredient price history

Recommended new entity: `ingredient_price_history`.

Capture:

- ingredient;
- old price;
- new price;
- old and new package size;
- normalized unit cost before and after;
- percentage change;
- supplier;
- source;
- effective date;
- actor;
- affected active products;
- estimated margin impact.

Price-hike alerts must compare normalized unit costs, not package prices alone.

### 8.4 Collection terms and due dates

Add or confirm:

- partner payment terms in days;
- explicit due date on each delivery;
- payment status;
- remaining amount;
- partial payments, if the owner requires them.

Until explicit terms are stored, use a clearly labeled configurable fallback of 15 days after delivery.

### 8.5 Sales-channel normalization

Create one normalized dashboard query layer that maps:

- consignment sales;
- reseller orders;
- market-event sales;
- pre-order fulfillment.

Each normalized record should expose:

- sale date;
- channel;
- SKU;
- quantity;
- gross item amount;
- discounts;
- refunds;
- net sales;
- tax;
- tips;
- paid or receivable state;
- cost snapshots;
- direct expense allocation.

## 9. Backend and API Recommendation

Prefer one typed owner-dashboard endpoint rather than the frontend making separate summary and costing requests.

Recommended endpoint:

```text
GET /dashboard/owner-weekly
```

Parameters:

- `date_from`;
- `date_to`;
- `comparison=previous_period`;
- optional `category`;
- optional `product_limit`.

Recommended top-level response:

- `period`;
- `comparison_period`;
- `data_confidence`;
- `kpis`;
- `sales_by_channel`;
- `weekly_cost_breakdown`;
- `inventory_reconciliation`;
- `alerts`;
- `upcoming_events`;
- `product_cost_rows`;
- `generated_at`.

Security:

- owner-only;
- use the existing token-authorized request path;
- staff dashboard must continue receiving operational data only;
- never send cost, margin, expense, or revenue fields to staff and merely hide them in the UI.

Performance:

- aggregate in SQL where practical;
- avoid one query per product;
- reuse the costing service’s memoized cycle-safe calculations;
- cache only by owner role and exact date/filter fingerprint;
- invalidate relevant dashboard caches after sales, costing, expense, stock, or collection mutations.

## 10. Interaction Details

### Dashboard actions

- Every alert has one clear primary action.
- Clicking a KPI applies the matching detail filter.
- Chart selections persist during the session.
- Product tooltips include name, SKU, size, and cost confidence.
- `View all` links preserve the dashboard period where relevant.

### Empty states

Examples:

- `No sales recorded for this week yet.`
- `No overdue collections.`
- `No upcoming events in the next 14 days.`
- `All active products have valid cost records.`

Avoid displaying empty charts with zero-filled fake data.

### Error and partial-data states

If one data source fails:

- keep the remaining dashboard visible;
- mark the affected card or section `Unavailable`;
- state which source failed;
- offer a retry for that section;
- do not convert missing data to zero.

## 11. Responsive and Accessibility Requirements

### Desktop

- four primary KPI cards in one row;
- full alert table;
- two-column weekly-cost charts;
- full product chart with controls above it.

### Tablet

- two KPI cards per row;
- alert list may switch to compact rows;
- charts stack if labels become cramped.

### Mobile

- two KPI cards per row, or one per row below 360px;
- alert cards instead of a horizontally compressed table;
- chart controls stack vertically;
- chart region supports horizontal exploration only when necessary;
- product detail can open as a bottom sheet.

### Accessibility

- do not communicate alert priority or chart series by color alone;
- include visible labels, icons, and text;
- maintain at least 44px touch targets;
- provide keyboard access to all filters and actions;
- give charts accessible summaries or supporting data tables;
- announce filter refresh and partial-data errors;
- preserve browser zoom and responsive reflow;
- use `aria-live` for updated alert counts where appropriate;
- ensure tooltips are not the only way to access values.

The supplied image alone cannot confirm keyboard, screen-reader, contrast, zoom, or responsive compliance. Those require testing on the implemented dashboard.

## 12. Recommended Visual Direction

- Use the existing warm H+H theme and shared primitives.
- Keep the page background quiet and let white cards carry the information.
- Use cocoa for navigation and primary identity.
- Use gold sparingly for emphasis.
- Reserve:
  - red for critical loss, invalid cost, and overdue risk;
  - amber for warnings;
  - blue for informational events and receivables;
  - green for healthy or positive results.
- Use tabular or monospaced numbers for currency, quantities, and percentages.
- Keep card labels in plain business language; avoid technical terms such as `aggregate`, `schema`, or `synchronization` in owner-facing copy.

## 13. Recommended Implementation Phases

### Phase 0 — Confirm finance policies

Confirm:

- Monday-to-Sunday week;
- revenue before VAT and tips;
- accrual versus cash treatment;
- consignment payment terms;
- price-increase threshold;
- margin-warning threshold;
- expense categories;
- whether actual or standard labor and utility values drive the primary dashboard.

### Phase 1 — Build the trusted weekly data layer

- add reseller and market-event cost snapshots;
- normalize revenue across channels;
- separate VAT, tips, discounts, refunds, free items, and receivables;
- add price history;
- add due dates;
- add or define the expense ledger;
- implement data-confidence checks.

### Phase 2 — Build the owner dashboard structure

- weekly default period and comparison;
- four KPI cards;
- consolidated alerts and upcoming events;
- weekly cost charts;
- product chart selector;
- owner-only typed response.

### Phase 3 — Add linked actions and alert lifecycle

- deep links and filtered destinations;
- acknowledgements;
- deduplication;
- configurable thresholds;
- event readiness checks;
- overdue collection actions.

### Phase 4 — Validate and release

- formula unit tests;
- sales-channel reconciliation tests;
- historical cost immutability tests;
- RBAC tests;
- timezone boundary tests;
- empty, error, and partial-data tests;
- desktop, tablet, and mobile visual verification;
- keyboard and screen-reader checks;
- production build, lint, backend tests, and live health verification.

## 14. Recommended Defaults for Owner Approval

These defaults keep implementation moving while making policy choices explicit.

| Decision | Recommended default |
| --- | --- |
| Week definition | Monday through Sunday, Asia/Manila |
| Primary sales number | Net sales before VAT and tips |
| Complimentary items | Quantity reported separately; zero revenue |
| Receivables | Included in recognized sales but shown separately from collected cash |
| Overdue consignment | Explicit due date; temporary fallback at 15 days after delivery |
| Price-hike alert | At least 5% normalized unit-cost increase or at least 2-point product-margin impact |
| Margin warning | Below 50%, configurable |
| Upcoming event window | 14 days |
| Event readiness warning | 7 days |
| Expiring batch warning | 15 days |
| Profit label before expense completion | Contribution Profit — Estimated |
| Historical COGS | Immutable cost snapshot captured per sale item |

## 15. Acceptance Criteria

The redesigned owner dashboard is complete when:

1. The default view shows the current Philippine business week.
2. Weekly sales reconcile to channel-level transactions without mixing VAT, tips, or cash float into revenue.
3. Weekly food cost uses immutable sale-time cost snapshots.
4. Contribution profit and margin clearly state whether values are complete or estimated.
5. Pending and overdue collections are distinct.
6. Upcoming events and event-readiness problems appear in Top Alerts.
7. Ingredient price increases create actionable alerts using normalized unit cost.
8. The five requested product chart modes work with consistent product and category filters.
9. Every alert links to the exact workflow needed to resolve it.
10. Staff API responses contain no owner financial fields.
11. The dashboard works at desktop, tablet, and mobile sizes.
12. Backend tests, lint, TypeScript, production build, and role-based security checks pass.

## 16. Final Product Principle

The dashboard should not merely display more information. It should explain:

- **what happened;**
- **why it happened;**
- **how trustworthy the number is;**
- **what the owner should do next.**

That is the difference between a decorative dashboard and a useful weekly business-control center.
