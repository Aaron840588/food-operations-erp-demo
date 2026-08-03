-- Explicit Market Event closeout buckets. Money is stored as decimal-safe
-- NUMERIC. A NULL digital balance means "not reconciled"; an explicit zero is
-- a valid physical/account count and must not fall back to the POS total.

ALTER TABLE public.market_events
  ADD COLUMN IF NOT EXISTS cash_expenses NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS cash_refunds NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS gcash_sales NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS bpi_sales NUMERIC(12, 2);

-- This also makes the migration safe if an earlier local draft created these
-- columns as DOUBLE PRECISION.
ALTER TABLE public.market_events
  ALTER COLUMN cash_expenses TYPE NUMERIC(12, 2)
    USING ROUND(COALESCE(cash_expenses, 0)::NUMERIC, 2),
  ALTER COLUMN cash_expenses SET DEFAULT 0.00,
  ALTER COLUMN cash_expenses SET NOT NULL,
  ALTER COLUMN cash_refunds TYPE NUMERIC(12, 2)
    USING ROUND(COALESCE(cash_refunds, 0)::NUMERIC, 2),
  ALTER COLUMN cash_refunds SET DEFAULT 0.00,
  ALTER COLUMN cash_refunds SET NOT NULL,
  ALTER COLUMN gcash_sales TYPE NUMERIC(12, 2)
    USING ROUND(gcash_sales::NUMERIC, 2),
  ALTER COLUMN gcash_sales DROP DEFAULT,
  ALTER COLUMN gcash_sales DROP NOT NULL,
  ALTER COLUMN bpi_sales TYPE NUMERIC(12, 2)
    USING ROUND(bpi_sales::NUMERIC, 2),
  ALTER COLUMN bpi_sales DROP DEFAULT,
  ALTER COLUMN bpi_sales DROP NOT NULL;

-- Preserve expenses captured by the legacy closeout form.
UPDATE public.market_events
SET cash_expenses = total_expenses
WHERE cash_expenses = 0.0
  AND COALESCE(total_expenses, 0.0) > 0.0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_market_events_cash_expenses_nonnegative'
      AND conrelid = 'public.market_events'::regclass
  ) THEN
    ALTER TABLE public.market_events
      ADD CONSTRAINT ck_market_events_cash_expenses_nonnegative
      CHECK (cash_expenses >= 0.0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_market_events_cash_refunds_nonnegative'
      AND conrelid = 'public.market_events'::regclass
  ) THEN
    ALTER TABLE public.market_events
      ADD CONSTRAINT ck_market_events_cash_refunds_nonnegative
      CHECK (cash_refunds >= 0.0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_market_events_gcash_sales_nonnegative'
      AND conrelid = 'public.market_events'::regclass
  ) THEN
    ALTER TABLE public.market_events
      ADD CONSTRAINT ck_market_events_gcash_sales_nonnegative
      CHECK (gcash_sales >= 0.0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_market_events_bpi_sales_nonnegative'
      AND conrelid = 'public.market_events'::regclass
  ) THEN
    ALTER TABLE public.market_events
      ADD CONSTRAINT ck_market_events_bpi_sales_nonnegative
      CHECK (bpi_sales >= 0.0);
  END IF;
END $$;
