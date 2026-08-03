-- Revert Spreads & Sauces SKUs back to original Hub prices per owner directive
-- Generated on 2026-07-31T07:33:08.746922

BEGIN;

UPDATE public.product_skus SET retail_price = 295.00, reseller_price = 250.00 WHERE sku = 'YP-IND-SWT';
UPDATE public.product_skus SET retail_price = 150.00, reseller_price = 130.00 WHERE sku = 'YP-SAM-SWT';
UPDATE public.product_skus SET retail_price = 480.00, reseller_price = 400.00 WHERE sku = 'ST-IND-SWT';
UPDATE public.product_skus SET retail_price = 245.00, reseller_price = 210.00 WHERE sku = 'ST-SAM-SWT';
UPDATE public.product_skus SET retail_price = 375.00, reseller_price = 320.00 WHERE sku = 'CM-IND-SWT';
UPDATE public.product_skus SET retail_price = 190.00, reseller_price = 160.00 WHERE sku = 'CM-SAM-SWT';
UPDATE public.product_skus SET retail_price = 395.00, reseller_price = 340.00 WHERE sku = 'WM-IND-SWT';
UPDATE public.product_skus SET retail_price = 200.00, reseller_price = 170.00 WHERE sku = 'WM-SAM-SWT';
UPDATE public.product_skus SET retail_price = 495.00, reseller_price = 420.00 WHERE sku = 'PP-IND-SVR';
UPDATE public.product_skus SET retail_price = 250.00, reseller_price = 210.00 WHERE sku = 'PP-SAM-SVR';
UPDATE public.product_skus SET retail_price = 250.00, reseller_price = 210.00 WHERE sku = 'CGO-IND-SVR';
UPDATE public.product_skus SET retail_price = 130.00, reseller_price = 110.00 WHERE sku = 'CGO-SAM-SVR';
UPDATE public.product_skus SET retail_price = 450.00, reseller_price = 380.00 WHERE sku = 'CKS-IND-SVR';
UPDATE public.product_skus SET retail_price = 230.00, reseller_price = 195.00 WHERE sku = 'CKS-SAM-SVR';

COMMIT;
