# Market Event Readiness and Mobile Operations

This document defines the safety boundaries for H+H Market Events. It is an
implementation contract, not a claim that a particular phone or browser has
already been physically validated.

Current implementation: **H+H Hub v2.6.1**. Automated backend reconciliation,
idempotency, stock, payment, closeout, and offline-policy checks pass. Physical
device and printer checks listed at the end remain required.

The owner create dialog is null-safe when no existing event is selected; this
presentation fix does not change activation, allocation, checkout, or closeout semantics.

New event allocations use only the owner's active 26-product core lineup. If a
product is retired while an event already holds it, that event continues to
display and sell the remaining allocation. Edits may retain or reduce that
quantity but cannot add or increase retired stock.

## Operational stock semantics

- A **Draft** event is a plan. Draft allocations are logical reservations and
  do not reduce warehouse stock.
- Activating an event is an online-only, explicitly confirmed transaction. The
  backend validates all allocations, deducts each SKU once, records the
  inventory ledger entries, and synchronizes the main-facility stock mirror.
- An active allocation's `quantity` is the booth's remaining sellable stock.
  A sale reduces it only after the sale transaction passes server-side price,
  stock, payment, and idempotency validation.
- Event completion is online-only. Eligible unsold stock is returned once;
  recorded waste is not returned. A completed or cancelled event cannot be
  reactivated.
- Cashier responses expose operational stock and selling prices, but not cost,
  margin, event-wide profit, or unrelated event data.

The expanded reconciliation model must preserve this physical invariant for
each SKU:

```text
actual brought = paid sold + free/promotional + damaged/wasted + returned + active remaining
```

After completion, active remaining is zero because eligible remaining units
have become returned units.

## Offline cashier lifecycle

Market POS financial writes are deliberately excluded from the application's
generic offline mutation queue. The event cashier uses the isolated
`hh_market_events_offline` IndexedDB database instead.

1. While online, the cashier chooses **Prepare Offline Mode** for an active,
   assigned event.
2. The browser stores a versioned event package: event identity, authenticated
   cashier and device identity, current lineup products, price snapshots, and
   event stock. A package expires no later than 24 hours after generation.
3. Each local checkout receives a cryptographically random stable client
   reference before it is recorded. Sale and stock reservation are committed
   together in one IndexedDB transaction.
4. A refresh or browser restart reloads cached stock and unresolved sales from
   IndexedDB. Local stock is never reconstructed only from React state.
5. Replay is serial. The backend's `(event_id, client_reference)` uniqueness
   guarantee makes retries idempotent.
6. A local sale is acknowledged only after the response matches its event,
   cashier, payment, line items, price snapshots, and total. Ambiguous or
   mismatched receipts require manual review and keep their local evidence.
7. A pending local sale can be voided only when its delivery is known not to
   have reached the server. Its reserved stock is restored in the same local
   transaction. Synced or delivery-uncertain sales cannot be locally erased.

Authentication expiry or logout must not delete unresolved offline event
sales. Reauthentication is required before replay, and the authenticated
cashier/device must match the package that recorded the sale.

## Mobile safety rules

- The cashier path targets portrait phone widths from 320 px through 430 px.
- Primary actions and quantity controls use at least 44 px touch targets.
- Form controls remain at 16 px on phones to avoid iOS focus zoom.
- Fixed checkout controls use safe-area insets and dynamic viewport units.
- Cash checkout is disabled when tender is insufficient. The server, not the
  browser, computes the authoritative total and change.
- Non-cash checkout does not display change. A payment reference is optional
  unless the owner later makes it mandatory for a method.
- Duplicate taps are blocked in the UI and by backend idempotency.
- Event activation and completion remain unavailable offline.

## Readiness checks

Before starting a real event, the owner or assigned staff should verify:

- event name, date, location, and assigned cashier are correct;
- every allocated SKU has a current selling price and positive quantity;
- warehouse stock covers the intended event dispatch;
- packed quantities have been physically checked;
- the event's offline package was generated on each cashier device and is not
  expired;
- old unresolved offline sales are synchronized or reviewed;
- opening float is counted and entered;
- configured pre-orders, promotions, add-ons, and packages are available on
  the device;
- device storage, battery, and network recovery have been checked.

The first six checks are operational blockers. Battery and current network
quality are warnings because offline cashiering is expected to remain usable.

## Requires Owner Validation

The following policies are intentionally centralized or documented as
assumptions instead of being silently hard-coded across the UI:

- Pre-orders do not reserve stock in v1; stock is deducted only by POS
  fulfillment.
- Offline event packages expire after 24 hours.
- Default receivable due date: seven calendar days after the sale.
- Maximum staff manual percentage discount: 20% until the owner configures a
  different limit.
- Whether fixed discounts are available to staff, and whether discounts may
  stack with Buy X Get Y promotions.
- Which digital payment methods require a reference number.
- Whether `BPI / Bank Transfer` and generic `Bank Transfer` should remain
  separate reporting methods.
- Which add-ons track physical stock and which are untracked services.
- Which gift sets are eligible for specific events and which add-ons can be
  attached to them.
- Whether an owner override may complete an event with a physical stock
  variance, and the minimum required reason.

## Requires Physical Device Validation

Automated Chromium/WebKit viewport checks cannot replace the following:

- iPhone Safari behavior with the keyboard, browser toolbar, screen lock, and
  home-screen installation;
- Chrome and Edge on iOS, which also use WebKit;
- Samsung Internet IndexedDB persistence and service-worker behavior;
- Android Chrome/Edge behavior under battery saver and process eviction;
- printing from the actual event printer, if one will be used;
- switching between two cashier phones during a live event.

Record device model, OS version, browser version, event package timestamp, and
the tested recovery steps when this validation is performed.
