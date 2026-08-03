-- Sync Product SKU Retail Prices (SRP) and Reseller Prices with Owner Master Excel Trackers
-- Generated on 2026-07-31T07:23:24.202304

BEGIN;

UPDATE public.product_skus SET retail_price = 165.00, reseller_price = 165.00 WHERE sku = 'BLT-SL-SW-SVR';
UPDATE public.product_skus SET retail_price = 150.00, reseller_price = 150.00 WHERE sku = 'GCP-SL-SW-SVR';
UPDATE public.product_skus SET retail_price = 130.00, reseller_price = 130.00 WHERE sku = 'PEGG-SL-SW-SVR';
UPDATE public.product_skus SET retail_price = 140.00, reseller_price = 140.00 WHERE sku = 'PTE-FL-SW-SVR';
UPDATE public.product_skus SET retail_price = 140.00, reseller_price = 140.00 WHERE sku = 'UYK-FL-SW-CK';
UPDATE public.product_skus SET retail_price = 95.00, reseller_price = 95.00 WHERE sku = 'STS-HF-SW-SWT';
UPDATE public.product_skus SET retail_price = 80.00, reseller_price = 80.00 WHERE sku = 'CMS-HF-SW-SWT';
UPDATE public.product_skus SET retail_price = 95.00, reseller_price = 95.00 WHERE sku = 'WM-HF-SW-SWT';
UPDATE public.product_skus SET retail_price = 130.00, reseller_price = 130.00 WHERE sku = 'TPP-SL-PASTA';
UPDATE public.product_skus SET retail_price = 130.00, reseller_price = 130.00 WHERE sku = 'BMC-SL-PASTA';
UPDATE public.product_skus SET retail_price = 170.00, reseller_price = 170.00 WHERE sku = 'SSC-SL-SW-SVR';
UPDATE public.product_skus SET retail_price = 150.00, reseller_price = 150.00 WHERE sku = 'PCS-FL-SW-SVR';
UPDATE public.product_skus SET retail_price = 150.00, reseller_price = 150.00 WHERE sku = 'PCHXW-SL-SW-SVR';
UPDATE public.product_skus SET retail_price = 140.00, reseller_price = 140.00 WHERE sku = 'PCBW-SL-SW-SVR';
UPDATE public.product_skus SET retail_price = 85.00, reseller_price = 85.00 WHERE sku = 'TRRD-SL-SW-SWT';
UPDATE public.product_skus SET retail_price = 90.00, reseller_price = 90.00 WHERE sku = 'YMB-SL-SW-SWT';
UPDATE public.product_skus SET retail_price = 120.00, reseller_price = 120.00 WHERE sku = 'YBC-DES-2S';
UPDATE public.product_skus SET retail_price = 100.00, reseller_price = 100.00 WHERE sku = 'UCB-DRK-01';
UPDATE public.product_skus SET retail_price = 230.00, reseller_price = 185.00 WHERE sku = 'YP-IND-SWT';
UPDATE public.product_skus SET retail_price = 130.00, reseller_price = 105.00 WHERE sku = 'YP-SAM-SWT';
UPDATE public.product_skus SET retail_price = 230.00, reseller_price = 185.00 WHERE sku = 'ST-IND-SWT';
UPDATE public.product_skus SET retail_price = 130.00, reseller_price = 105.00 WHERE sku = 'ST-SAM-SWT';
UPDATE public.product_skus SET retail_price = 255.00, reseller_price = 205.00 WHERE sku = 'CM-IND-SWT';
UPDATE public.product_skus SET retail_price = 145.00, reseller_price = 115.00 WHERE sku = 'CM-SAM-SWT';
UPDATE public.product_skus SET retail_price = 280.00, reseller_price = 225.00 WHERE sku = 'WM-IND-SWT';
UPDATE public.product_skus SET retail_price = 155.00, reseller_price = 125.00 WHERE sku = 'WM-SAM-SWT';
UPDATE public.product_skus SET retail_price = 265.00, reseller_price = 215.00 WHERE sku = 'PP-IND-SVR';
UPDATE public.product_skus SET retail_price = 150.00, reseller_price = 120.00 WHERE sku = 'PP-SAM-SVR';
UPDATE public.product_skus SET retail_price = 210.00, reseller_price = 170.00 WHERE sku = 'CGO-IND-SVR';
UPDATE public.product_skus SET retail_price = 120.00, reseller_price = 95.00 WHERE sku = 'CGO-SAM-SVR';
UPDATE public.product_skus SET retail_price = 205.00, reseller_price = 165.00 WHERE sku = 'CKS-IND-SVR';
UPDATE public.product_skus SET retail_price = 120.00, reseller_price = 95.00 WHERE sku = 'CKS-SAM-SVR';

COMMIT;
