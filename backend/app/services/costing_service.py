from sqlalchemy.orm import Session, joinedload
from typing import List, Dict
import logging
from .. import models

logger = logging.getLogger("hh_backend")

# In-memory cache for profit margin analysis
_analysis_cache = None
_analysis_cache_time = 0.0
CACHE_TTL = 300.0  # 5 minutes TTL, invalidated on data updates

class CostingService:
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

        batch_cost = 0.0
        for item in recipe.ingredients:
            if item.ingredient_type == "raw":
                raw_ing = raw_ings_map.get(item.raw_ingredient_id)
                if raw_ing:
                    batch_cost += item.base_qty * (raw_ing.cost_per_gram_unit or 0.0)
            elif item.ingredient_type == "sku":
                sub_raw_cost = CostingService.calculate_sku_raw_food_cost_memoized(
                    item.sub_sku,
                    products_map,
                    recipes_map,
                    raw_ings_map,
                    raw_computed_costs,
                    visited=visited.copy()
                )
                sub_recipe = recipes_map.get(item.sub_sku)
                sub_portion_size = sub_recipe.portion_size if sub_recipe and sub_recipe.portion_size else 1.0
                batch_cost += item.base_qty * (sub_raw_cost / sub_portion_size)

        portion_size = recipe.portion_size or 1.0
        yield_weight = recipe.yield_weight or portion_size
        
        servings = int(yield_weight / portion_size)
        if servings <= 0:
            servings = 1

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

        packaging_cost = 0.0
        category = product.category.lower()
        
        if "spread" in category or "sauce" in category:
            packaging_cost = default_spread_packaging
        elif "pastry" in category or "pastries" in category:
            packaging_cost = 14.58  # Default crinkle box allocation
        elif "cold brew" in category or "drink" in category:
            packaging_cost = 15.00  # Bottle cost allocation

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
        jar = next((r for r in raw_ings if "jar" in r.name.lower()), None)
        label = next((r for r in raw_ings if "label" in r.name.lower()), None)
        jar_price = (jar.price / jar.net_weight) if jar and jar.net_weight else 20.0
        label_price = (label.price / label.net_weight) if label and label.net_weight else 4.17
        default_spread_packaging = jar_price + label_price

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
