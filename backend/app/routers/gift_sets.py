from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from .. import models, schemas, auth

router = APIRouter(prefix="/gift-sets", tags=["Gift Sets & Overhead"])

# ----------------------------------------------------
# CATEGORY OVERHEAD RATES CRUD
# ----------------------------------------------------
@router.get("/overhead-rates", response_model=List[schemas.CategoryOverheadRateOut])
def get_overhead_rates(db: Session = Depends(get_db)):
    """
    Returns list of all category overhead labor and utility allocations.
    """
    return db.query(models.CategoryOverheadRate).all()

@router.put("/overhead-rates/{category}", response_model=schemas.CategoryOverheadRateOut, dependencies=[Depends(auth.check_demo_mode)])
def update_overhead_rate(category: str, payload: schemas.CategoryOverheadRateBase, db: Session = Depends(get_db)):
    """
    Updates the labor and utility allocation rates for a category.
    """
    rate = db.query(models.CategoryOverheadRate).filter(
        models.CategoryOverheadRate.category == category.lower().strip()
    ).first()
    
    if not rate:
        rate = models.CategoryOverheadRate(category=category.lower().strip())
        db.add(rate)
        
    rate.labor_cost_per_unit = payload.labor_cost_per_unit
    rate.utility_cost_per_unit = payload.utility_cost_per_unit
    
    db.commit()
    db.refresh(rate)
    return rate


# ----------------------------------------------------
# GIFT SETS CRUD
# ----------------------------------------------------
def calculate_gift_set_costs(db: Session, gift_set: models.GiftSet) -> schemas.GiftSetOut:
    """
    Helper to calculate total costs and margins for a Gift Set.
    """
    items_out = []
    total_components_cost = 0.0

    for item in gift_set.items:
        prod = db.query(models.ProductSKU).filter(models.ProductSKU.sku == item.sku).first()
        prod_name = prod.product_name if prod else item.sku
        size = prod.size if prod else ""
        cost_unit = prod.cost_per_unit if prod else 0.0
        
        total_components_cost += item.quantity * cost_unit

        items_out.append(schemas.GiftSetItemOut(
            id=item.id,
            sku=item.sku,
            product_name=prod_name,
            size=size,
            quantity=item.quantity,
            cost_per_unit=round(cost_unit, 2)
        ))

    total_cost = (gift_set.packaging_cost or 0.0) + total_components_cost
    
    # Calculate margins
    retail = gift_set.retail_price
    reseller = gift_set.reseller_price
    
    gross_margin = ((retail - total_cost) / retail * 100) if retail > 0 else 0.0
    net_margin = ((reseller - total_cost) / reseller * 100) if reseller > 0 else 0.0

    return schemas.GiftSetOut(
        id=gift_set.id,
        name=gift_set.name,
        retail_price=retail,
        reseller_price=reseller,
        packaging_cost=gift_set.packaging_cost,
        notes=gift_set.notes,
        items=items_out,
        calculated_total_cost=round(total_cost, 2),
        gross_margin_pct=round(gross_margin, 2),
        net_margin_pct=round(net_margin, 2)
    )

@router.post("", response_model=schemas.GiftSetOut)
def create_gift_set(payload: schemas.GiftSetCreate, db: Session = Depends(get_db)):
    """
    Creates a new Gift Set bundle configuration.
    """
    existing = db.query(models.GiftSet).filter(models.GiftSet.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Gift set name already exists")

    db_gift = models.GiftSet(
        name=payload.name,
        retail_price=payload.retail_price,
        reseller_price=payload.reseller_price,
        packaging_cost=payload.packaging_cost,
        notes=payload.notes
    )
    db.add(db_gift)
    db.commit()
    db.refresh(db_gift)

    for item in payload.items:
        db_item = models.GiftSetItem(
            gift_set_id=db_gift.id,
            sku=item.sku,
            quantity=item.quantity
        )
        db.add(db_item)

    db.commit()
    db.refresh(db_gift)

    return calculate_gift_set_costs(db, db_gift)

@router.get("", response_model=List[schemas.GiftSetOut])
def get_all_gift_sets(db: Session = Depends(get_db)):
    """
    Returns list of all gift sets with calculated cost details and margins.
    """
    gift_sets = db.query(models.GiftSet).all()
    return [calculate_gift_set_costs(db, gs) for gs in gift_sets]

@router.get("/{gift_set_id}", response_model=schemas.GiftSetOut)
def get_gift_set_details(gift_set_id: int, db: Session = Depends(get_db)):
    """
    Returns details for a specific gift set bundle.
    """
    gs = db.query(models.GiftSet).filter(models.GiftSet.id == gift_set_id).first()
    if not gs:
        raise HTTPException(status_code=404, detail="Gift Set not found")
    return calculate_gift_set_costs(db, gs)

@router.delete("/{gift_set_id}")
def delete_gift_set(gift_set_id: int, db: Session = Depends(get_db)):
    """
    Removes a gift set bundle configuration.
    """
    gs = db.query(models.GiftSet).filter(models.GiftSet.id == gift_set_id).first()
    if not gs:
        raise HTTPException(status_code=404, detail="Gift Set not found")
    db.delete(gs)
    db.commit()
    return {"message": f"Successfully deleted Gift Set bundle '{gs.name}'"}
