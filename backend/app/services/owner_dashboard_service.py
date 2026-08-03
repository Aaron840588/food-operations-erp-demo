"""Owner-only weekly decision dashboard calculations."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from .. import models
from .cost_snapshot_service import UnitCostSnapshot, build_unit_cost_snapshots
from .sheet_sync_config import load_google_sheets_config


MANILA_TZ = timezone(timedelta(hours=8), name="Asia/Manila")
OWNER_PRODUCT_CATEGORIES = {"Spreads & Sauces", "Sandwiches & Salads"}
PRIORITY_ORDER = {"critical": 0, "warning": 1, "info": 2}


def _as_float(value: Any) -> float:
    return float(value or 0.0)


def _as_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if value:
        try:
            return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
        except ValueError:
            return None
    return None


def _business_category(product: models.ProductSKU | None) -> str:
    if not product:
        return "Other"
    category = (product.category or "").lower()
    name = (product.product_name or "").lower()
    sku = (product.sku or "").upper()
    if (
        any(token in category for token in ("sandwich", "salad", "pasta", "ready to eat", "rte"))
        or any(token in name for token in ("sandwich", "salad", "pasta", "rigatoni", "mac & cheese"))
        or sku.startswith(("RTE-", "TPP-", "PTR-", "CAP-", "BMC-", "YBC-", "UCB-"))
        or "-SW-" in sku
        or "-SL-" in sku
        or "-PASTA" in sku
    ):
        return "Sandwiches & Salads"
    if (
        any(token in category for token in ("sweet", "savory", "spread", "sauce"))
        or any(token in name for token in ("spread", "sauce", "oil"))
        or sku.startswith(("YP-", "ST-", "CM-", "WM-", "PP-", "CGO-", "CLS-"))
    ):
        return "Spreads & Sauces"
    return "Other"


def _resolved_line_cost(
    item: Any,
    fallback: UnitCostSnapshot,
    *,
    consignment_food_fallback: float | None = None,
) -> tuple[float, float, float, float, str]:
    component_values = (
        getattr(item, "food_cost_snapshot", None),
        getattr(item, "labor_cost_snapshot", None),
        getattr(item, "utility_cost_snapshot", None),
        getattr(item, "total_cost_snapshot", None),
    )
    status = getattr(item, "cost_status_snapshot", None)
    if all(value is not None for value in component_values):
        food, labor, utility, total = (_as_float(value) for value in component_values)
        return food, labor, utility, total, status or "legacy_estimate"

    food = (
        _as_float(consignment_food_fallback)
        if consignment_food_fallback is not None
        else fallback.food_cost
    )
    labor = fallback.labor_cost
    utility = fallback.utility_cost
    return food, labor, utility, food + labor + utility, "legacy_estimate"


def _empty_period_totals() -> dict[str, Any]:
    return {
        "net_sales": 0.0,
        "food_cost": 0.0,
        "standard_labor_cost": 0.0,
        "utility_cost": 0.0,
        "direct_expenses": 0.0,
        "actual_labor_cost": 0.0,
        "labor_basis": "standard",
        "contribution_profit": 0.0,
        "sales_by_channel": defaultdict(float),
        "cost_by_category": defaultdict(
            lambda: {"food_cost": 0.0, "labor_cost": 0.0, "utility_cost": 0.0}
        ),
        "product_activity": defaultdict(lambda: {"units_sold": 0, "net_sales": 0.0}),
        "cost_gap_lines": 0,
        "has_consignment_sales": False,
        "approved_timesheets": 0,
        "missing_timesheet_rates": 0,
    }


def _add_line(
    totals: dict[str, Any],
    *,
    channel: str,
    product: models.ProductSKU | None,
    sku: str,
    quantity: int,
    revenue: float,
    food_cost: float,
    labor_cost: float,
    utility_cost: float,
    cost_status: str,
) -> None:
    category = _business_category(product)
    quantity = max(0, int(quantity or 0))
    totals["net_sales"] += revenue
    totals["food_cost"] += quantity * food_cost
    totals["standard_labor_cost"] += quantity * labor_cost
    totals["utility_cost"] += quantity * utility_cost
    totals["sales_by_channel"][channel] += revenue
    totals["cost_by_category"][category]["food_cost"] += quantity * food_cost
    totals["cost_by_category"][category]["labor_cost"] += quantity * labor_cost
    totals["cost_by_category"][category]["utility_cost"] += quantity * utility_cost
    totals["product_activity"][sku]["units_sold"] += quantity
    totals["product_activity"][sku]["net_sales"] += revenue
    if cost_status != "ok":
        totals["cost_gap_lines"] += 1


def _period_totals(
    db: Session,
    start_date: date,
    end_date: date,
    current_costs: dict[str, UnitCostSnapshot],
) -> dict[str, Any]:
    totals = _empty_period_totals()
    start_str = start_date.isoformat()
    end_str = end_date.isoformat()
    default_cost = UnitCostSnapshot(0.0, 0.0, 0.0, 0.0, "invalid_cost", "Missing product")

    consignment_deliveries = db.query(models.ConsignmentDelivery).options(
        joinedload(models.ConsignmentDelivery.items).joinedload(models.ConsignmentItem.product)
    ).filter(
        models.ConsignmentDelivery.delivery_date >= start_str,
        models.ConsignmentDelivery.delivery_date <= end_str,
    ).all()
    for delivery in consignment_deliveries:
        for item in delivery.items:
            quantity = int(item.units_sold or 0)
            if quantity <= 0:
                continue
            fallback = current_costs.get(item.sku, default_cost)
            food, labor, utility, _, status = _resolved_line_cost(
                item,
                fallback,
                consignment_food_fallback=_as_float(item.cost_per_unit_snapshot),
            )
            _add_line(
                totals,
                channel="Consignment",
                product=item.product,
                sku=item.sku,
                quantity=quantity,
                revenue=quantity * _as_float(item.reseller_price_snapshot),
                food_cost=food,
                labor_cost=labor,
                utility_cost=utility,
                cost_status=status,
            )
            totals["has_consignment_sales"] = True

    reseller_orders = db.query(models.ResellerOrder).options(
        joinedload(models.ResellerOrder.items).joinedload(models.ResellerOrderItem.product)
    ).filter(
        models.ResellerOrder.order_date >= start_str,
        models.ResellerOrder.order_date <= end_str,
    ).all()
    for order in reseller_orders:
        gross_subtotal = _as_float(order.subtotal)
        recognized_total = max(0.0, _as_float(order.grand_total) - _as_float(order.tax_amount))
        revenue_factor = recognized_total / gross_subtotal if gross_subtotal > 0.0 else 0.0
        for item in order.items:
            quantity = int(item.quantity or 0)
            fallback = current_costs.get(item.sku, default_cost)
            food, labor, utility, _, status = _resolved_line_cost(item, fallback)
            gross_line = quantity * _as_float(item.price_snapshot)
            _add_line(
                totals,
                channel="Wholesale",
                product=item.product,
                sku=item.sku,
                quantity=quantity,
                revenue=gross_line * revenue_factor,
                food_cost=food,
                labor_cost=labor,
                utility_cost=utility,
                cost_status=status,
            )

    start_at = datetime.combine(start_date, time.min)
    end_at = datetime.combine(end_date + timedelta(days=1), time.min)
    market_sales = db.query(models.MarketEventSale).options(
        joinedload(models.MarketEventSale.items).joinedload(models.MarketEventSaleItem.product)
    ).join(
        models.MarketEvent,
        models.MarketEventSale.event_id == models.MarketEvent.id,
    ).filter(
        models.MarketEvent.is_deleted == False,
        models.MarketEventSale.timestamp >= start_at,
        models.MarketEventSale.timestamp < end_at,
    ).all()
    for sale in market_sales:
        gross_subtotal = sum(
            int(item.quantity or 0) * _as_float(item.price_snapshot)
            for item in sale.items
        )
        revenue_factor = _as_float(sale.total_amount) / gross_subtotal if gross_subtotal > 0 else 0.0
        for item in sale.items:
            quantity = int(item.quantity or 0)
            fallback = current_costs.get(item.sku, default_cost)
            food, labor, utility, _, status = _resolved_line_cost(item, fallback)
            _add_line(
                totals,
                channel="Market Events",
                product=item.product,
                sku=item.sku,
                quantity=quantity,
                revenue=quantity * _as_float(item.price_snapshot) * revenue_factor,
                food_cost=food,
                labor_cost=labor,
                utility_cost=utility,
                cost_status=status,
            )

    events = db.query(models.MarketEvent).filter(
        models.MarketEvent.is_deleted == False,
        models.MarketEvent.event_date >= start_str,
        models.MarketEvent.event_date <= end_str,
    ).all()
    for event in events:
        recorded_expenses = _as_float(event.cash_expenses)
        if recorded_expenses <= 0.0:
            recorded_expenses = _as_float(event.total_expenses)
        totals["direct_expenses"] += recorded_expenses + _as_float(event.cash_refunds)

    timesheets = db.query(models.TimesheetEntry).options(
        joinedload(models.TimesheetEntry.employee)
    ).filter(
        models.TimesheetEntry.review_status == "Approved",
        models.TimesheetEntry.work_date >= start_str,
        models.TimesheetEntry.work_date <= end_str,
    ).all()
    totals["approved_timesheets"] = len(timesheets)
    totals["missing_timesheet_rates"] = sum(
        1 for entry in timesheets if entry.duration_hours > 0 and entry.hourly_rate <= 0
    )
    actual_labor = sum(entry.labor_cost for entry in timesheets)
    totals["actual_labor_cost"] = actual_labor
    if actual_labor > 0.0:
        totals["labor_basis"] = "approved_timesheets"
        labor_for_profit = actual_labor
    else:
        labor_for_profit = totals["standard_labor_cost"]

    totals["contribution_profit"] = (
        totals["net_sales"]
        - totals["food_cost"]
        - labor_for_profit
        - totals["utility_cost"]
        - totals["direct_expenses"]
    )
    return totals


def _pending_collectibles(db: Session, as_of: date) -> dict[str, Any]:
    as_of_str = as_of.isoformat()
    overdue_cutoff = as_of - timedelta(days=15)
    total = 0.0
    overdue_total = 0.0
    count = 0
    overdue_count = 0
    overdue_partners: list[dict[str, Any]] = []

    deliveries = db.query(models.ConsignmentDelivery).options(
        joinedload(models.ConsignmentDelivery.partner),
        joinedload(models.ConsignmentDelivery.items),
    ).filter(
        models.ConsignmentDelivery.delivery_date <= as_of_str,
    ).all()
    for delivery in deliveries:
        payment_date = _as_date(delivery.payment_date)
        if delivery.is_paid and (payment_date is None or payment_date <= as_of):
            continue
        amount = sum(
            int(item.units_sold or 0) * _as_float(item.reseller_price_snapshot)
            for item in delivery.items
        )
        if amount <= 0.0:
            continue
        total += amount
        count += 1
        delivered_on = _as_date(delivery.delivery_date)
        if delivered_on and delivered_on <= overdue_cutoff:
            overdue_total += amount
            overdue_count += 1
            overdue_partners.append({
                "name": delivery.partner.name if delivery.partner else "Unknown partner",
                "amount": round(amount, 2),
                "days_overdue": max(0, (as_of - (delivered_on + timedelta(days=15))).days),
                "delivery_id": delivery.id,
            })

    reseller_orders = db.query(models.ResellerOrder).filter(
        models.ResellerOrder.is_paid == False,
        models.ResellerOrder.order_date <= as_of_str,
    ).all()
    for order in reseller_orders:
        amount = _as_float(order.grand_total)
        total += amount
        count += 1
        ordered_on = _as_date(order.order_date)
        if ordered_on and ordered_on <= overdue_cutoff:
            overdue_total += amount
            overdue_count += 1

    market_receivables = db.query(models.MarketEventSale).filter(
        models.MarketEventSale.timestamp < datetime.combine(as_of + timedelta(days=1), time.min),
        (
            (models.MarketEventSale.payment_method == "Pautang")
            | (
                (models.MarketEventSale.is_preorder == True)
                & (models.MarketEventSale.preorder_payment_status != "Paid")
            )
        ),
    ).all()
    for sale in market_receivables:
        amount = _as_float(sale.total_amount)
        total += amount
        count += 1
        sold_on = _as_date(sale.timestamp)
        if sold_on and sold_on <= overdue_cutoff:
            overdue_total += amount
            overdue_count += 1

    overdue_partners.sort(key=lambda row: (row["days_overdue"], row["amount"]), reverse=True)
    return {
        "total": round(total, 2),
        "count": count,
        "overdue_total": round(overdue_total, 2),
        "overdue_count": overdue_count,
        "top_overdue_partners": overdue_partners[:3],
    }


def _metric(value: float, previous: float | None) -> dict[str, Any]:
    change_pct = None
    if previous not in (None, 0):
        change_pct = ((value - float(previous)) / abs(float(previous))) * 100.0
    direction = "flat"
    if previous is not None and value > previous:
        direction = "up"
    elif previous is not None and value < previous:
        direction = "down"
    return {
        "value": round(value, 2),
        "previous_value": round(previous, 2) if previous is not None else None,
        "change_pct": round(change_pct, 1) if change_pct is not None else None,
        "direction": direction,
    }


def _build_product_analysis(
    products: list[models.ProductSKU],
    current_costs: dict[str, UnitCostSnapshot],
    product_activity: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    rows = []
    for product in products:
        category = _business_category(product)
        if category not in OWNER_PRODUCT_CATEGORIES or not product.is_active:
            continue
        snapshot = current_costs[product.sku]
        selling_price = _as_float(product.retail_price)
        gross_profit = selling_price - snapshot.food_cost
        net_profit = selling_price - snapshot.total_cost
        activity = product_activity.get(product.sku, {})
        rows.append({
            "sku": product.sku,
            "product_name": product.product_name,
            "size": product.size,
            "category": category,
            "selling_price": round(selling_price, 2),
            "food_cost": round(snapshot.food_cost, 2),
            "labor_cost": round(snapshot.labor_cost, 2),
            "utility_cost": round(snapshot.utility_cost, 2),
            "total_cost": round(snapshot.total_cost, 2),
            "gross_profit": round(gross_profit, 2),
            "net_profit": round(net_profit, 2),
            "gross_margin_pct": round(gross_profit / selling_price * 100.0, 2) if selling_price else 0.0,
            "net_margin_pct": round(net_profit / selling_price * 100.0, 2) if selling_price else 0.0,
            "units_sold": int(activity.get("units_sold", 0)),
            "weekly_net_sales": round(_as_float(activity.get("net_sales")), 2),
            "cost_status": snapshot.status,
            "cost_status_message": snapshot.status_message,
        })
    rows.sort(key=lambda row: (row["weekly_net_sales"], row["net_margin_pct"]), reverse=True)
    return rows


def _build_alerts(
    db: Session,
    *,
    today: date,
    collectibles: dict[str, Any],
    product_analysis: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []
    today_str = today.isoformat()
    event_horizon = (today + timedelta(days=14)).isoformat()

    events = db.query(models.MarketEvent).options(
        joinedload(models.MarketEvent.allocations)
    ).filter(
        models.MarketEvent.is_deleted == False,
        models.MarketEvent.status.in_(["Draft", "Active"]),
        models.MarketEvent.event_date >= today_str,
        models.MarketEvent.event_date <= event_horizon,
    ).order_by(models.MarketEvent.event_date.asc()).all()
    for event in events[:2]:
        event_date = _as_date(event.event_date) or today
        readiness_gaps = []
        if not (event.staff_assigned or "").strip():
            readiness_gaps.append("staff")
        if not event.allocations or sum(int(row.quantity or 0) for row in event.allocations) <= 0:
            readiness_gaps.append("stock allocation")
        days_until = max(0, (event_date - today).days)
        if readiness_gaps:
            alerts.append({
                "id": f"event-{event.id}",
                "priority": "critical" if days_until <= 3 else "warning",
                "type": "Event readiness",
                "message": f"{event.name} is missing {' and '.join(readiness_gaps)}.",
                "impact": f"{days_until} day{'s' if days_until != 1 else ''} to event",
                "due": event_date.isoformat(),
                "action_label": "Prepare event",
                "action_href": "/market-events",
            })
        else:
            alerts.append({
                "id": f"event-{event.id}",
                "priority": "info",
                "type": "Upcoming event",
                "message": f"{event.name} is staffed and has booth stock allocated.",
                "impact": f"{days_until} day{'s' if days_until != 1 else ''} to event",
                "due": event_date.isoformat(),
                "action_label": "View event",
                "action_href": "/market-events",
            })

    if collectibles["overdue_count"] > 0:
        alerts.append({
            "id": "overdue-collectibles",
            "priority": "critical",
            "type": "Overdue collectibles",
            "message": (
                f"{collectibles['overdue_count']} receivable"
                f"{'s are' if collectibles['overdue_count'] != 1 else ' is'} over 15 days past due."
            ),
            "impact": f"PHP {collectibles['overdue_total']:,.0f} cash at risk",
            "due": "Overdue",
            "action_label": "Collect payment",
            "action_href": "/consignment",
        })

    sheet_config = load_google_sheets_config()
    if not sheet_config.configured:
        alerts.append({
            "id": "sheet-sync-not-configured",
            "priority": "warning",
            "type": "Sheet sync setup required",
            "message": "Google Sheet price updates are not connected to the Hub yet.",
            "impact": "Owner Sheet edits will not auto-update",
            "due": "Setup",
            "action_label": "Open settings",
            "action_href": "/settings",
        })

    ingredient_count = db.query(func.count(models.RawIngredient.id)).scalar() or 0
    unlinked_ingredient_count = db.query(func.count(models.RawIngredient.id)).filter(
        models.RawIngredient.supplier_id.is_(None),
    ).scalar() or 0
    if ingredient_count and unlinked_ingredient_count:
        alerts.append({
            "id": "supplier-links-missing",
            "priority": "warning",
            "type": "Supplier links missing",
            "message": (
                f"{unlinked_ingredient_count} of {ingredient_count} ingredients "
                "are not linked to a supplier."
            ),
            "impact": "Supplier price alerts are incomplete",
            "due": "Setup",
            "action_label": "Open inventory",
            "action_href": "/inventory",
        })

    price_since = datetime.combine(today - timedelta(days=30), time.min)
    price_changes = db.query(models.IngredientPriceHistory).options(
        joinedload(models.IngredientPriceHistory.raw_ingredient)
    ).filter(
        models.IngredientPriceHistory.changed_at >= price_since,
        models.IngredientPriceHistory.previous_unit_cost > 0,
        models.IngredientPriceHistory.new_unit_cost > models.IngredientPriceHistory.previous_unit_cost,
    ).order_by(models.IngredientPriceHistory.changed_at.desc()).all()
    seen_ingredients: set[int] = set()
    for change in price_changes:
        if change.raw_ingredient_id in seen_ingredients:
            continue
        seen_ingredients.add(change.raw_ingredient_id)
        increase = (
            (change.new_unit_cost - change.previous_unit_cost)
            / change.previous_unit_cost
            * 100.0
        )
        if increase < 5.0:
            continue
        ingredient_name = (
            change.raw_ingredient.name if change.raw_ingredient else "Ingredient"
        )
        alerts.append({
            "id": f"price-{change.id}",
            "priority": "critical" if increase >= 15.0 else "warning",
            "type": "Ingredient price increase",
            "message": f"{ingredient_name} unit cost increased {increase:.1f}%.",
            "impact": "Review affected recipes",
            "due": _as_date(change.changed_at).isoformat() if _as_date(change.changed_at) else "Recent",
            "action_label": "Review costs",
            "action_href": "/recipes",
        })
        if len(seen_ingredients) >= 2:
            break

    low_ingredients = db.query(models.RawIngredient).filter(
        models.RawIngredient.reorder_level > 0,
        models.RawIngredient.available_stock <= models.RawIngredient.reorder_level,
    ).all()
    low_ingredients.sort(
        key=lambda row: (
            _as_float(row.available_stock) / _as_float(row.reorder_level)
            if _as_float(row.reorder_level) > 0
            else 1.0
        )
    )
    for ingredient in low_ingredients[:2]:
        alerts.append({
            "id": f"ingredient-{ingredient.id}",
            "priority": "critical" if _as_float(ingredient.available_stock) <= 0 else "warning",
            "type": "Low stock ingredient",
            "message": (
                f"{ingredient.name} is at {_as_float(ingredient.available_stock):,.1f} "
                f"{ingredient.unit}; reorder point is {_as_float(ingredient.reorder_level):,.1f}."
            ),
            "impact": "Production risk",
            "due": "Now",
            "action_label": "Open inventory",
            "action_href": "/inventory",
        })

    invalid_products = [
        row for row in product_analysis if row["cost_status"] != "ok"
    ]
    if invalid_products:
        alerts.append({
            "id": "invalid-product-costs",
            "priority": "critical",
            "type": "Invalid product cost",
            "message": (
                f"{len(invalid_products)} active product"
                f"{'s need' if len(invalid_products) != 1 else ' needs'} recipe or cost review."
            ),
            "impact": "Profit confidence blocked",
            "due": "Now",
            "action_label": "Fix costing",
            "action_href": "/recipes",
        })

    alerts.sort(key=lambda alert: (PRIORITY_ORDER[alert["priority"]], alert["due"]))
    return alerts[:8]


def _format_period_label(start_date: date, end_date: date) -> str:
    if start_date.year == end_date.year and start_date.month == end_date.month:
        return f"{start_date.strftime('%b')} {start_date.day}-{end_date.day}, {end_date.year}"
    if start_date.year == end_date.year:
        return (
            f"{start_date.strftime('%b')} {start_date.day}-"
            f"{end_date.strftime('%b')} {end_date.day}, {end_date.year}"
        )
    return (
        f"{start_date.strftime('%b')} {start_date.day}, {start_date.year}-"
        f"{end_date.strftime('%b')} {end_date.day}, {end_date.year}"
    )


def build_owner_weekly_dashboard(
    db: Session,
    start_date: date,
    end_date: date,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    if end_date < start_date:
        raise ValueError("Owner dashboard end date cannot be before start date")

    local_now = now.astimezone(MANILA_TZ) if now and now.tzinfo else now
    local_now = local_now or datetime.now(MANILA_TZ)
    duration = (end_date - start_date).days + 1
    effective_end = end_date
    if start_date <= local_now.date() <= end_date:
        effective_end = local_now.date()
    previous_start = start_date - timedelta(days=duration)
    previous_end = previous_start + timedelta(
        days=max(0, (effective_end - start_date).days)
    )

    products = db.query(models.ProductSKU).filter(
        models.ProductSKU.sku != "SKU",
        models.ProductSKU.retail_price > 0,
    ).all()
    current_costs = build_unit_cost_snapshots(db, products)
    current = _period_totals(db, start_date, effective_end, current_costs)
    previous = _period_totals(db, previous_start, previous_end, current_costs)
    collectibles = _pending_collectibles(db, effective_end)

    product_analysis = _build_product_analysis(
        products,
        current_costs,
        current["product_activity"],
    )
    cost_gaps: list[str] = []
    if current["cost_gap_lines"]:
        cost_gaps.append(
            f"{current['cost_gap_lines']} sold line item(s) use legacy or incomplete cost snapshots."
        )
    if current["has_consignment_sales"]:
        cost_gaps.append(
            "Consignment sales are grouped by delivery date because sold-date history is not stored."
        )
    if current["net_sales"] > 0 and current["actual_labor_cost"] <= 0:
        cost_gaps.append(
            "No approved labor cost was recorded for this period; standard SKU labor was used."
        )
    if current["missing_timesheet_rates"] > 0:
        cost_gaps.append(
            f"{current['missing_timesheet_rates']} approved timesheet(s) have no hourly rate."
        )
    if current["utility_cost"] > 0:
        cost_gaps.append(
            "Utility cost uses SKU allocations rather than an actual weekly utility bill."
        )
    cost_gaps.append(
        "Direct expenses include recorded market-event expenses; a general expense ledger is not available."
    )

    invalid_product_count = sum(
        1 for row in product_analysis if row["cost_status"] != "ok"
    )
    if invalid_product_count > 0:
        confidence_status = "needs_review"
    elif cost_gaps:
        confidence_status = "estimated"
    else:
        confidence_status = "complete"

    labor_total = (
        current["actual_labor_cost"]
        if current["labor_basis"] == "approved_timesheets"
        else current["standard_labor_cost"]
    )
    previous_labor_total = (
        previous["actual_labor_cost"]
        if previous["labor_basis"] == "approved_timesheets"
        else previous["standard_labor_cost"]
    )
    breakdown_values = {
        "Food & packaging": current["food_cost"],
        "Labor": labor_total,
        "Utilities": current["utility_cost"],
        "Direct expenses": current["direct_expenses"],
    }
    cost_breakdown = [
        {"name": name, "value": round(value, 2)}
        for name, value in breakdown_values.items()
        if value > 0.0
    ]

    category_rows = []
    for category in ("Spreads & Sauces", "Sandwiches & Salads", "Other"):
        values = current["cost_by_category"].get(category)
        if not values or sum(values.values()) <= 0.0:
            continue
        category_rows.append({
            "category": category,
            "food_cost": round(values["food_cost"], 2),
            "labor_cost": round(values["labor_cost"], 2),
            "utility_cost": round(values["utility_cost"], 2),
            "total_cost": round(sum(values.values()), 2),
        })

    alerts = _build_alerts(
        db,
        today=local_now.date(),
        collectibles=collectibles,
        product_analysis=product_analysis,
    )
    return {
        "timezone": "Asia/Manila",
        "refreshed_at": local_now.isoformat(),
        "period": {
            "start": start_date.isoformat(),
            "end": end_date.isoformat(),
            "data_through": effective_end.isoformat(),
            "label": _format_period_label(start_date, end_date),
            "previous_start": previous_start.isoformat(),
            "previous_end": previous_end.isoformat(),
            "previous_label": _format_period_label(previous_start, previous_end),
            "is_current_week": (
                start_date
                == local_now.date() - timedelta(days=local_now.date().weekday())
            ),
        },
        "confidence": {
            "status": confidence_status,
            "gap_count": len(cost_gaps),
            "gaps": cost_gaps,
            "invalid_product_count": invalid_product_count,
        },
        "kpis": {
            "weekly_net_sales": _metric(current["net_sales"], previous["net_sales"]),
            "weekly_food_cost": _metric(current["food_cost"], previous["food_cost"]),
            "contribution_profit": _metric(
                current["contribution_profit"],
                previous["contribution_profit"],
            ),
            "pending_collectibles": {
                **_metric(collectibles["total"], None),
                "count": collectibles["count"],
                "overdue_total": collectibles["overdue_total"],
                "overdue_count": collectibles["overdue_count"],
            },
        },
        "sales_by_channel": [
            {"channel": channel, "net_sales": round(current["sales_by_channel"].get(channel, 0.0), 2)}
            for channel in ("Consignment", "Wholesale", "Market Events")
        ],
        "cost_by_category": category_rows,
        "cost_breakdown": cost_breakdown,
        "labor_basis": current["labor_basis"],
        "alerts": alerts,
        "product_analysis": product_analysis,
    }
