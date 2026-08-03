import assert from "node:assert/strict";
import test from "node:test";

import { getProductBusinessCategory, getProductSizeGroup } from "./utils.ts";

test("sandwich SKU evidence wins over generic Sweet or Savory source categories", () => {
  assert.equal(
    getProductBusinessCategory({
      sku: "PCLB-HF-SW-SVR",
      product_name: "Pesto Chicken Labneh",
      category: "Savory",
    }),
    "Sandwiches & Salads",
  );
  assert.equal(
    getProductBusinessCategory({
      sku: "WMS-HF-SW-SWT",
      product_name: "White Mocha Sandwich",
      category: "Sweet",
    }),
    "Sandwiches & Salads",
  );
});

test("spread group headings do not repeat the commercial size label", () => {
  assert.equal(
    getProductSizeGroup({
      sku: "YP-IND",
      product_name: "Classic Yema Spread",
      category: "Sweet",
      size: "Indulge",
    }).label,
    "Sweet Spreads (Indulge (240g))",
  );
});
