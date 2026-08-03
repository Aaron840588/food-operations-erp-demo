-- Reconcile the one known tracker-import mismatch for Sweet Tablea.
--
-- The source fingerprint is intentionally exact. If an owner has edited the
-- legacy 1 g / PHP 13 row, changed the BOM quantity/unit, or already selected
-- another ingredient, this migration performs no update.

WITH canonical_tablea AS (
  SELECT id
  FROM public.raw_ingredients
  WHERE LOWER(TRIM(name)) = 'tablea chopped'
    AND LOWER(TRIM(unit)) IN (
      'mg', 'milligram', 'milligrams',
      'g', 'gm', 'gms', 'gram', 'grams',
      'kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'
    )
    AND COALESCE(price, 0.0) > 0.0
    AND COALESCE(net_weight, 0.0) > 0.0
  ORDER BY id
  LIMIT 1
), fingerprinted_recipe_item AS (
  SELECT recipe_item.id AS recipe_item_id, canonical.id AS canonical_id
  FROM public.recipe_items AS recipe_item
  JOIN public.recipes AS recipe
    ON recipe.id = recipe_item.recipe_id
  JOIN public.raw_ingredients AS legacy
    ON legacy.id = recipe_item.raw_ingredient_id
  CROSS JOIN canonical_tablea AS canonical
  WHERE recipe.sku = 'ST-IND-SWT'
    AND recipe_item.ingredient_type = 'raw'
    AND LOWER(TRIM(recipe_item.base_unit)) IN ('g', 'gm', 'gms', 'gram', 'grams')
    AND ABS(recipe_item.base_qty - 1000.0) < 0.000001
    AND LOWER(TRIM(legacy.name)) = 'tablea'
    AND LOWER(TRIM(legacy.unit)) IN ('g', 'gm', 'gms', 'gram', 'grams')
    AND ABS(legacy.price - 13.0) < 0.000001
    AND ABS(legacy.net_weight - 1.0) < 0.000001
    AND ABS(COALESCE(legacy.cost_per_gram_unit, 0.0) - 13.0) < 0.000001
)
UPDATE public.recipe_items AS recipe_item
SET raw_ingredient_id = fingerprinted.canonical_id
FROM fingerprinted_recipe_item AS fingerprinted
WHERE recipe_item.id = fingerprinted.recipe_item_id;

-- Refresh the persisted Sweet Tablea COGS snapshot used by market events,
-- consignments, and gift sets. The formula mirrors the backend's mass-unit
-- normalization and whole-serving calculation for this raw-only recipe.
WITH corrected_cost AS (
  SELECT
    recipe.sku,
    SUM(
      recipe_item.base_qty
      * CASE LOWER(TRIM(recipe_item.base_unit))
          WHEN 'mg' THEN 0.001
          WHEN 'milligram' THEN 0.001
          WHEN 'milligrams' THEN 0.001
          WHEN 'kg' THEN 1000.0
          WHEN 'kgs' THEN 1000.0
          WHEN 'kilo' THEN 1000.0
          WHEN 'kilos' THEN 1000.0
          WHEN 'kilogram' THEN 1000.0
          WHEN 'kilograms' THEN 1000.0
          ELSE 1.0
        END
      * raw.price
      / NULLIF(
          raw.net_weight
          * CASE LOWER(TRIM(raw.unit))
              WHEN 'mg' THEN 0.001
              WHEN 'milligram' THEN 0.001
              WHEN 'milligrams' THEN 0.001
              WHEN 'kg' THEN 1000.0
              WHEN 'kgs' THEN 1000.0
              WHEN 'kilo' THEN 1000.0
              WHEN 'kilos' THEN 1000.0
              WHEN 'kilogram' THEN 1000.0
              WHEN 'kilograms' THEN 1000.0
              ELSE 1.0
            END,
          0.0
        )
    ) / GREATEST(
      FLOOR(
        recipe.yield_weight
        * CASE LOWER(TRIM(recipe.yield_unit))
            WHEN 'kg' THEN 1000.0
            WHEN 'kgs' THEN 1000.0
            WHEN 'kilo' THEN 1000.0
            WHEN 'kilos' THEN 1000.0
            WHEN 'kilogram' THEN 1000.0
            WHEN 'kilograms' THEN 1000.0
            ELSE 1.0
          END
        / NULLIF(
            recipe.portion_size
            * CASE LOWER(TRIM(recipe.portion_unit))
                WHEN 'kg' THEN 1000.0
                WHEN 'kgs' THEN 1000.0
                WHEN 'kilo' THEN 1000.0
                WHEN 'kilos' THEN 1000.0
                WHEN 'kilogram' THEN 1000.0
                WHEN 'kilograms' THEN 1000.0
                ELSE 1.0
              END,
            0.0
          )
      ),
      1.0
    ) AS raw_portion_cost
  FROM public.recipes AS recipe
  JOIN public.recipe_items AS recipe_item
    ON recipe_item.recipe_id = recipe.id
   AND recipe_item.ingredient_type = 'raw'
  JOIN public.raw_ingredients AS raw
    ON raw.id = recipe_item.raw_ingredient_id
  WHERE recipe.sku = 'ST-IND-SWT'
  GROUP BY
    recipe.sku,
    recipe.yield_weight,
    recipe.yield_unit,
    recipe.portion_size,
    recipe.portion_unit
)
UPDATE public.product_skus AS product
SET cost_per_unit = corrected.raw_portion_cost
FROM corrected_cost AS corrected
WHERE product.sku = corrected.sku
  AND COALESCE(product.cost_override, 0.0) <= 0.0;
