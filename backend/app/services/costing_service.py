from sqlalchemy.orm import Session, joinedload
from typing import Dict, List, Optional, Tuple
import logging
import math
from .. import models

logger = logging.getLogger("hh_backend")

# In-memory cache for profit margin analysis
_analysis_cache = None
_analysis_cache_time = 0.0
CACHE_TTL = 300.0  # 5 minutes TTL, invalidated on data updates

# Recipe quantities and purchase-pack sizes are entered by people and have
# accumulated several harmless spelling variants over time.  Each factor is
# expressed in the dimension's canonical costing unit (g, ml, or pc).
_UNIT_DEFINITIONS: Dict[str, Tuple[str, float]] = {
    "mg": ("mass", 0.001),
    "milligram": ("mass", 0.001),
    "milligrams": ("mass", 0.001),
    "g": ("mass", 1.0),
    "gm": ("mass", 1.0),
    "gms": ("mass", 1.0),
    "gram": ("mass", 1.0),
    "grams": ("mass", 1.0),
    "kg": ("mass", 1000.0),
    "kgs": ("mass", 1000.0),
    "kilo": ("mass", 1000.0),
    "kilos": ("mass", 1000.0),
    "kilogram": ("mass", 1000.0),
    "kilograms": ("mass", 1000.0),
    "ml": ("volume", 1.0),
    "milliliter": ("volume", 1.0),
    "milliliters": ("volume", 1.0),
    "millilitre": ("volume", 1.0),
    "millilitres": ("volume", 1.0),
    "l": ("volume", 1000.0),
    "liter": ("volume", 1000.0),
    "liters": ("volume", 1000.0),
    "litre": ("volume", 1000.0),
    "litres": ("volume", 1000.0),
    "pc": ("count", 1.0),
    "pcs": ("count", 1.0),
    "piece": ("count", 1.0),
    "pieces": ("count", 1.0),
    "unit": ("count", 1.0),
    "units": ("count", 1.0),
    "ea": ("count", 1.0),
    "each": ("count", 1.0),
}

class CostingService:
    @staticmethod
    def _normalize_unit_name(unit: Optional[str]) -> str:
        return " ".join((unit or "").strip().lower().replace(".", "").split())

    @staticmethod
    def _unit_definition(unit: Optional[str]) -> Optional[Tuple[str, float]]:
        return _UNIT_DEFINITIONS.get(CostingService._normalize_unit_name(unit))

    @staticmethod
    def convert_quantity(
        quantity: float,
        source_unit: Optional[str],
        target_unit: Optional[str],
    ) -> Optional[float]:
        """Convert compatible recipe units, returning None for unknown/mixed dimensions."""
        source_name = CostingService._normalize_unit_name(source_unit)
        target_name = CostingService._normalize_unit_name(target_unit)
        if source_name == target_name and source_name:
            return float(quantity)

        source = CostingService._unit_definition(source_unit)
        target = CostingService._unit_definition(target_unit)
        if not source or not target or source[0] != target[0]:
            return None
        return float(quantity) * source[1] / target[1]

    @staticmethod
    def calculate_recipe_servings(recipe: models.Recipe) -> int:
        """Return whole portions after normalizing yield and portion units."""
        portion_size = recipe.portion_size or 1.0
        yield_weight = recipe.yield_weight or portion_size
        normalized_yield = CostingService.convert_quantity(
            yield_weight,
            recipe.yield_unit,
            recipe.portion_unit,
        )
        if normalized_yield is None:
            # Preserve legacy behavior for custom units that cannot be safely
            # converted instead of guessing across incompatible dimensions.
            normalized_yield = yield_weight

        servings = int(normalized_yield / portion_size)
        return max(servings, 1)

    @staticmethod
    def _normalize_ingredient_name(name: Optional[str]) -> str:
        return " ".join((name or "").strip().lower().split())

    @staticmethod
    def reconcile_legacy_sweet_tablea_recipe(db: Session) -> bool:
        """
        Point the one known bad imported Sweet Tablea BOM line at its actual
        mass-priced ingredient. The full fingerprint prevents owner-edited or
        legitimate per-gram Tablea rows from being rewritten.

        The caller owns the transaction. Returns whether a row was changed.
        """
        recipe = db.query(models.Recipe).filter(
            models.Recipe.sku == "ST-IND-SWT"
        ).first()
        if not recipe:
            return False

        raw_ingredients = db.query(models.RawIngredient).order_by(
            models.RawIngredient.id
        ).all()
        legacy = next((raw for raw in raw_ingredients if (
            CostingService._normalize_ingredient_name(raw.name) == "tablea"
            and CostingService._unit_definition(raw.unit) == ("mass", 1.0)
            and math.isclose(raw.net_weight or 0.0, 1.0, rel_tol=1e-9)
            and math.isclose(raw.price or 0.0, 13.0, rel_tol=1e-9)
            and math.isclose(
                raw.cost_per_gram_unit or 0.0,
                13.0,
                rel_tol=1e-9,
            )
        )), None)
        canonical = next((raw for raw in raw_ingredients if (
            CostingService._normalize_ingredient_name(raw.name) == "tablea chopped"
            and (CostingService._unit_definition(raw.unit) or (None, None))[0] == "mass"
            and (raw.net_weight or 0.0) > 0.0
            and (raw.price or 0.0) > 0.0
        )), None)
        if not legacy or not canonical:
            return False

        recipe_item = next((item for item in recipe.ingredients if (
            item.ingredient_type == "raw"
            and item.raw_ingredient_id == legacy.id
            and CostingService._unit_definition(item.base_unit) == ("mass", 1.0)
            and math.isclose(item.base_qty or 0.0, 1000.0, rel_tol=1e-9)
        )), None)
        if not recipe_item:
            return False

        recipe_item.raw_ingredient_id = canonical.id
        CostingService.clear_costing_cache()
        return True

    @staticmethod
    def calculate_raw_recipe_item_cost(
        item: models.RecipeItem,
        raw_ing: models.RawIngredient,
        raw_ings_map: Dict[int, models.RawIngredient],
    ) -> float:
        """Calculate a raw BOM line from fresh pack price/net-content data."""
        price = raw_ing.price or 0.0
        net_weight = raw_ing.net_weight or 0.0
        if price > 0.0 and net_weight > 0.0:
            quantity_in_pack_unit = CostingService.convert_quantity(
                item.base_qty,
                item.base_unit,
                raw_ing.unit,
            )
            if quantity_in_pack_unit is None:
                # Retain the established calculation for custom units.  This
                # is safer than treating mass, volume, and count as equivalent.
                quantity_in_pack_unit = item.base_qty
            return quantity_in_pack_unit * (price / net_weight)

        return item.base_qty * (raw_ing.cost_per_gram_unit or 0.0)

    @staticmethod
    def calculate_sub_recipe_item_cost(
        item: models.RecipeItem,
        sub_portion_cost: float,
        sub_recipe: Optional[models.Recipe],
    ) -> float:
        """Scale a sub-recipe portion cost using compatible BOM units."""
        sub_portion_size = (
            sub_recipe.portion_size
            if sub_recipe and sub_recipe.portion_size
            else 1.0
        )
        quantity_in_portion_unit = CostingService.convert_quantity(
            item.base_qty,
            item.base_unit,
            sub_recipe.portion_unit if sub_recipe else item.base_unit,
        )
        if quantity_in_portion_unit is None:
            quantity_in_portion_unit = item.base_qty
        return quantity_in_portion_unit * (sub_portion_cost / sub_portion_size)

    @staticmethod
    def calculate_recipe_batch_raw_cost(
        recipe: models.Recipe,
        products_map: Dict[str, models.ProductSKU],
        recipes_map: Dict[str, models.Recipe],
        raw_ings_map: Dict[int, models.RawIngredient],
        raw_computed_costs: Dict[str, float],
        visited: Optional[set] = None,
    ) -> float:
        """Calculate one recipe batch using the shared normalized costing rules."""
        batch_cost = 0.0
        for item in recipe.ingredients:
            if item.ingredient_type == "raw":
                raw_ing = raw_ings_map.get(item.raw_ingredient_id)
                if raw_ing:
                    batch_cost += CostingService.calculate_raw_recipe_item_cost(
                        item,
                        raw_ing,
                        raw_ings_map,
                    )
            elif item.ingredient_type == "sku" and item.sub_sku:
                sub_raw_cost = CostingService.calculate_sku_raw_food_cost_memoized(
                    item.sub_sku,
                    products_map,
                    recipes_map,
                    raw_ings_map,
                    raw_computed_costs,
                    visited=(visited or set()).copy(),
                )
                batch_cost += CostingService.calculate_sub_recipe_item_cost(
                    item,
                    sub_raw_cost,
                    recipes_map.get(item.sub_sku),
                )
        return batch_cost

    @staticmethod
    def calculate_default_spread_packaging(raw_ingredients: List[models.RawIngredient]) -> float:
        jar = next((raw for raw in raw_ingredients if "jar" in raw.name.lower()), None)
        label = next((raw for raw in raw_ingredients if "label" in raw.name.lower()), None)
        jar_price = (
            jar.price / jar.net_weight
            if jar and (jar.price or 0.0) > 0.0 and (jar.net_weight or 0.0) > 0.0
            else 0.0
        )
        label_price = (
            label.price / label.net_weight
            if label and (label.price or 0.0) > 0.0 and (label.net_weight or 0.0) > 0.0
            else 0.0
        )
        return jar_price + label_price

    @staticmethod
    def calculate_product_packaging_cost(
        product: models.ProductSKU,
        default_spread_packaging: float,
    ) -> float:
        category = product.category.lower()
        if "spread" in category or "sauce" in category:
            return default_spread_packaging
        if "pastry" in category or "pastries" in category:
            return 14.58
        if "cold brew" in category or "drink" in category:
            return 15.00
        return 0.0

    @staticmethod
    def clear_costing_cache():
        global _analysis_cache, _analysis_cache_time
        _analysis_cache = None
        _analysis_cache_time = 0.0

    @staticmethod
    def get_analysis_cache():
        global _analysis_cache, _analysis_cache_time
        import time
        if _analysis_cache is not None and (time.time() - _analysis_cache_time) < CACHE_TTL:
            return _analysis_cache
        return None

    @staticmethod
    def set_analysis_cache(data):
        global _analysis_cache, _analysis_cache_time
        import time
        _analysis_cache = data
        _analysis_cache_time = time.time()

    @staticmethod
    def calculate_sku_raw_food_cost_memoized(
        sku: str,
        products_map: Dict[str, models.ProductSKU],
        recipes_map: Dict[str, models.Recipe],
        raw_ings_map: Dict[int, models.RawIngredient],
        raw_computed_costs: Dict[str, float],
        visited: set = None
    ) -> float:
        """
        Recursively calculates raw food ingredients cost only, completely bypassing packaging cost.
        """
        if visited is None:
            visited = set()
        
        if sku in visited:
            return 0.0
        visited.add(sku)

        if sku in raw_computed_costs:
            return raw_computed_costs[sku]

        product = products_map.get(sku)
        if not product:
            raw_computed_costs[sku] = 0.0
            return 0.0

        if product.cost_override is not None and product.cost_override > 0.0:
            raw_computed_costs[sku] = product.cost_override
            return product.cost_override

        recipe = recipes_map.get(sku)
        if not recipe:
            raw_computed_costs[sku] = 0.0
            return 0.0

        batch_cost = CostingService.calculate_recipe_batch_raw_cost(
            recipe,
            products_map,
            recipes_map,
            raw_ings_map,
            raw_computed_costs,
            visited=visited,
        )

        servings = CostingService.calculate_recipe_servings(recipe)
        portion_cost = batch_cost / servings
        raw_computed_costs[sku] = portion_cost
        return portion_cost

    @staticmethod
    def calculate_sku_food_cost_memoized(
        sku: str,
        products_map: Dict[str, models.ProductSKU],
        recipes_map: Dict[str, models.Recipe],
        raw_ings_map: Dict[int, models.RawIngredient],
        default_spread_packaging: float,
        raw_computed_costs: Dict[str, float],
        computed_costs: Dict[str, float],
        persist: bool = False,
        visited: set = None
    ) -> float:
        """
        Combines recursive raw food cost with SKU-level packaging cost.
        """
        if sku in computed_costs:
            return computed_costs[sku]

        product = products_map.get(sku)
        if not product:
            computed_costs[sku] = 0.0
            return 0.0

        if product.cost_override is not None and product.cost_override > 0.0:
            if persist:
                product.cost_per_unit = product.cost_override
            computed_costs[sku] = product.cost_override
            return product.cost_override

        raw_cost = CostingService.calculate_sku_raw_food_cost_memoized(
            sku,
            products_map,
            recipes_map,
            raw_ings_map,
            raw_computed_costs,
            visited=visited
        )

        packaging_cost = CostingService.calculate_product_packaging_cost(
            product,
            default_spread_packaging,
        )

        total_food_cost = raw_cost + packaging_cost
        
        if persist:
            product.cost_per_unit = total_food_cost
            
        computed_costs[sku] = total_food_cost
        return total_food_cost

    @staticmethod
    def detect_circular_references(recipes_map: Dict[str, models.Recipe]) -> List[List[str]]:
        """
        Detects any circular dependency loops in recipes.
        Returns a list of loops (paths of SKUs forming the cycle).
        """
        cycles = []
        
        def dfs(sku: str, path: List[str], visited: set):
            if sku in path:
                cycle_start_idx = path.index(sku)
                cycles.append(path[cycle_start_idx:] + [sku])
                return
            
            if sku in visited:
                return
                
            recipe = recipes_map.get(sku)
            if not recipe:
                return
                
            path.append(sku)
            for item in recipe.ingredients:
                if item.ingredient_type == "sku" and item.sub_sku:
                    dfs(item.sub_sku, path, visited)
            path.pop()
            visited.add(sku)

        visited_nodes = set()
        for sku in recipes_map.keys():
            dfs(sku, [], visited_nodes)
            
        return cycles

    @staticmethod
    def collect_sku_data_issues(db: Session) -> Dict[str, List[str]]:
        """Report source-data gaps that make a computed SKU cost unreliable."""

        products = db.query(models.ProductSKU).all()
        products_map = {product.sku: product for product in products}
        raw_ingredients = db.query(models.RawIngredient).all()
        raw_ings_map = {ingredient.id: ingredient for ingredient in raw_ingredients}
        recipes = db.query(models.Recipe).options(
            joinedload(models.Recipe.ingredients)
        ).all()
        recipes_map = {recipe.sku: recipe for recipe in recipes}
        issue_cache: Dict[str, List[str]] = {}

        def collect(sku: str, path: tuple[str, ...]) -> List[str]:
            if sku in issue_cache:
                return issue_cache[sku]
            if sku in path:
                return [f"Circular recipe reference: {' -> '.join((*path, sku))}"]

            product = products_map.get(sku)
            if not product:
                return [f"Sub-product {sku} does not exist"]
            if product.cost_override is not None and product.cost_override > 0.0:
                issue_cache[sku] = []
                return []

            recipe = recipes_map.get(sku)
            if not recipe:
                issue_cache[sku] = ["Recipe is missing"]
                return issue_cache[sku]

            issues: List[str] = []
            if (recipe.yield_weight or 0.0) <= 0.0:
                issues.append("Recipe yield must be greater than zero")
            if (recipe.portion_size or 0.0) <= 0.0:
                issues.append("Recipe portion size must be greater than zero")
            if not recipe.ingredients:
                issues.append("Recipe has no ingredients")

            for item in recipe.ingredients:
                if (item.base_qty or 0.0) <= 0.0:
                    issues.append(f"Recipe item {item.id or 'new'} has a zero quantity")
                    continue
                if not (item.base_unit or "").strip():
                    issues.append(f"Recipe item {item.id or 'new'} has no unit")
                    continue

                if item.ingredient_type == "raw":
                    raw_ingredient = raw_ings_map.get(item.raw_ingredient_id)
                    if not raw_ingredient:
                        issues.append(f"Recipe item {item.id or 'new'} has no ingredient link")
                        continue
                    has_pack_cost = (
                        (raw_ingredient.price or 0.0) > 0.0
                        and (raw_ingredient.net_weight or 0.0) > 0.0
                    )
                    has_legacy_unit_cost = (raw_ingredient.cost_per_gram_unit or 0.0) > 0.0
                    if not has_pack_cost and not has_legacy_unit_cost:
                        issues.append(f"{raw_ingredient.name} has no usable purchase cost")
                    if (
                        CostingService.convert_quantity(
                            item.base_qty,
                            item.base_unit,
                            raw_ingredient.unit,
                        )
                        is None
                        and CostingService._normalize_unit_name(item.base_unit)
                        != CostingService._normalize_unit_name(raw_ingredient.unit)
                    ):
                        issues.append(
                            f"{raw_ingredient.name} uses incompatible units "
                            f"({item.base_unit} vs {raw_ingredient.unit})"
                        )
                elif item.ingredient_type == "sku":
                    if not item.sub_sku:
                        issues.append(f"Recipe item {item.id or 'new'} has no sub-product link")
                        continue
                    issues.extend(collect(item.sub_sku, (*path, sku)))
                else:
                    issues.append(
                        f"Recipe item {item.id or 'new'} has invalid type {item.ingredient_type}"
                    )

            category = (product.category or "").lower()
            if "spread" in category or "sauce" in category:
                for label, token in (("Jar", "jar"), ("Label", "label")):
                    packaging = next(
                        (
                            ingredient
                            for ingredient in raw_ingredients
                            if token in (ingredient.name or "").lower()
                        ),
                        None,
                    )
                    if not packaging:
                        issues.append(f"{label} packaging source is missing")
                    elif (
                        (packaging.price or 0.0) <= 0.0
                        or (packaging.net_weight or 0.0) <= 0.0
                    ):
                        issues.append(f"{packaging.name} has no usable purchase cost")

            issue_cache[sku] = list(dict.fromkeys(issues))
            return issue_cache[sku]

        for sku in products_map:
            collect(sku, ())
        return issue_cache

    @staticmethod
    def compute_all_sku_costs_in_memory(db: Session, persist: bool = False) -> Dict[str, float]:
        """
        Pre-fetches all related tables and computes food costs for all SKUs.
        Performs exactly 3 select queries and 0 commits (unless persist is True).
        """
        # 1. Fetch products & raw ingredients
        products = db.query(models.ProductSKU).all()
        products_map = {p.sku: p for p in products}
        
        raw_ings = db.query(models.RawIngredient).all()
        raw_ings_map = {r.id: r for r in raw_ings}
        
        # 2. Fetch recipes with their ingredients in a single joined load query
        recipes = db.query(models.Recipe).options(joinedload(models.Recipe.ingredients)).all()
        recipes_map = {r.sku: r for r in recipes}

        # Validate circular references
        cycles = CostingService.detect_circular_references(recipes_map)
        if cycles:
            for cycle in cycles:
                logger.error(f"CIRCULAR RECIPE DETECTED: {' -> '.join(cycle)}")

        # Precalculate packaging costs to avoid looking them up repeatedly
        default_spread_packaging = CostingService.calculate_default_spread_packaging(raw_ings)

        raw_computed_costs = {}
        computed_costs = {}
        
        # Calculate costs for all SKUs
        for sku in products_map.keys():
            CostingService.calculate_sku_food_cost_memoized(
                sku,
                products_map,
                recipes_map,
                raw_ings_map,
                default_spread_packaging,
                raw_computed_costs,
                computed_costs,
                persist=persist
            )

        # Commit only if database updates are explicitly requested
        if persist:
            db.commit()
            
        return computed_costs

    @staticmethod
    def calculate_sku_food_cost(db: Session, sku: str, visited: set = None) -> float:
        """
        Backward-compatible wrapper for external calls and unit test scripts.
        Runs the batch in-memory calculation (and commits it for safety).
        """
        costs = CostingService.compute_all_sku_costs_in_memory(db, persist=True)
        return costs.get(sku, 0.0)
