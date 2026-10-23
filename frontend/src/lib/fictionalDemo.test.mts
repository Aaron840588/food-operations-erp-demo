import assert from "node:assert/strict";
import test from "node:test";
import { initialDemo, transition, estimateCost } from "./fictionalDemo.ts";
test("receive then fulfil preserves stock and immutable order values", () => {
  const start = initialDemo();
  assert.throws(
    () => transition(start, { type: "fulfil", id: 1002 }),
    /Not enough stock/,
  );
  const stocked = transition(start, {
    type: "receive",
    product: "tomato",
    quantity: 10,
  });
  const done = transition(stocked, { type: "fulfil", id: 1002 });
  assert.equal(done.stock.tomato, 8);
  assert.equal(start.stock.tomato, 8);
  assert.equal(done.orders[1].status, "Fulfilled");
  assert.equal(done.orders[1].price, 190);
  assert.equal(done.orders[1].cost, 76);
  assert.throws(
    () => transition(done, { type: "fulfil", id: 1002 }),
    /no longer queued/,
  );
  assert.throws(
    () => transition(done, { type: "cancel", id: 1002 }),
    /no longer queued/,
  );
});
test("queue and cancel leave stock unchanged; reset restores a fresh workspace", () => {
  const start = initialDemo();
  const next = transition(start, {
    type: "order",
    product: "pesto",
    quantity: 3,
    customer: "Sample shop C",
  });
  assert.equal(next.orders[2].id, 1003);
  assert.deepEqual(next.stock, start.stock);
  const cancelled = transition(next, { type: "cancel", id: 1003 });
  assert.equal(cancelled.orders[2].status, "Cancelled");
  assert.deepEqual(cancelled.stock, start.stock);
  assert.deepEqual(transition(cancelled, { type: "reset" }), initialDemo());
});
test("invalid stock quantities and arbitrary customers are rejected", () => {
  for (const quantity of [0, -1, 1.5, NaN, Infinity, 1001]) {
    assert.throws(() =>
      transition(initialDemo(), {
        type: "receive",
        product: "pesto",
        quantity,
      }),
    );
    assert.throws(() =>
      transition(initialDemo(), {
        type: "order",
        product: "pesto",
        quantity,
        customer: "Sample café A",
      }),
    );
  }
  assert.throws(() =>
    transition(initialDemo(), {
      type: "order",
      product: "pesto",
      quantity: 1,
      customer: "Private customer",
    }),
  );
});
test("costing handles losses and rejects invalid estimates", () => {
  assert.deepEqual(estimateCost(96, 240, 12), {
    cost: 1152,
    revenue: 2880,
    profit: 1728,
    margin: 60,
  });
  assert.equal(estimateCost(96, 80, 1)?.profit, -16);
  for (const qty of [0, -1, 1.5, 1001, NaN])
    assert.equal(estimateCost(96, 240, qty), null);
  assert.equal(estimateCost(96, 0, 1), null);
});
