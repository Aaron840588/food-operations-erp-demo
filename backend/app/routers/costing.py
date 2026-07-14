from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict
import time
from ..database import get_db
from .. import models, schemas, auth
from ..services.costing_service import CostingService

router = APIRouter(prefix="/costing", tags=["Costing Engine"])


def has_valid_unit_cost(cost_per_unit: float | None, selling_price: float | None) -> bool:
    """Return whether a unit cost can support trustworthy profit reporting."""
    return (
        cost_per_unit is not None
        and selling_price is not None
        and cost_per_unit > 0.0
        and selling_price > cost_per_unit
    )

def clear_costing_cache():
    CostingService.clear_costing_cache()

def calculate_sku_food_cost(db: Session, sku: str, visited: set = None) -> float:
    return CostingService.calculate_sku_food_cost(db, sku, visited)

@router.post("/recalculate-all")
def recalculate_all_costs(db: Session = Depends(get_db)):
    """
    Recalculates food costs for all product SKUs recursively and persists them.
    """
    CostingService.clear_costing_cache()
    costs = CostingService.compute_all_sku_costs_in_memory(db, persist=True)
    rounded = {sku: round(cost, 4) for sku, cost in costs.items()}
    return {"message": f"Successfully recalculated costs for {len(costs)} SKUs", "sku_costs": rounded}

@router.get("/sku/{sku}", response_model=schemas.RecipeOut)
def get_sku_cost_details(sku: str, db: Session = Depends(get_db)):
    """
    Returns detailed cost breakdown for a specific SKU.
    """
    product = db.query(models.ProductSKU).filter(models.ProductSKU.sku == sku).first()
    if not product:
        raise HTTPException(status_code=404, detail="SKU not found")
        
    recipe = db.query(models.Recipe).filter(models.Recipe.sku == sku).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found for this SKU")

    # Run read-only calculations to get fresh computed costs
    computed_costs = CostingService.compute_all_sku_costs_in_memory(db, persist=False)
    
    # Reload recipe from DB
    recipe_out = db.query(models.Recipe).filter(models.Recipe.sku == sku).first()
    
    # Map to schema output
    ingredients_out = []
    batch_cost = 0.0
    for item in recipe_out.ingredients:
        calculated_cost = 0.0
        raw_name = None
        sub_name = None
        
        if item.ingredient_type == "raw":
            raw_ing = db.query(models.RawIngredient).filter(models.RawIngredient.id == item.raw_ingredient_id).first()
            if raw_ing:
                raw_name = raw_ing.name
                calculated_cost = item.base_qty * raw_ing.cost_per_gram_unit
                batch_cost += calculated_cost
        elif item.ingredient_type == "sku":
            sub_prod = db.query(models.ProductSKU).filter(models.ProductSKU.sku == item.sub_sku).first()
            if sub_prod:
                sub_name = sub_prod.product_name
                # Calculate sub-recipe portion cost
                sub_cost = computed_costs.get(item.sub_sku, 0.0)
                sub_recipe = db.query(models.Recipe).filter(models.Recipe.sku == item.sub_sku).first()
                sub_portion_size = sub_recipe.portion_size if sub_recipe and sub_recipe.portion_size else 1.0
                calculated_cost = item.base_qty * (sub_cost / sub_portion_size)
                batch_cost += calculated_cost
                
        ingredients_out.append(schemas.RecipeItemOut(
            id=item.id,
            ingredient_type=item.ingredient_type,
            raw_ingredient_id=item.raw_ingredient_id,
            sub_sku=item.sub_sku,
            base_qty=item.base_qty,
            base_unit=item.base_unit,
            raw_ingredient_name=raw_name,
            sub_product_name=sub_name,
            calculated_cost=round(calculated_cost, 4)
        ))
        
    portions = int(recipe_out.yield_weight / (recipe_out.portion_size or 1.0))
    if portions <= 0:
        portions = 1
        
    portion_cost = batch_cost / portions
    
    # Fetch default packaging
    packaging = (computed_costs.get(sku, 0.0) or product.cost_per_unit) - portion_cost
    
    return schemas.RecipeOut(
        id=recipe_out.id,
        sku=recipe_out.sku,
        yield_weight=recipe_out.yield_weight,
        yield_unit=recipe_out.yield_unit,
        portion_size=recipe_out.portion_size,
        portion_unit=recipe_out.portion_unit,
        notes=recipe_out.notes,
        product_name=product.product_name,
        size=product.size,
        cost_override=product.cost_override,
        calculated_batch_cost=round(batch_cost, 2),
        calculated_portion_cost=round(computed_costs.get(sku, 0.0), 2),
        ingredients=ingredients_out
    )

@router.get("/recipes", response_model=List[schemas.RecipeOut])
def get_all_recipes(db: Session = Depends(get_db)):
    """
    Returns all recipes with their nested ingredients.
    """
    from sqlalchemy.orm import joinedload
    return db.query(models.Recipe).options(joinedload(models.Recipe.ingredients)).all()

@router.get("/analysis", response_model=List[Dict])
def get_profit_margin_analysis(db: Session = Depends(get_db)):
    """
    Generates a financial analysis table for all SKUs, including food costs,
    labor costs, utility costs, and net profit margins.
    Optimized to run recursive calculations completely in memory (read-only)
    with a fast in-memory caching layer.
    """
    cached = CostingService.get_analysis_cache()
    if cached is not None:
        return cached

    # Precompute all costs in a single batch in memory without database writes
    computed_costs = CostingService.compute_all_sku_costs_in_memory(db, persist=False)
    
    products = db.query(models.ProductSKU).filter(
        models.ProductSKU.sku != "SKU",
        models.ProductSKU.product_name != "Product Name",
        models.ProductSKU.retail_price > 0.0,
        models.ProductSKU.retail_price != None
    ).all()
    recipe_skus = {
        sku for (sku,) in db.query(models.Recipe.sku).filter(models.Recipe.sku != None).all()
    }
    
    # Fetch database-backed category overhead rates
    overhead_rates = db.query(models.CategoryOverheadRate).all()
    overhead_map = {r.category.lower().strip(): r for r in overhead_rates}

    # Fetch default fallback utility config if no category rate is configured
    utility_config = db.query(models.OverheadConfig).filter(models.OverheadConfig.particular == "default_utility_per_unit").first()
    default_utility_per_unit = utility_config.cost_per_day if utility_config else 3.28
    
    analysis = []
    
    for p in products:
        # Retrieve computed food cost from our memory map
        food_cost = computed_costs.get(p.sku, 0.0)
        has_cost_override = p.cost_override is not None and p.cost_override > 0.0
        if not has_cost_override and p.sku not in recipe_skus:
            cost_status = "missing_recipe"
            cost_status_message = "Recipe missing"
        elif food_cost <= 0.0:
            cost_status = "invalid_cost"
            cost_status_message = "Review costing data"
        elif not has_valid_unit_cost(food_cost, p.retail_price):
            cost_status = "invalid_cost"
            cost_status_message = "Cost exceeds selling price"
        else:
            cost_status = "ok"
            cost_status_message = None
            
        # Retrieve labor and utility cost directly from ProductSKU properties, falling back to database category configurations
        labor_cost = p.labor_cost if p.labor_cost is not None else 0.0
        utility_cost = p.utility_cost if p.utility_cost is not None else 0.0

        if (labor_cost == 0.0 and utility_cost == 0.0) or (labor_cost is None and utility_cost is None):
            # Fallback to CategoryOverheadRate or legacy fallback rules if both are unconfigured
            cat_key = p.category.lower().strip()
            db_rate = overhead_map.get(cat_key)
            if db_rate:
                labor_cost = db_rate.labor_cost_per_unit or 0.0
                utility_cost = db_rate.utility_cost_per_unit or 0.0
            else:
                labor_cost = 0.0
                if "spread" in cat_key or "sauce" in cat_key:
                    labor_cost = 22.50 if "indulge" in p.size.lower() else 11.25
                elif "sandwich" in cat_key:
                    labor_cost = 6.30
                elif "pasta" in cat_key:
                    labor_cost = 10.23
                elif "pastry" in cat_key or "pastries" in cat_key:
                    labor_cost = 5.00
                utility_cost = default_utility_per_unit
            
        selling_price = p.retail_price
        
        # Calculations
        gross_margin_amt = selling_price - food_cost
        gross_margin_pct = (gross_margin_amt / selling_price) if selling_price > 0 else 0.0
        
        total_unit_cost = food_cost + labor_cost + utility_cost
        net_profit_amt = selling_price - total_unit_cost
        net_margin_pct = (net_profit_amt / selling_price) if selling_price > 0 else 0.0
        
        analysis.append({
            "sku": p.sku,
            "product_name": p.product_name,
            "size": p.size,
            "category": p.category,
            "selling_price": selling_price,
            "reseller_price": p.reseller_price,
            "food_cost": round(food_cost, 2),
            "cost_override": p.cost_override,
            "cost_status": cost_status,
            "cost_status_message": cost_status_message,
            "labor_cost": round(labor_cost, 2),
            "utility_cost": round(utility_cost, 2),
            "total_cost": round(total_unit_cost, 2),
            "gross_profit": round(gross_margin_amt, 2),
            "gross_margin_pct": round(gross_margin_pct * 100, 2),
            "net_profit": round(net_profit_amt, 2),
            "net_margin_pct": round(net_margin_pct * 100, 2)
        })
        
    CostingService.set_analysis_cache(analysis)
    return analysis

@router.put("/recipe-items/{item_id}", response_model=schemas.RecipeItemOut)
def update_recipe_item(
    item_id: int,
    payload: schemas.RecipeItemUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """
    Updates the quantity of a specific ingredient in a recipe.
    """
    item = db.query(models.RecipeItem).filter(models.RecipeItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Recipe Item not found")
        
    if payload.base_qty is not None:
        item.base_qty = payload.base_qty
        
    db.commit()
    db.refresh(item)
    
    # Recalculate costs dynamically
    CostingService.clear_costing_cache()
    CostingService.compute_all_sku_costs_in_memory(db, persist=True)
    
    # Reload item details with proper names
    raw_name = None
    sub_name = None
    calculated_cost = 0.0
    
    if item.ingredient_type == "raw":
        raw_ing = db.query(models.RawIngredient).filter(models.RawIngredient.id == item.raw_ingredient_id).first()
        if raw_ing:
            raw_name = raw_ing.name
            calculated_cost = item.base_qty * raw_ing.cost_per_gram_unit
    elif item.ingredient_type == "sku":
        sub_prod = db.query(models.ProductSKU).filter(models.ProductSKU.sku == item.sub_sku).first()
        if sub_prod:
            sub_name = sub_prod.product_name
            computed_costs = CostingService.compute_all_sku_costs_in_memory(db, persist=False)
            sub_cost = computed_costs.get(item.sub_sku, 0.0)
            sub_recipe = db.query(models.Recipe).filter(models.Recipe.sku == item.sub_sku).first()
            sub_portion_size = sub_recipe.portion_size if sub_recipe and sub_recipe.portion_size else 1.0
            calculated_cost = item.base_qty * (sub_cost / sub_portion_size)
            
    return schemas.RecipeItemOut(
        id=item.id,
        ingredient_type=item.ingredient_type,
        raw_ingredient_id=item.raw_ingredient_id,
        sub_sku=item.sub_sku,
        base_qty=item.base_qty,
        base_unit=item.base_unit,
        raw_ingredient_name=raw_name,
        sub_product_name=sub_name,
        calculated_cost=round(calculated_cost, 4)
    )

@router.put("/sku/{sku}", response_model=schemas.RecipeOut)
def update_sku_recipe(
    sku: str,
    payload: schemas.RecipeUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """
    Updates the recipe header and all its ingredients in a single transactional operation.
    """
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Owner access required")
        
    product = db.query(models.ProductSKU).filter(models.ProductSKU.sku == sku).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product SKU not found")

    # Validate yield weight and portion size
    if payload.yield_weight <= 0:
        raise HTTPException(status_code=400, detail="Yield weight must be greater than zero")
    if payload.portion_size is not None and payload.portion_size <= 0:
        raise HTTPException(status_code=400, detail="Portion size must be greater than zero")

    # Validate ingredients input
    seen = set()
    for item in payload.ingredients:
        if item.ingredient_type == "raw":
            if not item.raw_ingredient_id:
                raise HTTPException(status_code=400, detail="Missing raw ingredient ID for raw ingredient item")
            # Verify raw ingredient exists
            raw_exists = db.query(models.RawIngredient).filter(models.RawIngredient.id == item.raw_ingredient_id).first()
            if not raw_exists:
                raise HTTPException(status_code=400, detail=f"Raw ingredient with ID {item.raw_ingredient_id} not found")
            key = f"raw_{item.raw_ingredient_id}"
        elif item.ingredient_type == "sku":
            if not item.sub_sku:
                raise HTTPException(status_code=400, detail="Missing sub SKU for sub-product recipe item")
            if item.sub_sku == sku:
                raise HTTPException(status_code=400, detail="Self-referencing recipe items are not allowed")
            # Verify sub-SKU exists
            sku_exists = db.query(models.ProductSKU).filter(models.ProductSKU.sku == item.sub_sku).first()
            if not sku_exists:
                raise HTTPException(status_code=400, detail=f"Sub-product SKU {item.sub_sku} not found")
            key = f"sku_{item.sub_sku}"
        else:
            raise HTTPException(status_code=400, detail=f"Invalid ingredient type: {item.ingredient_type}")

        if item.base_qty <= 0:
            raise HTTPException(status_code=400, detail="Ingredient quantity must be greater than zero")
        if not item.base_unit or not item.base_unit.strip():
            raise HTTPException(status_code=400, detail="Ingredient unit cannot be empty")
            
        if key in seen:
            item_name = raw_exists.name if item.ingredient_type == "raw" else sku_exists.product_name
            raise HTTPException(status_code=400, detail=f"Duplicate ingredient: {item_name}")
        seen.add(key)

    # Detect Circular Reference
    recipes = db.query(models.Recipe).all()
    recipes_map = {r.sku: r for r in recipes}
    
    proposed_recipe = models.Recipe(
        sku=sku,
        yield_weight=payload.yield_weight,
        yield_unit=payload.yield_unit,
        portion_size=payload.portion_size,
        portion_unit=payload.portion_unit,
        notes=payload.notes
    )
    proposed_recipe.ingredients = [
        models.RecipeItem(
            ingredient_type=ing.ingredient_type,
            raw_ingredient_id=ing.raw_ingredient_id,
            sub_sku=ing.sub_sku,
            base_qty=ing.base_qty,
            base_unit=ing.base_unit
        ) for ing in payload.ingredients
    ]
    recipes_map[sku] = proposed_recipe
    
    cycles = CostingService.detect_circular_references(recipes_map)
    if cycles:
        cycle_str = " -> ".join(cycles[0])
        raise HTTPException(
            status_code=400,
            detail=f"Circular reference detected: {cycle_str}"
        )

    # Start transactional update
    recipe = db.query(models.Recipe).filter(models.Recipe.sku == sku).first()
    if not recipe:
        recipe = models.Recipe(sku=sku, yield_weight=payload.yield_weight)
        db.add(recipe)
        db.flush() # Get recipe.id

    recipe.yield_weight = payload.yield_weight
    recipe.yield_unit = payload.yield_unit
    recipe.portion_size = payload.portion_size
    recipe.portion_unit = payload.portion_unit
    recipe.notes = payload.notes

    # Clear existing items
    db.query(models.RecipeItem).filter(models.RecipeItem.recipe_id == recipe.id).delete()

    # Insert new items
    for ing in payload.ingredients:
        new_item = models.RecipeItem(
            recipe_id=recipe.id,
            ingredient_type=ing.ingredient_type,
            raw_ingredient_id=ing.raw_ingredient_id,
            sub_sku=ing.sub_sku,
            base_qty=ing.base_qty,
            base_unit=ing.base_unit
        )
        db.add(new_item)

    db.commit()

    # Recalculate costing across all SKUs
    CostingService.clear_costing_cache()
    CostingService.compute_all_sku_costs_in_memory(db, persist=True)

    return get_sku_cost_details(sku, db)
