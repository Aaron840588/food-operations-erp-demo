-- Reconcile the active Market Events and public sales lineup with the
-- owner-provided paper inventory sheets photographed on 2026-08-03.
--
-- Only master retail prices and current-lineup availability change here.
-- Existing sale, preorder, reseller, consignment, and Market Event financial
-- snapshots remain immutable. Finished-goods quantities are not changed.

BEGIN;

DO $$
DECLARE
    main_facility_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO main_facility_count
    FROM public.warehouses
    WHERE name = 'Main Facility';

    IF main_facility_count <> 1 THEN
        RAISE EXCEPTION
            'Owner lineup migration requires exactly one Main Facility warehouse; found %',
            main_facility_count;
    END IF;
END $$;

-- These two current products were present on the owner sheet but missing from
-- the catalog. They start at zero stock; staff must record real production or
-- a reviewed stock adjustment before they can be allocated to an event.
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
        'BMC-SL-PASTA',
        'Bacon Mac and Cheese',
        'Pasta Tub',
        '170g',
        130.00,
        130.00,
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
        'TSLD-HF-SW-SVR',
        'Tuna Salad Sandwich',
        'Sandwich',
        'Half',
        115.00,
        97.75,
        1,
        NULL,
        NULL,
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
    is_active = TRUE,
    last_updated = NOW();

-- The Price column on the photographed inventory sheet is the Hub master SRP.
WITH approved_prices (sku, retail_price) AS (
    VALUES
        ('YP-IND-SWT', 295.00),
        ('YP-SAM-SWT', 150.00),
        ('ST-IND-SWT', 460.00),
        ('ST-SAM-SWT', 245.00),
        ('CM-IND-SWT', 375.00),
        ('CM-SAM-SWT', 190.00),
        ('WM-IND-SWT', 395.00),
        ('WM-SAM-SWT', 200.00),
        ('PP-IND-SVR', 495.00),
        ('PP-SAM-SVR', 250.00),
        ('CGO-IND-SVR', 250.00),
        ('CGO-SAM-SVR', 130.00),
        ('GCP-SL-SW-SVR', 90.00),
        ('PEGG-SL-SW-SVR', 115.00),
        ('PCHXW-SL-SW-SVR', 135.00),
        ('SSS-SL-SW-SVR', 150.00),
        ('TSLD-HF-SW-SVR', 115.00),
        ('STS-HF-SW-SWT', 75.00),
        ('CMS-HF-SW-SWT', 70.00),
        ('TRM-HF-SW-SWT', 90.00),
        ('UYK-HF-SW-CK', 115.00),
        ('PTE-HF-SW-SVR', 105.00),
        ('TPP-SL-PASTA', 130.00),
        ('BMC-SL-PASTA', 130.00),
        ('PCS-HF-SW-SVR', 125.00),
        ('BLT-SL-SW-SVR', 165.00)
)
UPDATE public.product_skus AS product
SET
    retail_price = approved.retail_price,
    last_updated = NOW()
FROM approved_prices AS approved
WHERE product.sku = approved.sku;

-- Deactivate rather than delete legacy products so historical foreign keys,
-- financial snapshots, and already-open event allocations remain intact.
WITH approved_lineup (sku) AS (
    VALUES
        ('YP-IND-SWT'), ('YP-SAM-SWT'),
        ('ST-IND-SWT'), ('ST-SAM-SWT'),
        ('CM-IND-SWT'), ('CM-SAM-SWT'),
        ('WM-IND-SWT'), ('WM-SAM-SWT'),
        ('PP-IND-SVR'), ('PP-SAM-SVR'),
        ('CGO-IND-SVR'), ('CGO-SAM-SVR'),
        ('GCP-SL-SW-SVR'), ('PEGG-SL-SW-SVR'),
        ('PCHXW-SL-SW-SVR'), ('SSS-SL-SW-SVR'),
        ('TSLD-HF-SW-SVR'), ('STS-HF-SW-SWT'),
        ('CMS-HF-SW-SWT'), ('TRM-HF-SW-SWT'),
        ('UYK-HF-SW-CK'), ('PTE-HF-SW-SVR'),
        ('TPP-SL-PASTA'), ('BMC-SL-PASTA'),
        ('PCS-HF-SW-SVR'), ('BLT-SL-SW-SVR')
)
UPDATE public.product_skus AS product
SET
    is_active = FALSE,
    last_updated = NOW()
WHERE product.sku <> 'SKU'
  AND product.is_active IS DISTINCT FROM FALSE
  AND NOT EXISTS (
      SELECT 1
      FROM approved_lineup AS approved
      WHERE approved.sku = product.sku
  );

WITH approved_lineup (sku) AS (
    VALUES
        ('YP-IND-SWT'), ('YP-SAM-SWT'),
        ('ST-IND-SWT'), ('ST-SAM-SWT'),
        ('CM-IND-SWT'), ('CM-SAM-SWT'),
        ('WM-IND-SWT'), ('WM-SAM-SWT'),
        ('PP-IND-SVR'), ('PP-SAM-SVR'),
        ('CGO-IND-SVR'), ('CGO-SAM-SVR'),
        ('GCP-SL-SW-SVR'), ('PEGG-SL-SW-SVR'),
        ('PCHXW-SL-SW-SVR'), ('SSS-SL-SW-SVR'),
        ('TSLD-HF-SW-SVR'), ('STS-HF-SW-SWT'),
        ('CMS-HF-SW-SWT'), ('TRM-HF-SW-SWT'),
        ('UYK-HF-SW-CK'), ('PTE-HF-SW-SVR'),
        ('TPP-SL-PASTA'), ('BMC-SL-PASTA'),
        ('PCS-HF-SW-SVR'), ('BLT-SL-SW-SVR')
)
UPDATE public.product_skus AS product
SET
    is_active = TRUE,
    last_updated = NOW()
WHERE product.is_active IS DISTINCT FROM TRUE
  AND EXISTS (
      SELECT 1
      FROM approved_lineup AS approved
      WHERE approved.sku = product.sku
  );

-- Preserve the Main Facility mirror invariant for the two newly catalogued
-- zero-stock products without resetting any existing mirror quantity.
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
  AND product.sku IN ('BMC-SL-PASTA', 'TSLD-HF-SW-SVR')
  AND NOT EXISTS (
      SELECT 1
      FROM public.warehouse_stocks AS existing
      WHERE existing.warehouse_id = warehouse.id
        AND existing.sku = product.sku
  );

DO $$
DECLARE
    missing_skus TEXT[];
    unexpected_active_skus TEXT[];
    wrong_prices TEXT[];
    missing_mirrors TEXT[];
BEGIN
    WITH approved_prices (sku, retail_price) AS (
        VALUES
            ('YP-IND-SWT', 295.00), ('YP-SAM-SWT', 150.00),
            ('ST-IND-SWT', 460.00), ('ST-SAM-SWT', 245.00),
            ('CM-IND-SWT', 375.00), ('CM-SAM-SWT', 190.00),
            ('WM-IND-SWT', 395.00), ('WM-SAM-SWT', 200.00),
            ('PP-IND-SVR', 495.00), ('PP-SAM-SVR', 250.00),
            ('CGO-IND-SVR', 250.00), ('CGO-SAM-SVR', 130.00),
            ('GCP-SL-SW-SVR', 90.00), ('PEGG-SL-SW-SVR', 115.00),
            ('PCHXW-SL-SW-SVR', 135.00), ('SSS-SL-SW-SVR', 150.00),
            ('TSLD-HF-SW-SVR', 115.00), ('STS-HF-SW-SWT', 75.00),
            ('CMS-HF-SW-SWT', 70.00), ('TRM-HF-SW-SWT', 90.00),
            ('UYK-HF-SW-CK', 115.00), ('PTE-HF-SW-SVR', 105.00),
            ('TPP-SL-PASTA', 130.00), ('BMC-SL-PASTA', 130.00),
            ('PCS-HF-SW-SVR', 125.00), ('BLT-SL-SW-SVR', 165.00)
    )
    SELECT ARRAY_AGG(approved.sku ORDER BY approved.sku)
    INTO missing_skus
    FROM approved_prices AS approved
    LEFT JOIN public.product_skus AS product
      ON product.sku = approved.sku
    WHERE product.sku IS NULL;

    IF missing_skus IS NOT NULL THEN
        RAISE EXCEPTION
            'Owner lineup migration is missing approved SKUs: %',
            ARRAY_TO_STRING(missing_skus, ', ');
    END IF;

    WITH approved_prices (sku, retail_price) AS (
        VALUES
            ('YP-IND-SWT', 295.00), ('YP-SAM-SWT', 150.00),
            ('ST-IND-SWT', 460.00), ('ST-SAM-SWT', 245.00),
            ('CM-IND-SWT', 375.00), ('CM-SAM-SWT', 190.00),
            ('WM-IND-SWT', 395.00), ('WM-SAM-SWT', 200.00),
            ('PP-IND-SVR', 495.00), ('PP-SAM-SVR', 250.00),
            ('CGO-IND-SVR', 250.00), ('CGO-SAM-SVR', 130.00),
            ('GCP-SL-SW-SVR', 90.00), ('PEGG-SL-SW-SVR', 115.00),
            ('PCHXW-SL-SW-SVR', 135.00), ('SSS-SL-SW-SVR', 150.00),
            ('TSLD-HF-SW-SVR', 115.00), ('STS-HF-SW-SWT', 75.00),
            ('CMS-HF-SW-SWT', 70.00), ('TRM-HF-SW-SWT', 90.00),
            ('UYK-HF-SW-CK', 115.00), ('PTE-HF-SW-SVR', 105.00),
            ('TPP-SL-PASTA', 130.00), ('BMC-SL-PASTA', 130.00),
            ('PCS-HF-SW-SVR', 125.00), ('BLT-SL-SW-SVR', 165.00)
    )
    SELECT ARRAY_AGG(product.sku ORDER BY product.sku)
    INTO wrong_prices
    FROM approved_prices AS approved
    JOIN public.product_skus AS product
      ON product.sku = approved.sku
    WHERE ABS(product.retail_price - approved.retail_price::double precision) > 0.001
       OR product.is_active IS DISTINCT FROM TRUE;

    IF wrong_prices IS NOT NULL THEN
        RAISE EXCEPTION
            'Owner lineup migration has incorrect active prices: %',
            ARRAY_TO_STRING(wrong_prices, ', ');
    END IF;

    WITH approved_lineup (sku) AS (
        VALUES
            ('YP-IND-SWT'), ('YP-SAM-SWT'),
            ('ST-IND-SWT'), ('ST-SAM-SWT'),
            ('CM-IND-SWT'), ('CM-SAM-SWT'),
            ('WM-IND-SWT'), ('WM-SAM-SWT'),
            ('PP-IND-SVR'), ('PP-SAM-SVR'),
            ('CGO-IND-SVR'), ('CGO-SAM-SVR'),
            ('GCP-SL-SW-SVR'), ('PEGG-SL-SW-SVR'),
            ('PCHXW-SL-SW-SVR'), ('SSS-SL-SW-SVR'),
            ('TSLD-HF-SW-SVR'), ('STS-HF-SW-SWT'),
            ('CMS-HF-SW-SWT'), ('TRM-HF-SW-SWT'),
            ('UYK-HF-SW-CK'), ('PTE-HF-SW-SVR'),
            ('TPP-SL-PASTA'), ('BMC-SL-PASTA'),
            ('PCS-HF-SW-SVR'), ('BLT-SL-SW-SVR')
    )
    SELECT ARRAY_AGG(product.sku ORDER BY product.sku)
    INTO unexpected_active_skus
    FROM public.product_skus AS product
    WHERE product.sku <> 'SKU'
      AND product.is_active = TRUE
      AND NOT EXISTS (
          SELECT 1
          FROM approved_lineup AS approved
          WHERE approved.sku = product.sku
      );

    IF unexpected_active_skus IS NOT NULL THEN
        RAISE EXCEPTION
            'Owner lineup migration left unexpected active SKUs: %',
            ARRAY_TO_STRING(unexpected_active_skus, ', ');
    END IF;

    SELECT ARRAY_AGG(product.sku ORDER BY product.sku)
    INTO missing_mirrors
    FROM public.product_skus AS product
    WHERE product.sku IN ('BMC-SL-PASTA', 'TSLD-HF-SW-SVR')
      AND NOT EXISTS (
          SELECT 1
          FROM public.warehouse_stocks AS stock
          JOIN public.warehouses AS warehouse
            ON warehouse.id = stock.warehouse_id
          WHERE warehouse.name = 'Main Facility'
            AND stock.sku = product.sku
      );

    IF missing_mirrors IS NOT NULL THEN
        RAISE EXCEPTION
            'Owner lineup migration is missing Main Facility mirrors: %',
            ARRAY_TO_STRING(missing_mirrors, ', ');
    END IF;
END $$;

COMMIT;
