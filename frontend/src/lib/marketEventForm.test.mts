import assert from "node:assert/strict";
import test from "node:test";

import {
  canDisplayMarketEventCatalogProduct,
  getMarketEventChecklistKey,
} from "./marketEventForm.ts";

test("create event checklist identity is safe without a selected event", () => {
  assert.equal(getMarketEventChecklistKey(null), "create-event");
  assert.equal(getMarketEventChecklistKey(undefined), "create-event");
});

test("edit event checklist identity changes with event status", () => {
  assert.equal(
    getMarketEventChecklistKey({ id: 33, status: "Draft" }),
    "event:33:Draft",
  );
  assert.equal(
    getMarketEventChecklistKey({ id: 33, status: "Active" }),
    "event:33:Active",
  );
});

test("inactive products stay visible only when already allocated", () => {
  const allocatedSkus = new Set(["legacy-gift"]);

  assert.equal(
    canDisplayMarketEventCatalogProduct(
      { sku: "CURRENT-SKU", is_active: true },
      allocatedSkus,
    ),
    true,
  );
  assert.equal(
    canDisplayMarketEventCatalogProduct(
      { sku: "LEGACY-GIFT", is_active: false },
      allocatedSkus,
    ),
    true,
  );
  assert.equal(
    canDisplayMarketEventCatalogProduct(
      { sku: "OLD-SKU", is_active: false },
      allocatedSkus,
    ),
    false,
  );
});
