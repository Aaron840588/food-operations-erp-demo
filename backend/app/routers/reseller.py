from fastapi import APIRouter, Depends, HTTPException
import os
from sqlalchemy import func, update
from sqlalchemy.orm import Session, joinedload
from typing import List
from collections import defaultdict
from ..database import get_db
from .. import models, schemas, auth

router = APIRouter(prefix="/resellers", tags=["Reseller Orders"])

def get_discount_percentage(subtotal: float, db: Session) -> float:
    """
    Returns the tiered reseller discount percentage based on order subtotal
    queried dynamically from the database.
    """
    tiers = db.query(models.DiscountTier).order_by(models.DiscountTier.min_subtotal.asc()).all()
    if not tiers:
        # Fallback to hardcoded defaults if DB is empty
        if subtotal < 1300.0:
            return 10.0
        elif 1300.0 <= subtotal <= 1999.99:
            return 12.0
        elif 2000.0 <= subtotal <= 3499.99:
            return 15.0
        elif 3500.0 <= subtotal <= 6999.99:
            return 18.0
        else:
            return 22.0
            
    resolved_pct = 0.0
    for tier in tiers:
        if subtotal >= tier.min_subtotal:
            resolved_pct = tier.discount_percentage
        else:
            break
    return resolved_pct

@router.post("/orders", response_model=schemas.ResellerOrderOut)
def create_reseller_order(payload: schemas.ResellerOrderCreate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    """
    Creates a new reseller order.
    Calculates subtotals, determines tiered discounts automatically,
    deducts SKU stock from warehouse, and saves order to DB.
    """
    DEMO_MODE = (os.getenv("DEMO_MODE") == "true") or (os.getenv("ENVIRONMENT") == "demo")
    if DEMO_MODE:
        if db.query(models.ResellerOrder).count() >= 100:
            raise HTTPException(
                status_code=400,
                detail="Sandbox table limit reached. In Public Demo Sandbox, the number of reseller orders is capped at 100 to prevent database abuse. Please reset the database."
            )
        for item in payload.items:
            if item.quantity > 100:
                raise HTTPException(
                    status_code=400,
                    detail="Quantity limit exceeded. In Public Demo Sandbox, order quantity is capped at 100 per item to prevent abuse."
                )

    if payload.manual_discount_percentage is not None and current_user.role != "owner":
        raise HTTPException(
            status_code=403,
            detail="Only an owner can apply a manual wholesale discount.",
        )

    requested_by_sku = defaultdict(int)
    for item in payload.items:
        requested_by_sku[item.sku] += item.quantity

    items_to_create = []
    subtotal = 0.0

    try:
        # Conditional updates make the stock check and deduction one atomic
        # database operation. Sorting also keeps lock acquisition deterministic.
        for sku in sorted(requested_by_sku):
            requested_quantity = requested_by_sku[sku]
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

            product = db.query(models.ProductSKU).filter(models.ProductSKU.sku == sku).first()
            item_sub = requested_quantity * product.retail_price
            subtotal += item_sub
            items_to_create.append({
                "sku": sku,
                "quantity": requested_quantity,
                "price_snapshot": product.retail_price,
                "item_subtotal": item_sub,
            })

        # 2. Determine discount
        discount_pct = get_discount_percentage(subtotal, db)

        if payload.manual_discount_percentage is not None:
            discount_pct = payload.manual_discount_percentage

        discount_amt = subtotal * (discount_pct / 100.0)
        tax_rate = payload.tax_rate
        discounted_subtotal = subtotal - discount_amt
        grand_total = discounted_subtotal
        tax_amt = grand_total * tax_rate / (100.0 + tax_rate)

        # 3. Build the invoice and all related records in the same transaction.
        db_order = models.ResellerOrder(
            reseller_name=payload.reseller_name,
            order_date=payload.order_date,
            subtotal=subtotal,
            discount_percentage=discount_pct,
            discount_amount=discount_amt,
            tax_rate=tax_rate,
            tax_amount=tax_amt,
            grand_total=grand_total,
            is_paid=False,
            notes=payload.notes
        )
        db.add(db_order)
        db.flush()

        for item in items_to_create:
            db.add(models.ResellerOrderItem(
                order_id=db_order.id,
                sku=item["sku"],
                quantity=item["quantity"],
                price_snapshot=item["price_snapshot"],
            ))

            db.add(models.InventoryTransaction(
                sku=item["sku"],
                transaction_type="sales_deduct",
                qty=float(-item["quantity"]),
                user_id=current_user.id,
                batch_reference=f"RESELLER_ORDER-{db_order.id}",
                notes=f"Deducted for reseller sale to {payload.reseller_name} under invoice #{db_order.id}.",
            ))

            db.add(models.ProductionBatch(
                batch_date=payload.order_date,
                sku=item["sku"],
                qty_produced=0,
                qty_delivered=item["quantity"],
                notes=f"Reseller sale to {payload.reseller_name}",
            ))

        # Keep the warehouse module's stock mirror in the same transaction.
        from ..database import sync_warehouse_stock_for_main_facility
        for item in items_to_create:
            sync_warehouse_stock_for_main_facility(db, sku=item["sku"])

        db.commit()
        db.refresh(db_order)
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    # Trigger push alert
    try:
        from ..notifications import trigger_push_notifications
        trigger_push_notifications(
            title="New Reseller Order logged",
            body=f"Order logged for {payload.reseller_name} - Payout: ₱{grand_total:.2f}",
            db=db
        )
    except Exception as e:
        print(f"Failed to trigger reseller push notification: {e}")

    # 5. Return order details
    return get_reseller_order(db_order.id, db)

@router.get("/orders", response_model=List[schemas.ResellerOrderOut])
def get_all_reseller_orders(limit: int = 10, skip: int = 0, db: Session = Depends(get_db)):
    """
    Returns a list of all reseller orders.
    Optimized using joinedload to prevent N+1 database queries.
    """
    orders = db.query(models.ResellerOrder)\
               .options(joinedload(models.ResellerOrder.items).joinedload(models.ResellerOrderItem.product))\
               .order_by(models.ResellerOrder.order_date.desc())\
               .offset(skip)\
               .limit(limit)\
               .all()
    output = []
    
    for order in orders:
        items_out = []
        for item in order.items:
            product_name = item.product.product_name if item.product else item.sku
            size = item.product.size if item.product else ''
            
            items_out.append(schemas.ResellerOrderItemOut(
                id=item.id,
                sku=item.sku,
                product_name=product_name,
                size=size,
                quantity=item.quantity,
                price_snapshot=item.price_snapshot,
                item_subtotal=item.quantity * item.price_snapshot
            ))
            
        output.append(schemas.ResellerOrderOut(
            id=order.id,
            reseller_name=order.reseller_name,
            order_date=order.order_date,
            subtotal=order.subtotal,
            discount_percentage=order.discount_percentage,
            discount_amount=order.discount_amount,
            tax_rate=order.tax_rate if order.tax_rate is not None else 0.0,
            tax_amount=order.tax_amount if order.tax_amount is not None else 0.0,
            grand_total=order.grand_total,
            is_paid=order.is_paid,
            notes=order.notes,
            items=items_out
        ))
        
    return output

@router.get("/orders/{order_id}", response_model=schemas.ResellerOrderOut)
def get_reseller_order(order_id: int, db: Session = Depends(get_db)):
    """
    Returns specific reseller order invoice details.
    Optimized using joinedload to prevent N+1 database queries.
    """
    order = db.query(models.ResellerOrder)\
              .options(joinedload(models.ResellerOrder.items).joinedload(models.ResellerOrderItem.product))\
              .filter(models.ResellerOrder.id == order_id)\
              .first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
        
    items_out = []
    for item in order.items:
        product_name = item.product.product_name if item.product else item.sku
        size = item.product.size if item.product else ''
        
        items_out.append(schemas.ResellerOrderItemOut(
            id=item.id,
            sku=item.sku,
            product_name=product_name,
            size=size,
            quantity=item.quantity,
            price_snapshot=item.price_snapshot,
            item_subtotal=item.quantity * item.price_snapshot
        ))
        
    return schemas.ResellerOrderOut(
        id=order.id,
        reseller_name=order.reseller_name,
        order_date=order.order_date,
        subtotal=order.subtotal,
        discount_percentage=order.discount_percentage,
        discount_amount=order.discount_amount,
        tax_rate=order.tax_rate if order.tax_rate is not None else 0.0,
        tax_amount=order.tax_amount if order.tax_amount is not None else 0.0,
        grand_total=order.grand_total,
        is_paid=order.is_paid,
        notes=order.notes,
        items=items_out
    )

@router.post("/orders/{order_id}/pay", dependencies=[Depends(auth.get_current_user)])
def mark_reseller_order_paid(order_id: int, db: Session = Depends(get_db)):
    """
    Marks a reseller order as paid.
    """
    order = db.query(models.ResellerOrder).filter(models.ResellerOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
        
    order.is_paid = True
    db.commit()
    return {"message": f"Reseller order #{order_id} marked as PAID"}


# ----------------------------------------------------
# DISCOUNT TIERS CRUD ENDPOINTS (Owner-Only Updates)
# ----------------------------------------------------
@router.get("/discount-tiers", response_model=List[schemas.DiscountTierOut])
def get_all_discount_tiers(db: Session = Depends(get_db)):
    """
    Returns list of all active reseller discount tiers.
    """
    return db.query(models.DiscountTier).order_by(models.DiscountTier.min_subtotal.asc()).all()

@router.post("/discount-tiers", response_model=schemas.DiscountTierOut, dependencies=[Depends(auth.require_owner), Depends(auth.check_demo_mode)])
def create_discount_tier(payload: schemas.DiscountTierUpdate, db: Session = Depends(get_db)):
    """
    Creates a new discount tier.
    """
    existing = db.query(models.DiscountTier).filter(models.DiscountTier.min_subtotal == payload.min_subtotal).first()
    if existing:
        raise HTTPException(status_code=400, detail="A tier with this subtotal threshold already exists")
        
    tier = models.DiscountTier(
        min_subtotal=payload.min_subtotal,
        discount_percentage=payload.discount_percentage
    )
    db.add(tier)
    db.commit()
    db.refresh(tier)
    return tier

@router.put("/discount-tiers/{tier_id}", response_model=schemas.DiscountTierOut, dependencies=[Depends(auth.require_owner), Depends(auth.check_demo_mode)])
def update_discount_tier(tier_id: int, payload: schemas.DiscountTierUpdate, db: Session = Depends(get_db)):
    """
    Updates an existing discount tier.
    """
    tier = db.query(models.DiscountTier).filter(models.DiscountTier.id == tier_id).first()
    if not tier:
        raise HTTPException(status_code=404, detail="Discount tier not found")
        
    # Check uniqueness if threshold changes
    if payload.min_subtotal != tier.min_subtotal:
        duplicate = db.query(models.DiscountTier).filter(models.DiscountTier.min_subtotal == payload.min_subtotal).first()
        if duplicate:
            raise HTTPException(status_code=400, detail="A tier with this subtotal threshold already exists")
            
    tier.min_subtotal = payload.min_subtotal
    tier.discount_percentage = payload.discount_percentage
    
    db.commit()
    db.refresh(tier)
    return tier

@router.delete("/discount-tiers/{tier_id}", dependencies=[Depends(auth.require_owner), Depends(auth.check_demo_mode)])
def delete_discount_tier(tier_id: int, db: Session = Depends(get_db)):
    """
    Deletes an existing discount tier.
    """
    tier = db.query(models.DiscountTier).filter(models.DiscountTier.id == tier_id).first()
    if not tier:
        raise HTTPException(status_code=404, detail="Discount tier not found")
        
    db.delete(tier)
    db.commit()
    return {"message": f"Successfully deleted discount tier #{tier_id}"}


@router.delete("/orders/{order_id}", dependencies=[Depends(auth.require_owner), Depends(auth.check_demo_mode)])
def delete_reseller_order(order_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    """
    Deletes an existing reseller order.
    Restores the deducted warehouse stock of the items and logs return transactions.
    """
    order = db.query(models.ResellerOrder).filter(models.ResellerOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
        
    for item in order.items:
        product = db.query(models.ProductSKU).filter(models.ProductSKU.sku == item.sku).first()
        if product:
            product.warehouse_stock = (product.warehouse_stock or 0) + item.quantity
            
            db.add(models.InventoryTransaction(
                sku=item.sku,
                transaction_type="sales_return",
                qty=float(item.quantity),
                user_id=current_user.id,
                batch_reference=f"RESELLER_RETURN-{order.id}",
                notes=f"Restored stock from deleted reseller order #{order.id} for {order.reseller_name}.",
            ))
            
            from ..database import sync_warehouse_stock_for_main_facility
            sync_warehouse_stock_for_main_facility(db, sku=item.sku)

    db.delete(order)
    db.commit()
    return {"message": f"Successfully deleted reseller order #{order_id}"}

