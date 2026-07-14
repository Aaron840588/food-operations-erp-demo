from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload, joinedload
from typing import List, Dict
from ..database import get_db
from .. import models, schemas, auth

router = APIRouter(prefix="/consignment", tags=["Consignment Partners"])

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
    import os
    DEMO_MODE = (os.getenv("DEMO_MODE") == "true") or (os.getenv("ENVIRONMENT") == "demo")
    if DEMO_MODE:
        if db.query(models.ConsignmentDelivery).count() >= 100:
            raise HTTPException(
                status_code=400,
                detail="Sandbox table limit reached. In Public Demo Sandbox, the number of consignment deliveries is capped at 100. Please reset the database."
            )
        for item in payload.items:
            if item.qty_delivered > 100:
                raise HTTPException(
                    status_code=400,
                    detail="Quantity limit exceeded. In Public Demo Sandbox, consignment dispatches are capped at 100 per item."
                )

    partner = db.query(models.ConsignmentPartner).filter(models.ConsignmentPartner.id == payload.partner_id).first()
    if not partner:
        raise HTTPException(status_code=444, detail="Consignment partner not found")

    db_delivery = models.ConsignmentDelivery(
        partner_id=payload.partner_id,
        delivery_date=payload.delivery_date,
        dr_number=payload.dr_number,
        is_paid=False
    )
    db.add(db_delivery)
    db.commit()
    db.refresh(db_delivery)

    for item in payload.items:
        product = db.query(models.ProductSKU).filter(models.ProductSKU.sku == item.sku).first()
        if not product:
            continue
            
        # Deduct warehouse stock
        product.warehouse_stock = max(0, (product.warehouse_stock or 0) - item.target_qty)
        
        # Log finished goods stock deduction transaction
        tx = models.InventoryTransaction(
            sku=product.sku,
            transaction_type="consignment_deduct",
            qty=float(-item.target_qty),
            user_id=current_user.id,
            batch_reference=f"DELIVERY-{db_delivery.id}",
            notes=f"Deducted for consignment delivery #{db_delivery.id} to {partner.name} under DR #{payload.dr_number}."
        )
        db.add(tx)

        # Calculate snapshots
        reseller_price = product.reseller_price
        if reseller_price == 0:
            reseller_price = product.retail_price * (1 - partner.discount_rate)
            
        cost_unit = product.cost_per_unit or 0.0

        db_item = models.ConsignmentItem(
            delivery_id=db_delivery.id,
            sku=item.sku,
            qty_delivered=item.target_qty,
            units_sold=0,
            qty_pulled_out=0,
            reseller_price_snapshot=reseller_price,
            cost_per_unit_snapshot=cost_unit,
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

    db.commit()
    
    # Synchronize warehouse stocks for all items in the consignment delivery
    try:
        from ..database import sync_warehouse_stock_for_main_facility
        for item in payload.items:
            sync_warehouse_stock_for_main_facility(db, sku=item.sku)
        db.commit()
    except Exception as e:
        print(f"Error syncing warehouse stock in consignment: {e}")
    
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
    d.dr_number = dr_number if dr_number else None
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

    if payload.units_sold is not None:
        if payload.units_sold > item.qty_delivered:
            raise HTTPException(status_code=400, detail="Units sold cannot exceed quantity delivered")
        item.units_sold = payload.units_sold

    if payload.qty_pulled_out is not None:
        if (item.units_sold + payload.qty_pulled_out) > item.qty_delivered:
            raise HTTPException(status_code=400, detail="Sum of sold and pulled-out items cannot exceed quantity delivered")
            
        old_pulled = item.qty_pulled_out or 0
        new_pulled = payload.qty_pulled_out
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
