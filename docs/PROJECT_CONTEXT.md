# H+H Hub — Business Context Handbook

H+H Hub is Handmade+Homemade's operations platform for premium jarred spreads, sauces, sandwiches, salads, and event sales. Version **2.6.1** links the operating chain from product and recipe setup through purchasing, inventory, production, sales, delivery, and owner profitability review.

The detailed engineering source of truth is the repository-root `PROJECT_CONTEXT.md`.

## Business workflow

```text
customer order or event demand
  -> product SKU and selling price
  -> recipe and source-data confidence
  -> ingredient requirement and purchasing
  -> production plan and FIFO consumption
  -> warehouse/event/partner stock
  -> sale, preorder, reseller, or consignment transaction
  -> immutable price/cost snapshot
  -> owner weekly dashboard and action center
```

## Sales channels

1. **Public preorders** — advance pickup/delivery orders from the tokenized customer form.
2. **Market Events** — allocated booth stock, offline-capable cashiering, payment capture, waste, returns, and closeout.
3. **Resellers** — wholesale sales with configured discounts, stock deduction, and invoices.
4. **Consignment partners** — deliveries, units sold, pull-outs, collectibles, and historical margins.

Consignment DR value is the quantity dispatched multiplied by the immutable partner-price snapshot. It is visible before confirmation and on historical deliveries but is not recognized as revenue. Blank DR numbers receive stable server-generated identifiers that staff can later replace with official paper numbers.

## Operating goals

- Explain weekly sales, costs, contribution profit, and the reason a value may be incomplete.
- Translate upcoming demand into ingredient and production work.
- Prevent overselling, duplicate financial writes, and untraceable stock changes.
- Preserve historical sale prices and costs when master data changes later.
- Let the owner continue temporary price maintenance in approved Google Sheets without allowing Sheets to overwrite operational truth.
- Keep staff workflows plain-language and touch-friendly while redacting owner financial data.

## Roles

### Owner

Controls financial reporting, product/recipe configuration, partners, users, Sheet review, and system settings.

### Staff

Handles approved operational routes such as inventory, Market Events, preorders, tasks, and timesheets. Staff response schemas omit sensitive cost and margin fields.

Passcodes are configured through the authenticated Hub and environment setup; they are never documented or committed.

## Source-of-truth boundaries

- H+H Hub is authoritative for stock, production, sales, payments, users, and audit history.
- Approved Sheets may propose product master changes.
- Only retail and reseller prices can use bounded owner-enabled automatic application.
- Sheet stock totals, formulas, dashboards, and transaction ledgers are not imported as authoritative values.
- Missing recipe, supplier, yield, and packaging data must be repaired from an approved source rather than guessed.

## Current operational blockers

- Google keyless runtime identity is configured; Partner Inventory still needs Viewer sharing and a verified dry run.
- Three Full/Half Sheet SKU duplicates need correction.
- Jar and label costs need stable packaging codes and an authoritative Packaging Master.
- Missing recipes/yields and supplier links remain data-completion work.
- Physical mobile-device and printer checks remain required before relying on a live event setup.
