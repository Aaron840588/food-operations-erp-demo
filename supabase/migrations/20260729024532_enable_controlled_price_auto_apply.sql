-- Allow the owner to opt the two reviewed product price mappings into
-- automatic application. All other mapped fields remain manual-review only.

UPDATE public.sheet_sync_mappings
SET approval_mode = 'manual_review'
WHERE approval_mode NOT IN ('manual_review', 'auto_apply');

UPDATE public.sheet_sync_changes
SET approval_mode = 'manual_review'
WHERE approval_mode NOT IN ('manual_review', 'auto_apply');

ALTER TABLE public.sheet_sync_mappings
    DROP CONSTRAINT IF EXISTS check_sheet_sync_mapping_approval;
ALTER TABLE public.sheet_sync_mappings
    ADD CONSTRAINT check_sheet_sync_mapping_approval
        CHECK (approval_mode IN ('manual_review', 'auto_apply'));

ALTER TABLE public.sheet_sync_changes
    DROP CONSTRAINT IF EXISTS check_sheet_sync_change_approval;
ALTER TABLE public.sheet_sync_changes
    ADD CONSTRAINT check_sheet_sync_change_approval
        CHECK (approval_mode IN ('manual_review', 'auto_apply'));
