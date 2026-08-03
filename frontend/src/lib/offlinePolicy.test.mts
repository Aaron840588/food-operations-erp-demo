import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyOfflineRequest,
  shouldPersistInGenericOfflineQueue,
} from "./offlinePolicy.ts";

test("credentials and privileged mutations are never persisted for replay", () => {
  const unsafeRequests = [
    ["/auth/login", "POST"],
    ["/auth/refresh", "POST"],
    ["/users", "POST"],
    ["/users/7/reset-password", "POST"],
    ["/products/GCP-SL", "PATCH"],
    ["/raw-ingredients/17", "PUT"],
    ["/warehouse-stocks/3", "DELETE"],
    ["/consignment/deliveries", "POST"],
    ["/resellers/orders", "POST"],
    ["/market-events/4/sales", "POST"],
    ["/sheet-sync/check", "POST"],
    ["/production/plans/8/complete", "POST"],
    ["/preorders/public/token", "POST"],
  ] as const;

  for (const [path, method] of unsafeRequests) {
    assert.equal(
      shouldPersistInGenericOfflineQueue(path, method),
      false,
      `${method} ${path} must not enter the generic replay queue`,
    );
  }
});

test("read-only requests are distinguished from mutations", () => {
  assert.equal(classifyOfflineRequest("/products", "GET"), "read");
  assert.equal(classifyOfflineRequest("/costing/sku/GCP-SL/preview", "POST"), "read_only_post");
  assert.equal(classifyOfflineRequest("/production/forecast", "POST"), "read_only_post");
  assert.equal(classifyOfflineRequest("/products/GCP-SL", "PATCH"), "mutation");
});
