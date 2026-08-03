import logging
import traceback
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, update
from sqlalchemy.orm import Session, joinedload
from typing import List, Dict
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
import math
import re
from ..database import get_db
from .. import models, schemas, auth
from .costing import has_valid_unit_cost
from ..services.cost_snapshot_service import build_unit_cost_snapshots

logger = logging.getLogger("hh_backend")
router = APIRouter(prefix="/market-events", tags=["Market Events"])

# ----------------------------------------------------
# MARKET EVENTS AI-ASSISTED ANALYTICS (PHASE 5)
# Must be defined BEFORE /{event_id} routing!
# ----------------------------------------------------

@router.get("/analytics/summary", dependencies=[Depends(auth.require_owner)])
def get_market_events_analytics(db: Session = Depends(get_db)):
    """
    Analyzes historical completed Market Events and compiles sales trends,
    hourly distributions, best/slow sellers, and conversational AI recommendations.
    """
    # 1. Fetch completed events
    completed_events = db.query(models.MarketEvent).filter(
        models.MarketEvent.status == "Completed",
        models.MarketEvent.is_deleted == False
    ).all()

    total_events = len(completed_events)
    total_revenue = 0.0
    total_cost = 0.0
    total_units_sold = 0

    sku_sales = {}
    completed_event_ids = [event.id for event in completed_events]
    sales_query = (
        db.query(models.MarketEventSale)
        .filter(models.MarketEventSale.event_id.in_(completed_event_ids))
        .all()
        if completed_event_ids
        else []
    )
    
    # Aggregate from sale items
    for sale in sales_query:
        if not _is_revenue_sale(sale):
            continue
        total_revenue += _money_as_float(sale.total_amount)
        for item in sale.items:
            total_units_sold += item.quantity
            sku_sales[item.sku] = sku_sales.get(item.sku, 0) + item.quantity

    # Fetch cost from products
    products = db.query(models.ProductSKU).all()
    products_map = {p.sku: p for p in products}

    costing_complete = True
    for sku, qty in sku_sales.items():
        prod = products_map.get(sku)
        cost_per_unit = (prod.cost_per_unit or 0.0) if prod else 0.0
        if not prod or not has_valid_unit_cost(cost_per_unit, prod.retail_price):
            costing_complete = False
        else:
            total_cost += qty * cost_per_unit

    potential_profit = total_revenue - total_cost

    # Leaderboard
    sorted_sales = sorted(sku_sales.items(), key=lambda x: x[1], reverse=True)
    best_sellers = []
    slow_sellers = []

    for sku, qty in sorted_sales[:3]:
        prod = products_map.get(sku)
        best_sellers.append({
            "sku": sku,
            "product_name": prod.product_name if prod else sku,
            "size": prod.size if prod else "",
            "quantity": qty
        })

    for sku, qty in reversed(sorted_sales[-3:] if len(sorted_sales) >= 3 else sorted_sales):
        prod = products_map.get(sku)
        slow_sellers.append({
            "sku": sku,
            "product_name": prod.product_name if prod else sku,
            "size": prod.size if prod else "",
            "quantity": qty
        })

    # Hourly distribution
    hourly_distribution = {}
    for sale in sales_query:
        if sale.timestamp:
            hour = sale.timestamp.hour
            hourly_distribution[hour] = (
                hourly_distribution.get(hour, 0.0)
                + _money_as_float(sale.total_amount)
            )

    hourly_sales = [
        {"hour": f"{h:02d}:00", "sales": round(amt, 2)}
        for h, amt in sorted(hourly_distribution.items())
    ]

    # Seasonality (Weekend vs Weekday)
    weekend_sales = 0.0
    weekday_sales = 0.0
    for sale in sales_query:
        if sale.timestamp:
            day_of_week = sale.timestamp.weekday() # 0-4 is weekday, 5-6 is weekend
            if day_of_week >= 5:
                weekend_sales += _money_as_float(sale.total_amount)
            else:
                weekday_sales += _money_as_float(sale.total_amount)

    # AI Recommendations engine
    ai_recommendations = []
    for p in products:
        total_sku_sales = sku_sales.get(p.sku, 0)
        avg_sales = round(total_sku_sales / max(1, total_events), 1)

        if avg_sales > 0:
            # Suggest average + 15% safety buffer, rounded to nearest 6 pack (half box)
            recommended_qty = int(math.ceil(avg_sales * 1.15 / 6.0) * 6)
            if recommended_qty < 12:
                recommended_qty = 12 # minimum suggestion is 1 box (12 jars)
                
            expected_rev = recommended_qty * p.retail_price
            has_valid_cost = has_valid_unit_cost(p.cost_per_unit, p.retail_price)
            expected_prof = recommended_qty * (p.retail_price - p.cost_per_unit) if has_valid_cost else None
            is_stock_short = recommended_qty > (p.warehouse_stock or 0)

            reason = f"Last {total_events} completed Market Events averaged {avg_sales} sales of {p.product_name}. We recommend bringing {recommended_qty} jars (rounded to full pack sizes) as reservation."

            ai_recommendations.append({
                "sku": p.sku,
                "product_name": p.product_name,
                "size": p.size,
                "recommended_quantity": recommended_qty,
                "reason": reason,
                "expected_revenue": round(expected_rev, 2),
                "expected_profit": round(expected_prof, 2) if expected_prof is not None else None,
                "costing_complete": has_valid_cost,
                "is_stock_short": is_stock_short,
                "warehouse_stock": p.warehouse_stock or 0
            })

    # Event-over-event growth
    event_growth = []
    accumulated_rev = 0.0
    for event in sorted(completed_events, key=lambda x: x.event_date):
        ev_sales = db.query(models.MarketEventSale).filter(models.MarketEventSale.event_id == event.id).all()
        ev_rev = sum(_money_as_float(s.total_amount) for s in ev_sales)
        accumulated_rev += ev_rev
        event_growth.append({
            "event_name": event.name,
            "date": event.event_date,
            "revenue": round(ev_rev, 2),
            "accumulated": round(accumulated_rev, 2)
        })

    return {
        "overall": {
            "total_completed_events": total_events,
            "total_revenue": round(total_revenue, 2),
            "total_cost": round(total_cost, 2),
            "potential_profit": round(potential_profit, 2),
            "costing_complete": costing_complete,
            "total_units_sold": total_units_sold,
            "avg_revenue_per_event": round(total_revenue / max(1, total_events), 2)
        },
        "best_sellers": best_sellers,
        "slow_sellers": slow_sellers,
        "hourly_sales": hourly_sales,
        "weekend_sales": round(weekend_sales, 2),
        "weekday_sales": round(weekday_sales, 2),
        "event_growth": event_growth,
        "recommendations": ai_recommendations
    }


def get_reserved_quantities(db: Session, exclude_event_id: int = None) -> Dict[str, int]:
    """
    Returns a mapping of SKU -> total reserved quantity in Draft events.
    Optionally excludes a specific event_id.
    """
    query = (
        db.query(models.MarketEventAllocation.sku, func.sum(models.MarketEventAllocation.quantity))
        .join(models.MarketEvent, models.MarketEvent.id == models.MarketEventAllocation.event_id)
        .filter(
            models.MarketEvent.status == "Draft",
            models.MarketEvent.is_deleted == False
        )
    )
    if exclude_event_id is not None:
        query = query.filter(models.MarketEvent.id != exclude_event_id)
        
    results = query.group_by(models.MarketEventAllocation.sku).all()
    return {sku: int(qty) for sku, qty in results if qty is not None}


# ----------------------------------------------------
# STANDARD MARKET EVENTS CRUD
# ----------------------------------------------------

PAYMENT_BREAKDOWN_KEYS = (
    "Cash",
    "GCash",
    "BPI / Bank Transfer",
    "Maya",
    "Card",
    "Complimentary / Gift",
    "Pautang",
    "Mixed",
)


def _canonical_payment_method(payment_method: str) -> str:
    normalized = (payment_method or "").strip().lower()
    if normalized in {"bpi", "bank transfer", "bpi / bank transfer", "bpi/bank transfer"}:
        return "BPI / Bank Transfer"
    if normalized in {"complimentary / gift", "complimentary", "gift", "gift / free", "gift / complimentary", "free"}:
        return "Complimentary / Gift"
    if normalized in {
        "pautang",
        "pautang / collectibles",
        "pautang/collectibles",
        "collectible",
        "collectibles",
    }:
        return "Pautang"
    for method in PAYMENT_BREAKDOWN_KEYS:
        if normalized == method.lower():
            return method
    return payment_method or "Other"


def _is_collected_sale(sale: models.MarketEventSale) -> bool:
    if _canonical_payment_method(sale.payment_method) in {
        "Complimentary / Gift",
        "Pautang",
    }:
        return False
    return not sale.is_preorder or sale.preorder_payment_status == "Paid"


def _is_revenue_sale(sale: models.MarketEventSale) -> bool:
    """Recognize receivable revenue without treating it as collected cash."""
    if _canonical_payment_method(sale.payment_method) == "Pautang":
        return True
    return _is_collected_sale(sale)


def _money_as_float(value, default: float = 0.0) -> float:
    """Keep calculations compatible with legacy Float and new Numeric rows."""
    return default if value is None else float(value)


_MONEY_QUANTUM = Decimal("0.01")
_PROMOTION_TARGETS = {
    "CLASSIC_DUO": Decimal("165.00"),
    "SIGNATURE_DUO": Decimal("245.00"),
    "COMBO_DUO": Decimal("210.00"),
}


def _money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(_MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def _is_classic_product(product: models.ProductSKU) -> bool:
    sku = (product.sku or "").upper()
    name = (product.product_name or "").lower()
    return (
        sku.startswith(
            ("GCP-", "PEGG-", "PTE-", "UYK-", "STS-", "CMS-", "WM-")
        )
        or any(
            token in name
            for token in (
                "grilled cheese",
                "pesto egg",
                "pesto, tomato",
                "ube, keso",
                "sweet tablea s'mores",
                "cookies & matcha",
                "cookies and matcha",
                "white mocha s'mores",
            )
        )
    )


def _is_signature_product(product: models.ProductSKU) -> bool:
    sku = (product.sku or "").upper()
    name = (product.product_name or "").lower()
    return (
        sku.startswith(("TPP-", "BMC-", "SSC-", "PCS-", "PCHXW-", "BLT-"))
        or any(
            token in name
            for token in (
                "tuna pesto pasta",
                "bacon mac",
                "smoked salmon",
                "pesto club",
                "pesto chicken",
                "bacon, lettuce",
                "(blt)",
            )
        )
    )


def _promotion_discount(
    promotion_code: str | None,
    requested_by_sku: Dict[str, int],
    products_by_sku: Dict[str, models.ProductSKU],
) -> tuple[Decimal, str | None]:
    if promotion_code is None:
        return Decimal("0.00"), None

    classic_units: list[Decimal] = []
    signature_units: list[Decimal] = []
    all_units: list[Decimal] = []
    for sku, quantity in requested_by_sku.items():
        product = products_by_sku[sku]
        price = _money(product.retail_price)
        units = [price] * quantity
        all_units.extend(units)
        if _is_classic_product(product):
            classic_units.extend(units)
        if _is_signature_product(product):
            signature_units.extend(units)

    discount = Decimal("0.00")
    pair_count = 0
    target_price = _PROMOTION_TARGETS.get(promotion_code)
    if promotion_code in {"CLASSIC_DUO", "SIGNATURE_DUO"}:
        eligible = classic_units if promotion_code == "CLASSIC_DUO" else signature_units
        eligible.sort(reverse=True)
        for index in range(0, len(eligible) - 1, 2):
            pair_sum = eligible[index] + eligible[index + 1]
            discount += max(Decimal("0.00"), pair_sum - target_price)
            pair_count += 1
    elif promotion_code == "COMBO_DUO":
        classic_units.sort(reverse=True)
        signature_units.sort(reverse=True)
        pair_count = min(len(classic_units), len(signature_units))
        for index in range(pair_count):
            pair_sum = classic_units[index] + signature_units[index]
            discount += max(Decimal("0.00"), pair_sum - target_price)
    elif promotion_code == "B1T1":
        all_units.sort(reverse=True)
        for index in range(0, len(all_units) - 1, 2):
            discount += all_units[index + 1]
            pair_count += 1
    else:
        raise HTTPException(status_code=422, detail="Unsupported promotion code.")

    snapshot = {
        "code": promotion_code,
        "pair_count": pair_count,
        "rule": (
            "cheaper_item_free"
            if promotion_code == "B1T1"
            else "fixed_pair_price"
        ),
        "target_pair_price": (
            None if target_price is None else f"{target_price:.2f}"
        ),
    }
    return (
        discount.quantize(_MONEY_QUANTUM, rounding=ROUND_HALF_UP),
        json.dumps(snapshot, sort_keys=True, separators=(",", ":")),
    )


_STAFF_ASSIGNMENT_SEPARATOR = re.compile(r"[,;|\r\n]+")


def _staff_assignment_tokens(staff_assigned: str) -> set[str]:
    """Return exact username tokens from the legacy free-text assignment field.

    The existing UI documents comma-separated assignments. Semicolons, pipes,
    and line breaks are accepted as equivalent separators for imported records.
    Matching is exact after trimming and Unicode-aware case folding; substring
    matches such as ``alice`` in ``malice`` never grant access.
    """
    return {
        token.strip().casefold()
        for token in _STAFF_ASSIGNMENT_SEPARATOR.split(staff_assigned or "")
        if token.strip()
    }


def _is_staff_assigned(event: models.MarketEvent, user: models.User) -> bool:
    username = (user.username or "").strip().casefold()
    return bool(username) and username in _staff_assignment_tokens(event.staff_assigned)


def _require_cashier_safe_event_access(
    event: models.MarketEvent,
    current_user: models.User,
) -> None:
    """Allow owners globally and staff on assigned Active and Draft market events."""
    if current_user.role == "owner":
        return
    if (
        current_user.role != "staff"
        or event.status not in {"Active", "Draft"}
        or (bool((event.staff_assigned or "").strip()) and not _is_staff_assigned(event, current_user))
    ):
        raise HTTPException(
            status_code=403,
            detail="Staff access is limited to assigned Active and Draft Market Events.",
        )


def _require_market_event_update_access(
    event: models.MarketEvent,
    current_user: models.User,
) -> None:
    """Limit event mutation to owners or explicitly assigned Active staff."""
    if current_user.role == "owner":
        return
    if (
        current_user.role == "staff"
        and event.status == "Active"
        and _is_staff_assigned(event, current_user)
    ):
        return
    raise HTTPException(
        status_code=403,
        detail="Market Event updates require an owner or explicitly assigned Active-event staff member.",
    )


def compute_event_stats(
    event: models.MarketEvent,
    db: Session,
    include_financials: bool = True,
) -> schemas.MarketEventOut:
    allocations_out = []

    # Calculate sold quantities, gross sales (un-discounted SRP sum), and actual sales revenue per SKU for this event
    sold_qtys = {}
    gross_sales_total = 0.0
    actual_sales_revenue = 0.0
    payment_breakdown = {method: 0.0 for method in PAYMENT_BREAKDOWN_KEYS}

    sales = db.query(models.MarketEventSale).filter(models.MarketEventSale.event_id == event.id).all()
    for sale in sales:
        if _is_revenue_sale(sale):
            sale_amount = _money_as_float(sale.total_amount)
            actual_sales_revenue += sale_amount
            for item in sale.items:
                gross_sales_total += (
                    (item.quantity or 0) * _money_as_float(item.price_snapshot)
                )
            method = _canonical_payment_method(sale.payment_method)
            payment_breakdown[method] = payment_breakdown.get(method, 0.0) + sale_amount
        for item in sale.items:
            sold_qtys[item.sku] = sold_qtys.get(item.sku, 0) + item.quantity

    payment_breakdown = {
        method: round(amount, 2)
        for method, amount in payment_breakdown.items()
    }
    cash_sales = payment_breakdown.get("Cash", 0.0)
    total_tips = sum(_money_as_float(s.tip_amount) for s in sales if _is_collected_sale(s))
    cash_tips = sum(
        _money_as_float(sale.tip_amount)
        for sale in sales
        if (
            _is_collected_sale(sale)
            and _canonical_payment_method(sale.payment_method) == "Cash"
        )
    )
    opening_float = max(0.0, event.initial_cash_balance or 0.0)
    # Backfill-safe fallback for closeouts created before explicit cash buckets.
    cash_expenses = max(
        0.0,
        _money_as_float(
            event.cash_expenses
            if event.cash_expenses is not None
            else event.total_expenses
        ),
    )
    cash_refunds = max(0.0, _money_as_float(event.cash_refunds))
    gcash_sales = (
        None if event.gcash_sales is None else max(0.0, _money_as_float(event.gcash_sales))
    )
    bpi_sales = (
        None if event.bpi_sales is None else max(0.0, _money_as_float(event.bpi_sales))
    )
    # Null means "not reconciled" and falls back to POS. Explicit zero is a
    # physical/account count and must remain zero.
    reconciled_gcash_sales = (
        payment_breakdown.get("GCash", 0.0)
        if gcash_sales is None
        else gcash_sales
    )
    reconciled_bpi_sales = (
        payment_breakdown.get("BPI / Bank Transfer", 0.0)
        if bpi_sales is None
        else bpi_sales
    )
    # Mixed tenders cannot be allocated without per-tender sale data, so they
    # remain visibly unclassified in payment_breakdown and are not silently
    # counted as digital receipts.
    digital_sales_total = (
        reconciled_gcash_sales
        + reconciled_bpi_sales
        + payment_breakdown.get("Maya", 0.0)
        + payment_breakdown.get("Card", 0.0)
    )
    ending_cashbox_balance = (
        opening_float
        + cash_sales
        + cash_tips
        - cash_expenses
        - cash_refunds
    )
    food_waste_quantity = sum(max(0, alloc.wasted_quantity or 0) for alloc in event.allocations)
    food_leftover_quantity = sum(
        max(0, (alloc.quantity or 0) - (alloc.wasted_quantity or 0))
        for alloc in event.allocations
    )

    estimated_revenue = 0.0
    estimated_cost = 0.0
    food_waste_cost = 0.0
    costing_complete = True

    has_actuals = len(sales) > 0 or event.status == "Completed"

    if has_actuals:
        estimated_revenue = actual_sales_revenue - cash_refunds

        for alloc in event.allocations:
            product = db.query(models.ProductSKU).filter(models.ProductSKU.sku == alloc.sku).first()
            prod_name = product.product_name if product else alloc.sku
            size = product.size if product else ""
            current_stock = product.warehouse_stock if product else 0
            retail_price = product.retail_price if product else 0.0
            cost_per_unit = (product.cost_per_unit or 0.0) if product else 0.0

            sold_qty = sold_qtys.get(alloc.sku, 0)
            wasted_qty = max(0, alloc.wasted_quantity or 0)
            remaining_qty = max(0, alloc.quantity - wasted_qty)
            if (sold_qty > 0 or wasted_qty > 0) and not has_valid_unit_cost(cost_per_unit, retail_price):
                costing_complete = False
            estimated_cost += (sold_qty + wasted_qty) * cost_per_unit
            food_waste_cost += wasted_qty * cost_per_unit

            allocations_out.append(schemas.MarketEventAllocationOut(
                id=alloc.id,
                sku=alloc.sku,
                quantity=alloc.quantity,
                product_name=prod_name,
                size=size,
                current_stock=current_stock,
                retail_price=retail_price,
                cost_per_unit=cost_per_unit if include_financials else None,
                wasted_quantity=(alloc.wasted_quantity or 0) if include_financials else 0,
                waste_reason=(alloc.waste_reason or "") if include_financials else "",
                sold_quantity=sold_qty,
                remaining_quantity=remaining_qty,
            ))
    else:
        # Forecast metrics (based on potential dispatch quantities)
        for alloc in event.allocations:
            product = db.query(models.ProductSKU).filter(models.ProductSKU.sku == alloc.sku).first()
            prod_name = product.product_name if product else alloc.sku
            size = product.size if product else ""
            current_stock = product.warehouse_stock if product else 0
            retail_price = product.retail_price if product else 0.0
            cost_per_unit = (product.cost_per_unit or 0.0) if product else 0.0
            sold_qty = sold_qtys.get(alloc.sku, 0)
            wasted_qty = max(0, alloc.wasted_quantity or 0)
            remaining_qty = max(0, alloc.quantity - wasted_qty)
            if alloc.quantity > 0 and not has_valid_unit_cost(cost_per_unit, retail_price):
                costing_complete = False
            
            gross_sales_total += alloc.quantity * retail_price
            estimated_revenue += alloc.quantity * retail_price
            estimated_cost += alloc.quantity * cost_per_unit
            
            allocations_out.append(schemas.MarketEventAllocationOut(
                id=alloc.id,
                sku=alloc.sku,
                quantity=alloc.quantity,
                product_name=prod_name,
                size=size,
                current_stock=current_stock,
                retail_price=retail_price,
                cost_per_unit=cost_per_unit if include_financials else None,
                wasted_quantity=(alloc.wasted_quantity or 0) if include_financials else 0,
                waste_reason=(alloc.waste_reason or "") if include_financials else "",
                sold_quantity=sold_qty,
                remaining_quantity=remaining_qty,
            ))

    potential_profit = estimated_revenue - estimated_cost
    if has_actuals:
        potential_profit -= cash_expenses

    return schemas.MarketEventOut(
        id=event.id,
        name=event.name,
        event_date=event.event_date,
        location=event.location,
        staff_assigned=event.staff_assigned,
        notes=event.notes,
        status=event.status,
        is_deleted=event.is_deleted,
        allocations=allocations_out,
        gross_sales=round(gross_sales_total, 2),
        estimated_revenue=round(estimated_revenue, 2),
        estimated_cost=round(estimated_cost, 2) if include_financials else None,
        potential_profit=round(potential_profit, 2) if include_financials else None,
        metrics_basis="actual" if has_actuals else "forecast",
        costing_complete=costing_complete if include_financials else False,
        financials_visible=include_financials,
        # Event-level cash, reconciliation, waste, cost, revenue, and profit
        # values are owner report data. Staff receives only the event identity,
        # assigned active inventory quantities, and POS-required retail prices.
        initial_cash_balance=event.initial_cash_balance if include_financials else None,
        opening_float=opening_float if include_financials else None,
        actual_closing_cash=event.actual_closing_cash if include_financials else None,
        cash_adjustments=event.cash_adjustments if include_financials else None,
        cash_adjustments_notes=event.cash_adjustments_notes if include_financials else None,
        total_expenses=event.total_expenses if include_financials else None,
        expense_notes=event.expense_notes if include_financials else None,
        cash_expenses=cash_expenses if include_financials else None,
        cash_refunds=cash_refunds if include_financials else None,
        gcash_sales=gcash_sales if include_financials else None,
        bpi_sales=bpi_sales if include_financials else None,
        cash_sales=round(cash_sales, 2) if include_financials else None,
        total_tips=round(total_tips, 2) if include_financials else None,
        ending_cashbox_balance=round(ending_cashbox_balance, 2) if include_financials else None,
        digital_sales_total=round(digital_sales_total, 2) if include_financials else None,
        payment_breakdown=payment_breakdown if include_financials else None,
        food_waste_quantity=food_waste_quantity if include_financials else 0,
        food_leftover_quantity=food_leftover_quantity if include_financials else 0,
        food_waste_cost=round(food_waste_cost, 2) if include_financials else None,
    )

@router.get("", response_model=List[schemas.MarketEventOut])
def get_all_market_events(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    query = db.query(models.MarketEvent).filter(models.MarketEvent.is_deleted == False)
    if current_user.role == "owner":
        events = query.order_by(models.MarketEvent.event_date.desc()).all()
        return [compute_event_stats(event, db, True) for event in events]
    if current_user.role != "staff":
        raise HTTPException(status_code=403, detail="Unsupported Market Events role.")

    events = query.filter(models.MarketEvent.status.in_(["Active", "Draft"])).order_by(
        models.MarketEvent.event_date.desc()
    ).all()
    return [
        compute_event_stats(event, db, False)
        for event in events
        if not (event.staff_assigned or "").strip() or _is_staff_assigned(event, current_user)
    ]

@router.get("/{event_id}", response_model=schemas.MarketEventOut)
def get_market_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    event = db.query(models.MarketEvent).filter(
        models.MarketEvent.id == event_id,
        models.MarketEvent.is_deleted == False,
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Market Event not found")
    _require_cashier_safe_event_access(event, current_user)
    return compute_event_stats(event, db, current_user.role == "owner")

@router.post("", response_model=schemas.MarketEventOut)
def create_market_event(
    payload: schemas.MarketEventCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    opening_float = (
        payload.opening_float
        if payload.opening_float is not None
        else (payload.initial_cash_balance or 0.0)
    )
    cash_expenses = (
        payload.cash_expenses
        if payload.cash_expenses is not None
        else (payload.total_expenses or 0.0)
    )
    staff_text = payload.staff_assigned or ""
    if current_user.role == "staff" and current_user.username.strip().casefold() not in _staff_assignment_tokens(staff_text):
        staff_text = f"{staff_text}, {current_user.username}".strip(", ")

    event = models.MarketEvent(
        name=payload.name,
        event_date=payload.event_date,
        location=payload.location,
        staff_assigned=staff_text,
        notes=payload.notes,
        status=payload.status or "Draft",
        is_deleted=False,
        initial_cash_balance=opening_float,
        actual_closing_cash=payload.actual_closing_cash,
        cash_adjustments=payload.cash_adjustments or 0.0,
        cash_adjustments_notes=payload.cash_adjustments_notes or "",
        total_expenses=payload.total_expenses or cash_expenses,
        expense_notes=payload.expense_notes or "",
        cash_expenses=cash_expenses,
        cash_refunds=payload.cash_refunds or 0.0,
        gcash_sales=payload.gcash_sales,
        bpi_sales=payload.bpi_sales,
    )
    if event.status not in {"Draft", "Active"}:
        raise HTTPException(
            status_code=409,
            detail="A new Market Event must start in Draft or Active status.",
        )

    allocation_totals = defaultdict(int)
    for alloc in payload.allocations:
        allocation_totals[alloc.sku] += alloc.quantity

    # Enforce allocation validation: only active products, and quantity <= available stock
    reserved_map = get_reserved_quantities(db)
    for sku, qty in allocation_totals.items():
        product = db.query(models.ProductSKU).filter(models.ProductSKU.sku == sku).first()
        if not product:
            raise HTTPException(status_code=404, detail=f"Product SKU {sku} not found")
        if not product.is_active:
            raise HTTPException(
                status_code=400,
                detail=f"Product SKU {sku} is inactive and cannot be allocated."
            )
        available_stock = (product.warehouse_stock or 0) - reserved_map.get(sku, 0)
        if qty > available_stock:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot allocate {qty} units of SKU {sku}. Available stock is {available_stock}."
            )

    for sku in sorted(allocation_totals):
        event.allocations.append(models.MarketEventAllocation(
            sku=sku,
            quantity=allocation_totals[sku],
        ))

    if event.status == "Active" and not allocation_totals:
        raise HTTPException(
            status_code=422,
            detail="At least one allocation is required to activate a Market Event.",
        )

    try:
        db.add(event)
        db.flush()

        if event.status == "Active":
            for sku in sorted(allocation_totals):
                requested_quantity = allocation_totals[sku]
                result = db.execute(
                    update(models.ProductSKU)
                    .where(
                        models.ProductSKU.sku == sku,
                        func.coalesce(models.ProductSKU.warehouse_stock, 0) >= requested_quantity,
                    )
                    .values(
                        warehouse_stock=func.coalesce(models.ProductSKU.warehouse_stock, 0)
                        - requested_quantity
                    )
                    .execution_options(synchronize_session=False)
                )
                if result.rowcount != 1:
                    db.rollback()
                    product = db.query(models.ProductSKU).filter(models.ProductSKU.sku == sku).first()
                    if not product:
                        raise HTTPException(status_code=404, detail=f"Product SKU {sku} not found")
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            f"Insufficient warehouse stock for SKU {sku}. "
                            f"Available: {product.warehouse_stock or 0}, "
                            f"Requested: {requested_quantity}."
                        ),
                    )

                db.add(models.InventoryTransaction(
                    sku=sku,
                    transaction_type="manual_adjustment",
                    qty=float(-requested_quantity),
                    user_id=current_user.id,
                    notes=f"Stock allocated and dispatched to Active Market Event: {event.name}",
                ))

            from ..database import sync_warehouse_stock_for_main_facility
            db.flush()
            db.expire_all()
            for sku in sorted(allocation_totals):
                sync_warehouse_stock_for_main_facility(db, sku=sku)

        # Handle recurrence if specified
        recurrence = (payload.recurrence or "none").lower()
        recurrence_count = payload.recurrence_count or 1
        
        if recurrence != "none" and recurrence_count > 1:
            from datetime import datetime, timedelta
            try:
                start_date = datetime.strptime(payload.event_date, "%Y-%m-%d").date()
            except ValueError:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid event date format. Use YYYY-MM-DD."
                )
            
            for i in range(1, recurrence_count):
                if recurrence == "weekly":
                    next_date = start_date + timedelta(days=7 * i)
                elif recurrence == "bi-weekly":
                    next_date = start_date + timedelta(days=14 * i)
                elif recurrence == "monthly":
                    # calendar monthly calculation
                    year = start_date.year
                    month = start_date.month + i
                    day = start_date.day
                    while month > 12:
                        month -= 12
                        year += 1
                    import calendar
                    last_day = calendar.monthrange(year, month)[1]
                    next_date = datetime(year, month, min(day, last_day)).date()
                else:
                    break
                    
                next_date_str = next_date.strftime("%Y-%m-%d")
                future_event = models.MarketEvent(
                    name=payload.name,
                    event_date=next_date_str,
                    location=payload.location,
                    staff_assigned=payload.staff_assigned,
                    notes=payload.notes,
                    status="Draft",  # Future occurrences are created as Draft
                    is_deleted=False,
                    initial_cash_balance=opening_float,
                    actual_closing_cash=None,
                    cash_adjustments=0.0,
                    cash_adjustments_notes="",
                    total_expenses=0.0,
                    expense_notes="",
                    cash_expenses=0.0,
                    cash_refunds=0.0,
                    gcash_sales=None,
                    bpi_sales=None,
                )
                db.add(future_event)

        db.commit()
        db.refresh(event)
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    return compute_event_stats(event, db, current_user.role == "owner")

@router.put("/{event_id}", response_model=schemas.MarketEventOut)
def update_market_event(
    event_id: int, 
    payload: schemas.MarketEventUpdate, 
    db: Session = Depends(get_db), 
    current_user: models.User = Depends(auth.get_current_user)
):
    event = db.query(models.MarketEvent).filter(
        models.MarketEvent.id == event_id,
        models.MarketEvent.is_deleted == False,
    ).with_for_update().first()
    if not event:
        raise HTTPException(status_code=404, detail="Market Event not found")

    _require_market_event_update_access(event, current_user)

    old_status = event.status
    update_data = payload.model_dump(exclude_unset=True)
    allocations = update_data.pop("allocations", None)
    if current_user.role != "owner":
        owner_only_fields = {
            "name",
            "event_date",
            "location",
            "staff_assigned",
        }
        forbidden_fields = sorted(owner_only_fields.intersection(update_data))
        if forbidden_fields:
            raise HTTPException(
                status_code=403,
                detail=(
                    "Only owners can update Market Event identity or staff "
                    f"assignment fields: {', '.join(forbidden_fields)}."
                ),
            )
    required_closeout_values = {
        "initial_cash_balance",
        "opening_float",
        "total_expenses",
        "cash_expenses",
        "cash_refunds",
    }
    null_closeout_values = sorted(
        key for key in required_closeout_values
        if key in update_data and update_data[key] is None
    )
    if null_closeout_values:
        raise HTTPException(
            status_code=422,
            detail=f"Closeout values cannot be null: {', '.join(null_closeout_values)}.",
        )
    if "opening_float" in update_data:
        update_data["initial_cash_balance"] = update_data.pop("opening_float")
    if "cash_expenses" in update_data and "total_expenses" not in update_data:
        update_data["total_expenses"] = update_data["cash_expenses"]
    elif "total_expenses" in update_data and "cash_expenses" not in update_data:
        update_data["cash_expenses"] = update_data["total_expenses"]
    new_status = update_data.get("status", old_status)
    stock_skus_to_sync = set()

    legal_transitions = {
        "Draft": {"Draft", "Active", "Cancelled"},
        "Active": {"Active", "Completed", "Cancelled"},
        "Completed": {"Completed"},
        "Cancelled": {"Cancelled"},
    }
    if new_status is None or old_status not in legal_transitions or new_status not in legal_transitions[old_status]:
        raise HTTPException(
            status_code=409,
            detail=f"Illegal Market Event status transition from {old_status} to {new_status}.",
        )
    if old_status == "Active" and new_status == "Completed":
        closing_cash = update_data.get("actual_closing_cash", event.actual_closing_cash)
        if closing_cash is None:
            raise HTTPException(
                status_code=422,
                detail="Actual physical closing cash is required before completing a Market Event.",
            )
    if allocations is not None and old_status not in {"Draft", "Active"}:
        raise HTTPException(
            status_code=409,
            detail="Inventory allocations cannot be edited after a Market Event is completed or cancelled.",
        )

    try:
        for key, value in update_data.items():
            setattr(event, key, value)

        if allocations is not None and old_status == "Active" and new_status == "Completed":
            # Update only wasted_quantity and waste_reason for existing allocations
            for alloc_data in allocations:
                db_alloc = db.query(models.MarketEventAllocation).filter(
                    models.MarketEventAllocation.event_id == event.id,
                    models.MarketEventAllocation.sku == alloc_data["sku"]
                ).first()
                if not db_alloc:
                    raise HTTPException(
                        status_code=422,
                        detail=f"SKU {alloc_data['sku']} is not allocated to this Market Event.",
                    )
                wasted_quantity = alloc_data.get("wasted_quantity") or 0
                waste_reason = (alloc_data.get("waste_reason") or "").strip()
                if wasted_quantity > db_alloc.quantity:
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            f"Waste for SKU {db_alloc.sku} cannot exceed its "
                            f"remaining booth stock of {db_alloc.quantity}."
                        ),
                    )
                if wasted_quantity > 0 and not waste_reason:
                    raise HTTPException(
                        status_code=422,
                        detail=f"A waste reason is required for SKU {db_alloc.sku}.",
                    )
                db_alloc.wasted_quantity = wasted_quantity
                db_alloc.waste_reason = waste_reason

        elif allocations is not None and old_status == "Active" and new_status == "Active":
            desired_remaining_by_sku: Dict[str, int] = {}
            existing_remaining_by_sku = defaultdict(int)
            for existing_allocation in event.allocations:
                existing_remaining_by_sku[existing_allocation.sku] += max(
                    0,
                    int(existing_allocation.quantity or 0),
                )
            for alloc_data in allocations:
                if (
                    "remaining_quantity" not in alloc_data
                    or alloc_data.get("remaining_quantity") is None
                    or "quantity" in alloc_data
                ):
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            "Active allocation edits require remaining_quantity "
                            "and must not send the legacy quantity field."
                        ),
                    )
                if (
                    (alloc_data.get("wasted_quantity") or 0) != 0
                    or (alloc_data.get("waste_reason") or "").strip()
                ):
                    raise HTTPException(
                        status_code=422,
                        detail="Waste can only be recorded during closeout.",
                    )
                raw_sku = (alloc_data.get("sku") or "").strip()
                product = db.query(models.ProductSKU).filter(
                    models.ProductSKU.sku == raw_sku
                ).first()
                if not product:
                    product = db.query(models.ProductSKU).filter(
                        func.lower(models.ProductSKU.sku) == raw_sku.lower()
                    ).first()
                if not product:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Product SKU '{raw_sku}' not found in catalog.",
                    )
                if product.sku in desired_remaining_by_sku:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Duplicate Active allocation SKU '{product.sku}'.",
                    )
                desired_remaining = int(alloc_data["remaining_quantity"])
                current_remaining = existing_remaining_by_sku.get(product.sku, 0)
                if not product.is_active and desired_remaining > current_remaining:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Product SKU '{product.sku}' is inactive and "
                            "cannot receive additional booth stock. Existing "
                            "event stock may only be retained or reduced."
                        ),
                    )
                desired_remaining_by_sku[product.sku] = desired_remaining

            sold_rows = (
                db.query(
                    models.MarketEventSaleItem.sku,
                    func.sum(models.MarketEventSaleItem.quantity),
                )
                .join(
                    models.MarketEventSale,
                    models.MarketEventSale.id
                    == models.MarketEventSaleItem.sale_id,
                )
                .filter(models.MarketEventSale.event_id == event.id)
                .group_by(models.MarketEventSaleItem.sku)
                .all()
            )
            sold_by_sku = {sku: int(quantity or 0) for sku, quantity in sold_rows}

            existing_rows_by_sku = defaultdict(list)
            for allocation in event.allocations:
                existing_rows_by_sku[allocation.sku].append(allocation)

            def move_warehouse_stock(sku: str, delta: int) -> None:
                """Move delta into the booth; negative delta returns stock."""
                if delta > 0:
                    result = db.execute(
                        update(models.ProductSKU)
                        .where(
                            models.ProductSKU.sku == sku,
                            func.coalesce(
                                models.ProductSKU.warehouse_stock, 0
                            ) >= delta,
                        )
                        .values(
                            warehouse_stock=func.coalesce(
                                models.ProductSKU.warehouse_stock, 0
                            ) - delta
                        )
                        .execution_options(synchronize_session=False)
                    )
                    if result.rowcount != 1:
                        product = db.query(models.ProductSKU).filter(
                            models.ProductSKU.sku == sku
                        ).first()
                        if not product:
                            raise HTTPException(
                                status_code=404,
                                detail=f"Product SKU {sku} not found",
                            )
                        raise HTTPException(
                            status_code=409,
                            detail=(
                                f"Insufficient warehouse stock for SKU {sku}. "
                                f"Available: {product.warehouse_stock or 0}, "
                                f"Requested additional booth stock: {delta}."
                            ),
                        )
                    movement_note = (
                        "Additional stock allocated to Active Market Event"
                    )
                elif delta < 0:
                    return_quantity = abs(delta)
                    result = db.execute(
                        update(models.ProductSKU)
                        .where(models.ProductSKU.sku == sku)
                        .values(
                            warehouse_stock=func.coalesce(
                                models.ProductSKU.warehouse_stock, 0
                            ) + return_quantity
                        )
                        .execution_options(synchronize_session=False)
                    )
                    if result.rowcount != 1:
                        raise HTTPException(
                            status_code=404,
                            detail=f"Product SKU {sku} not found",
                        )
                    movement_note = "Stock unallocated from Active Market Event"
                else:
                    return

                db.add(models.InventoryTransaction(
                    sku=sku,
                    transaction_type="manual_adjustment",
                    qty=float(-delta),
                    user_id=current_user.id,
                    notes=f"{movement_note}: {event.name}",
                ))
                stock_skus_to_sync.add(sku)

            all_target_skus = set(existing_rows_by_sku.keys()) | set(desired_remaining_by_sku.keys())
            for sku in all_target_skus:
                desired_remaining = desired_remaining_by_sku.get(sku, 0)
                existing_rows = existing_rows_by_sku.get(sku, [])
                current_remaining = sum(
                    max(0, row.quantity or 0) for row in existing_rows
                )
                move_warehouse_stock(sku, desired_remaining - current_remaining)

                if desired_remaining > 0:
                    if existing_rows:
                        primary = existing_rows[0]
                        primary.quantity = desired_remaining
                        for duplicate_row in existing_rows[1:]:
                            db.delete(duplicate_row)
                    else:
                        db.add(models.MarketEventAllocation(
                            event_id=event.id,
                            sku=sku,
                            quantity=desired_remaining,
                            wasted_quantity=0,
                            waste_reason="",
                        ))
                else:
                    if sold_by_sku.get(sku, 0) > 0:
                        if existing_rows:
                            primary = existing_rows[0]
                            primary.quantity = 0
                            for duplicate_row in existing_rows[1:]:
                                db.delete(duplicate_row)
                    else:
                        for row in existing_rows:
                            db.delete(row)



            # Historical Active edits deleted fully sold allocation rows.
            # Recreate those audit anchors at zero without moving stock.
            remaining_allocation_skus = {
                allocation.sku for allocation in event.allocations
            }
            for sold_sku in sorted(sold_by_sku):
                if sold_sku not in remaining_allocation_skus:
                    event.allocations.append(models.MarketEventAllocation(
                        event_id=event.id,
                        sku=sold_sku,
                        quantity=0,
                    ))

        elif allocations is not None:
            replacement_totals = defaultdict(int)
            reserved_map = get_reserved_quantities(db, exclude_event_id=event.id)
            existing_draft_quantity_by_sku = defaultdict(int)
            for existing_allocation in event.allocations:
                existing_draft_quantity_by_sku[existing_allocation.sku] += max(
                    0,
                    int(existing_allocation.quantity or 0),
                )
            for alloc in allocations:
                if (
                    "quantity" not in alloc
                    or alloc.get("quantity") is None
                    or "remaining_quantity" in alloc
                ):
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            "Draft allocation edits require quantity and must "
                            "not send remaining_quantity."
                        ),
                    )
                raw_sku = (alloc.get("sku") if isinstance(alloc, dict) else getattr(alloc, "sku", "")) or ""
                raw_sku = raw_sku.strip()
                qty = int((alloc.get("quantity") if isinstance(alloc, dict) else getattr(alloc, "quantity", 0)) or 0)
                if not raw_sku:
                    continue
                product = db.query(models.ProductSKU).filter(models.ProductSKU.sku == raw_sku).first()
                if not product:
                    product = db.query(models.ProductSKU).filter(func.lower(models.ProductSKU.sku) == raw_sku.lower()).first()
                    if not product:
                        raise HTTPException(status_code=404, detail=f"Product SKU '{raw_sku}' not found in catalog.")
                existing_quantity = existing_draft_quantity_by_sku.get(product.sku, 0)
                if not product.is_active and qty > existing_quantity:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Product SKU '{product.sku}' is inactive and cannot "
                            "receive a new or larger reservation. Existing Draft "
                            "stock may only be retained or reduced."
                        ),
                    )
                available = (product.warehouse_stock or 0) - reserved_map.get(product.sku, 0)
                if product.is_active and qty > available:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Cannot allocate {qty} units of SKU {product.sku}. Available stock (excluding other Draft reservations) is {available}."
                    )
                replacement_totals[product.sku] += qty

            existing_allocs_by_sku = {}
            for alloc in event.allocations:
                existing_allocs_by_sku[alloc.sku] = alloc
                existing_allocs_by_sku[alloc.sku.strip().lower()] = alloc

            replacement_lowers = {k.strip().lower() for k in replacement_totals}
            for alloc in list(event.allocations):
                if alloc.sku not in replacement_totals and alloc.sku.strip().lower() not in replacement_lowers:
                    event.allocations.remove(alloc)

            for sku in sorted(replacement_totals):
                norm_sku = sku.strip().lower()
                existing_alloc = existing_allocs_by_sku.get(sku) or existing_allocs_by_sku.get(norm_sku)
                if existing_alloc:
                    existing_alloc.sku = sku
                    existing_alloc.quantity = replacement_totals[sku]
                else:
                    event.allocations.append(models.MarketEventAllocation(
                        event_id=event.id,
                        sku=sku,
                        quantity=replacement_totals[sku],
                    ))

        if old_status != new_status:
            allocation_totals = defaultdict(int)
            for alloc in event.allocations:
                if old_status == "Draft" and new_status == "Active" and alloc.quantity <= 0:
                    raise HTTPException(
                        status_code=422,
                        detail="Market Event allocations must use positive quantities.",
                    )
                allocation_totals[alloc.sku] += alloc.quantity

            # Dispatch all event stock in one transaction. Conditional updates
            # prevent two activations from consuming the same warehouse units.
            if old_status == "Draft" and new_status == "Active":
                if not allocation_totals:
                    raise HTTPException(
                        status_code=422,
                        detail="At least one allocation is required to activate a Market Event.",
                    )

                for sku in sorted(allocation_totals):
                    requested_quantity = allocation_totals[sku]
                    result = db.execute(
                        update(models.ProductSKU)
                        .where(
                            models.ProductSKU.sku == sku,
                            func.coalesce(models.ProductSKU.warehouse_stock, 0) >= requested_quantity,
                        )
                        .values(
                            warehouse_stock=func.coalesce(models.ProductSKU.warehouse_stock, 0)
                            - requested_quantity
                        )
                        .execution_options(synchronize_session=False)
                    )
                    if result.rowcount != 1:
                        db.rollback()
                        product = db.query(models.ProductSKU).filter(models.ProductSKU.sku == sku).first()
                        if not product:
                            raise HTTPException(status_code=404, detail=f"Product SKU {sku} not found")
                        raise HTTPException(
                            status_code=409,
                            detail=(
                                f"Insufficient warehouse stock for SKU {sku}. "
                                f"Available: {product.warehouse_stock or 0}, "
                                f"Requested: {requested_quantity}."
                            ),
                        )

                    db.add(models.InventoryTransaction(
                        sku=sku,
                        transaction_type="manual_adjustment",
                        qty=float(-requested_quantity),
                        user_id=current_user.id,
                        notes=f"Stock allocated and dispatched to Active Market Event: {event.name}",
                    ))
                    stock_skus_to_sync.add(sku)

            # Draft -> Cancelled: no stock was ever deducted, nothing to restore.
            elif old_status == "Draft" and new_status == "Cancelled":
                pass  # reservations are logical only; warehouse stock is unchanged

            # Sale checkout already decrements allocation.quantity. Closeout
            # returns the remaining booth balance less declared waste exactly
            # once; subtracting historical sold units here would double-count.
            elif old_status == "Active" and new_status in ["Completed", "Cancelled"]:
                for alloc in event.allocations:
                    sku = alloc.sku
                    remaining_booth_quantity = alloc.quantity
                    wasted_qty = alloc.wasted_quantity or 0
                    returned_quantity = max(
                        0,
                        remaining_booth_quantity - wasted_qty,
                    )

                    result = db.execute(
                        update(models.ProductSKU)
                        .where(models.ProductSKU.sku == sku)
                        .values(
                            warehouse_stock=func.coalesce(models.ProductSKU.warehouse_stock, 0)
                            + returned_quantity
                        )
                        .execution_options(synchronize_session=False)
                    )
                    if result.rowcount != 1:
                        raise HTTPException(status_code=404, detail=f"Product SKU {sku} not found")

                    # A zero-return row is not a stock movement. Omitting it
                    # keeps the inventory ledger meaningful while the
                    # idempotency marker remains a separate internal type.
                    if returned_quantity > 0:
                        db.add(models.InventoryTransaction(
                            sku=sku,
                            transaction_type="manual_adjustment",
                            qty=float(returned_quantity),
                            user_id=current_user.id,
                            notes=f"Unsold stock returned from closed Market Event: {event.name}",
                        ))

                    # Log waste transaction if any
                    if wasted_qty > 0:
                        db.add(models.InventoryTransaction(
                            sku=sku,
                            transaction_type="waste",
                            qty=float(-wasted_qty),
                            user_id=current_user.id,
                            notes=f"Waste logged during closeout of Market Event: {event.name}. Reason: {alloc.waste_reason or 'unspecified'}",
                        ))

                    stock_skus_to_sync.add(sku)

        if stock_skus_to_sync:
            from ..database import sync_warehouse_stock_for_main_facility
            db.flush()
            # Raw SQL UPDATEs with synchronize_session=False leave stale
            # ProductSKU objects in the identity map.  Expire only those
            # specific products so the sync helper re-reads the actual
            # warehouse_stock from the database, without invalidating
            # the event / allocation objects we still need.
            for sku in stock_skus_to_sync:
                stale_prod = db.query(models.ProductSKU).filter(
                    models.ProductSKU.sku == sku
                ).first()
                if stale_prod is not None:
                    db.expire(stale_prod)
            for sku in sorted(stock_skus_to_sync):
                sync_warehouse_stock_for_main_facility(db, sku=sku)

        db.commit()
        db.refresh(event)
        return compute_event_stats(event, db, current_user.role == "owner")
    except HTTPException:
        db.rollback()
        raise
    except Exception as err:
        db.rollback()
        tb = traceback.format_exc()
        logger.error("Unhandled error updating Market Event %s: %s\n%s", event_id, err, tb)
        raise HTTPException(
            status_code=500,
            detail=f"Server error while updating Market Event: {type(err).__name__}: {err}",
        )

@router.delete("/{event_id}", dependencies=[Depends(auth.require_owner)])
def delete_market_event(event_id: int, db: Session = Depends(get_db)):
    event = db.query(models.MarketEvent).filter(
        models.MarketEvent.id == event_id
    ).with_for_update().first()
    if not event:
        raise HTTPException(status_code=404, detail="Market Event not found")
    if event.status == "Active":
        raise HTTPException(
            status_code=409,
            detail="Active Market Events cannot be deleted directly while live stock is checked out. Close or cancel the event through reconciliation first.",
        )

    event.is_deleted = True
    db.commit()
    return {"detail": "Market Event soft deleted successfully"}


# ----------------------------------------------------
# MARKET EVENTS ACTIVE SALES MODE ENDPOINTS (PHASE 2)
# ----------------------------------------------------

def _market_sale_marker_reference(event_id: int, client_reference: str) -> str:
    digest = hashlib.sha256(client_reference.encode("utf-8")).hexdigest()[:48]
    return f"{models.MARKET_SALE_IDEMPOTENCY_PREFIX}{event_id}:{digest}"


def _format_market_event_sale(
    sale: models.MarketEventSale,
    db: Session,
) -> schemas.MarketEventSaleOut:
    items_out = []
    for item in sale.items:
        product = db.query(models.ProductSKU).filter(
            models.ProductSKU.sku == item.sku
        ).first()
        items_out.append(schemas.MarketEventSaleItemOut(
            id=item.id,
            sku=item.sku,
            quantity=item.quantity,
            product_name=product.product_name if product else item.sku,
            size=product.size if product else "",
            price_snapshot=item.price_snapshot,
        ))

    return schemas.MarketEventSaleOut(
        id=sale.id,
        event_id=sale.event_id,
        cashier_username=sale.cashier.username if sale.cashier else "System",
        payment_method=sale.payment_method,
        subtotal_amount=sale.subtotal_amount or Decimal("0.00"),
        discount_type=sale.discount_type,
        discount_value=sale.discount_value,
        manual_discount_amount=sale.manual_discount_amount or Decimal("0.00"),
        promotion_code=sale.promotion_code,
        promotion_discount_amount=(
            sale.promotion_discount_amount or Decimal("0.00")
        ),
        promotion_snapshot=sale.promotion_snapshot,
        discount_amount=sale.discount_amount or Decimal("0.00"),
        total_amount=sale.total_amount,
        cash_received=sale.cash_received,
        change_given=sale.change_given or Decimal("0.00"),
        tip_amount=sale.tip_amount or Decimal("0.00"),
        payment_reference=sale.payment_reference,
        customer_name=sale.customer_name,
        is_collected=_is_collected_sale(sale),
        timestamp=sale.timestamp,
        items=items_out,
        is_preorder=sale.is_preorder or False,
        preorder_customer_name=sale.preorder_customer_name,
        preorder_payment_status=sale.preorder_payment_status,
        preorder_fulfillment_status=sale.preorder_fulfillment_status,
    )


@router.post("/{event_id}/sales", response_model=schemas.MarketEventSaleOut)
def record_market_event_sale(
    event_id: int,
    payload: schemas.MarketEventSaleCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    requested_by_sku = defaultdict(int)
    for item in payload.items:
        requested_by_sku[item.sku] += item.quantity

    try:
        # PostgreSQL serializes all checkouts for one event on this row. SQLite
        # ignores FOR UPDATE, while retaining the same sequential semantics in
        # local/test use.
        event = db.query(models.MarketEvent).filter(
            models.MarketEvent.id == event_id,
            models.MarketEvent.is_deleted == False,
        ).with_for_update().first()
        if not event:
            raise HTTPException(status_code=404, detail="Market Event not found")

        _require_cashier_safe_event_access(event, current_user)

        existing_sale = db.query(models.MarketEventSale).filter(
            models.MarketEventSale.event_id == event_id,
            models.MarketEventSale.client_reference == payload.client_reference,
        ).first()
        if existing_sale:
            output = _format_market_event_sale(existing_sale, db)
            db.rollback()
            return output

        marker_reference = _market_sale_marker_reference(
            event_id,
            payload.client_reference,
        )
        marker = db.query(models.InventoryTransaction).filter(
            models.InventoryTransaction.transaction_type
            == models.MARKET_SALE_IDEMPOTENCY_TRANSACTION_TYPE,
            models.InventoryTransaction.batch_reference == marker_reference,
        ).first()
        if marker:
            try:
                original_sale_id = int(marker.notes or "")
            except ValueError:
                original_sale_id = 0
            original_sale = db.query(models.MarketEventSale).filter(
                models.MarketEventSale.id == original_sale_id,
                models.MarketEventSale.event_id == event_id,
            ).first()
            if original_sale:
                output = _format_market_event_sale(original_sale, db)
                db.rollback()
                return output

            # A manually orphaned marker must not permanently block checkout.
            db.delete(marker)
            db.flush()

        if event.status != "Active":
            raise HTTPException(status_code=400, detail="Cannot record sales for a non-active market event.")

        # Price and validate the entire receipt before any stock mutation.
        products_by_sku: Dict[str, models.ProductSKU] = {}
        sale_items = []
        subtotal_amount = Decimal("0.00")
        for sku in sorted(requested_by_sku):
            product = db.query(models.ProductSKU).filter(
                models.ProductSKU.sku == sku
            ).first()
            if not product:
                raise HTTPException(
                    status_code=404,
                    detail=f"Product SKU {sku} not found",
                )
            products_by_sku[sku] = product
            price = _money(product.retail_price)
            requested_quantity = requested_by_sku[sku]
            sale_items.append({
                "sku": sku,
                "quantity": requested_quantity,
                "price_snapshot": price,
            })
            subtotal_amount += Decimal(requested_quantity) * price
        subtotal_amount = subtotal_amount.quantize(
            _MONEY_QUANTUM,
            rounding=ROUND_HALF_UP,
        )
        cost_snapshots = build_unit_cost_snapshots(
            db,
            products_by_sku.values(),
        )
        for sale_item in sale_items:
            snapshot = cost_snapshots[sale_item["sku"]]
            sale_item.update({
                "food_cost_snapshot": snapshot.food_cost,
                "labor_cost_snapshot": snapshot.labor_cost,
                "utility_cost_snapshot": snapshot.utility_cost,
                "total_cost_snapshot": snapshot.total_cost,
                "cost_status_snapshot": snapshot.status,
            })

        if (
            payload.expected_subtotal is not None
            and _money(payload.expected_subtotal) != subtotal_amount
        ):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "SALE_SUBTOTAL_MISMATCH",
                    "expected_subtotal": f"{_money(payload.expected_subtotal):.2f}",
                    "current_subtotal": f"{subtotal_amount:.2f}",
                },
            )

        canonical_payment_method = _canonical_payment_method(
            payload.payment_method
        )
        if canonical_payment_method == "Mixed":
            raise HTTPException(
                status_code=422,
                detail=(
                    "Mixed payments require an explicit per-tender breakdown "
                    "and are not currently supported."
                ),
            )

        promotion_discount_amount, promotion_snapshot = _promotion_discount(
            payload.promotion_code,
            requested_by_sku,
            products_by_sku,
        )
        remaining_after_promotion = max(
            Decimal("0.00"),
            subtotal_amount - promotion_discount_amount,
        )
        manual_discount_amount = Decimal("0.00")
        if payload.discount_type == "PERCENTAGE":
            manual_discount_amount = (
                remaining_after_promotion
                * _money(payload.discount_value)
                / Decimal("100")
            ).quantize(_MONEY_QUANTUM, rounding=ROUND_HALF_UP)
        elif payload.discount_type == "FIXED":
            manual_discount_amount = min(
                remaining_after_promotion,
                _money(payload.discount_value),
            )

        persisted_promotion_code = payload.promotion_code
        discount_amount = min(
            subtotal_amount,
            promotion_discount_amount + manual_discount_amount,
        ).quantize(_MONEY_QUANTUM, rounding=ROUND_HALF_UP)
        total_amount = (subtotal_amount - discount_amount).quantize(
            _MONEY_QUANTUM,
            rounding=ROUND_HALF_UP,
        )
        tip_amount = _money(payload.tip_amount)
        customer_name = (
            (payload.customer_name or "").strip()
            or (payload.preorder_customer_name or "").strip()
            or None
        )

        if canonical_payment_method == "Complimentary / Gift":
            if (
                payload.promotion_code is not None
                or payload.discount_type is not None
                or payload.cash_received is not None
                or tip_amount > 0
            ):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "Complimentary sales cannot combine promotions, manual "
                        "discounts, cash tender, or tips."
                    ),
                )
            persisted_promotion_code = "COMPLIMENTARY"
            promotion_discount_amount = subtotal_amount
            promotion_snapshot = json.dumps(
                {
                    "code": "COMPLIMENTARY",
                    "rule": "full_subtotal_waived",
                },
                sort_keys=True,
                separators=(",", ":"),
            )
            manual_discount_amount = Decimal("0.00")
            discount_amount = subtotal_amount
            total_amount = Decimal("0.00")

        if canonical_payment_method == "Pautang":
            if not customer_name:
                raise HTTPException(
                    status_code=422,
                    detail="customer_name is required for Pautang sales.",
                )
            if payload.cash_received is not None or tip_amount > 0:
                raise HTTPException(
                    status_code=422,
                    detail="Pautang cannot record collected cash or tips.",
                )

        collected_payment = (
            canonical_payment_method
            not in {"Complimentary / Gift", "Pautang"}
            and (not payload.is_preorder or payload.preorder_payment_status == "Paid")
        )
        if not collected_payment and tip_amount > 0:
            raise HTTPException(
                status_code=422,
                detail="Tips cannot be recorded on an uncollected sale.",
            )

        cash_received = None
        change_given = Decimal("0.00")
        if canonical_payment_method == "Cash" and collected_payment:
            if payload.cash_received is None:
                raise HTTPException(
                    status_code=422,
                    detail="Cash received is required for a collected cash sale.",
                )
            cash_received = _money(payload.cash_received)
            required_amount = total_amount + tip_amount
            if cash_received < required_amount:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Cash received is insufficient. Required: {required_amount:.2f}; "
                        f"received: {cash_received:.2f}."
                    ),
                )
            change_given = (cash_received - required_amount).quantize(
                _MONEY_QUANTUM,
                rounding=ROUND_HALF_UP,
            )
        elif canonical_payment_method == "Cash" and payload.cash_received is not None:
            raise HTTPException(
                status_code=422,
                detail="cash_received cannot be recorded on an uncollected sale.",
            )
        elif canonical_payment_method != "Cash" and payload.cash_received is not None:
            raise HTTPException(
                status_code=422,
                detail="cash_received is only valid for collected Cash sales.",
            )

        # Deduct each event allocation conditionally so concurrent or repeated
        # checkout attempts cannot oversell the stock reserved for the event.
        for sku in sorted(requested_by_sku):
            requested_quantity = requested_by_sku[sku]

            allocation_rows = db.query(models.MarketEventAllocation).filter(
                models.MarketEventAllocation.event_id == event_id,
                models.MarketEventAllocation.sku == sku,
            ).order_by(models.MarketEventAllocation.id.asc()).all()
            if not allocation_rows:
                raise HTTPException(
                    status_code=409,
                    detail=f"SKU {sku} is not allocated to this Market Event.",
                )

            remaining_quantity = requested_quantity
            allocation_conflict = False
            for allocation in allocation_rows:
                if remaining_quantity == 0:
                    break
                deduction = min(allocation.quantity, remaining_quantity)
                if deduction <= 0:
                    continue
                result = db.execute(
                    update(models.MarketEventAllocation)
                    .where(
                        models.MarketEventAllocation.id == allocation.id,
                        models.MarketEventAllocation.quantity >= deduction,
                    )
                    .values(
                        quantity=models.MarketEventAllocation.quantity - deduction
                    )
                    .execution_options(synchronize_session=False)
                )
                if result.rowcount != 1:
                    allocation_conflict = True
                    break
                remaining_quantity -= deduction

            if allocation_conflict or remaining_quantity > 0:
                db.rollback()
                available_quantity = db.query(
                    func.coalesce(func.sum(models.MarketEventAllocation.quantity), 0)
                ).filter(
                    models.MarketEventAllocation.event_id == event_id,
                    models.MarketEventAllocation.sku == sku,
                ).scalar()
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Insufficient Market Event stock for SKU {sku}. "
                        f"Available: {available_quantity}, Requested: {requested_quantity}."
                    ),
                )

        sale = models.MarketEventSale(
            event_id=event_id,
            cashier_id=current_user.id,
            client_reference=payload.client_reference,
            payment_method=canonical_payment_method,
            subtotal_amount=subtotal_amount,
            discount_type=payload.discount_type,
            discount_value=(
                _money(payload.discount_value)
                if payload.discount_value is not None
                else None
            ),
            manual_discount_amount=manual_discount_amount,
            promotion_code=persisted_promotion_code,
            promotion_discount_amount=promotion_discount_amount,
            promotion_snapshot=promotion_snapshot,
            discount_amount=discount_amount,
            total_amount=total_amount,
            cash_received=cash_received,
            change_given=change_given,
            tip_amount=tip_amount,
            payment_reference=(payload.payment_reference or "").strip() or None,
            customer_name=customer_name,
            is_preorder=payload.is_preorder or False,
            preorder_customer_name=payload.preorder_customer_name,
            preorder_payment_status=payload.preorder_payment_status,
            preorder_fulfillment_status=payload.preorder_fulfillment_status,
        )
        db.add(sale)
        db.flush()

        db.add(models.InventoryTransaction(
            user_id=current_user.id,
            transaction_type=models.MARKET_SALE_IDEMPOTENCY_TRANSACTION_TYPE,
            qty=0.0,
            batch_reference=marker_reference,
            notes=str(sale.id),
        ))

        for item in sale_items:
            db.add(models.MarketEventSaleItem(
                sale_id=sale.id,
                sku=item["sku"],
                quantity=item["quantity"],
                price_snapshot=item["price_snapshot"],
                food_cost_snapshot=item["food_cost_snapshot"],
                labor_cost_snapshot=item["labor_cost_snapshot"],
                utility_cost_snapshot=item["utility_cost_snapshot"],
                total_cost_snapshot=item["total_cost_snapshot"],
                cost_status_snapshot=item["cost_status_snapshot"],
            ))

        db.commit()
        db.refresh(sale)
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    return _format_market_event_sale(sale, db)

@router.get(
    "/{event_id}/sales",
    response_model=List[schemas.MarketEventSaleOut],
)
def get_market_event_sales(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    event = db.query(models.MarketEvent).filter(
        models.MarketEvent.id == event_id,
        models.MarketEvent.is_deleted == False,
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Market Event not found")
    _require_cashier_safe_event_access(event, current_user)

    sales = db.query(models.MarketEventSale).filter(
        models.MarketEventSale.event_id == event_id
    ).order_by(models.MarketEventSale.timestamp.desc()).all()
    return [_format_market_event_sale(sale, db) for sale in sales]

@router.delete(
    "/{event_id}/sales/{sale_id}/undo",
    dependencies=[Depends(auth.require_owner)],
)
def undo_market_event_sale(event_id: int, sale_id: int, db: Session = Depends(get_db)):
    try:
        event = db.query(models.MarketEvent).filter(
            models.MarketEvent.id == event_id
        ).with_for_update().first()
        if not event:
            raise HTTPException(status_code=404, detail="Market Event not found")
        if event.status != "Active":
            raise HTTPException(
                status_code=409,
                detail="Sales can only be undone while the Market Event is Active.",
            )

        sale = db.query(models.MarketEventSale).filter(
            models.MarketEventSale.id == sale_id,
            models.MarketEventSale.event_id == event_id,
        ).with_for_update().first()
        if not sale:
            raise HTTPException(status_code=404, detail="Sale transaction not found")

        restored_by_sku = defaultdict(int)
        for item in sale.items:
            restored_by_sku[item.sku] += item.quantity

        for sku in sorted(restored_by_sku):
            allocation = db.query(models.MarketEventAllocation).filter(
                models.MarketEventAllocation.event_id == event_id,
                models.MarketEventAllocation.sku == sku,
            ).order_by(models.MarketEventAllocation.id.asc()).first()
            if not allocation:
                raise HTTPException(
                    status_code=409,
                    detail=f"Cannot restore SKU {sku}; its Market Event allocation no longer exists.",
                )

            db.execute(
                update(models.MarketEventAllocation)
                .where(models.MarketEventAllocation.id == allocation.id)
                .values(
                    quantity=models.MarketEventAllocation.quantity + restored_by_sku[sku]
                )
                .execution_options(synchronize_session=False)
            )

        db.query(models.InventoryTransaction).filter(
            models.InventoryTransaction.transaction_type
            == models.MARKET_SALE_IDEMPOTENCY_TRANSACTION_TYPE,
            models.InventoryTransaction.batch_reference.like(
                f"{models.MARKET_SALE_IDEMPOTENCY_PREFIX}{event_id}:%"
            ),
            models.InventoryTransaction.notes == str(sale_id),
        ).delete(synchronize_session=False)
        db.delete(sale)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    return {"detail": "Sale transaction successfully reverted and allocations restored."}

@router.put("/{event_id}/sales/{sale_id}/preorder", response_model=schemas.MarketEventSaleOut)
def update_market_event_preorder(
    event_id: int,
    sale_id: int,
    payload: schemas.MarketEventSaleUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    event = db.query(models.MarketEvent).filter(
        models.MarketEvent.id == event_id,
        models.MarketEvent.is_deleted == False,
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Market Event not found")
    _require_cashier_safe_event_access(event, current_user)

    sale = db.query(models.MarketEventSale).filter(
        models.MarketEventSale.id == sale_id,
        models.MarketEventSale.event_id == event_id
    ).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Preorder transaction not found")
        
    changes = payload.model_dump(exclude_unset=True)
    if "payment_method" in changes:
        requested_method = _canonical_payment_method(changes["payment_method"])
        existing_method = _canonical_payment_method(sale.payment_method)
        if requested_method != existing_method:
            raise HTTPException(
                status_code=409,
                detail=(
                    "A recorded sale's payment method is immutable. Undo the "
                    "Active-event sale and record a corrected receipt instead."
                ),
            )
        changes["payment_method"] = existing_method
    for key, value in changes.items():
        setattr(sale, key, value)
        
    db.commit()
    db.refresh(sale)
    return _format_market_event_sale(sale, db)
