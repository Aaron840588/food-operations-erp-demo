-- Restore OTOP partner and shipment delivery log DR-20260803-00004
-- Ensures historical and active OTOP B2B consignment tracking is fully preserved.

BEGIN;

-- 1. Ensure OTOP partner exists
INSERT INTO public.consignment_partners (name, discount_rate, collection_frequency, minimum_order_amount, is_active)
SELECT 'OTOP', 0.10, 'Monthly', 0.00, TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM public.consignment_partners WHERE LOWER(name) = 'otop'
);

-- 2. Restore delivery log DR-20260803-00004 for OTOP if missing
WITH otop_partner AS (
    SELECT id FROM public.consignment_partners WHERE LOWER(name) = 'otop' LIMIT 1
),
inserted_delivery AS (
    INSERT INTO public.consignment_deliveries (partner_id, delivery_date, dr_number, is_paid)
    SELECT id, '2026-08-03', 'DR-20260803-00004', FALSE
    FROM otop_partner
    WHERE NOT EXISTS (
        SELECT 1 FROM public.consignment_deliveries WHERE dr_number = 'DR-20260803-00004'
    )
    RETURNING id
)
INSERT INTO public.consignment_items (
    delivery_id, sku, qty_delivered, units_sold, qty_pulled_out,
    reseller_price_snapshot, store_price_snapshot, cost_per_unit_snapshot
)
SELECT
    d.id, v.sku, v.qty_delivered, 0, 0, v.reseller_price, v.store_price, v.cost
FROM inserted_delivery d
CROSS JOIN (
    VALUES
        ('YP-IND-SWT', 4, 266.00, 295.00, 85.00),
        ('YP-SAM-SWT', 6, 135.00, 150.00, 42.00),
        ('CM-IND-SWT', 4, 338.00, 375.00, 110.00),
        ('CM-SAM-SWT', 6, 171.00, 190.00, 55.00),
        ('WM-IND-SWT', 4, 356.00, 395.00, 115.00),
        ('WM-SAM-SWT', 6, 180.00, 200.00, 58.00),
        ('PP-IND-SVR', 4, 446.00, 495.00, 145.00),
        ('PP-SAM-SVR', 6, 225.00, 250.00, 72.00),
        ('CGO-IND-SVR', 4, 225.00, 250.00, 70.00),
        ('CGO-SAM-SVR', 6, 117.00, 130.00, 36.00)
) AS v(sku, qty_delivered, reseller_price, store_price, cost);

COMMIT;
