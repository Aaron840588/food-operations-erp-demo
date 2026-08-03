from fastapi import APIRouter, Depends, HTTPException
from decimal import Decimal, ROUND_HALF_UP
from sqlalchemy.orm import Session, selectinload, joinedload
from typing import List, Dict
from ..database import get_db
from .. import models, schemas, auth
from ..services.cost_snapshot_service import build_unit_cost_snapshots

router = APIRouter(prefix="/consignment", tags=["Consignment Partners"])


def calculate_partner_unit_price(retail_price: float, discount_rate: float) -> float:
    """Return the whole-peso partner price used for immutable delivery snapshots."""
    price = Decimal(str(retail_price or 0)) * (Decimal("1") - Decimal(str(discount_rate or 0)))
    return float(price.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def generate_system_dr_number(delivery: models.ConsignmentDelivery) -> str:
    delivery_date_key = str(delivery.delivery_date).replace("-", "")
    return f"DR-{delivery_date_key}-{delivery.id:05d}"

# ----------------------------------------------------
# PARTNER CRUD ENDPOINTS
# ----------------------------------------------------
@router.get("/partners", response_model=List[schemas.ConsignmentPartnerOut])
def get_all_partners(db: Session = Depends(get_db)):
    """
    Returns a list of all B2B consignment partners with aggregate sales metrics.
    Optimized using selectinload to prevent N+1 queries.
    """
    partners = db.query(models.ConsignmentPartner).options(
        selectinload(models.ConsignmentPartner.deliveries).selectinload(models.ConsignmentDelivery.items)
    ).all()
    output = []
    
    for partner in partners:
        total_delivered = 0
        total_sold = 0
        total_pulled = 0
        
        for delivery in partner.deliveries:
            for item in delivery.items:
                total_delivered += item.qty_delivered or 0
                total_sold += item.units_sold or 0
                total_pulled += item.qty_pulled_out or 0
                
        eff_rate = (total_sold / total_delivered * 100.0) if total_delivered > 0 else 0.0
        waste_rate = (total_pulled / total_delivered * 100.0) if total_delivered > 0 else 0.0
        
        output.append(schemas.ConsignmentPartnerOut(
            id=partner.id,
            name=partner.name,
            discount_rate=partner.discount_rate,
            collection_frequency=partner.collection_frequency,
            minimum_order_amount=partner.minimum_order_amount,
            is_active=partner.is_active,
            total_deliveries_count=len(partner.deliveries),
            average_efficiency_rate=round(eff_rate, 2),
            average_waste_percentage=round(waste_rate, 2)
        ))
        
    return output

@router.put("/partners/{partner_id}", response_model=schemas.ConsignmentPartnerOut)
def update_consignment_partner(
    partner_id: int,
    payload: schemas.ConsignmentPartnerBase,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_owner)
):
    partner = db.query(models.ConsignmentPartner).filter(models.ConsignmentPartner.id == partner_id).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Consignment partner not found")
        
    partner.name = payload.name
    partner.discount_rate = payload.discount_rate
    if payload.collection_frequency:
        partner.collection_frequency = payload.collection_frequency
    if payload.minimum_order_amount is not None:
        partner.minimum_order_amount = payload.minimum_order_amount
    
    from sqlalchemy import text
    if payload.is_active is not None:
        try:
            partner.is_active = payload.is_active
            db.commit()
        except Exception as db_err:
            db.rollback()
            # Self-healing database migration: auto-add missing columns in live cloud Postgres
            err_msg = str(db_err).lower()
            if "is_active" in err_msg or "column" in err_msg:
                try:
                    db.execute(text("ALTER TABLE consignment_partners ADD COLUMN is_active BOOLEAN DEFAULT TRUE"))
                    db.commit()
                    # Retry setting is_active
                    partner.is_active = payload.is_active
                    db.commit()
                except Exception as heal_err:
                    db.rollback()
                    raise HTTPException(
                        status_code=500,
                        detail=f"Self-healing database update failed. Column is_active cannot be added: {heal_err}"
                    )
            else:
                raise HTTPException(status_code=500, detail=f"Database update failed: {db_err}")
    else:
        db.commit()
        
    db.refresh(partner)
    
    total_delivered = 0
    total_sold = 0
    total_pulled = 0
    for delivery in partner.deliveries:
        for item in delivery.items:
            total_delivered += item.qty_delivered or 0
            total_sold += item.units_sold or 0
            total_pulled += item.qty_pulled_out or 0
            
    eff_rate = (total_sold / total_delivered * 100.0) if total_delivered > 0 else 0.0
    waste_rate = (total_pulled / total_delivered * 100.0) if total_delivered > 0 else 0.0
    
    return schemas.ConsignmentPartnerOut(
        id=partner.id,
        name=partner.name,
        discount_rate=partner.discount_rate,
        collection_frequency=partner.collection_frequency,
        minimum_order_amount=partner.minimum_order_amount,
        is_active=partner.is_active,
        total_deliveries_count=len(partner.deliveries),
        average_efficiency_rate=round(eff_rate, 2),
        average_waste_percentage=round(waste_rate, 2)
    )

@router.get("/partners/{partner_id}/deliveries", response_model=List[schemas.ConsignmentDeliveryOut])
def get_partner_deliveries(partner_id: int, limit: int = 10, skip: int = 0, db: Session = Depends(get_db)):
    """
    Retrieves all delivery logs for a specific partner.
    """
    deliveries = db.query(models.ConsignmentDelivery).options(
        joinedload(models.ConsignmentDelivery.items).joinedload(models.ConsignmentItem.product)
    ).filter(
        models.ConsignmentDelivery.partner_id == partner_id
    ).order_by(models.ConsignmentDelivery.delivery_date.desc())\
     .offset(skip)\
     .limit(limit)\
     .all()
    
    partner = db.query(models.ConsignmentPartner).filter(models.ConsignmentPartner.id == partner_id).first()
    partner_name = partner.name if partner else "Unknown"

    output = []
    for d in deliveries:
        items_out = []
        for item in d.items:
            # Calculate metrics
            qty = item.qty_delivered
            sold = item.units_sold or 0
            pulled = item.qty_pulled_out or 0
            reseller_price = item.reseller_price_snapshot or 0.0
            cost = item.cost_per_unit_snapshot or 0.0
            store_price = item.store_price_snapshot or 0.0
            
            eff_rate = (sold / qty * 100) if qty > 0 else 0.0
            waste = (pulled / qty * 100) if qty > 0 else 0.0
            rev = sold * reseller_price
            net_prof = rev - (qty * cost)
            
            prod_name = item.product.product_name if item.product else item.sku
            size = item.product.size if item.product else ''

            items_out.append(schemas.ConsignmentItemOut(
                id=item.id,
                sku=item.sku,
                product_name=prod_name,
                size=size,
                qty_delivered=qty,
                units_sold=sold,
                qty_pulled_out=pulled,
                reseller_price_snapshot=reseller_price,
                cost_per_unit_snapshot=cost,
                store_price_snapshot=store_price,
                efficiency_rate=round(eff_rate, 2),
                food_waste_percentage=round(waste, 2),
                sales_revenue=round(rev, 2),
                net_profit=round(net_prof, 2),
                notes=item.notes
            ))
            
        output.append(schemas.ConsignmentDeliveryOut(
            id=d.id,
            partner_name=partner_name,
            delivery_date=d.delivery_date,
            dr_number=d.dr_number,
            is_paid=d.is_paid,
            payment_date=d.payment_date,
            items=items_out
        ))
        
    return output

@router.post("/deliveries", response_model=schemas.ConsignmentDeliveryOut)
def record_consignment_delivery(payload: schemas.ConsignmentDeliveryCreate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    """
    Logs a new delivery to a consignment partner.
    Deducts delivered items from warehouse stock.
    """
    partner = db.query(models.ConsignmentPartner).filter(models.ConsignmentPartner.id == payload.partner_id).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Consignment partner not found")

    manual_dr_number = (payload.dr_number or "").strip() or None

    # 1. Check for duplicate DR number if provided
    if manual_dr_number:
        existing = db.query(models.ConsignmentDelivery).filter(
            models.ConsignmentDelivery.dr_number == manual_dr_number
        ).first()
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"A consignment delivery with DR number '{manual_dr_number}' already exists."
            )

    # 2. Pre-validate stock availability for all items to guarantee transactionality
    if not payload.items:
        raise HTTPException(status_code=400, detail="Delivery must contain at least one item.")

    items_to_process = []
    for item in payload.items:
        product = db.query(models.ProductSKU).filter(models.ProductSKU.sku == item.sku).first()
        if not product:
            raise HTTPException(status_code=400, detail=f"Product with SKU '{item.sku}' not found.")
        
        available = product.warehouse_stock or 0
        if available < item.target_qty:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient stock for SKU '{item.sku}'. Available: {available}, Required: {item.target_qty}."
            )
        items_to_process.append((product, item))

    cost_snapshots = build_unit_cost_snapshots(
        db,
        [product for product, _ in items_to_process],
    )

    try:
        # 3. Add delivery record
        db_delivery = models.ConsignmentDelivery(
            partner_id=payload.partner_id,
            delivery_date=payload.delivery_date,
            dr_number=manual_dr_number,
            is_paid=False
        )
        db.add(db_delivery)
        db.flush() # Generate ID for db_delivery

        # Keep a delivery reference even when the operator does not have a
        # paper DR number to enter yet. The database ID makes this stable and
        # collision-free; an operator may still replace it with the official
        # receipt number through the existing edit control.
        if not db_delivery.dr_number:
            db_delivery.dr_number = generate_system_dr_number(db_delivery)

        # 4. Process all deductions and log transactions
        for product, item in items_to_process:
            # Deduct stock
            product.warehouse_stock = (product.warehouse_stock or 0) - item.target_qty
            
            # Log finished goods stock deduction transaction
            tx = models.InventoryTransaction(
                sku=product.sku,
                transaction_type="consignment_deduct",
                qty=float(-item.target_qty),
                user_id=current_user.id,
                batch_reference=f"DELIVERY-{db_delivery.id}",
                notes=f"Deducted for consignment delivery #{db_delivery.id} to {partner.name} under DR #{db_delivery.dr_number}."
            )
            db.add(tx)

            # Calculate snapshots
            # Consignment pricing is partner-specific. Do not reuse the generic
            # reseller catalog price: the partner's configured discount from
            # SRP is the authoritative price for this delivery. Whole-peso,
            # half-up rounding matches the owner tracker (for example,
            # PHP 245 less 10% becomes PHP 221, not PHP 220).
            reseller_price = calculate_partner_unit_price(
                product.retail_price,
                partner.discount_rate,
            )
                
            cost_unit = product.cost_per_unit or 0.0
            cost_snapshot = cost_snapshots[product.sku]

            db_item = models.ConsignmentItem(
                delivery_id=db_delivery.id,
                sku=item.sku,
                qty_delivered=item.target_qty,
                units_sold=0,
                qty_pulled_out=0,
                reseller_price_snapshot=reseller_price,
                cost_per_unit_snapshot=cost_unit,
                food_cost_snapshot=cost_snapshot.food_cost,
                labor_cost_snapshot=cost_snapshot.labor_cost,
                utility_cost_snapshot=cost_snapshot.utility_cost,
                total_cost_snapshot=cost_snapshot.total_cost,
                cost_status_snapshot=cost_snapshot.status,
                store_price_snapshot=product.retail_price,
                notes="Logged delivery"
            )
            db.add(db_item)
            
            # Log delivery run record in production batches
            batch_log = models.ProductionBatch(
                batch_date=payload.delivery_date,
                sku=item.sku,
                qty_produced=0,
                qty_delivered=item.target_qty,
                notes=f"Consignment delivery to {partner.name}"
            )
            db.add(batch_log)

        db.flush()

        # 5. Synchronize warehouse stocks table for Pasig main facility (ID: 1)
        from ..database import sync_warehouse_stock_for_main_facility
        for product, item in items_to_process:
            sync_warehouse_stock_for_main_facility(db, sku=item.sku)

        db.commit()
        db.refresh(db_delivery)
    except Exception as e:
        db.rollback()
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Database transaction failed: {str(e)}")

    # Return full delivery details
    return get_delivery_details(db_delivery.id, db)


@router.get("/deliveries/{delivery_id}", response_model=schemas.ConsignmentDeliveryOut)
def get_delivery_details(delivery_id: int, db: Session = Depends(get_db)):
    """
    Returns specific delivery record details.
    """
    d = db.query(models.ConsignmentDelivery).filter(models.ConsignmentDelivery.id == delivery_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Delivery record not found")
        
    partner_name = d.partner.name
    items_out = []
    
    for item in d.items:
        qty = item.qty_delivered
        sold = item.units_sold or 0
        pulled = item.qty_pulled_out or 0
        reseller_price = item.reseller_price_snapshot
        cost = item.cost_per_unit_snapshot
        
        eff_rate = (sold / qty * 100) if qty > 0 else 0.0
        waste = (pulled / qty * 100) if qty > 0 else 0.0
        rev = sold * reseller_price
        net_prof = rev - (qty * cost)
        
        p = db.query(models.ProductSKU).filter(models.ProductSKU.sku == item.sku).first()
        prod_name = p.product_name if p else item.sku
        size = p.size if p else ''

        items_out.append(schemas.ConsignmentItemOut(
            id=item.id,
            sku=item.sku,
            product_name=prod_name,
            size=size,
            qty_delivered=qty,
            units_sold=sold,
            qty_pulled_out=pulled,
            reseller_price_snapshot=reseller_price,
            cost_per_unit_snapshot=cost,
            store_price_snapshot=item.store_price_snapshot,
            efficiency_rate=round(eff_rate, 2),
            food_waste_percentage=round(waste, 2),
            sales_revenue=round(rev, 2),
            net_profit=round(net_prof, 2),
            notes=item.notes
        ))
        
    return schemas.ConsignmentDeliveryOut(
        id=d.id,
        partner_name=partner_name,
        delivery_date=d.delivery_date,
        dr_number=d.dr_number,
        is_paid=d.is_paid,
        payment_date=d.payment_date,
        items=items_out
    )

@router.put("/deliveries/{delivery_id}", response_model=schemas.ConsignmentDeliveryOut, dependencies=[Depends(auth.get_current_user)])
def update_consignment_delivery(delivery_id: int, dr_number: str, db: Session = Depends(get_db)):
    """
    Updates the DR / tracking receipt number of a consignment delivery run.
    """
    d = db.query(models.ConsignmentDelivery).filter(models.ConsignmentDelivery.id == delivery_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Delivery record not found")
    normalized_dr_number = dr_number.strip()
    replacement = normalized_dr_number or generate_system_dr_number(d)
    existing = db.query(models.ConsignmentDelivery).filter(
        models.ConsignmentDelivery.dr_number == replacement,
        models.ConsignmentDelivery.id != delivery_id,
    ).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"A consignment delivery with DR number '{replacement}' already exists.",
        )
    d.dr_number = replacement
    db.commit()
    db.refresh(d)
    return get_delivery_details(delivery_id, db)

@router.put("/delivery-items/{item_id}", response_model=schemas.ConsignmentItemOut)
def update_delivery_item(item_id: int, payload: schemas.ConsignmentItemUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    """
    Updates the sold and pulled-out (waste) count for a delivered SKU.
    """
    item = db.query(models.ConsignmentItem).filter(models.ConsignmentItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Delivery item record not found")

    target_sold = payload.units_sold if payload.units_sold is not None else (item.units_sold or 0)
    target_pulled = payload.qty_pulled_out if payload.qty_pulled_out is not None else (item.qty_pulled_out or 0)

    if target_sold < 0 or target_pulled < 0:
        raise HTTPException(status_code=400, detail="Quantities cannot be negative")

    if (target_sold + target_pulled) > item.qty_delivered:
        raise HTTPException(status_code=400, detail="Sum of sold and pulled-out items cannot exceed quantity delivered")

    item.units_sold = target_sold

    if payload.qty_pulled_out is not None:
        old_pulled = item.qty_pulled_out or 0
        new_pulled = target_pulled
        item.qty_pulled_out = new_pulled
        
        # Log pullouts delta to transactions as waste write-off
        diff = new_pulled - old_pulled
        if diff != 0:
            tx = models.InventoryTransaction(
                sku=item.sku,
                transaction_type="waste",
                qty=float(-diff),
                user_id=current_user.id,
                batch_reference=f"DELIVERY-{item.delivery_id}",
                notes=f"Consignment pullout waste write-off for delivery #{item.delivery_id}."
            )
            db.add(tx)

    if payload.notes is not None:
        item.notes = payload.notes

    db.commit()
    db.refresh(item)

    # Return item summary
    qty = item.qty_delivered
    sold = item.units_sold or 0
    pulled = item.qty_pulled_out or 0
    reseller_price = item.reseller_price_snapshot
    cost = item.cost_per_unit_snapshot
    
    eff_rate = (sold / qty * 100) if qty > 0 else 0.0
    waste = (pulled / qty * 100) if qty > 0 else 0.0
    rev = sold * reseller_price
    net_prof = rev - (qty * cost)
    
    p = db.query(models.ProductSKU).filter(models.ProductSKU.sku == item.sku).first()

    return schemas.ConsignmentItemOut(
        id=item.id,
        sku=item.sku,
        product_name=p.product_name if p else item.sku,
        size=p.size if p else '',
        qty_delivered=qty,
        units_sold=sold,
        qty_pulled_out=pulled,
        reseller_price_snapshot=reseller_price,
        cost_per_unit_snapshot=cost,
        store_price_snapshot=item.store_price_snapshot,
        efficiency_rate=round(eff_rate, 2),
        food_waste_percentage=round(waste, 2),
        sales_revenue=round(rev, 2),
        net_profit=round(net_prof, 2),
        notes=item.notes
    )

@router.post("/deliveries/{delivery_id}/pay")
def mark_delivery_paid(delivery_id: int, payment_date: str, db: Session = Depends(get_db)):
    """
    Marks a delivery run as settled/paid on a specific date.
    """
    d = db.query(models.ConsignmentDelivery).filter(models.ConsignmentDelivery.id == delivery_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Delivery record not found")
        
    d.is_paid = True
    d.payment_date = payment_date
    db.commit()
    return {"message": f"Delivery #{delivery_id} marked as PAID on {payment_date}"}

@router.get("/deliveries/unpaid", response_model=List[schemas.ConsignmentDeliveryOut])
def get_unpaid_deliveries(db: Session = Depends(get_db)):
    """
    Retrieves all unpaid delivery logs across all B2B consignment partners.
    """
    deliveries = db.query(models.ConsignmentDelivery).options(
        joinedload(models.ConsignmentDelivery.items).joinedload(models.ConsignmentItem.product)
    ).filter(
        models.ConsignmentDelivery.is_paid == False
    ).order_by(models.ConsignmentDelivery.delivery_date.desc()).all()
    
    output = []
    for d in deliveries:
        items_out = []
        for item in d.items:
            qty = item.qty_delivered
            sold = item.units_sold or 0
            pulled = item.qty_pulled_out or 0
            reseller_price = item.reseller_price_snapshot
            cost = item.cost_per_unit_snapshot
            store_price = item.store_price_snapshot
            
            eff_rate = (sold / qty * 100) if qty > 0 else 0.0
            waste = (pulled / qty * 100) if qty > 0 else 0.0
            rev = sold * reseller_price
            net_prof = rev - (qty * cost)
            
            prod_name = item.product.product_name if item.product else item.sku
            size = item.product.size if item.product else ''

            items_out.append(schemas.ConsignmentItemOut(
                id=item.id,
                sku=item.sku,
                product_name=prod_name,
                size=size,
                qty_delivered=qty,
                units_sold=sold,
                qty_pulled_out=pulled,
                reseller_price_snapshot=reseller_price,
                cost_per_unit_snapshot=cost,
                store_price_snapshot=store_price,
                efficiency_rate=round(eff_rate, 2),
                food_waste_percentage=round(waste, 2),
                sales_revenue=round(rev, 2),
                net_profit=round(net_prof, 2),
                notes=item.notes
            ))
            
        output.append(schemas.ConsignmentDeliveryOut(
            id=d.id,
            partner_name=d.partner.name if d.partner else "Unknown",
            delivery_date=d.delivery_date,
            dr_number=d.dr_number,
            is_paid=False,
            payment_date=d.payment_date,
            items=items_out
        ))
        
    return output

@router.delete("/deliveries/{delivery_id}", dependencies=[Depends(auth.get_current_user)])
def delete_consignment_delivery(
    delivery_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """
    Deletes a consignment delivery.
    Restores the quantities of all delivered items back to warehouse stock.
    Logs movement transactions.
    """
    d = db.query(models.ConsignmentDelivery).filter(models.ConsignmentDelivery.id == delivery_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Delivery record not found")
        
    try:
        # Restore stock for each item in the delivery
        for item in d.items:
            product = db.query(models.ProductSKU).filter(models.ProductSKU.sku == item.sku).first()
            if product:
                # Add stock back
                product.warehouse_stock = (product.warehouse_stock or 0) + item.qty_delivered
                
                # Log transaction
                db.add(models.InventoryTransaction(
                    sku=item.sku,
                    transaction_type="manual_adjustment",
                    qty=float(item.qty_delivered),
                    user_id=current_user.id,
                    notes=f"Restored stock from deleted consignment delivery #{d.id} for {d.partner.name}."
                ))
        
        # Delete associated production batches to keep output metrics clean
        dr_ref = d.dr_number or str(d.id)
        db.query(models.ProductionBatch).filter(
            models.ProductionBatch.notes.like(f"%DR #{dr_ref}%")
        ).delete(synchronize_session=False)

        # Keep warehouse stock sync
        from ..database import sync_warehouse_stock_for_main_facility
        skus_to_sync = [item.sku for item in d.items]
        
        db.delete(d)
        db.flush()
        
        for sku in skus_to_sync:
            sync_warehouse_stock_for_main_facility(db, sku=sku)
            
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database transaction failed: {str(e)}")
        
    return {"detail": f"Successfully deleted consignment delivery #{delivery_id} and restored warehouse stock."}
