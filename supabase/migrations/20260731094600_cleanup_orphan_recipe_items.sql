-- Clean up orphan recipe items and link Macchiato Honeycomb Crunch Tablea ingredient
-- Generated on 2026-07-31T09:46:00

BEGIN;

-- Link Tablea (id=59) for MHC-HF-SW-CK and MHC-FL-SW-CK recipe items
UPDATE public.recipe_items SET raw_ingredient_id = 59, ingredient_type = 'raw' WHERE id IN (72, 764);

-- Remove legacy unlinked 0g/duplicate recipe item rows
DELETE FROM public.recipe_items WHERE id IN (18, 83, 517, 775);

COMMIT;
