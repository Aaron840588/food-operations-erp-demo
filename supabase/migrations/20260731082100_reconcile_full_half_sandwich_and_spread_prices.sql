-- Reconcile Full and Half Portion Sandwich SRP/Reseller Prices & Spreads Reseller Prices with Owner Master Excel Catalog
-- Generated on 2026-07-31T08:21:00

BEGIN;

-- Full Portion Sandwiches (restoring true Full Portion SRPs instead of Half Portion duplicates)
UPDATE public.product_skus SET retail_price = 200.00, reseller_price = 170.00 WHERE sku = 'CQM-FL-SW-SVR';
UPDATE public.product_skus SET retail_price = 205.00, reseller_price = 174.25 WHERE sku = 'CQMD-FL-SW-SVR';
UPDATE public.product_skus SET retail_price = 250.00, reseller_price = 212.50 WHERE sku = 'PPZ-FL-SW-SVR';
UPDATE public.product_skus SET retail_price = 200.00, reseller_price = 170.00 WHERE sku = 'PTE-FL-SW-SVR';
UPDATE public.product_skus SET retail_price = 245.00, reseller_price = 208.25 WHERE sku = 'PCS-FL-SW-SVR';
UPDATE public.product_skus SET retail_price = 165.00, reseller_price = 140.25 WHERE sku = 'BLT-SL-SW-SVR';

-- Half Portion Sandwiches
UPDATE public.product_skus SET retail_price = 110.00, reseller_price = 93.50 WHERE sku = 'CQM-HF-SW-SVR';
UPDATE public.product_skus SET retail_price = 115.00, reseller_price = 97.75 WHERE sku = 'CQMD-HF-SW-SVR';
UPDATE public.product_skus SET retail_price = 130.00, reseller_price = 110.50 WHERE sku = 'PPZ-HF-SW-SVR';
UPDATE public.product_skus SET retail_price = 105.00, reseller_price = 89.25 WHERE sku = 'PTE-HF-SW-SVR';
UPDATE public.product_skus SET retail_price = 125.00, reseller_price = 106.25 WHERE sku = 'PCS-HF-SW-SVR';
UPDATE public.product_skus SET retail_price = 125.00, reseller_price = 106.25 WHERE sku = 'PCLB-HF-SW-SVR';
UPDATE public.product_skus SET retail_price = 80.00, reseller_price = 68.00 WHERE sku = 'WMS-HF-SW-SWT';

-- Spreads & Sauces Wholesale / Reseller Prices
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
UPDATE public.product_skus SET retail_price = 250.00, reseller_price = 210.00 WHERE sku = 'CLS-IND-SVR';
UPDATE public.product_skus SET retail_price = 130.00, reseller_price = 110.00 WHERE sku = 'CLS-SAM-SVR';

COMMIT;
