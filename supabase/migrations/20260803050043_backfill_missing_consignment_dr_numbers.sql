-- Give legacy consignment deliveries without a paper DR the same stable
-- system identifier used by new deliveries. This changes receipt metadata
-- only; stock, quantities, financial snapshots, and settlements are untouched.

BEGIN;

UPDATE public.consignment_deliveries
SET dr_number = 'DR-'
    || replace(delivery_date, '-', '')
    || '-'
    || lpad(id::text, 5, '0')
WHERE dr_number IS NULL OR btrim(dr_number) = '';

COMMIT;
