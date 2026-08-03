import assert from "node:assert/strict";
import test from "node:test";

import { calculateConsignmentUnitPrice } from "./consignmentPricing.ts";

test("consignment partner pricing rounds half pesos up like the owner tracker", () => {
  assert.equal(calculateConsignmentUnitPrice(295, 0.10), 266);
  assert.equal(calculateConsignmentUnitPrice(245, 0.10), 221);
  assert.equal(calculateConsignmentUnitPrice(375, 0.10), 338);
});
