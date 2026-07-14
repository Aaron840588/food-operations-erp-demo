-- ============================================================
-- H+H Hub — Supabase Security & Performance Migration
-- Fixes: RLS, Function Search Path, Unindexed Foreign Keys
-- Run this in Supabase → SQL Editor
-- ============================================================

-- ============================================================
-- 1. ENABLE RLS ON ALL PUBLIC TABLES
--    The FastAPI backend connects via the postgres superuser
--    which bypasses RLS automatically. Enabling RLS closes
--    the hole where someone with the anon key could access
--    data directly via the Supabase REST API.
-- ============================================================

ALTER TABLE public.users                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_ingredients          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_skus             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipes                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredient_batches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_stocks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_targets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_batches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_sets                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_set_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consignment_partners     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consignment_deliveries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consignment_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reseller_orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reseller_order_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_tiers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_overhead_rates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overhead_configs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_assets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleaning_tasks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions       ENABLE ROW LEVEL SECURITY;

-- Handle warehouses table (may exist under different name)
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'warehouses') THEN
    EXECUTE 'ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- ============================================================
-- 2. ADD RLS POLICIES — Allow service_role full access
--    The FastAPI backend uses the postgres/service_role which
--    bypasses RLS natively. These policies are a safety net
--    for any direct Supabase client usage in future.
-- ============================================================

-- Helper: create a "service role full access" policy for each table
-- We use 'authenticated' role as a catch-all for backend access.
-- The postgres superuser already bypasses RLS.

DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'users', 'suppliers', 'raw_ingredients', 'product_skus',
    'recipes', 'recipe_items', 'ingredient_batches', 'inventory_transactions',
    'warehouse_stocks', 'production_plans', 'production_targets', 'production_batches',
    'gift_sets', 'gift_set_items', 'consignment_partners', 'consignment_deliveries',
    'consignment_items', 'reseller_orders', 'reseller_order_items', 'discount_tiers',
    'category_overhead_rates', 'overhead_configs', 'maintenance_assets',
    'cleaning_tasks', 'push_subscriptions', 'warehouses'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl) THEN
      -- Drop existing policies first (idempotent)
      EXECUTE format(
        'DROP POLICY IF EXISTS "service_role_all" ON public.%I', tbl
      );
      -- Create policy: service_role bypasses RLS; this gives authenticated role full access too
      EXECUTE format(
        'CREATE POLICY "service_role_all" ON public.%I
         FOR ALL
         TO service_role
         USING (true)
         WITH CHECK (true)', tbl
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 3. FIX FUNCTION SEARCH PATH — update_raw_ingredient_cost
--    Prevents schema search path injection attacks.
-- ============================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_raw_ingredient_cost'
  ) THEN
    EXECUTE $func$
      ALTER FUNCTION public.update_raw_ingredient_cost()
      SET search_path = public, extensions
    $func$;
  END IF;
END $$;

-- ============================================================
-- 4. ADD MISSING FOREIGN KEY INDEXES — Performance
--    Supabase flagged these FK columns as unindexed.
-- ============================================================

-- consignment_deliveries
CREATE INDEX IF NOT EXISTS idx_consignment_deliveries_partner_id
  ON public.consignment_deliveries(partner_id);

-- consignment_items (two FK columns flagged)
CREATE INDEX IF NOT EXISTS idx_consignment_items_delivery_id
  ON public.consignment_items(delivery_id);

CREATE INDEX IF NOT EXISTS idx_consignment_items_sku
  ON public.consignment_items(sku);

-- gift_set_items
CREATE INDEX IF NOT EXISTS idx_gift_set_items_gift_set_id
  ON public.gift_set_items(gift_set_id);

CREATE INDEX IF NOT EXISTS idx_gift_set_items_sku
  ON public.gift_set_items(sku);

-- recipe_items (two FK columns flagged)
CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe_id
  ON public.recipe_items(recipe_id);

CREATE INDEX IF NOT EXISTS idx_recipe_items_raw_ingredient_id
  ON public.recipe_items(raw_ingredient_id);

-- warehouse_stocks (two FK columns flagged)
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'warehouse_stocks') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_warehouse_stocks_warehouse_id
              ON public.warehouse_stocks(warehouse_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_warehouse_stocks_sku
              ON public.warehouse_stocks(sku)';
  END IF;
END $$;

-- ============================================================
-- Done!
-- RLS: enabled on all tables with service_role policy
-- Function: search_path locked
-- Indexes: all unindexed FKs now indexed
-- ============================================================
SELECT 'Migration complete — RLS enabled, function fixed, FK indexes added' AS status;
