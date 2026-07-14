from fastapi import APIRouter, Depends, HTTPException
import os
from sqlalchemy import func, update
from sqlalchemy.orm import Session, joinedload
from typing import List, Dict
from collections import defaultdict
import hashlib
import math
from ..database import get_db
from .. import models, schemas, auth
from .costing import has_valid_unit_cost

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
        total_revenue += sale.total_amount
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
            hourly_distribution[hour] = hourly_distribution.get(hour, 0.0) + sale.total_amount

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
                weekend_sales += sale.total_amount
            else:
                weekday_sales += sale.total_amount

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
        ev_rev = sum(s.total_amount for s in ev_sales)
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

def compute_event_stats(
    event: models.MarketEvent,
    db: Session,
    include_financials: bool = True,
) -> schemas.MarketEventOut:
    allocations_out = []
    
    # Calculate sold quantities and actual sales revenue per SKU for this event
    sold_qtys = {}
    actual_sales_revenue = 0.0
    
    sales = db.query(models.MarketEventSale).filter(models.MarketEventSale.event_id == event.id).all()
    for sale in sales:
        actual_sales_revenue += sale.total_amount
        for item in sale.items:
            sold_qtys[item.sku] = sold_qtys.get(item.sku, 0) + item.quantity
            
    estimated_revenue = 0.0
    estimated_cost = 0.0
    costing_complete = True
    
    # Check if there are any actual sales recorded yet
    has_sales = len(sales) > 0

    if has_sales:
        # 1. Active/Completed closeout metrics (based on actual sold quantities)
        estimated_revenue = actual_sales_revenue
        
        for alloc in event.allocations:
            product = db.query(models.ProductSKU).filter(models.ProductSKU.sku == alloc.sku).first()
            prod_name = product.product_name if product else alloc.sku
            size = product.size if product else ""
            current_stock = product.warehouse_stock if product else 0
            retail_price = product.retail_price if product else 0.0
            cost_per_unit = product.cost_per_unit if product else 0.0
            
            sold_qty = sold_qtys.get(alloc.sku, 0)
            if sold_qty > 0 and not has_valid_unit_cost(cost_per_unit, retail_price):
                costing_complete = False
            estimated_cost += sold_qty * cost_per_unit
            
            allocations_out.append(schemas.MarketEventAllocationOut(
                id=alloc.id,
                sku=alloc.sku,
                quantity=alloc.quantity, # keeps remaining quantity count for inventory return audits
                product_name=prod_name,
                size=size,
                current_stock=current_stock,
                retail_price=retail_price,
                cost_per_unit=cost_per_unit if include_financials else None,
                wasted_quantity=alloc.wasted_quantity or 0,
                waste_reason=alloc.waste_reason or ""
            ))
    else:
        # 2. Draft/Blank Active forecast metrics (based on potential dispatch quantities)
        for alloc in event.allocations:
            product = db.query(models.ProductSKU).filter(models.ProductSKU.sku == alloc.sku).first()
            prod_name = product.product_name if product else alloc.sku
            size = product.size if product else ""
            current_stock = product.warehouse_stock if product else 0
            retail_price = product.retail_price if product else 0.0
            cost_per_unit = product.cost_per_unit if product else 0.0
            if alloc.quantity > 0 and not has_valid_unit_cost(cost_per_unit, retail_price):
                costing_complete = False
            
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
                wasted_quantity=alloc.wasted_quantity or 0,
                waste_reason=alloc.waste_reason or ""
            ))

    potential_profit = estimated_revenue - estimated_cost

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
        estimated_revenue=round(estimated_revenue, 2),
        estimated_cost=round(estimated_cost, 2) if include_financials else None,
        potential_profit=round(potential_profit, 2) if include_financials else None,
        metrics_basis="actual" if has_sales else "forecast",
        costing_complete=costing_complete if include_financials else False,
        financials_visible=include_financials,
        initial_cash_balance=event.initial_cash_balance,
        actual_closing_cash=event.actual_closing_cash,
        cash_adjustments=event.cash_adjustments,
        cash_adjustments_notes=event.cash_adjustments_notes,
        total_expenses=event.total_expenses,
        expense_notes=event.expense_notes,
    )

@router.get("", response_model=List[schemas.MarketEventOut])
def get_all_market_events(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    events = db.query(models.MarketEvent).filter(models.MarketEvent.is_deleted == False).order_by(models.MarketEvent.event_date.desc()).all()
    include_financials = current_user.role == "owner"
    return [compute_event_stats(e, db, include_financials) for e in events]

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
    return compute_event_stats(event, db, current_user.role == "owner")

@router.post("", response_model=schemas.MarketEventOut)
def create_market_event(
    payload: schemas.MarketEventCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    import os
    DEMO_MODE = (os.getenv("DEMO_MODE") == "true") or (os.getenv("ENVIRONMENT") == "demo")
    if DEMO_MODE:
        if db.query(models.MarketEvent).count() >= 100:
            raise HTTPException(
                status_code=400,
                detail="Sandbox table limit reached. In Public Demo Sandbox, the number of market events is capped at 100. Please reset the database."
            )
        for alloc in payload.allocations:
            if alloc.quantity > 100:
                raise HTTPException(
                    status_code=400,
                    detail="Quantity limit exceeded. In Public Demo Sandbox, market allocation quantity is capped at 100 per SKU."
                )

    event = models.MarketEvent(
        name=payload.name,
        event_date=payload.event_date,
        location=payload.location,
        staff_assigned=payload.staff_assigned,
        notes=payload.notes,
        status=payload.status or "Draft",
        is_deleted=False,
        initial_cash_balance=payload.initial_cash_balance or 0.0,
        actual_closing_cash=payload.actual_closing_cash,
        cash_adjustments=payload.cash_adjustments or 0.0,
        cash_adjustments_notes=payload.cash_adjustments_notes or ""
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

    old_status = event.status
    update_data = payload.model_dump(exclude_unset=True)
    allocations = update_data.pop("allocations", None)
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
    if allocations is not None and old_status != "Draft":
        if not (old_status == "Active" and new_status == "Completed"):
            raise HTTPException(
                status_code=409,
                detail="Inventory allocations cannot be edited after a Market Event is activated.",
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
                if db_alloc:
                    db_alloc.wasted_quantity = alloc_data.get("wasted_quantity", 0)
                    db_alloc.waste_reason = alloc_data.get("waste_reason", "")

        elif allocations is not None:
            replacement_totals = defaultdict(int)
            for alloc in allocations:
                replacement_totals[alloc["sku"]] += alloc["quantity"]

            # Validate: only active products; qty <= available_stock (excluding this event's own reservation)
            reserved_map = get_reserved_quantities(db, exclude_event_id=event.id)
            for sku, qty in replacement_totals.items():
                product = db.query(models.ProductSKU).filter(models.ProductSKU.sku == sku).first()
                if not product:
                    raise HTTPException(status_code=404, detail=f"Product SKU {sku} not found")
                if not product.is_active:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Product SKU {sku} is inactive and cannot be allocated."
                    )
                available = (product.warehouse_stock or 0) - reserved_map.get(sku, 0)
                if qty > available:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Cannot allocate {qty} units of SKU {sku}. Available stock (excluding other Draft reservations) is {available}."
                    )

            event.allocations.clear()
            for sku in sorted(replacement_totals):
                event.allocations.append(models.MarketEventAllocation(
                    event_id=event.id,
                    sku=sku,
                    quantity=replacement_totals[sku],
                ))

        if old_status != new_status:
            allocation_totals = defaultdict(int)
            for alloc in event.allocations:
                if alloc.quantity <= 0:
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

            # Return only the event's unsold allocation when it closes (deducting wasted stock).
            elif old_status == "Active" and new_status in ["Completed", "Cancelled"]:
                for alloc in event.allocations:
                    sku = alloc.sku
                    remaining_qty = alloc.quantity
                    wasted_qty = alloc.wasted_quantity or 0
                    returned_quantity = max(0, remaining_qty - wasted_qty)

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

                    # Log return transaction
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
            db.expire_all()
            for sku in sorted(stock_skus_to_sync):
                sync_warehouse_stock_for_main_facility(db, sku=sku)

        db.commit()
        db.refresh(event)
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    return compute_event_stats(event, db, current_user.role == "owner")

@router.delete("/{event_id}", dependencies=[Depends(auth.get_current_user)])
def delete_market_event(event_id: int, db: Session = Depends(get_db)):
    event = db.query(models.MarketEvent).filter(
        models.MarketEvent.id == event_id
    ).with_for_update().first()
    if not event:
        raise HTTPException(status_code=404, detail="Market Event not found")
    if event.status not in {"Draft", "Cancelled"}:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Only Draft or Cancelled Market Events can be deleted.",
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
        total_amount=sale.total_amount,
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
    DEMO_MODE = (os.getenv("DEMO_MODE") == "true") or (os.getenv("ENVIRONMENT") == "demo")
    if DEMO_MODE:
        for item in payload.items:
            if item.quantity > 50:
                raise HTTPException(
                    status_code=400,
                    detail="Quantity limit exceeded. In Public Demo Sandbox, market sales are capped at 50 per item to prevent abuse."
                )

    requested_by_sku = defaultdict(int)
    for item in payload.items:
        requested_by_sku[item.sku] += item.quantity

    sale_items = []
    total_amount = 0.0

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

        # Deduct each event allocation conditionally so concurrent or repeated
        # checkout attempts cannot oversell the stock reserved for the event.
        for sku in sorted(requested_by_sku):
            requested_quantity = requested_by_sku[sku]
            product = db.query(models.ProductSKU).filter(models.ProductSKU.sku == sku).first()
            if not product:
                raise HTTPException(status_code=404, detail=f"Product SKU {sku} not found")

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

            price = product.retail_price
            sale_items.append({
                "sku": sku,
                "quantity": requested_quantity,
                "price_snapshot": price,
            })
            total_amount += requested_quantity * price

        sale = models.MarketEventSale(
            event_id=event_id,
            cashier_id=current_user.id,
            payment_method=payload.payment_method,
            total_amount=total_amount,
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
    dependencies=[Depends(auth.get_current_user)],
)
def get_market_event_sales(event_id: int, db: Session = Depends(get_db)):
    sales = db.query(models.MarketEventSale).filter(models.MarketEventSale.event_id == event_id).order_by(models.MarketEventSale.timestamp.desc()).all()
    
    result = []
    for sale in sales:
        items_out = []
        for it in sale.items:
            prod = db.query(models.ProductSKU).filter(models.ProductSKU.sku == it.sku).first()
            prod_name = prod.product_name if prod else it.sku
            size = prod.size if prod else ""
            items_out.append(schemas.MarketEventSaleItemOut(
                id=it.id,
                sku=it.sku,
                quantity=it.quantity,
                product_name=prod_name,
                size=size,
                price_snapshot=it.price_snapshot
            ))
            
        cashier_username = sale.cashier.username if sale.cashier else "System"
        
        result.append(schemas.MarketEventSaleOut(
            id=sale.id,
            event_id=sale.event_id,
            cashier_username=cashier_username,
            payment_method=sale.payment_method,
            total_amount=sale.total_amount,
            timestamp=sale.timestamp,
            items=items_out
        ))
    return result

@router.delete(
    "/{event_id}/sales/{sale_id}/undo",
    dependencies=[Depends(auth.get_current_user)],
)
def undo_market_event_sale(event_id: int, sale_id: int, db: Session = Depends(get_db)):
    try:
        event = db.query(models.MarketEvent).filter(
            models.MarketEvent.id == event_id
        ).with_for_update().first()
        if not event:
            raise HTTPException(status_code=404, detail="Market Event not found")

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
    sale = db.query(models.MarketEventSale).filter(
        models.MarketEventSale.id == sale_id,
        models.MarketEventSale.event_id == event_id
    ).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Preorder transaction not found")
        
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(sale, key, value)
        
    db.commit()
    db.refresh(sale)
    return _format_market_event_sale(sale, db)
