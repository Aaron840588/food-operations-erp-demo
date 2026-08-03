-- One-time source-data repair from the owner-approved Partner Inventory
-- `RTE Food Info` prices verified on 2026-07-29. Predicates include the
-- previously audited Hub value so a later owner edit is never overwritten.

UPDATE public.product_skus
SET retail_price = 90.00
WHERE sku = 'GCP-SL-SW-SVR' AND retail_price = 85.00;

UPDATE public.product_skus
SET retail_price = 150.00
WHERE sku = 'SSS-SL-SW-SVR' AND retail_price = 120.00;

UPDATE public.product_skus
SET retail_price = 115.00
WHERE sku = 'TSLD-SL-SW-SVR' AND retail_price = 105.00;

UPDATE public.product_skus
SET retail_price = 130.00, reseller_price = 110.50
WHERE sku = 'PPZ-HF-SW-SVR'
  AND retail_price = 0.00
  AND reseller_price = 0.00;

UPDATE public.product_skus
SET retail_price = 110.00, reseller_price = 93.50
WHERE sku = 'CQM-HF-SW-SVR'
  AND retail_price = 0.00
  AND reseller_price = 0.00;

UPDATE public.product_skus
SET retail_price = 115.00, reseller_price = 97.75
WHERE sku = 'CQMD-HF-SW-SVR'
  AND retail_price = 0.00
  AND reseller_price = 0.00;

-- These SKU patterns and product names identify ready-to-eat sandwiches.
-- Correcting the stored category keeps exports and non-UI consumers aligned
-- with the frontend/dashboard classification precedence fix.
UPDATE public.product_skus
SET category = 'Sandwich'
WHERE sku = 'PCLB-HF-SW-SVR' AND category = 'Savory';

UPDATE public.product_skus
SET category = 'Sandwich'
WHERE sku = 'WMS-HF-SW-SWT' AND category = 'Sweet';
