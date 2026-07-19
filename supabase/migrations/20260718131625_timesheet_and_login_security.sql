-- Shared login throttling and lean, idempotent timesheet access.

ALTER TABLE public.timesheet_entries
  ADD COLUMN IF NOT EXISTS client_reference VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS ix_timesheet_entries_client_reference
  ON public.timesheet_entries(client_reference)
  WHERE client_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_timesheet_entries_order
  ON public.timesheet_entries(work_date DESC, clock_in DESC);

CREATE INDEX IF NOT EXISTS ix_timesheet_entries_employee_order
  ON public.timesheet_entries(employee_user_id, work_date DESC, clock_in DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ix_timesheet_entries_machine_identity
  ON public.timesheet_entries(machine_employee_id, work_date)
  WHERE source = 'machine' AND machine_employee_id IS NOT NULL;

-- Cover foreign keys reported by the Supabase performance advisor.
CREATE INDEX IF NOT EXISTS ix_gift_set_items_gift_set_id ON public.gift_set_items(gift_set_id);
CREATE INDEX IF NOT EXISTS ix_gift_set_items_sku ON public.gift_set_items(sku);
CREATE INDEX IF NOT EXISTS ix_inventory_transactions_user_id ON public.inventory_transactions(user_id);
CREATE INDEX IF NOT EXISTS ix_inventory_transactions_warehouse_id ON public.inventory_transactions(warehouse_id);
CREATE INDEX IF NOT EXISTS ix_market_event_sale_items_sku ON public.market_event_sale_items(sku);
CREATE INDEX IF NOT EXISTS ix_market_event_sales_cashier_id ON public.market_event_sales(cashier_id);
CREATE INDEX IF NOT EXISTS ix_production_batches_sku ON public.production_batches(sku);
CREATE INDEX IF NOT EXISTS ix_production_targets_sku ON public.production_targets(sku);
CREATE INDEX IF NOT EXISTS ix_push_subscriptions_user_id ON public.push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS ix_raw_ingredients_supplier_id ON public.raw_ingredients(supplier_id);
CREATE INDEX IF NOT EXISTS ix_recipe_items_raw_ingredient_id ON public.recipe_items(raw_ingredient_id);
CREATE INDEX IF NOT EXISTS ix_recipe_items_sub_sku ON public.recipe_items(sub_sku);
CREATE INDEX IF NOT EXISTS ix_refresh_tokens_username ON public.refresh_tokens(username);
CREATE INDEX IF NOT EXISTS ix_timesheet_entries_imported_by_user_id ON public.timesheet_entries(imported_by_user_id);
CREATE INDEX IF NOT EXISTS ix_warehouse_stocks_raw_ingredient_id ON public.warehouse_stocks(raw_ingredient_id);
CREATE INDEX IF NOT EXISTS ix_warehouse_stocks_sku ON public.warehouse_stocks(sku);

-- Keep the ORM-named copy of each previously duplicated index.
DROP INDEX IF EXISTS public.idx_ingredient_batches_expiry_date;
DROP INDEX IF EXISTS public.idx_ingredient_batches_raw_ingredient_id;
DROP INDEX IF EXISTS public.idx_inventory_transactions_raw_ingredient_id;
DROP INDEX IF EXISTS public.idx_inventory_transactions_sku;
DROP INDEX IF EXISTS public.idx_reseller_order_items_order_id;
DROP INDEX IF EXISTS public.idx_reseller_order_items_sku;

CREATE TABLE IF NOT EXISTS public.login_rate_limits (
  id BIGSERIAL PRIMARY KEY,
  scope VARCHAR(20) NOT NULL,
  identifier_hash VARCHAR(64) NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  window_started_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  locked_until TIMESTAMP WITHOUT TIME ZONE,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_login_rate_limits_scope_identifier UNIQUE (scope, identifier_hash)
);

ALTER TABLE public.login_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.login_rate_limits FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.login_rate_limits_id_seq FROM anon, authenticated;
GRANT ALL ON TABLE public.login_rate_limits TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.login_rate_limits_id_seq TO service_role;
