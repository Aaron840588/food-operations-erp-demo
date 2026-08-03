"""Simulate the exact API endpoint call against production DB."""
import sys
sys.path.insert(0, 'backend')
from app.database import SessionLocal
from app.routers.preorders import _form_for_public_token, get_public_preorder_catalog
from app import models

db = SessionLocal()
try:
    print("Testing _form_for_public_token('default')...")
    form = _form_for_public_token(db, "default")
    print(f"SUCCESS: form.id={form.id}, form.name={form.name}, enabled={form.is_enabled}")

    print("\nTesting product query...")
    from sqlalchemy import or_
    CURRENT_LINEUP_CATEGORIES = (
        "Sweet", "Savory", "Sandwich", "Spreads & Sauces", "Sandwiches & Salads", "Spreads", "Sandwiches", "General"
    )
    products = db.query(models.ProductSKU).filter(
        or_(models.ProductSKU.is_active == True, models.ProductSKU.is_active.is_(None)),
        models.ProductSKU.category.in_(CURRENT_LINEUP_CATEGORIES),
        models.ProductSKU.retail_price >= 0,
    ).all()
    print(f"Found {len(products)} products")
    for p in products[:5]:
        print(f"  {p.sku}: {p.product_name} ({p.category}) - {p.retail_price}")

except Exception as e:
    print(f"ERROR: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
finally:
    db.close()
