-- Unconditionally restore OTOP partner and delivery DR-20260803-00004 with exact 39-jar shipment (Total: 6,010 PHP)
-- Fixes missing/incorrect dispatch records for OTOP store view on live Supabase PostgreSQL.

BEGIN;

-- 1. Ensure OTOP partner exists and is active
INSERT INTO public.consignment_partners (name, discount_rate, collection_frequency, minimum_order_amount, is_active)
SELECT 'OTOP', 0.10, 'Monthly', 0.00, TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM public.consignment_partners WHERE LOWER(name) = 'otop'
);

UPDATE public.consignment_partners
SET is_active = TRUE, discount_rate = 0.10
WHERE LOWER(name) = 'otop';

-- 2. Ensure delivery DR-20260803-00004 exists for OTOP partner
INSERT INTO public.consignment_deliveries (partner_id, delivery_date, dr_number, is_paid)
SELECT p.id, '2026-08-03', 'DR-20260803-00004', FALSE
FROM public.consignment_partners p
WHERE LOWER(p.name) = 'otop'
AND NOT EXISTS (
    SELECT 1 FROM public.consignment_deliveries WHERE dr_number = 'DR-20260803-00004'
);

-- Ensure DR-20260803-00004 partner_id points to OTOP
UPDATE public.consignment_deliveries
SET partner_id = (SELECT id FROM public.consignment_partners WHERE LOWER(name) = 'otop' LIMIT 1)
WHERE dr_number = 'DR-20260803-00004';

-- 3. Replace consignment items for DR-20260803-00004 with exact 39-jar shipment (6,010 PHP reseller value)
WITH target_delivery AS (
    SELECT id FROM public.consignment_deliveries WHERE dr_number = 'DR-20260803-00004' LIMIT 1
)
DELETE FROM public.consignment_items
WHERE delivery_id IN (SELECT id FROM target_delivery);

WITH target_delivery AS (
    SELECT id FROM public.consignment_deliveries WHERE dr_number = 'DR-20260803-00004' LIMIT 1
)
INSERT INTO public.consignment_items (
    delivery_id, sku, qty_delivered, units_sold, qty_pulled_out,
    reseller_price_snapshot, store_price_snapshot, cost_per_unit_snapshot
)
SELECT
    d.id, v.sku, v.qty_delivered, 0, 0, v.reseller_price, v.store_price, v.cost
FROM target_delivery d
CROSS JOIN (
    VALUES
        ('CGO-SAM-SVR', 15, 110.00, 130.00, 59.29),  -- 15 jars Chili Garlic Oil Sampler 100g = 1,650 PHP
        ('CM-SAM-SWT',   4, 160.00, 190.00, 52.46),  -- 4 jars Creamy Matcha Sampler 100g = 640 PHP
        ('PP-SAM-SVR',   8, 210.00, 250.00, 104.54), -- 8 jars Pesto with Pili Sampler 100g = 1,680 PHP
        ('YP-SAM-SWT',   8, 130.00, 150.00, 51.60),  -- 8 jars Yema with Pili Sampler 100g = 1,040 PHP
        ('YP-IND-SWT',   4, 250.00, 295.00, 94.69)   -- 4 jars Yema with Pili Indulge 240g = 1,000 PHP
) AS v(sku, qty_delivered, reseller_price, store_price, cost);

COMMIT;
