ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS hourly_rate DOUBLE PRECISION NOT NULL DEFAULT 0.0;

ALTER TABLE public.timesheet_entries
  ADD COLUMN IF NOT EXISTS production_plan_id INTEGER
  REFERENCES public.production_plans(id) ON DELETE SET NULL;

ALTER TABLE public.timesheet_entries
  ADD COLUMN IF NOT EXISTS approved_hourly_rate DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS ix_timesheet_entries_production_plan_id
  ON public.timesheet_entries(production_plan_id);

CREATE INDEX IF NOT EXISTS ix_timesheet_entries_labor_summary
  ON public.timesheet_entries(review_status, work_date)
  WHERE review_status = 'Approved';
