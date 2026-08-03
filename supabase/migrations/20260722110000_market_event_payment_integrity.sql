-- Server-authoritative cash tender/change and direct sale idempotency.
-- Rollback guidance: retain these nullable/audit columns during application
-- rollback; dropping the unique index would weaken duplicate protection.

ALTER TABLE public.market_event_sales
  ADD COLUMN IF NOT EXISTS client_reference VARCHAR(64),
  ADD COLUMN IF NOT EXISTS cash_received NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS change_given NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(100);

CREATE UNIQUE INDEX IF NOT EXISTS uq_market_event_sale_client_reference
  ON public.market_event_sales (event_id, client_reference)
  WHERE client_reference IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_market_event_sales_cash_received_nonnegative'
      AND conrelid = 'public.market_event_sales'::regclass
  ) THEN
    ALTER TABLE public.market_event_sales
      ADD CONSTRAINT ck_market_event_sales_cash_received_nonnegative
      CHECK (cash_received IS NULL OR cash_received >= 0.00);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_market_event_sales_change_given_nonnegative'
      AND conrelid = 'public.market_event_sales'::regclass
  ) THEN
    ALTER TABLE public.market_event_sales
      ADD CONSTRAINT ck_market_event_sales_change_given_nonnegative
      CHECK (change_given >= 0.00);
  END IF;
END $$;
