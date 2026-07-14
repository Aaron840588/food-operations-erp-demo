from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import List, Dict, Set
import math
from ..database import get_db
from .. import models, schemas, auth

router = APIRouter(prefix="/production", tags=["Production Planner"])

def explode_sku_requirements(
    db: Session,
    sku: str,
    target_qty: float,
    raw_reqs: Dict[int, float],
    sub_recipe_runs: List[Dict],
    recipes_map: Dict[str, models.Recipe] = None,
    products_map: Dict[str, models.ProductSKU] = None,
    raw_ings_map: Dict[int, models.RawIngredient] = None,
    parent_product_name: str = None,
    raw_to_parents: Dict[int, Set[str]] = None
) -> None:
    """
    Recursively explodes a SKU's recipe requirements.
    Aggregates raw ingredient weights in raw_reqs (raw_ingredient_id -> total_grams_pcs).
    Appends intermediate recipe batch requirements to sub_recipe_runs.
    """
    # 1. Fetch recipe
    recipe = recipes_map.get(sku) if recipes_map else db.query(models.Recipe).filter(models.Recipe.sku == sku).first()
    if not recipe:
        return

    # Portion size
    portion_size = recipe.portion_size or 1.0
    yield_weight = recipe.yield_weight or portion_size
    
    # Base servings in a single recipe batch
    base_servings = int(yield_weight / portion_size)
    if base_servings <= 0:
        base_servings = 1

    # Number of batches needed to produce target_qty portions
    batches_needed = target_qty / base_servings
    
    # Log the recipe run
    product = products_map.get(sku) if products_map else db.query(models.ProductSKU).filter(models.ProductSKU.sku == sku).first()
    prod_name = product.product_name if product else sku
    
    scaled_ingredients = []

    # 2. Iterate ingredients in recipe
    for item in recipe.ingredients:
        scaled_qty = item.base_qty * batches_needed
        
        if item.ingredient_type == "raw":
            raw_id = item.raw_ingredient_id
            if raw_id:
                raw_reqs[raw_id] = raw_reqs.get(raw_id, 0.0) + scaled_qty
                
                # Track parent product
                if raw_to_parents is not None and parent_product_name:
                    if raw_id not in raw_to_parents:
                        raw_to_parents[raw_id] = set()
                    raw_to_parents[raw_id].add(parent_product_name)
                
                # Fetch raw name for logging
                raw_ing = raw_ings_map.get(raw_id) if raw_ings_map else db.query(models.RawIngredient).filter(models.RawIngredient.id == raw_id).first()
                raw_name = raw_ing.name if raw_ing else "Unknown"
                
                scaled_ingredients.append(schemas.RecipeItemOut(
                    id=item.id,
                    ingredient_type=item.ingredient_type,
                    raw_ingredient_id=raw_id,
                    base_qty=item.base_qty,
                    base_unit=item.base_unit,
                    raw_ingredient_name=raw_name,
                    calculated_cost=round(scaled_qty * ((raw_ing.cost_per_gram_unit or 0.0) if raw_ing else 0.0), 2)
                ))
                
        elif item.ingredient_type == "sku":
            # Nested sub-recipe (e.g. spread used in a sandwich)
            sub_sku = item.sub_sku
            
            # Fetch sub-recipe portion size to convert grams/ml to portion units
            sub_recipe = recipes_map.get(sub_sku) if recipes_map else db.query(models.Recipe).filter(models.Recipe.sku == sub_sku).first()
            sub_portion_size = sub_recipe.portion_size if sub_recipe and sub_recipe.portion_size else 1.0
            sub_target_qty = scaled_qty / sub_portion_size
            
            # Add sub-recipe raw ingredient needs recursively
            explode_sku_requirements(
                db, sub_sku, sub_target_qty, raw_reqs, sub_recipe_runs,
                recipes_map, products_map, raw_ings_map,
                parent_product_name=parent_product_name,
                raw_to_parents=raw_to_parents
            )
            
            sub_prod = products_map.get(sub_sku) if products_map else db.query(models.ProductSKU).filter(models.ProductSKU.sku == sub_sku).first()
            sub_name = sub_prod.product_name if sub_prod else sub_sku
            
            scaled_ingredients.append(schemas.RecipeItemOut(
                id=item.id,
                ingredient_type=item.ingredient_type,
                sub_sku=sub_sku,
                base_qty=item.base_qty,
                base_unit=item.base_unit,
                sub_product_name=sub_name,
                calculated_cost=0.0
            ))

    prod_name_with_size = f"{prod_name} ({product.size})" if product and product.size else prod_name
    sub_recipe_runs.append({
        "recipe_name": f"{prod_name_with_size} Recipe (Batch)",
        "target_sku": sku,
        "batches_needed": round(batches_needed, 4),
        "scaled_yield": round(yield_weight * batches_needed, 2),
        "yield_unit": recipe.yield_unit,
        "scaled_ingredients": scaled_ingredients
    })

RECOMMENDED_CATEGORIES = [
    "Liquids and water",
    "Dairy",
    "Oils and fats",
    "Sweeteners",
    "Powders and dry ingredients",
    "Fruits and vegetables",
    "Seasonings and flavorings",
    "Toppings and inclusions",
    "Packaging materials",
    "Other / uncategorized"
]

def classify_ingredient_by_name(name: str) -> str:
    name_lower = name.lower()
    if any(x in name_lower for x in ["jar", "box", "bag", "wrap", "sticker", "paper", "packaging", "tissue", "glove", "hairnet", "mask", "soap", "bottle", "sponge", "cleaner", "detergent", "bleach", "sanitation", "toothpick"]):
        return "Packaging materials"
    if any(x in name_lower for x in ["milk", "cheese", "parmesan", "mozzarella", "cream", "butter", "yogurt", "whipping", "evap"]):
        return "Dairy"
    if any(x in name_lower for x in ["oil", "fat", "butter", "mayo", "margarine"]):
        return "Oils and fats"
    if any(x in name_lower for x in ["water", "cold brew", "liquid", "vinegar"]):
        return "Liquids and water"
    if any(x in name_lower for x in ["sugar", "glucose", "syrup", "honey", "sweetener", "jam"]):
        return "Sweeteners"
    if any(x in name_lower for x in ["powder", "flour", "apf", "cocoa", "matcha", "coffee grounds", "xanthan", "baking", "jelly", "pasta", "fusili", "spaghettini", "macaroni", "noodles", "malagkit"]):
        return "Powders and dry ingredients"
    if any(x in name_lower for x in ["garlic", "onion", "chili", "tomato", "lettuce", "carrot", "mushroom", "cherry", "cherries", "basil", "parsley"]):
        return "Fruits and vegetables"
    if any(x in name_lower for x in ["salt", "pepper", "sauce", "extract", "flavor", "paprika", "vinegar", "bay leaf"]):
        return "Seasonings and flavorings"
    if any(x in name_lower for x in ["pili", "peanut", "macadamia", "nut", "chocolate", "biscoff", "graham", "oreo", "cookie", "broas", "marshmallow", "pepperoni", "ham", "chicken", "beef", "bacon", "salmon", "cake", "yema", "pastillas", "seed"]):
        return "Toppings and inclusions"
    return "Other / uncategorized"

@router.post("/forecast", response_model=schemas.ProductionForecastOut)
def run_production_forecast(payload: schemas.ProductionForecastIn, db: Session = Depends(get_db)):
    """
    Computes scaled recipes and aggregates raw materials needed for target production.
    Returns:
    1. A list of scaled recipe batches with scaled yields and ingredients.
    2. A buying checklist showing stock, deficit, and number of packs/units to purchase.
    """
    # Pre-fetch all configurations in memory
    recipes = db.query(models.Recipe).options(joinedload(models.Recipe.ingredients)).all()
    products = db.query(models.ProductSKU).all()
    raw_ingredients = db.query(models.RawIngredient).all()

    recipes_map = {r.sku: r for r in recipes}
    products_map = {p.sku: p for p in products}
    raw_ings_map = {r.id: r for r in raw_ingredients}

    raw_requirements = {} # raw_ingredient_id -> total_needed_grams_pcs
    raw_to_parents = {}
    scaled_recipes = []

    # Explode all target items
    for item in payload.items:
        product = products_map.get(item.sku)
        prod_name = f"{product.product_name} ({product.size})" if product and product.size else (product.product_name if product else item.sku)
        # Explode recipe recursively using precompute maps
        explode_sku_requirements(
            db, item.sku, item.quantity, raw_requirements, scaled_recipes,
            recipes_map, products_map, raw_ings_map,
            parent_product_name=prod_name,
            raw_to_parents=raw_to_parents
        )

    # Compile the material buying checklist
    material_checklist = []
    total_shopping_cost = 0.0

    for raw_id, amount_needed in raw_requirements.items():
        raw_ing = raw_ings_map.get(raw_id)
        if not raw_ing:
            continue

        available = raw_ing.available_stock or 0.0
        deficit = amount_needed - available
        
        packs_to_buy = 0
        estimated_cost = 0.0

        if deficit > 0:
            # We need to buy more
            pack_size = raw_ing.net_weight or 1.0
            if pack_size <= 0:
                pack_size = 1.0
            
            # Round up to whole packs
            packs_to_buy = math.ceil(deficit / pack_size)
            estimated_cost = packs_to_buy * raw_ing.price
            total_shopping_cost += estimated_cost

        # Determine category based on existing metadata or fallback to classifier
        matched_category = None
        if raw_ing.category:
            for rc in RECOMMENDED_CATEGORIES:
                if raw_ing.category.strip().lower() == rc.lower():
                    matched_category = rc
                    break

        assigned_category = matched_category if matched_category else classify_ingredient_by_name(raw_ing.name)

        material_checklist.append(schemas.IngredientRequirement(
            ingredient_name=raw_ing.name,
            category=assigned_category,
            total_needed=round(amount_needed, 2),
            unit=raw_ing.unit,
            available_stock=round(available, 2),
            deficit=round(max(0.0, deficit), 2),
            amount_per_pack=raw_ing.net_weight,
            packs_to_buy=packs_to_buy,
            estimated_cost=round(estimated_cost, 2),
            parent_products=sorted(list(raw_to_parents.get(raw_id, set())))
        ))

    # Reverse scaled recipes list to show sub-recipes first (cooking dependency order)
    scaled_recipes.reverse()

    return schemas.ProductionForecastOut(
        scaled_recipes=scaled_recipes,
        material_checklist=material_checklist,
        total_estimated_raw_material_cost=round(total_shopping_cost, 2)
    )

@router.post("/plans", response_model=schemas.ProductionPlanOut)
def create_production_plan(payload: schemas.ProductionPlanCreate, db: Session = Depends(get_db)):
    """
    Creates a new production plan schedule for a specific date.
    """
    import os
    DEMO_MODE = (os.getenv("DEMO_MODE") == "true") or (os.getenv("ENVIRONMENT") == "demo")
    if DEMO_MODE:
        if db.query(models.ProductionPlan).count() >= 100:
            raise HTTPException(
                status_code=400,
                detail="Sandbox table limit reached. In Public Demo Sandbox, the number of production plans is capped at 100. Please reset the database."
            )
        for target in payload.targets:
            if target.target_qty > 100:
                raise HTTPException(
                    status_code=400,
                    detail="Quantity limit exceeded. In Public Demo Sandbox, production target quantity is capped at 100 per SKU."
                )

    # Check if plan already exists for this date
    existing = db.query(models.ProductionPlan).filter(models.ProductionPlan.plan_date == payload.plan_date).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Production plan for date {payload.plan_date} already exists")

    db_plan = models.ProductionPlan(
        plan_date=payload.plan_date,
        status="draft"
    )
    db.add(db_plan)
    db.commit()
    db.refresh(db_plan)

    for target in payload.targets:
        db_target = models.ProductionTarget(
            plan_id=db_plan.id,
            sku=target.sku,
            outlet=target.outlet,
            target_qty=target.target_qty
        )
        db.add(db_target)
    
    db.commit()
    db.refresh(db_plan)
    
    # Reload with products info
    return get_production_plan(db_plan.id, db)
@router.get("/plans", response_model=List[schemas.ProductionPlanOut])
def get_all_production_plans(db: Session = Depends(get_db)):
    """
    Returns list of all production plans. Optimized to pre-fetch products mapping to avoid N+1 queries.
    """
    plans = db.query(models.ProductionPlan).options(joinedload(models.ProductionPlan.targets)).all()
    products_map = {p.sku: p for p in db.query(models.ProductSKU).all()}
    
    output = []
    for plan in plans:
        targets_out = []
        for t in plan.targets:
            p = products_map.get(t.sku)
            targets_out.append(schemas.ProductionTargetOut(
                id=t.id,
                sku=t.sku,
                outlet=t.outlet,
                target_qty=t.target_qty,
                product_name=p.product_name if p else t.sku,
                size=p.size if p else ''
            ))
        output.append(schemas.ProductionPlanOut(
            id=plan.id,
            plan_date=plan.plan_date,
            status=plan.status,
            targets=targets_out,
            created_at=plan.created_at
        ))
    return output



@router.get("/plans/{plan_id}", response_model=schemas.ProductionPlanOut)
def get_production_plan(plan_id: int, db: Session = Depends(get_db)):
    """
    Returns specific production plan details.
    """
    plan = db.query(models.ProductionPlan).filter(models.ProductionPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
        
    targets_out = []
    for t in plan.targets:
        p = db.query(models.ProductSKU).filter(models.ProductSKU.sku == t.sku).first()
        targets_out.append(schemas.ProductionTargetOut(
            id=t.id,
            sku=t.sku,
            outlet=t.outlet,
            target_qty=t.target_qty,
            product_name=p.product_name if p else t.sku,
            size=p.size if p else ''
        ))
        
    return schemas.ProductionPlanOut(
        id=plan.id,
        plan_date=plan.plan_date,
        status=plan.status,
        targets=targets_out,
        created_at=plan.created_at
    )

@router.post("/plans/{plan_id}/complete")
def complete_production_run(plan_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    """
    Completes a production plan.
    Deducts all consumed raw ingredients from inventory, and increments
    product finished SKU stocks in the warehouse.
    """
    plan = db.query(models.ProductionPlan).filter(models.ProductionPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    if plan.status == "completed":
        raise HTTPException(status_code=400, detail="Plan is already marked completed")

    # 1. Compile required ingredients
    raw_requirements = {}
    scaled_recipes = []
    
    # Aggregate targets by SKU
    sku_targets = {}
    for target in plan.targets:
        sku_targets[target.sku] = sku_targets.get(target.sku, 0) + target.target_qty

    # Pre-fetch all maps in memory
    recipes = db.query(models.Recipe).options(joinedload(models.Recipe.ingredients)).all()
    products = db.query(models.ProductSKU).all()
    raw_ingredients = db.query(models.RawIngredient).all()

    recipes_map = {r.sku: r for r in recipes}
    products_map = {p.sku: p for p in products}
    raw_ings_map = {r.id: r for r in raw_ingredients}

    # Explode ingredients using precompute maps
    for sku, qty in sku_targets.items():
        explode_sku_requirements(
            db, sku, qty, raw_requirements, scaled_recipes,
            recipes_map, products_map, raw_ings_map
        )

    # 2. Verify stock availability (STRICT over-consumption block)
    insufficient_items = []
    for raw_id, amount_needed in raw_requirements.items():
        raw_ing = raw_ings_map.get(raw_id)
        if not raw_ing:
            continue
        available = raw_ing.available_stock or 0.0
        if available < amount_needed:
            deficit = amount_needed - available
            insufficient_items.append(f"{raw_ing.name} (Need: {round(amount_needed, 2)} {raw_ing.unit}, Have: {round(available, 2)} {raw_ing.unit}, Short: {round(deficit, 2)} {raw_ing.unit})")
            
    if insufficient_items:
        raise HTTPException(
            status_code=400, 
            detail=f"Production plan cannot be completed due to insufficient raw materials. Please purchase stock for: {'; '.join(insufficient_items)}"
        )

    # 3. Deduct consumed raw ingredients using FIFO batch tracking
    from ..services.fifo_service import FifoService
    FifoService.deduct_raw_ingredients_fifo(raw_requirements, current_user.id, plan.id, plan.plan_date, db)

    # 4. Add produced SKU stock in warehouse
    for sku, qty in sku_targets.items():
        product = products_map.get(sku)
        if product:
            product.warehouse_stock = (product.warehouse_stock or 0) + qty
            
            # Log finished product addition transaction
            tx = models.InventoryTransaction(
                sku=product.sku,
                transaction_type="production_add",
                qty=float(qty),
                user_id=current_user.id,
                batch_reference=f"PLAN-{plan.id}",
                notes=f"Added to warehouse stock from production run for plan #{plan.id} dated {plan.plan_date}."
            )
            db.add(tx)
            
            # Record production log record
            batch = models.ProductionBatch(
                batch_date=plan.plan_date,
                sku=sku,
                qty_produced=qty,
                qty_delivered=0, # Log deliveries separately
                notes=f"Produced from automated plan #{plan.id}"
            )
            db.add(batch)

    # Update plan status
    plan.status = "completed"
    db.commit()
    
    # Synchronize warehouse stocks for Main Facility (ID: 1)
    try:
        from ..database import sync_warehouse_stock_for_main_facility
        # Sync consumed raw ingredients
        for raw_id in raw_requirements.keys():
            sync_warehouse_stock_for_main_facility(db, raw_ingredient_id=raw_id)
        # Sync produced finished SKUs
        for sku in sku_targets.keys():
            sync_warehouse_stock_for_main_facility(db, sku=sku)
        db.commit()
    except Exception as e:
        print(f"Error syncing warehouse stock in production completion: {e}")

    # Trigger low stock alert check for all consumed ingredients
    try:
        from ..notifications import check_and_trigger_low_stock_alerts
        check_and_trigger_low_stock_alerts(list(raw_requirements.keys()), db)
    except Exception as e:
        print(f"Failed to trigger production low stock push alert: {e}")

    return {"message": f"Production plan #{plan_id} completed. Raw materials deducted, warehouse stock updated."}
