from __future__ import annotations

import math
from collections import defaultdict
from typing import Dict, Iterable, List, Optional, Sequence, Set

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from .. import auth, models, schemas
from ..database import get_db, sync_warehouse_stock_for_main_facility
from ..services.costing_service import CostingService
from ..services.fifo_service import FifoService


router = APIRouter(prefix="/production", tags=["Production Planner"])


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
    "Other / uncategorized",
]


def classify_ingredient_by_name(name: str) -> str:
    name_lower = name.lower()
    if any(
        value in name_lower
        for value in [
            "jar",
            "box",
            "bag",
            "wrap",
            "sticker",
            "paper",
            "packaging",
            "tissue",
            "glove",
            "hairnet",
            "mask",
            "soap",
            "bottle",
            "sponge",
            "cleaner",
            "detergent",
            "bleach",
            "sanitation",
            "toothpick",
        ]
    ):
        return "Packaging materials"
    if any(
        value in name_lower
        for value in [
            "milk",
            "cheese",
            "parmesan",
            "mozzarella",
            "cream",
            "butter",
            "yogurt",
            "whipping",
            "evap",
        ]
    ):
        return "Dairy"
    if any(value in name_lower for value in ["oil", "fat", "butter", "mayo", "margarine"]):
        return "Oils and fats"
    if any(value in name_lower for value in ["water", "cold brew", "liquid", "vinegar"]):
        return "Liquids and water"
    if any(value in name_lower for value in ["sugar", "glucose", "syrup", "honey", "sweetener", "jam"]):
        return "Sweeteners"
    if any(
        value in name_lower
        for value in [
            "powder",
            "flour",
            "apf",
            "cocoa",
            "matcha",
            "coffee grounds",
            "xanthan",
            "baking",
            "jelly",
            "pasta",
            "fusili",
            "spaghettini",
            "macaroni",
            "noodles",
            "malagkit",
        ]
    ):
        return "Powders and dry ingredients"
    if any(
        value in name_lower
        for value in [
            "garlic",
            "onion",
            "chili",
            "tomato",
            "lettuce",
            "carrot",
            "mushroom",
            "cherry",
            "cherries",
            "basil",
            "parsley",
        ]
    ):
        return "Fruits and vegetables"
    if any(
        value in name_lower
        for value in [
            "salt",
            "pepper",
            "sauce",
            "extract",
            "flavor",
            "paprika",
            "vinegar",
            "bay leaf",
        ]
    ):
        return "Seasonings and flavorings"
    if any(
        value in name_lower
        for value in [
            "pili",
            "peanut",
            "macadamia",
            "nut",
            "chocolate",
            "biscoff",
            "graham",
            "oreo",
            "cookie",
            "broas",
            "marshmallow",
            "pepperoni",
            "ham",
            "chicken",
            "beef",
            "bacon",
            "salmon",
            "cake",
            "yema",
            "pastillas",
            "seed",
        ]
    ):
        return "Toppings and inclusions"
    return "Other / uncategorized"


def _load_configuration(db: Session):
    recipes = db.query(models.Recipe).options(joinedload(models.Recipe.ingredients)).all()
    products = db.query(models.ProductSKU).all()
    raw_ingredients = db.query(models.RawIngredient).all()
    return (
        {recipe.sku: recipe for recipe in recipes},
        {product.sku: product for product in products},
        {ingredient.id: ingredient for ingredient in raw_ingredients},
    )


def _normalize_targets(
    targets: Iterable,
    quantity_attribute: str,
) -> List[Dict[str, object]]:
    aggregated: Dict[tuple[str, str], int] = defaultdict(int)
    for target in targets:
        sku = str(getattr(target, "sku", "") or "").strip()
        outlet = str(getattr(target, "outlet", "") or "").strip()
        quantity = getattr(target, quantity_attribute, None)

        if not sku:
            raise HTTPException(status_code=422, detail="Every production target must include a SKU.")
        if not outlet:
            raise HTTPException(
                status_code=422,
                detail=f"Production target {sku} must include an outlet.",
            )
        if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity <= 0:
            raise HTTPException(
                status_code=422,
                detail=f"Production target {sku} must be a positive whole number.",
            )
        aggregated[(sku, outlet)] += quantity

    if not aggregated:
        raise HTTPException(
            status_code=422,
            detail="Add at least one product with a positive target quantity.",
        )

    return [
        {"sku": sku, "outlet": outlet, "quantity": quantity}
        for (sku, outlet), quantity in sorted(aggregated.items())
    ]


def _target_signature(targets: Sequence[Dict[str, object]]) -> tuple:
    return tuple(
        sorted(
            (
                str(target["sku"]),
                str(target["outlet"]),
                int(target["quantity"]),
            )
            for target in targets
        )
    )


def _is_gift_or_bundle(product: models.ProductSKU) -> bool:
    identity = " ".join(
        [
            product.sku or "",
            product.product_name or "",
            product.category or "",
        ]
    ).lower()
    return (
        product.sku.upper().startswith("GS-")
        or "gift set" in identity
        or "gift package" in identity
    )


def _validate_recipe_graph_for_sku(
    target_sku: str,
    recipes_map: Dict[str, models.Recipe],
    products_map: Dict[str, models.ProductSKU],
    raw_ings_map: Dict[int, models.RawIngredient],
    *,
    require_active_target: bool = True,
) -> None:
    target_product = products_map.get(target_sku)
    if not target_product:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown production target: {target_sku}.",
        )
    if require_active_target and target_product.is_active is False:
        raise HTTPException(
            status_code=422,
            detail=f"{target_product.product_name} ({target_sku}) is inactive and cannot be planned.",
        )

    visiting: List[str] = []
    validated: Set[str] = set()

    def visit(sku: str) -> None:
        if sku in visiting:
            cycle_start = visiting.index(sku)
            cycle = visiting[cycle_start:] + [sku]
            raise HTTPException(
                status_code=422,
                detail=f"Recipe cycle detected: {' -> '.join(cycle)}.",
            )
        if sku in validated:
            return

        product = products_map.get(sku)
        if not product:
            raise HTTPException(
                status_code=422,
                detail=f"Recipe references unknown product SKU {sku}.",
            )

        recipe = recipes_map.get(sku)
        if not recipe:
            raise HTTPException(
                status_code=422,
                detail=f"{product.product_name} ({sku}) has no recipe and cannot be produced.",
            )
        if not recipe.ingredients:
            raise HTTPException(
                status_code=422,
                detail=f"{product.product_name} ({sku}) has an empty recipe and cannot be produced.",
            )
        if (recipe.yield_weight or 0) <= 0 or (recipe.portion_size or 0) <= 0:
            raise HTTPException(
                status_code=422,
                detail=f"{product.product_name} ({sku}) has an invalid yield or portion size.",
            )
        if (
            CostingService.convert_quantity(
                recipe.yield_weight,
                recipe.yield_unit,
                recipe.portion_unit,
            )
            is None
        ):
            raise HTTPException(
                status_code=422,
                detail=(
                    f"{product.product_name} ({sku}) has incompatible yield "
                    f"units ({recipe.yield_unit} to {recipe.portion_unit})."
                ),
            )

        visiting.append(sku)
        for item in recipe.ingredients:
            if (item.base_qty or 0) <= 0:
                raise HTTPException(
                    status_code=422,
                    detail=f"Recipe {sku} contains a zero or negative ingredient quantity.",
                )

            if item.ingredient_type == "raw":
                raw_ingredient = raw_ings_map.get(item.raw_ingredient_id)
                if not item.raw_ingredient_id or not raw_ingredient:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Recipe {sku} contains a missing raw ingredient reference.",
                    )
                if (
                    CostingService.convert_quantity(
                        item.base_qty,
                        item.base_unit,
                        raw_ingredient.unit,
                    )
                    is None
                ):
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            f"Recipe {sku} uses {raw_ingredient.name} in incompatible "
                            f"units ({item.base_unit} to {raw_ingredient.unit})."
                        ),
                    )
            elif item.ingredient_type == "sku":
                if not item.sub_sku:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Recipe {sku} contains a missing sub-recipe SKU.",
                    )
                visit(item.sub_sku)
            else:
                raise HTTPException(
                    status_code=422,
                    detail=f"Recipe {sku} contains unsupported ingredient type {item.ingredient_type!r}.",
                )

        visiting.pop()
        validated.add(sku)

    visit(target_sku)


def _validate_targets(
    normalized_targets: Sequence[Dict[str, object]],
    recipes_map: Dict[str, models.Recipe],
    products_map: Dict[str, models.ProductSKU],
    raw_ings_map: Dict[int, models.RawIngredient],
) -> None:
    for sku in sorted({str(target["sku"]) for target in normalized_targets}):
        _validate_recipe_graph_for_sku(
            sku,
            recipes_map,
            products_map,
            raw_ings_map,
        )


def _aggregate_sku_targets(
    normalized_targets: Sequence[Dict[str, object]],
) -> Dict[str, int]:
    totals: Dict[str, int] = defaultdict(int)
    for target in normalized_targets:
        totals[str(target["sku"])] += int(target["quantity"])
    return dict(totals)


def explode_sku_requirements(
    db: Session,
    sku: str,
    target_qty: float,
    raw_reqs: Dict[int, float],
    sub_recipe_runs: List[Dict],
    recipes_map: Optional[Dict[str, models.Recipe]] = None,
    products_map: Optional[Dict[str, models.ProductSKU]] = None,
    raw_ings_map: Optional[Dict[int, models.RawIngredient]] = None,
    parent_product_name: Optional[str] = None,
    raw_to_parents: Optional[Dict[int, Set[str]]] = None,
    recursion_stack: Optional[List[str]] = None,
) -> None:
    """Explode a validated SKU recipe into raw requirements in dependency order."""
    recipes_map = recipes_map or {
        recipe.sku: recipe
        for recipe in db.query(models.Recipe).options(joinedload(models.Recipe.ingredients)).all()
    }
    products_map = products_map or {
        product.sku: product for product in db.query(models.ProductSKU).all()
    }
    raw_ings_map = raw_ings_map or {
        ingredient.id: ingredient for ingredient in db.query(models.RawIngredient).all()
    }

    stack = list(recursion_stack or [])
    if sku in stack:
        cycle = stack[stack.index(sku):] + [sku]
        raise HTTPException(
            status_code=422,
            detail=f"Recipe cycle detected: {' -> '.join(cycle)}.",
        )
    stack.append(sku)

    recipe = recipes_map.get(sku)
    product = products_map.get(sku)
    if not product or not recipe or not recipe.ingredients:
        raise HTTPException(
            status_code=422,
            detail=f"Production target {sku} is missing a valid recipe.",
        )

    base_servings = CostingService.calculate_recipe_servings(recipe)
    batches_needed = target_qty / base_servings
    yield_weight = recipe.yield_weight or recipe.portion_size or 1.0
    product_name = product.product_name
    scaled_ingredients: List[schemas.RecipeItemOut] = []

    for item in recipe.ingredients:
        scaled_qty = float(item.base_qty) * batches_needed
        if item.ingredient_type == "raw":
            raw_ingredient = raw_ings_map.get(item.raw_ingredient_id)
            if not raw_ingredient:
                raise HTTPException(
                    status_code=422,
                    detail=f"Recipe {sku} references a missing raw ingredient.",
                )
            requirement_qty = CostingService.convert_quantity(
                scaled_qty,
                item.base_unit,
                raw_ingredient.unit,
            )
            if requirement_qty is None:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Recipe {sku} uses {raw_ingredient.name} in incompatible "
                        f"units ({item.base_unit} to {raw_ingredient.unit})."
                    ),
                )

            raw_reqs[raw_ingredient.id] = (
                raw_reqs.get(raw_ingredient.id, 0.0) + requirement_qty
            )
            if raw_to_parents is not None and parent_product_name:
                raw_to_parents.setdefault(raw_ingredient.id, set()).add(
                    parent_product_name
                )

            calculated_cost = (
                CostingService.calculate_raw_recipe_item_cost(
                    item,
                    raw_ingredient,
                    raw_ings_map,
                )
                * batches_needed
            )
            scaled_ingredients.append(
                schemas.RecipeItemOut(
                    id=item.id,
                    ingredient_type="raw",
                    raw_ingredient_id=raw_ingredient.id,
                    base_qty=round(scaled_qty, 4),
                    base_unit=item.base_unit,
                    raw_ingredient_name=raw_ingredient.name,
                    calculated_cost=round(calculated_cost, 2),
                )
            )
        elif item.ingredient_type == "sku":
            sub_recipe = recipes_map.get(item.sub_sku)
            sub_product = products_map.get(item.sub_sku)
            if not item.sub_sku or not sub_recipe or not sub_product:
                raise HTTPException(
                    status_code=422,
                    detail=f"Recipe {sku} references missing sub-recipe {item.sub_sku or '(blank)'}.",
                )

            quantity_in_portion_unit = CostingService.convert_quantity(
                scaled_qty,
                item.base_unit,
                sub_recipe.portion_unit,
            )
            if quantity_in_portion_unit is None:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Recipe {sku} uses sub-recipe {item.sub_sku} in incompatible "
                        f"units ({item.base_unit} to {sub_recipe.portion_unit})."
                    ),
                )
            sub_target_qty = quantity_in_portion_unit / float(
                sub_recipe.portion_size
            )

            explode_sku_requirements(
                db,
                item.sub_sku,
                sub_target_qty,
                raw_reqs,
                sub_recipe_runs,
                recipes_map,
                products_map,
                raw_ings_map,
                parent_product_name=parent_product_name,
                raw_to_parents=raw_to_parents,
                recursion_stack=stack,
            )
            scaled_ingredients.append(
                schemas.RecipeItemOut(
                    id=item.id,
                    ingredient_type="sku",
                    sub_sku=item.sub_sku,
                    base_qty=round(scaled_qty, 4),
                    base_unit=item.base_unit,
                    sub_product_name=sub_product.product_name,
                    calculated_cost=0.0,
                )
            )

    product_name_with_size = (
        f"{product_name} ({product.size})" if product.size else product_name
    )
    # Children are appended recursively before this parent. Do not reverse this
    # list later: this is already the kitchen dependency order.
    sub_recipe_runs.append(
        {
            "recipe_name": f"{product_name_with_size} Recipe (Batch)",
            "target_sku": sku,
            "batches_needed": round(batches_needed, 4),
            "scaled_yield": round(float(yield_weight) * batches_needed, 2),
            "yield_unit": recipe.yield_unit,
            "scaled_ingredients": scaled_ingredients,
        }
    )


def _build_forecast(
    normalized_targets: Sequence[Dict[str, object]],
    db: Session,
    recipes_map: Dict[str, models.Recipe],
    products_map: Dict[str, models.ProductSKU],
    raw_ings_map: Dict[int, models.RawIngredient],
) -> schemas.ProductionForecastOut:
    raw_requirements: Dict[int, float] = {}
    raw_to_parents: Dict[int, Set[str]] = {}
    scaled_recipes: List[Dict] = []

    for sku, quantity in _aggregate_sku_targets(normalized_targets).items():
        product = products_map[sku]
        product_name = (
            f"{product.product_name} ({product.size})"
            if product.size
            else product.product_name
        )
        explode_sku_requirements(
            db,
            sku,
            quantity,
            raw_requirements,
            scaled_recipes,
            recipes_map,
            products_map,
            raw_ings_map,
            parent_product_name=product_name,
            raw_to_parents=raw_to_parents,
        )

    material_checklist: List[schemas.IngredientRequirement] = []
    total_shopping_cost = 0.0
    for raw_id, amount_needed in raw_requirements.items():
        raw_ingredient = raw_ings_map[raw_id]
        available = float(raw_ingredient.available_stock or 0.0)
        deficit = max(0.0, amount_needed - available)
        pack_size = float(raw_ingredient.net_weight or 0.0)
        packs_to_buy = math.ceil(deficit / pack_size) if deficit > 0 and pack_size > 0 else 0
        estimated_cost = packs_to_buy * float(raw_ingredient.price or 0.0)
        total_shopping_cost += estimated_cost

        matched_category = next(
            (
                category
                for category in RECOMMENDED_CATEGORIES
                if raw_ingredient.category
                and raw_ingredient.category.strip().lower() == category.lower()
            ),
            None,
        )
        material_checklist.append(
            schemas.IngredientRequirement(
                ingredient_name=raw_ingredient.name,
                category=matched_category
                or classify_ingredient_by_name(raw_ingredient.name),
                total_needed=round(amount_needed, 2),
                unit=raw_ingredient.unit,
                available_stock=round(available, 2),
                deficit=round(deficit, 2),
                amount_per_pack=pack_size,
                packs_to_buy=packs_to_buy,
                estimated_cost=round(estimated_cost, 2),
                parent_products=sorted(raw_to_parents.get(raw_id, set())),
            )
        )

    material_checklist.sort(
        key=lambda item: (
            0 if item.deficit > 0 else 1,
            RECOMMENDED_CATEGORIES.index(item.category)
            if item.category in RECOMMENDED_CATEGORIES
            else len(RECOMMENDED_CATEGORIES),
            item.ingredient_name.lower(),
        )
    )
    return schemas.ProductionForecastOut(
        scaled_recipes=scaled_recipes,
        material_checklist=material_checklist,
        total_estimated_raw_material_cost=round(total_shopping_cost, 2),
    )


def _plan_out(plan: models.ProductionPlan, db: Session) -> schemas.ProductionPlanOut:
    targets = (
        db.query(models.ProductionTarget)
        .filter(models.ProductionTarget.plan_id == plan.id)
        .order_by(models.ProductionTarget.id.asc())
        .all()
    )
    product_skus = {target.sku for target in targets}
    products = (
        db.query(models.ProductSKU)
        .filter(models.ProductSKU.sku.in_(product_skus))
        .all()
        if product_skus
        else []
    )
    products_map = {product.sku: product for product in products}
    return schemas.ProductionPlanOut(
        id=plan.id,
        plan_date=plan.plan_date,
        status=plan.status,
        targets=[
            schemas.ProductionTargetOut(
                id=target.id,
                sku=target.sku,
                outlet=target.outlet,
                target_qty=target.target_qty,
                product_name=products_map[target.sku].product_name
                if target.sku in products_map
                else target.sku,
                size=products_map[target.sku].size
                if target.sku in products_map
                else "",
            )
            for target in targets
        ],
        created_at=plan.created_at,
    )


def _replace_plan_targets(
    plan: models.ProductionPlan,
    normalized_targets: Sequence[Dict[str, object]],
    db: Session,
) -> None:
    existing_targets = (
        db.query(models.ProductionTarget)
        .filter(models.ProductionTarget.plan_id == plan.id)
        .all()
    )
    for existing_target in existing_targets:
        db.delete(existing_target)
    db.flush()
    for target in normalized_targets:
        db.add(
            models.ProductionTarget(
                plan_id=plan.id,
                sku=str(target["sku"]),
                outlet=str(target["outlet"]),
                target_qty=int(target["quantity"]),
            )
        )
    db.flush()


def _lock_completion_rows(
    sku_targets: Dict[str, int],
    raw_requirements: Dict[int, float],
    db: Session,
) -> tuple[Dict[str, models.ProductSKU], Dict[int, models.RawIngredient]]:
    target_skus = sorted(sku_targets)
    raw_ids = sorted(raw_requirements)

    locked_products = (
        db.query(models.ProductSKU)
        .filter(models.ProductSKU.sku.in_(target_skus))
        .populate_existing()
        .with_for_update()
        .all()
    )
    locked_raw_ingredients = (
        db.query(models.RawIngredient)
        .filter(models.RawIngredient.id.in_(raw_ids))
        .populate_existing()
        .with_for_update()
        .all()
    )
    if raw_ids:
        (
            db.query(models.IngredientBatch)
            .filter(models.IngredientBatch.raw_ingredient_id.in_(raw_ids))
            .with_for_update()
            .all()
        )

    target_warehouse = (
        db.query(models.Warehouse)
        .filter(
            or_(
                models.Warehouse.id == 1,
                models.Warehouse.name == "Main Facility",
            )
        )
        .order_by(models.Warehouse.id.asc())
        .populate_existing()
        .with_for_update()
        .first()
    )
    if target_warehouse:
        mirror_filter = [
            models.WarehouseStock.warehouse_id == target_warehouse.id,
        ]
        stock_identity_filters = []
        if target_skus:
            stock_identity_filters.append(models.WarehouseStock.sku.in_(target_skus))
        if raw_ids:
            stock_identity_filters.append(
                models.WarehouseStock.raw_ingredient_id.in_(raw_ids)
            )
        if stock_identity_filters:
            (
                db.query(models.WarehouseStock)
                .filter(*mirror_filter)
                .filter(or_(*stock_identity_filters))
                .with_for_update()
                .all()
            )

    return (
        {product.sku: product for product in locked_products},
        {ingredient.id: ingredient for ingredient in locked_raw_ingredients},
    )


def _complete_locked_plan(
    plan: models.ProductionPlan,
    normalized_targets: Sequence[Dict[str, object]],
    db: Session,
    current_user: models.User,
) -> None:
    recipes_map, products_map, raw_ings_map = _load_configuration(db)
    _validate_targets(
        normalized_targets,
        recipes_map,
        products_map,
        raw_ings_map,
    )

    raw_requirements: Dict[int, float] = {}
    scaled_recipes: List[Dict] = []
    sku_targets = _aggregate_sku_targets(normalized_targets)
    for sku, quantity in sku_targets.items():
        explode_sku_requirements(
            db,
            sku,
            quantity,
            raw_requirements,
            scaled_recipes,
            recipes_map,
            products_map,
            raw_ings_map,
        )

    locked_products, locked_raw_ingredients = _lock_completion_rows(
        sku_targets,
        raw_requirements,
        db,
    )
    if set(locked_products) != set(sku_targets):
        raise HTTPException(
            status_code=409,
            detail="One or more production targets changed while the plan was being completed.",
        )
    inactive_targets = [
        product.product_name
        for product in locked_products.values()
        if product.is_active is False
    ]
    if inactive_targets:
        raise HTTPException(
            status_code=409,
            detail=(
                "Production cannot be completed because these targets became "
                f"inactive: {', '.join(sorted(inactive_targets))}."
            ),
        )
    if set(locked_raw_ingredients) != set(raw_requirements):
        raise HTTPException(
            status_code=409,
            detail="One or more recipe ingredients changed while the plan was being completed.",
        )

    insufficient_items = []
    for raw_id, amount_needed in raw_requirements.items():
        raw_ingredient = locked_raw_ingredients[raw_id]
        available = float(raw_ingredient.available_stock or 0.0)
        if available + 1e-9 < amount_needed:
            insufficient_items.append(
                (
                    f"{raw_ingredient.name} (need {amount_needed:.2f} "
                    f"{raw_ingredient.unit}, have {available:.2f} "
                    f"{raw_ingredient.unit}, short "
                    f"{amount_needed - available:.2f} {raw_ingredient.unit})"
                )
            )
    if insufficient_items:
        raise HTTPException(
            status_code=409,
            detail=(
                "Production cannot be completed because stock is short: "
                + "; ".join(insufficient_items)
            ),
        )

    FifoService.deduct_raw_ingredients_fifo(
        raw_requirements,
        current_user.id,
        plan.id,
        plan.plan_date,
        db,
    )

    for sku, quantity in sku_targets.items():
        product = locked_products[sku]
        product.warehouse_stock = int(product.warehouse_stock or 0) + quantity
        db.add(
            models.InventoryTransaction(
                sku=sku,
                transaction_type="production_add",
                qty=float(quantity),
                user_id=current_user.id,
                batch_reference=f"PLAN-{plan.id}",
                notes=(
                    f"Added to warehouse stock from production run for plan "
                    f"#{plan.id} dated {plan.plan_date}."
                ),
            )
        )
        db.add(
            models.ProductionBatch(
                batch_date=plan.plan_date,
                sku=sku,
                qty_produced=quantity,
                qty_delivered=0,
                notes=f"Produced from automated plan #{plan.id}",
            )
        )

    plan.status = "completed"
    db.flush()

    # Mirror synchronization is part of the same transaction. Any failure is
    # allowed to propagate so the caller rolls back raw deductions, finished
    # stock additions, logs, plan status, and mirror rows together.
    for raw_id in raw_requirements:
        sync_warehouse_stock_for_main_facility(
            db,
            raw_ingredient_id=raw_id,
        )
    for sku in sku_targets:
        sync_warehouse_stock_for_main_facility(db, sku=sku)
    db.flush()


@router.get("/catalog")
def get_production_catalog(db: Session = Depends(get_db)):
    """Return only active, structurally producible, non-gift-set SKUs."""
    recipes_map, products_map, raw_ings_map = _load_configuration(db)
    main_warehouse = (
        db.query(models.Warehouse)
        .filter(
            or_(
                models.Warehouse.id == 1,
                models.Warehouse.name == "Main Facility",
            )
        )
        .order_by(models.Warehouse.id.asc())
        .first()
    )
    mirror_stock = {}
    if main_warehouse:
        mirror_stock = {
            stock.sku: float(stock.quantity or 0.0)
            for stock in db.query(models.WarehouseStock)
            .filter(
                models.WarehouseStock.warehouse_id == main_warehouse.id,
                models.WarehouseStock.sku.isnot(None),
            )
            .all()
        }

    catalog = []
    for product in sorted(
        products_map.values(),
        key=lambda item: (
            (item.category or "").lower(),
            (item.product_name or "").lower(),
            item.sku,
        ),
    ):
        if product.is_active is False or _is_gift_or_bundle(product):
            continue
        recipe = recipes_map.get(product.sku)
        isValid = False
        try:
            _validate_recipe_graph_for_sku(
                product.sku,
                recipes_map,
                products_map,
                raw_ings_map,
            )
            isValid = True
        except HTTPException:
            if (product.category or "") not in ("Spreads & Sauces", "Sandwiches & Salads"):
                continue

        yield_w = recipe.yield_weight if (recipe and isValid) else 1.0
        yield_u = recipe.yield_unit if (recipe and isValid) else "portion"
        port_s = recipe.portion_size if (recipe and isValid) else 1.0
        port_u = recipe.portion_unit if (recipe and isValid) else "portion"
        units_per_b = CostingService.calculate_recipe_servings(recipe) if (recipe and isValid) else 1

        catalog.append(
            {
                "sku": product.sku,
                "product_name": product.product_name,
                "category": product.category,
                "size": product.size,
                "warehouse_stock": mirror_stock.get(
                    product.sku,
                    float(product.warehouse_stock or 0),
                ),
                "is_active": bool(product.is_active),
                "yield_weight": yield_w,
                "yield_unit": yield_u,
                "portion_size": port_s,
                "portion_unit": port_u,
                "units_per_batch": units_per_b,
            }
        )
    return catalog


@router.post("/forecast", response_model=schemas.ProductionForecastOut)
def run_production_forecast(
    payload: schemas.ProductionForecastIn,
    db: Session = Depends(get_db),
):
    normalized_targets = _normalize_targets(payload.items, "quantity")
    recipes_map, products_map, raw_ings_map = _load_configuration(db)
    _validate_targets(
        normalized_targets,
        recipes_map,
        products_map,
        raw_ings_map,
    )
    return _build_forecast(
        normalized_targets,
        db,
        recipes_map,
        products_map,
        raw_ings_map,
    )


@router.post("/plans", response_model=schemas.ProductionPlanOut)
def create_production_plan(
    payload: schemas.ProductionPlanCreate,
    db: Session = Depends(get_db),
):
    """Safely create or update the resumable draft for a production date."""
    normalized_targets = _normalize_targets(payload.targets, "target_qty")
    recipes_map, products_map, raw_ings_map = _load_configuration(db)
    _validate_targets(
        normalized_targets,
        recipes_map,
        products_map,
        raw_ings_map,
    )
    plan_date = str(payload.plan_date)
    try:
        plan = (
            db.query(models.ProductionPlan)
            .filter(models.ProductionPlan.plan_date == plan_date)
            .with_for_update()
            .first()
        )
        if plan and plan.status == "completed":
            raise HTTPException(
                status_code=409,
                detail=f"Production for {plan_date} is already completed.",
            )
        if not plan:
            plan = models.ProductionPlan(plan_date=plan_date, status="draft")
            db.add(plan)
            db.flush()
        else:
            plan.status = "draft"

        _replace_plan_targets(plan, normalized_targets, db)
        db.commit()
        db.refresh(plan)
        return _plan_out(plan, db)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"A production plan for {plan_date} was saved concurrently. Reload and retry.",
        ) from exc
    except Exception:
        db.rollback()
        raise


@router.post("/plans/complete", response_model=schemas.ProductionPlanOut)
def create_and_complete_production_plan(
    payload: schemas.ProductionPlanCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Atomically save targets and complete production in one request."""
    normalized_targets = _normalize_targets(payload.targets, "target_qty")
    plan_date = str(payload.plan_date)
    try:
        plan = (
            db.query(models.ProductionPlan)
            .filter(models.ProductionPlan.plan_date == plan_date)
            .with_for_update()
            .first()
        )
        if plan and plan.status == "completed":
            existing_targets = _normalize_targets(plan.targets, "target_qty")
            if _target_signature(existing_targets) != _target_signature(
                normalized_targets
            ):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Production for {plan_date} is already completed with "
                        "different targets."
                    ),
                )
            return _plan_out(plan, db)

        if not plan:
            plan = models.ProductionPlan(plan_date=plan_date, status="draft")
            db.add(plan)
            db.flush()
        _replace_plan_targets(plan, normalized_targets, db)
        _complete_locked_plan(
            plan,
            normalized_targets,
            db,
            current_user,
        )
        db.commit()
        db.refresh(plan)
        return _plan_out(plan, db)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        # A concurrent identical retry may have won the unique date race.
        existing = (
            db.query(models.ProductionPlan)
            .filter(models.ProductionPlan.plan_date == plan_date)
            .first()
        )
        if existing and existing.status == "completed":
            existing_targets = _normalize_targets(existing.targets, "target_qty")
            if _target_signature(existing_targets) == _target_signature(
                normalized_targets
            ):
                return _plan_out(existing, db)
        raise HTTPException(
            status_code=409,
            detail=f"Production for {plan_date} changed concurrently. Reload and verify stock.",
        ) from exc
    except Exception:
        db.rollback()
        raise


@router.get("/plans", response_model=List[schemas.ProductionPlanOut])
def get_all_production_plans(db: Session = Depends(get_db)):
    plans = (
        db.query(models.ProductionPlan)
        .order_by(models.ProductionPlan.plan_date.desc(), models.ProductionPlan.id.desc())
        .all()
    )
    return [_plan_out(plan, db) for plan in plans]


@router.get("/plans/{plan_id}", response_model=schemas.ProductionPlanOut)
def get_production_plan(
    plan_id: int,
    db: Session = Depends(get_db),
):
    plan = (
        db.query(models.ProductionPlan)
        .filter(models.ProductionPlan.id == plan_id)
        .first()
    )
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found.")
    return _plan_out(plan, db)


@router.post(
    "/plans/{plan_id}/complete",
    response_model=schemas.ProductionPlanOut,
)
def complete_production_run(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Complete an existing draft once; repeat requests are safe."""
    try:
        plan = (
            db.query(models.ProductionPlan)
            .filter(models.ProductionPlan.id == plan_id)
            .with_for_update()
            .first()
        )
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found.")
        if plan.status == "completed":
            return _plan_out(plan, db)

        normalized_targets = _normalize_targets(plan.targets, "target_qty")
        _complete_locked_plan(
            plan,
            normalized_targets,
            db,
            current_user,
        )
        db.commit()
        db.refresh(plan)
        return _plan_out(plan, db)
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
