-- Market Event stock and receipt integrity.
-- The filename matches the production Supabase migration-history version.
-- This migration is intentionally idempotent so interrupted deployments can
-- safely retry it. Historical sale-only SKUs are restored as zero booth rows;
-- warehouse stock is not changed by that repair.

ALTER TABLE public.market_event_sales
  ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS discount_type TEXT,
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS manual_discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS promotion_code TEXT,
  ADD COLUMN IF NOT EXISTS promotion_discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS promotion_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS customer_name TEXT;

ALTER TABLE public.market_event_sales
  ALTER COLUMN total_amount TYPE NUMERIC(12, 2)
    USING ROUND(COALESCE(total_amount, 0)::NUMERIC, 2),
  ALTER COLUMN total_amount SET DEFAULT 0.00,
  ALTER COLUMN total_amount SET NOT NULL;

ALTER TABLE public.market_event_sale_items
  ALTER COLUMN price_snapshot TYPE NUMERIC(12, 2)
    USING ROUND(COALESCE(price_snapshot, 0)::NUMERIC, 2),
  ALTER COLUMN price_snapshot SET DEFAULT 0.00,
  ALTER COLUMN price_snapshot SET NOT NULL;

WITH item_subtotals AS (
  SELECT
    sale_id,
    ROUND(
      COALESCE(SUM(quantity * price_snapshot), 0)::NUMERIC,
      2
    ) AS subtotal
  FROM public.market_event_sale_items
  GROUP BY sale_id
)
UPDATE public.market_event_sales AS sale
SET
  subtotal_amount = COALESCE(items.subtotal, sale.total_amount, 0.00),
  discount_amount = GREATEST(
    COALESCE(items.subtotal, sale.total_amount, 0.00)
      - COALESCE(sale.total_amount, 0.00),
    0.00
  ),
  promotion_snapshot = COALESCE(
    sale.promotion_snapshot,
    '{"code":"LEGACY","rule":"historical_total_only"}'
  )
FROM item_subtotals AS items
WHERE items.sale_id = sale.id;

UPDATE public.market_event_sales
SET
  subtotal_amount = COALESCE(NULLIF(subtotal_amount, 0.00), total_amount, 0.00),
  discount_amount = GREATEST(
    COALESCE(subtotal_amount, total_amount, 0.00)
      - COALESCE(total_amount, 0.00),
    0.00
  ),
  manual_discount_amount = COALESCE(manual_discount_amount, 0.00),
  promotion_discount_amount = COALESCE(promotion_discount_amount, 0.00),
  promotion_snapshot = COALESCE(
    promotion_snapshot,
    '{"code":"LEGACY","rule":"historical_total_only"}'
  );

-- Restore the audit anchor for SKUs sold before an Active allocation editor
-- deleted their zero-remaining row. This deliberately performs no warehouse
-- movement.
INSERT INTO public.market_event_allocations (
  event_id,
  sku,
  quantity,
  wasted_quantity,
  waste_reason
)
SELECT DISTINCT
  sale.event_id,
  item.sku,
  0,
  0,
  NULL
FROM public.market_event_sales AS sale
JOIN public.market_event_sale_items AS item
  ON item.sale_id = sale.id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.market_event_allocations AS allocation
  WHERE allocation.event_id = sale.event_id
    AND allocation.sku = item.sku
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_market_event_sales_pricing_nonnegative'
      AND conrelid = 'public.market_event_sales'::regclass
  ) THEN
    ALTER TABLE public.market_event_sales
      ADD CONSTRAINT ck_market_event_sales_pricing_nonnegative
      CHECK (
        subtotal_amount >= 0.00
        AND manual_discount_amount >= 0.00
        AND promotion_discount_amount >= 0.00
        AND discount_amount >= 0.00
        AND total_amount >= 0.00
        AND discount_amount <= subtotal_amount
        AND total_amount = subtotal_amount - discount_amount
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_market_event_sales_discount_type'
      AND conrelid = 'public.market_event_sales'::regclass
  ) THEN
    ALTER TABLE public.market_event_sales
      ADD CONSTRAINT ck_market_event_sales_discount_type
      CHECK (
        discount_type IS NULL
        OR discount_type IN ('PERCENTAGE', 'FIXED')
      );
  END IF;
END $$;
