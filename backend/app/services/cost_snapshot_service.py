"""Immutable per-unit cost snapshots for financial transaction line items."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from sqlalchemy.orm import Session

from .. import models
from .costing_service import CostingService


@dataclass(frozen=True)
class UnitCostSnapshot:
    food_cost: float
    labor_cost: float
    utility_cost: float
    total_cost: float
    status: str
    status_message: str | None


def _resolved_overheads(
    product: models.ProductSKU,
    overhead_map: dict[str, models.CategoryOverheadRate],
    default_utility_per_unit: float,
) -> tuple[float, float]:
    labor_cost = float(product.labor_cost or 0.0)
    utility_cost = float(product.utility_cost or 0.0)
    if labor_cost != 0.0 or utility_cost != 0.0:
        return labor_cost, utility_cost

    category_key = (product.category or "").lower().strip()
    category_rate = overhead_map.get(category_key)
    if category_rate:
        return (
            float(category_rate.labor_cost_per_unit or 0.0),
            float(category_rate.utility_cost_per_unit or 0.0),
        )

    size = (product.size or "").lower()
    if "spread" in category_key or "sauce" in category_key:
        labor_cost = 22.50 if "indulge" in size else 11.25
    elif "sandwich" in category_key:
        labor_cost = 6.30
    elif "pasta" in category_key:
        labor_cost = 10.23
    elif "pastry" in category_key or "pastries" in category_key:
        labor_cost = 5.00
    return labor_cost, default_utility_per_unit


def build_unit_cost_snapshots(
    db: Session,
    products: Iterable[models.ProductSKU] | None = None,
) -> dict[str, UnitCostSnapshot]:
    """Build one internally consistent snapshot map without persisting costs."""

    product_rows = list(products) if products is not None else db.query(models.ProductSKU).all()
    computed_costs = CostingService.compute_all_sku_costs_in_memory(db, persist=False)
    data_issues = CostingService.collect_sku_data_issues(db)
    recipe_skus = {
        sku
        for (sku,) in db.query(models.Recipe.sku)
        .filter(models.Recipe.sku.isnot(None))
        .all()
    }
    overhead_map = {
        (rate.category or "").lower().strip(): rate
        for rate in db.query(models.CategoryOverheadRate).all()
    }
    utility_config = db.query(models.OverheadConfig).filter(
        models.OverheadConfig.particular == "default_utility_per_unit"
    ).first()
    default_utility = float(utility_config.cost_per_day or 0.0) if utility_config else 3.28

    snapshots: dict[str, UnitCostSnapshot] = {}
    for product in product_rows:
        food_cost = float(computed_costs.get(product.sku, 0.0) or 0.0)
        labor_cost, utility_cost = _resolved_overheads(
            product,
            overhead_map,
            default_utility,
        )

        has_cost_override = product.cost_override is not None and product.cost_override > 0.0
        product_issues = data_issues.get(product.sku, [])
        if not has_cost_override and product.sku not in recipe_skus:
            status = "missing_recipe"
            message = "Recipe missing"
        elif product_issues:
            status = "missing_cost_input"
            message = product_issues[0]
        elif food_cost <= 0.0:
            status = "invalid_cost"
            message = "Review costing data"
        elif not product.retail_price or food_cost >= float(product.retail_price):
            status = "invalid_cost"
            message = "Cost exceeds selling price"
        else:
            status = "ok"
            message = None

        snapshots[product.sku] = UnitCostSnapshot(
            food_cost=round(food_cost, 4),
            labor_cost=round(labor_cost, 4),
            utility_cost=round(utility_cost, 4),
            total_cost=round(food_cost + labor_cost + utility_cost, 4),
            status=status,
            status_message=message,
        )
    return snapshots
