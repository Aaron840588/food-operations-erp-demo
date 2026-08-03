# H+H Hub — Business Rules

These rules describe the version **2.6.1** calculations and operational guards.

## 1. Product costing

```text
food cost = recursive ingredient cost + final-product packaging cost
total direct cost = food cost + labor cost + utility cost
contribution profit = recognized net sales - snapshotted direct cost
contribution margin % = contribution profit / recognized net sales * 100
```

- Recursive recipe costing uses memoized DFS and rejects cycles.
- A sub-recipe contributes its edible component cost; its jar/label packaging is not propagated into a parent sandwich or recipe.
- Final-product packaging is included only when a trustworthy configured packaging input exists.
- Product labor and utility values come from the SKU configuration. Approved category overhead rules may provide a documented fallback.
- Missing recipe, invalid/zero yield, zero-priced required ingredient, or unknown packaging input produces `missing_cost_input` or another explicit incomplete status.
- The Hub does not substitute an invented jar, label, supplier, labor, or utility value.

## 2. Historical cost truth

Reseller, consignment, and Market Event item rows store:

- food cost snapshot;
- labor cost snapshot;
- utility cost snapshot;
- total cost snapshot;
- cost status;
- snapshot timestamp.

A later ingredient price, recipe, or SKU cost edit must not rewrite a historical sale's margin.

## 3. Weekly dashboard revenue

- Week: Monday through Sunday in `Asia/Manila`.
- Recognized sales are based on accepted transactional channel records.
- VAT, tips, opening cash float, and stock movement are not sales.
- Discounts reduce recognized sales.
- Complimentary units are reported as quantity with zero revenue.
- Receivables may be recognized as sales but must remain visibly separate from collected cash.
- When source costs are incomplete, the dashboard labels profit as estimated and explains the missing inputs.

## 4. Public preorders

A product is publicly orderable only when:

1. the preorder form is enabled;
2. the SKU is active;
3. the SKU belongs to the approved current sales lineup;
4. the SKU is permitted by the form;
5. `retail_price > 0`.

The frontend filters and disables invalid items, but the backend repeats all checks during submission. A manipulated client cannot submit a zero-price or hidden SKU. Submitting a preorder does not reserve stock until the order enters the configured operational fulfillment path.

## 5. Reseller pricing

Configured volume tiers calculate the default wholesale discount. The owner may apply an explicitly recorded manual percentage in the validated range.

```text
discounted subtotal = subtotal - discount
tax = discounted subtotal * configured VAT rate
grand total = discounted subtotal + tax
```

The server calculates the authoritative values. The order and its item snapshots are committed with the associated stock mutation or rolled back together.

## 6. Consignment

- Delivery receipt identity and partner are preserved.
- If staff do not supply a paper DR number, the server generates `DR-YYYYMMDD-{delivery_id}` only after the delivery row has an ID. Staff may replace it later; clearing it restores the stable system number.
- The authoritative partner unit price is master SRP less the partner's configured discount, rounded to a whole peso with half-up rounding and stored in `reseller_price_snapshot`.
- Delivery/DR value is `qty_delivered × reseller_price_snapshot`. It is stock dispatch context, not sales revenue, and never uses `units_sold` or a later master price.
- Units sold and pull-outs cannot exceed delivered quantity.
- Pull-outs/waste generate reasoned inventory ledger entries.
- Partner price, reseller price, unit cost, and cost components are snapshotted.
- Collections and overdue status remain linked to the source delivery.
- Invoice generation is not part of the delivery workflow until separate business rules are approved.

## 7. Inventory and production

- A Draft production plan does not consume stock.
- Completion recursively expands all product targets into aggregate ingredient requirements.
- Completion is blocked when a recipe is missing, a yield is invalid, a cycle exists, a target is invalid, or stock is insufficient.
- Ingredient batches are consumed FIFO by expiry, with null expiries last.
- Ingredient and SKU stock changes synchronize the Main Facility warehouse mirror in the same transaction.
- Rollback restores all affected records when any deduction or mirror synchronization fails.

## 8. Market Events

- New allocations use only the active owner-confirmed core catalog: 12 Spreads & Sauces and 14 Sandwiches & Salads/Pasta products.
- Product retirement is non-destructive and never rewrites historical financial snapshots.
- A retired product already allocated to a Draft or Active event remains visible for that event and may be retained or reduced, but it cannot receive a new or larger allocation.
- Draft allocations are plans and do not reduce warehouse stock.
- Activation validates and deducts allocated stock once.
- Every checkout has a stable `client_reference`.
- Repeating the same `(event_id, client_reference)` returns the existing transaction instead of applying another sale.
- Event completion returns eligible unsold stock once; recorded waste is not returned.
- Zero-quantity returns do not create meaningless inventory transactions.

The physical reconciliation invariant is:

```text
actual brought = paid sold + complimentary + damaged/wasted + returned + active remaining
```

## 9. Offline behavior

- There is no generic mutation replay queue.
- Authentication, administration, inventory, reseller, consignment, and destructive writes are online-only.
- An uncertain response is reported as unconfirmed; the client does not silently queue and retry it.
- Market POS alone uses the isolated `hh_market_events_offline` database.
- Its sale and local stock reservation commit together, replay serially, and require a matching server receipt before acknowledgement.

## 10. Google Sheets

- Stable IDs, never row numbers, match source records to Hub records.
- Duplicate IDs, invalid values, unknown records, and ambiguous matches become conflicts.
- A missing Sheet row never deletes or deactivates a Hub record.
- Every accepted change rechecks the current destination version.
- Zero prices and changes greater than the configured 25% safety band require manual review.
- Only retail and reseller prices can use owner-enabled auto-apply.
- Stock, transactions, users, payments, and reporting formulas remain Hub-owned.
