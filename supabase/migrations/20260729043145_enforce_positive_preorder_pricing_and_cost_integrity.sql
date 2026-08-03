-- Public pre-orders must never persist a zero-value financial commitment.
-- Application validation is the first boundary; these constraints protect
-- direct SQL/import paths and future regressions.

ALTER TABLE public.preorders
  DROP CONSTRAINT IF EXISTS check_preorder_total_non_negative;

ALTER TABLE public.preorders
  ADD CONSTRAINT check_preorder_total_positive
  CHECK (total_amount > 0.00);

ALTER TABLE public.preorder_items
  DROP CONSTRAINT IF EXISTS check_preorder_item_unit_price_non_negative,
  DROP CONSTRAINT IF EXISTS check_preorder_item_line_total_non_negative;

ALTER TABLE public.preorder_items
  ADD CONSTRAINT check_preorder_item_unit_price_positive
    CHECK (unit_price_snapshot > 0.00),
  ADD CONSTRAINT check_preorder_item_line_total_positive
    CHECK (line_total_snapshot > 0.00);
