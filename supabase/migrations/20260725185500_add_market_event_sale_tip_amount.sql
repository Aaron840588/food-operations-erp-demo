-- Add tip_amount column to market_event_sales table
ALTER TABLE public.market_event_sales ADD COLUMN IF NOT EXISTS tip_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
