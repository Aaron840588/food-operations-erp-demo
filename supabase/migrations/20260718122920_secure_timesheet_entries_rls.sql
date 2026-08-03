ALTER TABLE public.timesheet_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.timesheet_entries;
CREATE POLICY "service_role_all" ON public.timesheet_entries
FOR ALL TO service_role USING (true) WITH CHECK (true);;
