-- Add the pasta production catalog from the owner-approved Google Sheets
-- source used on 2026-07-27.
-- The filename matches the production Supabase migration-history version.
--
-- Source rows:
--   TPP-SL-PASTA | Tuna Pesto Pasta | 1020 g yield | 170 g portion | PHP 130
--   PTR-SL-PASTA | Pesto Tomato Rigatoni | 1020 g yield | 170 g portion | PHP 150
--   CAP-SL-PASTA | Chili Asian Pasta | 510 g yield | 170 g portion | PHP 130
--
-- Blank Pili and Basil rows in the PTR source are intentionally excluded.
-- Ingredient references are resolved by normalized names/SKUs. No database IDs
-- are hardcoded.

-- The source requires sliced cheese, which is absent from production. Preserve
-- an existing normalized match if one was added before this migration arrives.
INSERT INTO public.raw_ingredients (
    name,
    category,
    unit,
    price,
    net_weight,
    cost_per_gram_unit,
    available_stock,
    reorder_level,
    remarks
)
SELECT
    'Sliced cheese',
    'Dairy',
    'slices',
    82.00,
    22.00,
    82.00 / 22.00,
    0.00,
    0.00,
    'Owner-approved Google Sheets pasta BOM source, 2026-07-27.'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.raw_ingredients
    WHERE LOWER(BTRIM(name)) = 'sliced cheese'
);

UPDATE public.raw_ingredients
SET
    category = 'Dairy',
    unit = 'slices',
    price = 82.00,
    net_weight = 22.00,
    cost_per_gram_unit = 82.00 / 22.00,
    last_updated = NOW()
WHERE LOWER(BTRIM(name)) = 'sliced cheese';

-- Correct the three source pack prices/net contents before any recipe rows are
-- installed. The cost-per-unit snapshot follows the same price/net-content
-- convention used by the backend costing service.
UPDATE public.raw_ingredients
SET
    price = CASE LOWER(BTRIM(name))
        WHEN 'perfect pasta cream' THEN 335.00
        WHEN 'tuna flakes in oil' THEN 99.00
        WHEN 'tomato' THEN 85.00
    END,
    net_weight = CASE LOWER(BTRIM(name))
        WHEN 'perfect pasta cream' THEN 1000.00
        WHEN 'tuna flakes in oil' THEN 420.00
        WHEN 'tomato' THEN 1000.00
    END,
    cost_per_gram_unit = CASE LOWER(BTRIM(name))
        WHEN 'perfect pasta cream' THEN 335.00 / 1000.00
        WHEN 'tuna flakes in oil' THEN 99.00 / 420.00
        WHEN 'tomato' THEN 85.00 / 1000.00
    END,
    last_updated = NOW()
WHERE LOWER(BTRIM(name)) IN (
    'perfect pasta cream',
    'tuna flakes in oil',
    'tomato'
);

-- Fail closed before writing product or BOM rows. A missing or duplicate
-- normalized ingredient would make a name-based join ambiguous and could
-- silently create an incomplete recipe.
DO $$
DECLARE
    missing_ingredients TEXT[];
    duplicate_ingredients TEXT[];
    missing_subrecipes TEXT[];
    main_facility_count INTEGER;
BEGIN
    SELECT ARRAY_AGG(required.name ORDER BY required.name)
    INTO missing_ingredients
    FROM (
        VALUES
            ('fusili pasta uncooked'),
            ('perfect pasta cream'),
            ('tuna flakes in oil'),
            ('rigatoni uncooked'),
            ('water'),
            ('chili oil'),
            ('sliced cheese'),
            ('grated processed parmesan'),
            ('tomato'),
            ('rice noodles'),
            ('mushroom'),
            ('ground roasted peanuts'),
            ('oyster sauce')
    ) AS required(name)
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.raw_ingredients AS raw
        WHERE LOWER(BTRIM(raw.name)) = required.name
    );

    IF missing_ingredients IS NOT NULL THEN
        RAISE EXCEPTION
            'Pasta catalog migration is missing raw ingredients: %',
            ARRAY_TO_STRING(missing_ingredients, ', ');
    END IF;

    SELECT ARRAY_AGG(required.name ORDER BY required.name)
    INTO duplicate_ingredients
    FROM (
        VALUES
            ('fusili pasta uncooked'),
            ('perfect pasta cream'),
            ('tuna flakes in oil'),
            ('rigatoni uncooked'),
            ('water'),
            ('chili oil'),
            ('sliced cheese'),
            ('grated processed parmesan'),
            ('tomato'),
            ('rice noodles'),
            ('mushroom'),
            ('ground roasted peanuts'),
            ('oyster sauce')
    ) AS required(name)
    WHERE (
        SELECT COUNT(*)
        FROM public.raw_ingredients AS raw
        WHERE LOWER(BTRIM(raw.name)) = required.name
    ) > 1;

    IF duplicate_ingredients IS NOT NULL THEN
        RAISE EXCEPTION
            'Pasta catalog migration found ambiguous raw ingredients: %',
            ARRAY_TO_STRING(duplicate_ingredients, ', ');
    END IF;

    SELECT ARRAY_AGG(required.sku ORDER BY required.sku)
    INTO missing_subrecipes
    FROM (
        VALUES ('PP-IND-SVR'), ('CGO-IND-SVR')
    ) AS required(sku)
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.product_skus AS product
        JOIN public.recipes AS recipe ON recipe.sku = product.sku
        WHERE product.sku = required.sku
          AND EXISTS (
              SELECT 1
              FROM public.recipe_items AS recipe_item
              WHERE recipe_item.recipe_id = recipe.id
          )
    );

    IF missing_subrecipes IS NOT NULL THEN
        RAISE EXCEPTION
            'Pasta catalog migration is missing valid sub-recipes: %',
            ARRAY_TO_STRING(missing_subrecipes, ', ');
    END IF;

    SELECT COUNT(*)
    INTO main_facility_count
    FROM public.warehouses
    WHERE name = 'Main Facility';

    IF main_facility_count <> 1 THEN
        RAISE EXCEPTION
            'Pasta catalog migration requires exactly one Main Facility warehouse; found %',
            main_facility_count;
    END IF;
END $$;

INSERT INTO public.product_skus (
    sku,
    product_name,
    category,
    size,
    retail_price,
    reseller_price,
    pack_qty,
    storage_life,
    serving_requirement,
    cost_per_unit,
    labor_cost,
    utility_cost,
    warehouse_stock,
    is_active
)
VALUES
    (
        'TPP-SL-PASTA',
        'Tuna Pesto Pasta',
        'Pasta Tub',
        '170g',
        130.00,
        110.50,
        1,
        NULL,
        'Serve chilled or reheated as directed.',
        0.00,
        0.00,
        0.00,
        0,
        TRUE
    ),
    (
        'PTR-SL-PASTA',
        'Pesto Tomato Rigatoni',
        'Pasta Tub',
        '170g',
        150.00,
        127.50,
        1,
        NULL,
        'Serve chilled or reheated as directed.',
        0.00,
        0.00,
        0.00,
        0,
        TRUE
    ),
    (
        'CAP-SL-PASTA',
        'Chili Asian Pasta',
        'Pasta Tub',
        '170g',
        130.00,
        110.50,
        1,
        NULL,
        'Serve chilled or reheated as directed.',
        0.00,
        0.00,
        0.00,
        0,
        TRUE
    )
ON CONFLICT (sku) DO UPDATE SET
    product_name = EXCLUDED.product_name,
    category = EXCLUDED.category,
    size = EXCLUDED.size,
    retail_price = EXCLUDED.retail_price,
    reseller_price = EXCLUDED.reseller_price,
    pack_qty = EXCLUDED.pack_qty,
    storage_life = EXCLUDED.storage_life,
    serving_requirement = EXCLUDED.serving_requirement,
    is_active = TRUE,
    last_updated = NOW();

INSERT INTO public.recipes (
    sku,
    yield_weight,
    yield_unit,
    portion_size,
    portion_unit,
    notes
)
VALUES
    (
        'TPP-SL-PASTA',
        1020.00,
        'g',
        170.00,
        'g',
        'Owner-approved Google Sheets pasta BOM source, 2026-07-27.'
    ),
    (
        'PTR-SL-PASTA',
        1020.00,
        'g',
        170.00,
        'g',
        'Owner-approved Google Sheets pasta BOM source, 2026-07-27. Blank Pili and Basil rows intentionally excluded.'
    ),
    (
        'CAP-SL-PASTA',
        510.00,
        'g',
        170.00,
        'g',
        'Owner-approved Google Sheets pasta BOM source, 2026-07-27.'
    )
ON CONFLICT (sku) DO UPDATE SET
    yield_weight = EXCLUDED.yield_weight,
    yield_unit = EXCLUDED.yield_unit,
    portion_size = EXCLUDED.portion_size,
    portion_unit = EXCLUDED.portion_unit,
    notes = EXCLUDED.notes;

-- These three recipes are source-authoritative. Replace only their existing
-- lines, leaving every other recipe untouched.
DELETE FROM public.recipe_items
WHERE recipe_id IN (
    SELECT id
    FROM public.recipes
    WHERE sku IN ('TPP-SL-PASTA', 'PTR-SL-PASTA', 'CAP-SL-PASTA')
);

WITH raw_bom (
    recipe_sku,
    ingredient_name,
    base_qty,
    base_unit
) AS (
    VALUES
        ('TPP-SL-PASTA', 'fusili pasta uncooked', 350.00, 'g'),
        ('TPP-SL-PASTA', 'perfect pasta cream', 100.00, 'g'),
        ('TPP-SL-PASTA', 'tuna flakes in oil', 50.00, 'g'),

        ('PTR-SL-PASTA', 'rigatoni uncooked', 315.00, 'g'),
        ('PTR-SL-PASTA', 'perfect pasta cream', 100.00, 'g'),
        ('PTR-SL-PASTA', 'water', 50.00, 'g'),
        ('PTR-SL-PASTA', 'chili oil', 3.00, 'g'),
        ('PTR-SL-PASTA', 'sliced cheese', 3.00, 'slices'),
        ('PTR-SL-PASTA', 'grated processed parmesan', 10.00, 'g'),
        ('PTR-SL-PASTA', 'tomato', 150.00, 'g'),

        ('CAP-SL-PASTA', 'rice noodles', 150.00, 'g'),
        ('CAP-SL-PASTA', 'mushroom', 10.00, 'g'),
        ('CAP-SL-PASTA', 'ground roasted peanuts', 50.00, 'g'),
        ('CAP-SL-PASTA', 'water', 50.00, 'g'),
        ('CAP-SL-PASTA', 'oyster sauce', 40.00, 'g'),
        ('CAP-SL-PASTA', 'grated processed parmesan', 10.00, 'g')
)
INSERT INTO public.recipe_items (
    recipe_id,
    ingredient_type,
    raw_ingredient_id,
    sub_sku,
    base_qty,
    base_unit
)
SELECT
    recipe.id,
    'raw',
    raw.id,
    NULL,
    raw_bom.base_qty,
    raw_bom.base_unit
FROM raw_bom
JOIN public.recipes AS recipe
    ON recipe.sku = raw_bom.recipe_sku
JOIN public.raw_ingredients AS raw
    ON LOWER(BTRIM(raw.name)) = raw_bom.ingredient_name;

WITH subrecipe_bom (
    recipe_sku,
    sub_sku,
    base_qty,
    base_unit
) AS (
    VALUES
        ('TPP-SL-PASTA', 'PP-IND-SVR', 190.00, 'g'),
        ('PTR-SL-PASTA', 'PP-IND-SVR', 150.00, 'g'),
        ('CAP-SL-PASTA', 'CGO-IND-SVR', 5.00, 'g')
)
INSERT INTO public.recipe_items (
    recipe_id,
    ingredient_type,
    raw_ingredient_id,
    sub_sku,
    base_qty,
    base_unit
)
SELECT
    recipe.id,
    'sku',
    NULL,
    subrecipe_bom.sub_sku,
    subrecipe_bom.base_qty,
    subrecipe_bom.base_unit
FROM subrecipe_bom
JOIN public.recipes AS recipe
    ON recipe.sku = subrecipe_bom.recipe_sku
JOIN public.product_skus AS sub_product
    ON sub_product.sku = subrecipe_bom.sub_sku;

-- Seed accurate raw-food COGS snapshots for the new products. This mirrors the
-- backend's normalized quantity calculation for these one-level pasta recipes:
-- raw line costs plus the raw-food portion cost of PP/CGO sub-recipes, divided
-- by whole finished portions.
WITH recipe_servings AS (
    SELECT
        recipe.sku,
        GREATEST(
            FLOOR(
                (
                    recipe.yield_weight
                    * CASE LOWER(BTRIM(recipe.yield_unit))
                        WHEN 'mg' THEN 0.001
                        WHEN 'milligram' THEN 0.001
                        WHEN 'milligrams' THEN 0.001
                        WHEN 'kg' THEN 1000.0
                        WHEN 'kgs' THEN 1000.0
                        WHEN 'kilo' THEN 1000.0
                        WHEN 'kilos' THEN 1000.0
                        WHEN 'kilogram' THEN 1000.0
                        WHEN 'kilograms' THEN 1000.0
                        WHEN 'l' THEN 1000.0
                        WHEN 'liter' THEN 1000.0
                        WHEN 'liters' THEN 1000.0
                        ELSE 1.0
                    END
                )
                / NULLIF(
                    recipe.portion_size
                    * CASE LOWER(BTRIM(recipe.portion_unit))
                        WHEN 'mg' THEN 0.001
                        WHEN 'milligram' THEN 0.001
                        WHEN 'milligrams' THEN 0.001
                        WHEN 'kg' THEN 1000.0
                        WHEN 'kgs' THEN 1000.0
                        WHEN 'kilo' THEN 1000.0
                        WHEN 'kilos' THEN 1000.0
                        WHEN 'kilogram' THEN 1000.0
                        WHEN 'kilograms' THEN 1000.0
                        WHEN 'l' THEN 1000.0
                        WHEN 'liter' THEN 1000.0
                        WHEN 'liters' THEN 1000.0
                        ELSE 1.0
                    END,
                    0.0
                )
            ),
            1.0
        ) AS servings
    FROM public.recipes AS recipe
    WHERE recipe.sku IN (
        'PP-IND-SVR',
        'CGO-IND-SVR',
        'TPP-SL-PASTA',
        'PTR-SL-PASTA',
        'CAP-SL-PASTA'
    )
), raw_batch_costs AS (
    SELECT
        recipe.sku,
        SUM(
            (
                recipe_item.base_qty
                * CASE LOWER(BTRIM(recipe_item.base_unit))
                    WHEN 'mg' THEN 0.001
                    WHEN 'milligram' THEN 0.001
                    WHEN 'milligrams' THEN 0.001
                    WHEN 'kg' THEN 1000.0
                    WHEN 'kgs' THEN 1000.0
                    WHEN 'kilo' THEN 1000.0
                    WHEN 'kilos' THEN 1000.0
                    WHEN 'kilogram' THEN 1000.0
                    WHEN 'kilograms' THEN 1000.0
                    WHEN 'l' THEN 1000.0
                    WHEN 'liter' THEN 1000.0
                    WHEN 'liters' THEN 1000.0
                    ELSE 1.0
                END
            )
            * raw.price
            / NULLIF(
                raw.net_weight
                * CASE LOWER(BTRIM(raw.unit))
                    WHEN 'mg' THEN 0.001
                    WHEN 'milligram' THEN 0.001
                    WHEN 'milligrams' THEN 0.001
                    WHEN 'kg' THEN 1000.0
                    WHEN 'kgs' THEN 1000.0
                    WHEN 'kilo' THEN 1000.0
                    WHEN 'kilos' THEN 1000.0
                    WHEN 'kilogram' THEN 1000.0
                    WHEN 'kilograms' THEN 1000.0
                    WHEN 'l' THEN 1000.0
                    WHEN 'liter' THEN 1000.0
                    WHEN 'liters' THEN 1000.0
                    ELSE 1.0
                END,
                0.0
            )
        ) AS raw_batch_cost
    FROM public.recipes AS recipe
    JOIN public.recipe_items AS recipe_item
      ON recipe_item.recipe_id = recipe.id
     AND recipe_item.ingredient_type = 'raw'
    JOIN public.raw_ingredients AS raw
      ON raw.id = recipe_item.raw_ingredient_id
    WHERE recipe.sku IN (
        'PP-IND-SVR',
        'CGO-IND-SVR',
        'TPP-SL-PASTA',
        'PTR-SL-PASTA',
        'CAP-SL-PASTA'
    )
    GROUP BY recipe.sku
), subrecipe_portion_costs AS (
    SELECT
        raw_cost.sku,
        raw_cost.raw_batch_cost / servings.servings AS raw_portion_cost
    FROM raw_batch_costs AS raw_cost
    JOIN recipe_servings AS servings
      ON servings.sku = raw_cost.sku
    WHERE raw_cost.sku IN ('PP-IND-SVR', 'CGO-IND-SVR')
), pasta_subrecipe_costs AS (
    SELECT
        recipe.sku,
        SUM(
            (
                recipe_item.base_qty
                * CASE LOWER(BTRIM(recipe_item.base_unit))
                    WHEN 'mg' THEN 0.001
                    WHEN 'milligram' THEN 0.001
                    WHEN 'milligrams' THEN 0.001
                    WHEN 'kg' THEN 1000.0
                    WHEN 'kgs' THEN 1000.0
                    WHEN 'kilo' THEN 1000.0
                    WHEN 'kilos' THEN 1000.0
                    WHEN 'kilogram' THEN 1000.0
                    WHEN 'kilograms' THEN 1000.0
                    WHEN 'l' THEN 1000.0
                    WHEN 'liter' THEN 1000.0
                    WHEN 'liters' THEN 1000.0
                    ELSE 1.0
                END
            )
            / NULLIF(
                sub_recipe.portion_size
                * CASE LOWER(BTRIM(sub_recipe.portion_unit))
                    WHEN 'mg' THEN 0.001
                    WHEN 'milligram' THEN 0.001
                    WHEN 'milligrams' THEN 0.001
                    WHEN 'kg' THEN 1000.0
                    WHEN 'kgs' THEN 1000.0
                    WHEN 'kilo' THEN 1000.0
                    WHEN 'kilos' THEN 1000.0
                    WHEN 'kilogram' THEN 1000.0
                    WHEN 'kilograms' THEN 1000.0
                    WHEN 'l' THEN 1000.0
                    WHEN 'liter' THEN 1000.0
                    WHEN 'liters' THEN 1000.0
                    ELSE 1.0
                END,
                0.0
            )
            * sub_cost.raw_portion_cost
        ) AS subrecipe_batch_cost
    FROM public.recipes AS recipe
    JOIN public.recipe_items AS recipe_item
      ON recipe_item.recipe_id = recipe.id
     AND recipe_item.ingredient_type = 'sku'
    JOIN public.recipes AS sub_recipe
      ON sub_recipe.sku = recipe_item.sub_sku
    JOIN subrecipe_portion_costs AS sub_cost
      ON sub_cost.sku = recipe_item.sub_sku
    WHERE recipe.sku IN ('TPP-SL-PASTA', 'PTR-SL-PASTA', 'CAP-SL-PASTA')
    GROUP BY recipe.sku
), pasta_portion_costs AS (
    SELECT
        servings.sku,
        (
            COALESCE(raw_cost.raw_batch_cost, 0.0)
            + COALESCE(sub_cost.subrecipe_batch_cost, 0.0)
        ) / servings.servings AS portion_cost
    FROM recipe_servings AS servings
    LEFT JOIN raw_batch_costs AS raw_cost
      ON raw_cost.sku = servings.sku
    LEFT JOIN pasta_subrecipe_costs AS sub_cost
      ON sub_cost.sku = servings.sku
    WHERE servings.sku IN ('TPP-SL-PASTA', 'PTR-SL-PASTA', 'CAP-SL-PASTA')
)
UPDATE public.product_skus AS product
SET
    cost_per_unit = pasta_cost.portion_cost,
    last_updated = NOW()
FROM pasta_portion_costs AS pasta_cost
WHERE product.sku = pasta_cost.sku;

-- Mirror the new finished products and raw ingredient in Main Facility without
-- resetting any pre-existing mirror quantity.
INSERT INTO public.warehouse_stocks (
    warehouse_id,
    sku,
    raw_ingredient_id,
    quantity
)
SELECT
    warehouse.id,
    product.sku,
    NULL,
    product.warehouse_stock
FROM public.warehouses AS warehouse
CROSS JOIN public.product_skus AS product
WHERE warehouse.name = 'Main Facility'
  AND product.sku IN ('TPP-SL-PASTA', 'PTR-SL-PASTA', 'CAP-SL-PASTA')
  AND NOT EXISTS (
      SELECT 1
      FROM public.warehouse_stocks AS existing
      WHERE existing.warehouse_id = warehouse.id
        AND existing.sku = product.sku
  );

INSERT INTO public.warehouse_stocks (
    warehouse_id,
    sku,
    raw_ingredient_id,
    quantity
)
SELECT
    warehouse.id,
    NULL,
    raw.id,
    raw.available_stock
FROM public.warehouses AS warehouse
CROSS JOIN public.raw_ingredients AS raw
WHERE warehouse.name = 'Main Facility'
  AND LOWER(BTRIM(raw.name)) = 'sliced cheese'
  AND NOT EXISTS (
      SELECT 1
      FROM public.warehouse_stocks AS existing
      WHERE existing.warehouse_id = warehouse.id
        AND existing.raw_ingredient_id = raw.id
  );

-- Final guard: an incomplete BOM must abort the migration, never leave a
-- product visible to the planner with partial material deductions.
DO $$
DECLARE
    invalid_recipes TEXT[];
    missing_product_mirrors TEXT[];
    missing_cheese_mirror BOOLEAN;
BEGIN
    SELECT ARRAY_AGG(expected.sku ORDER BY expected.sku)
    INTO invalid_recipes
    FROM (
        VALUES
            ('TPP-SL-PASTA', 4),
            ('PTR-SL-PASTA', 8),
            ('CAP-SL-PASTA', 7)
    ) AS expected(sku, item_count)
    JOIN public.recipes AS recipe ON recipe.sku = expected.sku
    LEFT JOIN public.recipe_items AS recipe_item
        ON recipe_item.recipe_id = recipe.id
    GROUP BY expected.sku, expected.item_count
    HAVING COUNT(recipe_item.id) <> expected.item_count;

    IF invalid_recipes IS NOT NULL THEN
        RAISE EXCEPTION
            'Pasta catalog migration produced incomplete recipes: %',
            ARRAY_TO_STRING(invalid_recipes, ', ');
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.product_skus
        WHERE sku IN ('TPP-SL-PASTA', 'PTR-SL-PASTA', 'CAP-SL-PASTA')
          AND COALESCE(cost_per_unit, 0.0) <= 0.0
    ) THEN
        RAISE EXCEPTION
            'Pasta catalog migration could not calculate positive COGS snapshots';
    END IF;

    SELECT ARRAY_AGG(product.sku ORDER BY product.sku)
    INTO missing_product_mirrors
    FROM public.product_skus AS product
    WHERE product.sku IN ('TPP-SL-PASTA', 'PTR-SL-PASTA', 'CAP-SL-PASTA')
      AND NOT EXISTS (
          SELECT 1
          FROM public.warehouse_stocks AS stock
          JOIN public.warehouses AS warehouse
            ON warehouse.id = stock.warehouse_id
          WHERE warehouse.name = 'Main Facility'
            AND stock.sku = product.sku
      );

    IF missing_product_mirrors IS NOT NULL THEN
        RAISE EXCEPTION
            'Pasta catalog migration is missing Main Facility product mirrors: %',
            ARRAY_TO_STRING(missing_product_mirrors, ', ');
    END IF;

    SELECT NOT EXISTS (
        SELECT 1
        FROM public.warehouse_stocks AS stock
        JOIN public.warehouses AS warehouse
          ON warehouse.id = stock.warehouse_id
        JOIN public.raw_ingredients AS raw
          ON raw.id = stock.raw_ingredient_id
        WHERE warehouse.name = 'Main Facility'
          AND LOWER(BTRIM(raw.name)) = 'sliced cheese'
    )
    INTO missing_cheese_mirror;

    IF missing_cheese_mirror THEN
        RAISE EXCEPTION
            'Pasta catalog migration is missing the Main Facility Sliced cheese mirror';
    END IF;
END $$;
