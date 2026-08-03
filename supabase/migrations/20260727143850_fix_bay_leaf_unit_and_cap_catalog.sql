-- Align Bay Leaf's raw-material unit with the owner-approved production recipe.
-- The source workbook records Bay Leaf as 8 grams in the Chili Garlic Oil BOM;
-- only the raw-material master was mislabeled as pieces.
DO $$
DECLARE
    bay_leaf_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO bay_leaf_count
    FROM public.raw_ingredients
    WHERE LOWER(BTRIM(name)) = 'bay leaf';

    IF bay_leaf_count <> 1 THEN
        RAISE EXCEPTION
            'Bay Leaf unit repair requires exactly one normalized raw ingredient; found %',
            bay_leaf_count;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.recipes AS recipe
        JOIN public.recipe_items AS item
          ON item.recipe_id = recipe.id
        JOIN public.raw_ingredients AS raw
          ON raw.id = item.raw_ingredient_id
        WHERE recipe.sku = 'CGO-IND-SVR'
          AND LOWER(BTRIM(raw.name)) = 'bay leaf'
          AND item.ingredient_type = 'raw'
          AND item.base_qty = 8
          AND LOWER(BTRIM(item.base_unit)) IN ('g', 'gram', 'grams')
    ) THEN
        RAISE EXCEPTION
            'Bay Leaf unit repair could not verify the authoritative 8 gram CGO recipe line';
    END IF;
END $$;

UPDATE public.raw_ingredients
SET
    unit = 'grams',
    cost_per_gram_unit = price / NULLIF(net_weight, 0),
    last_updated = NOW()
WHERE LOWER(BTRIM(name)) = 'bay leaf';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.raw_ingredients
        WHERE LOWER(BTRIM(name)) = 'bay leaf'
          AND LOWER(BTRIM(unit)) NOT IN ('g', 'gram', 'grams')
    ) THEN
        RAISE EXCEPTION 'Bay Leaf unit repair did not persist a gram-compatible unit';
    END IF;
END $$;
