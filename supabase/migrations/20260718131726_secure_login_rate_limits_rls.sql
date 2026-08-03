DROP POLICY IF EXISTS service_role_full_access ON public.login_rate_limits;
CREATE POLICY service_role_full_access
  ON public.login_rate_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
