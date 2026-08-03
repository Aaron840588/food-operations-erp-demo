-- Reconcile the active OTOP lineup with the owner-provided
-- "Partner Inventory Management - OTOP.csv" price block dated 2026-02-14.
--
-- The CSV's New SRP is the Hub master retail price. The OTOP price is derived
-- by consignment deliveries from OTOP's configured 10% discount and frozen in
-- reseller_price_snapshot. Historical snapshots are intentionally untouched.

BEGIN;

UPDATE public.product_skus SET retail_price = 295.00 WHERE sku = 'YP-IND-SWT';
UPDATE public.product_skus SET retail_price = 150.00 WHERE sku = 'YP-SAM-SWT';
UPDATE public.product_skus SET retail_price = 480.00 WHERE sku = 'ST-IND-SWT';
UPDATE public.product_skus SET retail_price = 245.00 WHERE sku = 'ST-SAM-SWT';
UPDATE public.product_skus SET retail_price = 375.00 WHERE sku = 'CM-IND-SWT';
UPDATE public.product_skus SET retail_price = 190.00 WHERE sku = 'CM-SAM-SWT';
UPDATE public.product_skus SET retail_price = 395.00 WHERE sku = 'WM-IND-SWT';
UPDATE public.product_skus SET retail_price = 200.00 WHERE sku = 'WM-SAM-SWT';
UPDATE public.product_skus SET retail_price = 495.00 WHERE sku = 'PP-IND-SVR';
UPDATE public.product_skus SET retail_price = 250.00 WHERE sku = 'PP-SAM-SVR';
UPDATE public.product_skus SET retail_price = 250.00 WHERE sku = 'CGO-IND-SVR';
UPDATE public.product_skus SET retail_price = 130.00 WHERE sku = 'CGO-SAM-SVR';

COMMIT;
