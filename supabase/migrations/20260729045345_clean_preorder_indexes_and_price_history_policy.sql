-- SQLAlchemy's legacy startup schema created indexes that duplicate the
-- reviewed preorder migration indexes. Keep the stable migration-owned names.
DROP INDEX IF EXISTS public.ix_preorder_forms_created_by_user_id;
DROP INDEX IF EXISTS public.ix_preorder_forms_event_id;
DROP INDEX IF EXISTS public.ix_preorder_forms_updated_by_user_id;
DROP INDEX IF EXISTS public.ix_preorder_status_history_actor_user_id;
DROP INDEX IF EXISTS public.ix_preorders_updated_by_user_id;

-- The FastAPI service role remains the sole access path for ingredient price
-- history. An explicit policy documents that boundary and keeps Supabase's RLS
-- advisor from treating the intentional service-only table as unconfigured.
ALTER TABLE public.ingredient_price_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ingredient_price_history FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.ingredient_price_history_id_seq FROM anon, authenticated;
GRANT ALL ON TABLE public.ingredient_price_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ingredient_price_history_id_seq TO service_role;

DROP POLICY IF EXISTS service_role_full_access
  ON public.ingredient_price_history;
CREATE POLICY service_role_full_access
  ON public.ingredient_price_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
