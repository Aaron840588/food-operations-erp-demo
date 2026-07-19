from fastapi import FastAPI, Depends, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session, joinedload
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Dict
from .database import engine, get_db, Base, SessionLocal
from . import models, schemas, auth
from .routers import costing, production, consignment, reseller, tasks, gift_sets, market_events, timesheets
from .routers.costing import clear_costing_cache
from .services.demo_seeder import seed_demo_baseline, seed_demo_transactions
from .services.database_login_rate_limiter import db_username_limiter, db_client_limiter
from .services.login_rate_limiter import username_limiter, client_limiter
import os
import logging

# Configure structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("hh_backend")

import re

def sanitize_html(text_val: str) -> str:
    if not text_val or not isinstance(text_val, str):
        return text_val
    clean = re.compile('<.*?>')
    return re.sub(clean, '', text_val)

# Apply database migrations for constraints before tables are reflected/created
try:
    from sqlalchemy import text
    with engine.connect() as conn:
        try:
            conn.execute(text('UPDATE product_skus SET labor_cost = 0.0 WHERE labor_cost IS NULL'))
            conn.execute(text('UPDATE product_skus SET utility_cost = 0.0 WHERE utility_cost IS NULL'))
            conn.commit()
            if "postgresql" in engine.name:
                conn.execute(text('ALTER TABLE product_skus ALTER COLUMN labor_cost SET NOT NULL'))
                conn.execute(text('ALTER TABLE product_skus ALTER COLUMN utility_cost SET NOT NULL'))
                conn.commit()
                logger.info("Enforced database constraints for ProductSKU overheads.")
        except Exception:
            pass
        try:
            conn.execute(text("UPDATE product_skus SET category='Savory', size='Sampler' WHERE sku='CLS-SAM-SVR' AND category='Sampler'"))
            conn.commit()
            logger.info("Reconciled CLS-SAM-SVR category/size swap.")
        except Exception as e:
            logger.warning(f"Reconciling CLS-SAM-SVR category/size swap failed: {e}")
        try:
            conn.execute(text("ALTER TABLE product_skus ADD COLUMN is_active BOOLEAN DEFAULT TRUE"))
            conn.commit()
            logger.info("Database migration: Added 'is_active' column to 'product_skus' table.")
        except Exception:
            pass

        # Market Events Cash closeout and Preorders migrations
        try:
            conn.execute(text("ALTER TABLE market_events ADD COLUMN initial_cash_balance FLOAT DEFAULT 0.0"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE market_events ADD COLUMN actual_closing_cash FLOAT"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE market_events ADD COLUMN cash_adjustments FLOAT DEFAULT 0.0"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE market_events ADD COLUMN cash_adjustments_notes TEXT DEFAULT ''"))
            conn.commit()
        except Exception:
            pass

        try:
            conn.execute(text("ALTER TABLE market_event_sales ADD COLUMN is_preorder BOOLEAN DEFAULT FALSE"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE market_event_sales ADD COLUMN preorder_customer_name VARCHAR(255)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE market_event_sales ADD COLUMN preorder_payment_status VARCHAR(50)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE market_event_sales ADD COLUMN preorder_fulfillment_status VARCHAR(50)"))
            conn.commit()
        except Exception:
            pass

        # Market Event expenses and allocations waste migrations
        try:
            conn.execute(text("ALTER TABLE market_events ADD COLUMN total_expenses FLOAT DEFAULT 0.0"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE market_events ADD COLUMN expense_notes TEXT DEFAULT ''"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE market_event_allocations ADD COLUMN wasted_quantity INTEGER DEFAULT 0"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE market_event_allocations ADD COLUMN waste_reason VARCHAR(255)"))
            conn.commit()
        except Exception:
            pass

        # Consignment partners is_active and deactivation migration
        try:
            conn.execute(text("ALTER TABLE consignment_partners ADD COLUMN is_active BOOLEAN DEFAULT TRUE"))
            conn.commit()
            logger.info("Database migration: Added 'is_active' column to 'consignment_partners' table.")
        except Exception:
            pass

        # Case-insensitive update to deactivate 'Artisan' and 'Kitchen Angels'
        try:
            conn.execute(text("UPDATE consignment_partners SET is_active = FALSE WHERE LOWER(name) IN ('artisan', 'kitchen angels')"))
            conn.commit()
            logger.info("Database migration: Deactivated 'Artisan' and 'Kitchen Angels' consignment partners.")
        except Exception:
            pass

        # Insert 'Drip Kofi' if not exists
        try:
            res = conn.execute(text("SELECT id FROM consignment_partners WHERE LOWER(name) = 'drip kofi'")).first()
            if not res:
                conn.execute(text("INSERT INTO consignment_partners (name, discount_rate, collection_frequency, minimum_order_amount, is_active) VALUES ('Drip Kofi', 0.10, 'Weekly', 1500.00, TRUE)"))
                conn.commit()
                logger.info("Database migration: Inserted 'Drip Kofi' as an active consignment partner.")
        except Exception as e:
            logger.warning(f"Error seeding Drip Kofi consignment partner: {e}")
except Exception as e:
    logger.warning(f"Startup migration warning: {e}")

# Table creation is auto-triggered on startup to ensure new schemas exist safely
try:
    Base.metadata.create_all(bind=engine)
except Exception as schema_err:
    logger.error(f"CRITICAL ERROR during Database Schema creation: {schema_err}")

app = FastAPI(
    title="H+H Food System API",
    description="Full-stack enterprise API for recipe costing, forecasting, B2B consignment tracking, and kitchen logs",
    version="2.1.2"
)

# Keep refresh cookies HTTPS-only by default. Local development can opt out
# explicitly without weakening the production configuration.
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "true").lower() != "false"


@app.on_event("startup")
def seed_default_users():
    db = SessionLocal()
    try:
        # Run live database migrations on FastAPI startup
        try:
            db.execute(text("ALTER TABLE consignment_partners ADD COLUMN is_active BOOLEAN DEFAULT TRUE"))
            db.commit()
            logger.info("FastAPI startup migration: Added 'is_active' column to 'consignment_partners' table.")
        except Exception:
            db.rollback()
            
        try:
            db.execute(text("UPDATE consignment_partners SET is_active = FALSE WHERE LOWER(name) IN ('artisan', 'kitchen angels')"))
            db.commit()
            logger.info("FastAPI startup migration: Deactivated 'Artisan' and 'Kitchen Angels' consignment partners.")
        except Exception:
            db.rollback()

        try:
            res = db.execute(text("SELECT id FROM consignment_partners WHERE LOWER(name) = 'drip kofi'")).first()
            if not res:
                db.execute(text("INSERT INTO consignment_partners (name, discount_rate, collection_frequency, minimum_order_amount, is_active) VALUES ('Drip Kofi', 0.10, 'Weekly', 1500.00, TRUE)"))
                db.commit()
                logger.info("FastAPI startup migration: Inserted 'Drip Kofi' as an active consignment partner.")
        except Exception:
            db.rollback()

        # Run live database migrations for market events on FastAPI startup
        try:
            db.execute(text("ALTER TABLE market_events ADD COLUMN total_expenses FLOAT DEFAULT 0.0"))
            db.commit()
        except Exception:
            db.rollback()
        try:
            db.execute(text("ALTER TABLE market_events ADD COLUMN expense_notes TEXT DEFAULT ''"))
            db.commit()
        except Exception:
            db.rollback()
        try:
            db.execute(text("ALTER TABLE market_event_allocations ADD COLUMN wasted_quantity INTEGER DEFAULT 0"))
            db.commit()
        except Exception:
            db.rollback()
        try:
            db.execute(text("ALTER TABLE market_event_allocations ADD COLUMN waste_reason VARCHAR(255)"))
            db.commit()
        except Exception:
            db.rollback()

        # Update sandwich prices to match master trackers
        try:
            db.execute(text("UPDATE product_skus SET retail_price = 85.0 WHERE sku = 'GCP-SL-SW-SVR'"))
            db.execute(text("UPDATE product_skus SET retail_price = 120.0 WHERE sku = 'SSS-SL-SW-SVR'"))
            db.execute(text("UPDATE product_skus SET retail_price = 105.0 WHERE sku = 'TSLD-SL-SW-SVR'"))
            db.commit()
            logger.info("FastAPI startup migration: Reconciled sandwich prices to match master trackers.")
        except Exception as e:
            db.rollback()
            logger.warning(f"Failed to update sandwich prices: {e}")

        # Update/Reconcile Pesto spread recipe
        try:
            recipe = db.query(models.Recipe).filter(models.Recipe.sku == "PP-IND-SVR").first()
            if not recipe:
                recipe = models.Recipe(sku="PP-IND-SVR", yield_weight=1760.0, portion_size=200.0)
                db.add(recipe)
                db.flush()
            else:
                recipe.yield_weight = 1760.0
                recipe.portion_size = 200.0
                db.query(models.RecipeItem).filter(models.RecipeItem.recipe_id == recipe.id).delete()
                db.commit()

            sweet_basil = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "sweet basil").first()
            pili = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "pili").first()
            garlic = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "garlic").first()
            washed_sugar = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "washed sugar").first()
            pepper = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "pepper").first()
            salt = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "salt").first()
            white_vinegar = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "white vinegar").first()
            worcestershire = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "worcestershire sauce").first()
            parmesan = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "grated processed parmesan").first()
            olive_oil = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "olive oil").first()

            pesto_items = [
                (sweet_basil, 1000.0, "grams"),
                (pili, 190.0, "grams"),
                (garlic, 75.0, "grams"),
                (washed_sugar, 32.0, "grams"),
                (pepper, 18.0, "grams"),
                (salt, 15.0, "grams"),
                (white_vinegar, 58.0, "grams"),
                (worcestershire, 40.0, "grams"),
                (parmesan, 120.0, "grams"),
                (olive_oil, 600.0, "grams")
            ]
            for ing, qty, unit in pesto_items:
                if ing:
                    db.add(models.RecipeItem(recipe_id=recipe.id, ingredient_type="raw", raw_ingredient_id=ing.id, base_qty=qty, base_unit=unit))
            db.commit()
            logger.info("FastAPI startup migration: Reconciled Pesto with Pili Sauce spread recipe.")
        except Exception as e:
            db.rollback()
            logger.warning(f"Failed to reconcile Pesto recipe: {e}")

        # Update/Reconcile Chili Garlic Oil recipe
        try:
            recipe = db.query(models.Recipe).filter(models.Recipe.sku == "CGO-IND-SVR").first()
            if not recipe:
                recipe = models.Recipe(sku="CGO-IND-SVR", yield_weight=1900.0, portion_size=200.0)
                db.add(recipe)
                db.flush()
            else:
                recipe.yield_weight = 1900.0
                recipe.portion_size = 200.0
                db.query(models.RecipeItem).filter(models.RecipeItem.recipe_id == recipe.id).delete()
                db.commit()

            taiwan_chili = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "taiwan chili").first()
            coconut_oil = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "coconut oil").first()
            garlic = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "garlic").first()
            salt = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "salt").first()
            bay_leaf = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "bay leaf").first()
            oyster_sauce = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "oyster sauce").first()

            cgo_items = [
                (taiwan_chili, 1000.0, "grams"),
                (coconut_oil, 1500.0, "grams"),
                (garlic, 180.0, "grams"),
                (salt, 40.0, "grams"),
                (bay_leaf, 8.0, "grams"),
                (oyster_sauce, 90.0, "grams")
            ]
            for ing, qty, unit in cgo_items:
                if ing:
                    db.add(models.RecipeItem(recipe_id=recipe.id, ingredient_type="raw", raw_ingredient_id=ing.id, base_qty=qty, base_unit=unit))
            db.commit()
            logger.info("FastAPI startup migration: Reconciled Chili Garlic Oil spread recipe.")
        except Exception as e:
            db.rollback()
            logger.warning(f"Failed to reconcile Chili Garlic Oil recipe: {e}")

        # Update/Reconcile Chicken Liver Spread recipe
        try:
            recipe = db.query(models.Recipe).filter(models.Recipe.sku == "CLS-IND-SVR").first()
            if not recipe:
                recipe = models.Recipe(sku="CLS-IND-SVR", yield_weight=660.0, portion_size=200.0)
                db.add(recipe)
                db.flush()
            else:
                recipe.yield_weight = 660.0
                recipe.portion_size = 200.0
                db.query(models.RecipeItem).filter(models.RecipeItem.recipe_id == recipe.id).delete()
                db.commit()

            chicken_liver = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "chicken liver").first()
            soy_sauce = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "soy sauce").first()
            white_vinegar = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "white vinegar").first()
            if_thawed = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "if thawed").first()
            garlic = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "garlic").first()
            onion = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "onion").first()
            pepper = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "pepper").first()
            paprika = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "paprika").first()
            washed_sugar = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "washed sugar").first()
            olive_oil = db.query(models.RawIngredient).filter(func.lower(models.RawIngredient.name) == "olive oil").first()

            cls_items = [
                (chicken_liver, 1016.0, "grams"),
                (soy_sauce, 61.0, "grams"),
                (white_vinegar, 41.0, "grams"),
                (if_thawed, 508.0, "grams"),
                (garlic, 92.0, "grams"),
                (onion, 152.0, "grams"),
                (pepper, 5.0, "grams"),
                (paprika, 25.0, "grams"),
                (washed_sugar, 20.0, "grams"),
                (olive_oil, 131.0, "grams")
            ]
            for ing, qty, unit in cls_items:
                if ing:
                    db.add(models.RecipeItem(recipe_id=recipe.id, ingredient_type="raw", raw_ingredient_id=ing.id, base_qty=qty, base_unit=unit))
            db.commit()
            logger.info("FastAPI startup migration: Reconciled Chicken Liver Spread recipe.")
        except Exception as e:
            db.rollback()
            logger.warning(f"Failed to reconcile Chicken Liver Spread recipe: {e}")

        DEMO_MODE = (os.getenv("DEMO_MODE") == "true") or (os.getenv("ENVIRONMENT") == "demo")
        if DEMO_MODE:
            if db.query(models.User).count() == 0 or db.query(models.ProductSKU).count() == 0:
                logger.info("DEMO_MODE is enabled with empty database. Triggering automatic synthetic seeding...")
                seed_demo_baseline(db)
                seed_demo_transactions(db)
                logger.info("Automatic synthetic database seeding completed.")

        if db.query(models.User).count() == 0:
            if "INITIAL_OWNER_PASSCODE" not in os.environ:
                logger.error("CRITICAL CONFIGURATION ERROR: The 'INITIAL_OWNER_PASSCODE' environment variable is missing. Seeding administrative credentials skipped.")
            else:
                owner_pass = os.environ["INITIAL_OWNER_PASSCODE"]
                hashed = auth.get_password_hash(owner_pass)
                # Create default owner
                owner = models.User(username="owner", hashed_password=hashed, role="owner", is_active=True)
                # Create default staff
                staff = models.User(username="staff", hashed_password=hashed, role="staff", is_active=True)
                db.add(owner)
                db.add(staff)
                db.commit()
                logger.info("Successfully seeded default owner and staff user accounts.")
            
        if db.query(models.DiscountTier).count() == 0:
            tiers = [
                models.DiscountTier(min_subtotal=0.0, discount_percentage=10.0),
                models.DiscountTier(min_subtotal=1300.0, discount_percentage=12.0),
                models.DiscountTier(min_subtotal=2000.0, discount_percentage=15.0),
                models.DiscountTier(min_subtotal=3500.0, discount_percentage=18.0),
                models.DiscountTier(min_subtotal=7000.0, discount_percentage=22.0),
            ]
            db.add_all(tiers)
            db.commit()
            logger.info("Successfully seeded default reseller discount tiers.")

        # Reconcile / remove DR-TEST-001 test data
        test_delivery = db.query(models.ConsignmentDelivery).filter(models.ConsignmentDelivery.dr_number == "DR-TEST-001").first()
        if test_delivery:
            db.delete(test_delivery)
            db.commit()
            logger.info("Successfully deleted test consignment record DR-TEST-001.")
    except Exception as e:
        logger.error(f"Error seeding startup data: {e}")
    finally:
        db.close()


@app.on_event("startup")
def sync_warehouse_stocks_on_startup():
    """
    Ensures the warehouse_stocks table is fully in sync with product_skus and
    raw_ingredients on every cold start. This handles migrations where records
    were inserted directly without going through the sync function.
    """
    db = SessionLocal()
    try:
        # Check if Main Facility warehouse (ID: 1) exists
        warehouse = db.query(models.Warehouse).filter(models.Warehouse.id == 1).first()
        if not warehouse:
            logger.warning("Main Facility warehouse (ID: 1) not found — skipping warehouse stock sync.")
            return

        synced_skus = 0
        synced_ings = 0

        # Sync all product SKUs
        all_products = db.query(models.ProductSKU).all()
        for prod in all_products:
            stock_record = db.query(models.WarehouseStock).filter(
                models.WarehouseStock.warehouse_id == 1,
                models.WarehouseStock.sku == prod.sku
            ).first()
            qty_val = float(prod.warehouse_stock or 0)
            if stock_record:
                if stock_record.quantity != qty_val:
                    stock_record.quantity = qty_val
                    synced_skus += 1
            else:
                db.add(models.WarehouseStock(warehouse_id=1, sku=prod.sku, quantity=qty_val))
                synced_skus += 1

        # Sync all raw ingredients
        all_ingredients = db.query(models.RawIngredient).all()
        for ing in all_ingredients:
            stock_record = db.query(models.WarehouseStock).filter(
                models.WarehouseStock.warehouse_id == 1,
                models.WarehouseStock.raw_ingredient_id == ing.id
            ).first()
            qty_val = float(ing.available_stock or 0.0)
            if stock_record:
                if stock_record.quantity != qty_val:
                    stock_record.quantity = qty_val
                    synced_ings += 1
            else:
                db.add(models.WarehouseStock(warehouse_id=1, raw_ingredient_id=ing.id, quantity=qty_val))
                synced_ings += 1

        db.commit()
        if synced_skus > 0 or synced_ings > 0:
            logger.info(f"Warehouse stock sync: updated/created {synced_skus} SKU records and {synced_ings} ingredient records.")
        else:
            logger.info("Warehouse stock sync: all records are already in sync.")
    except Exception as e:
        logger.error(f"Error during warehouse stock sync on startup: {e}")
    finally:
        db.close()

# CORS middleware to allow Next.js frontend calls
env_mode = os.getenv("ENVIRONMENT", os.getenv("VERCEL_ENV", os.getenv("ENV", "development")))
if env_mode == "production":
    origins = [
        "https://hh-portal.vercel.app",
        "http://localhost:3000",
        "http://127.0.0.1:3000"
    ]
else:
    origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi import Request

@app.middleware("http")
async def remove_api_prefix(request: Request, call_next):
    path = request.scope.get("path", "")
    if path.startswith("/api"):
        request.scope["path"] = path[4:]
    return await call_next(request)

# Register routers (protected by authentication)
app.include_router(costing.router, dependencies=[Depends(auth.require_owner)])
app.include_router(production.router, dependencies=[Depends(auth.get_current_user)])
app.include_router(consignment.router, dependencies=[Depends(auth.get_current_user)])
app.include_router(reseller.router, dependencies=[Depends(auth.get_current_user)])
app.include_router(tasks.router, dependencies=[Depends(auth.get_current_user)])
app.include_router(gift_sets.router, dependencies=[Depends(auth.require_owner)])
app.include_router(market_events.router, dependencies=[Depends(auth.get_current_user)])
app.include_router(timesheets.router, dependencies=[Depends(auth.get_current_user)])

@app.post("/login", response_model=schemas.LoginResponse)
def login(payload: schemas.LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    client_ip = request.client.host if request.client else "127.0.0.1"
    
    # Check rate limits (both local in-memory and shared database rate limiters)
    client_retry = client_limiter.retry_after(client_ip)
    if client_retry > 0:
        raise HTTPException(
            status_code=429,
            detail=f"Too many login attempts. Please try again in {client_retry} seconds.",
            headers={"Retry-After": str(client_retry)}
        )
        
    client_retry_db = db_client_limiter.retry_after(db, client_ip)
    if client_retry_db > 0:
        raise HTTPException(
            status_code=429,
            detail=f"Too many login attempts. Please try again in {client_retry_db} seconds.",
            headers={"Retry-After": str(client_retry_db)}
        )
        
    user_retry = username_limiter.retry_after(payload.username)
    if user_retry > 0:
        raise HTTPException(
            status_code=429,
            detail=f"Too many login attempts. Please try again in {user_retry} seconds.",
            headers={"Retry-After": str(user_retry)}
        )
        
    user_retry_db = db_username_limiter.retry_after(db, payload.username)
    if user_retry_db > 0:
        raise HTTPException(
            status_code=429,
            detail=f"Too many login attempts. Please try again in {user_retry_db} seconds.",
            headers={"Retry-After": str(user_retry_db)}
        )

    user = db.query(models.User).filter(models.User.username == payload.username).first()
    if not user or not auth.verify_password(payload.password, user.hashed_password):
        client_limiter.record_failure(client_ip)
        username_limiter.record_failure(payload.username)
        db_client_limiter.record_failure(db, client_ip)
        db_username_limiter.record_failure(db, payload.username)
        import time
        time.sleep(1.5) # Timing attack mitigation & brute-force delay throttling
        raise HTTPException(status_code=401, detail="Incorrect username or passcode")
        
    if not user.is_active:
        raise HTTPException(status_code=401, detail="User account is inactive")
        
    # Clear rate limits on success
    client_limiter.clear(client_ip)
    username_limiter.clear(payload.username)
    db_client_limiter.clear(db, client_ip)
    db_username_limiter.clear(db, payload.username)
        
    token = auth.create_access_token(data={"sub": user.username, "id": user.id, "role": user.role})
    
    # Create refresh token
    ref_token_val = secrets.token_hex(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=14)
    
    db_ref_token = models.RefreshToken(
        token=ref_token_val,
        username=user.username,
        expires_at=expires_at,
        is_revoked=False
    )
    db.add(db_ref_token)
    db.commit()
    
    # Set HttpOnly, SameSite=Strict cookie
    response.set_cookie(
        key="hh_refresh_token",
        value=ref_token_val,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="strict",
        max_age=14 * 24 * 60 * 60,
        path="/"
    )
    
    return {
        "token": token,
        "username": user.username,
        "role": user.role
    }

@app.post("/auth/refresh", response_model=schemas.LoginResponse)
def refresh_session(request: Request, response: Response, db: Session = Depends(get_db)):
    ref_token_val = request.cookies.get("hh_refresh_token")
    if not ref_token_val:
        raise HTTPException(status_code=401, detail="Refresh token missing from cookies")
        
    db_token = db.query(models.RefreshToken).filter(
        models.RefreshToken.token == ref_token_val,
        models.RefreshToken.is_revoked == False
    ).first()
    
    # Parse now timezone-aware
    now = datetime.now(timezone.utc)
    expires_at = db_token.expires_at if db_token else None
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
        
    if not db_token or expires_at < now:
        raise HTTPException(status_code=401, detail="Session expired or invalid refresh token")
        
    user = db.query(models.User).filter(models.User.username == db_token.username).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User account is inactive or not found")
        
    # Generate new access token
    new_token = auth.create_access_token(data={"sub": user.username, "id": user.id, "role": user.role})
    
    return {
        "token": new_token,
        "username": user.username,
        "role": user.role
    }

@app.post("/auth/logout")
def logout_session(request: Request, response: Response, db: Session = Depends(get_db)):
    ref_token_val = request.cookies.get("hh_refresh_token")
    if ref_token_val:
        db_token = db.query(models.RefreshToken).filter(models.RefreshToken.token == ref_token_val).first()
        if db_token:
            db_token.is_revoked = True
            db.commit()
            
    # Clear the cookie
    response.delete_cookie(
        key="hh_refresh_token",
        path="/",
        samesite="strict",
        httponly=True,
        secure=COOKIE_SECURE
    )
    return {"message": "Logged out successfully"}

@app.get("/auth/me")
def get_authenticated_user(
    current_user: models.User = Depends(auth.get_current_user),
):
    """Returns the role from the authenticated server session, never browser state."""
    return {
        "username": current_user.username,
        "role": current_user.role,
    }

@app.post("/users", response_model=schemas.UserOut, dependencies=[Depends(auth.require_owner), Depends(auth.check_demo_mode)])
def create_user(payload: schemas.UserCreate, db: Session = Depends(get_db)):
    existing = db.query(models.User).filter(models.User.username == payload.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
        
    hashed = auth.get_password_hash(payload.password)
    user = models.User(
        username=payload.username,
        hashed_password=hashed,
        role=payload.role,
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@app.post("/admin/reset-demo")
def reset_demo_endpoint(request: Request, db: Session = Depends(get_db)):
    """
    Idempotent endpoint to reset dynamic transactional data and restore original synthetic seed.
    Protected with a server-side DEMO_RESET_SECRET key inside request headers.
    """
    reset_secret = os.getenv("DEMO_RESET_SECRET")
    if not reset_secret:
        raise HTTPException(
            status_code=500,
            detail="DEMO_RESET_SECRET is not configured on the server."
        )
        
    received_secret = request.headers.get("X-Demo-Reset-Secret")
    if received_secret != reset_secret:
        raise HTTPException(
            status_code=401,
            detail="Unauthorized: Invalid reset secret."
        )
        
    db_url = os.getenv("DATABASE_URL") or ""
    if "lstdqfvbhimqrhhgrnqy" in db_url:
        raise HTTPException(
            status_code=403,
            detail="Action forbidden: Demo reset cannot run against the production database!"
        )
        
    try:
        seed_demo_transactions(db)
        return {"detail": "Demo database successfully reset and synthetic transaction seed restored."}
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to reset demo database: {str(e)}"
        )

@app.post("/admin/reset-test-data", dependencies=[Depends(auth.require_owner), Depends(auth.check_demo_mode)])
def reset_test_data(db: Session = Depends(get_db)):
    """
    Clears all dynamic testing records and transaction logs (orders, deliveries, market sales, audit ledger, FIFO batches)
    while keeping the master catalog (products, raw ingredients, recipes, suppliers, discount tiers, users) intact.
    Accessible to OWNER role only.
    """
    try:
        # 1. Clear reseller orders
        db.query(models.ResellerOrderItem).delete()
        db.query(models.ResellerOrder).delete()
        
        # 2. Clear consignment dispatches
        db.query(models.ConsignmentItem).delete()
        db.query(models.ConsignmentDelivery).delete()
        
        # 3. Clear market events sales & allocations
        db.query(models.MarketEventSaleItem).delete()
        db.query(models.MarketEventSale).delete()
        db.query(models.MarketEventAllocation).delete()
        db.query(models.MarketEvent).delete()
        
        # 4. Clear inventory transaction logs and batches
        db.query(models.InventoryTransaction).delete()
        db.query(models.IngredientBatch).delete()
        
        # 5. Clear production batches & plans
        db.query(models.ProductionBatch).delete()
        db.query(models.ProductionTarget).delete()
        db.query(models.ProductionPlan).delete()
        
        # 6. Reset stocks to 0 (or original catalog defaults)
        for prod in db.query(models.ProductSKU).all():
            prod.warehouse_stock = 0
        for ing in db.query(models.RawIngredient).all():
            ing.available_stock = 0.0
            
        # 7. Reset warehousestocks junction mapping
        db.query(models.WarehouseStock).delete()
        
        # 8. Reset checklist tasks
        for task in db.query(models.CleaningTask).all():
            task.last_done_date = None
            task.remarks = ""
        for asset in db.query(models.MaintenanceAsset).all():
            asset.condition = "OK"
            asset.remarks = ""
            asset.replacement_date = None
            
        db.commit()
        clear_costing_cache()
        return {"detail": "System transactions and test logs cleared successfully. Master catalog kept."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error clearing test data: {str(e)}")

@app.get("/")
def read_root():
    return {"message": "Welcome to H+H Food System API. View docs at /docs"}


# ----------------------------------------------------
# PRODUCT SKUs CRUD
# ----------------------------------------------------
def serialize_product_sku(product: models.ProductSKU, include_finance: bool, reserved_stock: int = 0) -> dict:
    data = schemas.ProductSKUOut.model_validate(product).model_dump()
    if not include_finance:
        for field in ("cost_override", "cost_per_unit", "labor_cost", "utility_cost"):
            data.pop(field, None)
    
    from sqlalchemy.orm import object_session
    db = object_session(product)
    stock_qty = product.warehouse_stock or 0
    if db:
        stock_record = db.query(models.WarehouseStock).filter(
            models.WarehouseStock.warehouse_id == 1,
            models.WarehouseStock.sku == product.sku
        ).first()
        if stock_record:
            stock_qty = int(stock_record.quantity)
            
    data["warehouse_stock"] = stock_qty
    data["reserved_stock"] = reserved_stock
    data["available_stock"] = max(0, stock_qty - reserved_stock)
    return data


@app.get("/products")
def get_all_product_skus(
    category: str = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    from .routers.market_events import get_reserved_quantities
    query = db.query(models.ProductSKU).filter(
        models.ProductSKU.sku != "SKU",
        models.ProductSKU.product_name != "Product Name",
        models.ProductSKU.retail_price > 0.0,
        models.ProductSKU.retail_price != None
    )
    if category:
        query = query.filter(models.ProductSKU.category == category)
    products = query.order_by(models.ProductSKU.product_name.asc()).all()
    reserved_map = get_reserved_quantities(db)
    return [
        serialize_product_sku(product, include_finance=current_user.role == "owner", reserved_stock=reserved_map.get(product.sku, 0))
        for product in products
    ]

@app.put("/products/{sku}")
def update_product_sku(sku: str, payload: schemas.ProductSKUUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    product = db.query(models.ProductSKU).filter(models.ProductSKU.sku == sku).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product SKU not found")
        
    changes = payload.model_dump(exclude_unset=True)
    if current_user.role != "owner":
        forbidden_fields = set(changes) - {"warehouse_stock"}
        if forbidden_fields:
            raise HTTPException(
                status_code=403,
                detail="Staff may only update finished-goods warehouse stock.",
            )

    old_stock = product.warehouse_stock
    new_stock = payload.warehouse_stock
    
    for k, v in changes.items():
        if isinstance(v, str):
            v = sanitize_html(v)
        setattr(product, k, v)
        
    if new_stock is not None and new_stock != old_stock:
        # Record manual finished stock change transaction
        tx = models.InventoryTransaction(
            sku=product.sku,
            transaction_type="manual_adjustment",
            qty=float(new_stock - old_stock),
            user_id=current_user.id,
            notes="Manual finished goods stock adjustment from web inventory screen."
        )
        db.add(tx)
        
    clear_costing_cache()
    db.commit()
    
    # Synchronize warehouse stock for Main Facility
    try:
        from .database import sync_warehouse_stock_for_main_facility
        sync_warehouse_stock_for_main_facility(db, sku=product.sku)
        db.commit()
    except Exception as e:
        logger.error(f"Error syncing warehouse stock: {e}")
        
    db.refresh(product)
    from .routers.market_events import get_reserved_quantities
    reserved_map = get_reserved_quantities(db)
    return serialize_product_sku(product, include_finance=current_user.role == "owner", reserved_stock=reserved_map.get(product.sku, 0))


# ----------------------------------------------------
# RAW INGREDIENTS CRUD
# ----------------------------------------------------
def serialize_raw_ingredient(ingredient: models.RawIngredient, include_finance: bool) -> dict:
    data = schemas.RawIngredientOut.model_validate(ingredient).model_dump()
    if not include_finance:
        data.pop("price", None)
        data.pop("cost_per_gram_unit", None)
        
    from sqlalchemy.orm import object_session
    db = object_session(ingredient)
    stock_qty = ingredient.available_stock or 0.0
    if db:
        stock_record = db.query(models.WarehouseStock).filter(
            models.WarehouseStock.warehouse_id == 1,
            models.WarehouseStock.raw_ingredient_id == ingredient.id
        ).first()
        if stock_record:
            stock_qty = stock_record.quantity
            
    data["available_stock"] = stock_qty
    return data


@app.get("/raw-ingredients")
def get_all_raw_ingredients(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    # 1. Fetch raw ingredients
    ingredients = db.query(models.RawIngredient).order_by(models.RawIngredient.name.asc()).all()
    
    # 2. Pre-fetch all recipes and product names to map where-used relationships
    recipes = db.query(models.Recipe).options(joinedload(models.Recipe.ingredients)).all()
    products = db.query(models.ProductSKU).all()
    products_map = {p.sku: p.product_name for p in products}
    
    # Group products by raw_ingredient_id
    where_used = {}
    for r in recipes:
        prod_name = products_map.get(r.sku, r.sku)
        for item in r.ingredients:
            if item.ingredient_type == "raw" and item.raw_ingredient_id:
                if item.raw_ingredient_id not in where_used:
                    where_used[item.raw_ingredient_id] = set()
                where_used[item.raw_ingredient_id].add(prod_name)
                
    # 3. Inject where-used product list into each ingredient object
    for ing in ingredients:
        ing.used_in_products = list(where_used.get(ing.id, []))
        
    return [
        serialize_raw_ingredient(ingredient, include_finance=current_user.role == "owner")
        for ingredient in ingredients
    ]

@app.get("/raw-ingredients/batches", response_model=List[schemas.IngredientBatchOut], dependencies=[Depends(auth.get_current_user)])
def get_all_ingredient_batches(db: Session = Depends(get_db)):
    batches = db.query(models.IngredientBatch).all()
    null_batches = [b for b in batches if not b.expiry_date]
    valued_batches = [b for b in batches if b.expiry_date]
    sorted_batches = sorted(valued_batches, key=lambda x: x.expiry_date) + null_batches
    
    output = []
    for b in sorted_batches:
        out = schemas.IngredientBatchOut.model_validate(b)
        out.ingredient_name = b.raw_ingredient.name if b.raw_ingredient else None
        output.append(out)
    return output

@app.post("/raw-ingredients/batches/intake", response_model=schemas.IngredientBatchOut)
def intake_ingredient_batch(payload: schemas.IngredientBatchCreate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    ing = db.query(models.RawIngredient).filter(models.RawIngredient.id == payload.raw_ingredient_id).first()
    if not ing:
        raise HTTPException(status_code=404, detail="Raw ingredient not found")
        
    old_stock = ing.available_stock or 0.0
    ing.available_stock = old_stock + payload.quantity
    
    new_batch = models.IngredientBatch(
        raw_ingredient_id=payload.raw_ingredient_id,
        batch_code=payload.batch_code,
        quantity=payload.quantity,
        expiry_date=payload.expiry_date
    )
    db.add(new_batch)
    
    tx = models.InventoryTransaction(
        raw_ingredient_id=payload.raw_ingredient_id,
        transaction_type="receive",
        qty=float(payload.quantity),
        user_id=current_user.id,
        batch_reference=payload.batch_code,
        notes=f"Received intake batch {payload.batch_code} (Expiry: {payload.expiry_date or 'None'}) added to warehouse stock."
    )
    db.add(tx)
    
    db.commit()
    db.refresh(new_batch)
    
    out = schemas.IngredientBatchOut.model_validate(new_batch)
    out.ingredient_name = ing.name
    return out

@app.put("/raw-ingredients/{ingredient_id}")
def update_raw_ingredient(ingredient_id: int, payload: schemas.RawIngredientUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    ing = db.query(models.RawIngredient).filter(models.RawIngredient.id == ingredient_id).first()
    if not ing:
        raise HTTPException(status_code=404, detail="Raw ingredient not found")
        
    changes = payload.model_dump(exclude_unset=True)
    if current_user.role != "owner":
        forbidden_fields = set(changes) - {"available_stock"}
        if forbidden_fields:
            raise HTTPException(
                status_code=403,
                detail="Staff may only update raw-material available stock.",
            )

    old_stock = ing.available_stock
    new_stock = payload.available_stock
    
    for k, v in changes.items():
        if isinstance(v, str):
            v = sanitize_html(v)
        setattr(ing, k, v)
        
    if new_stock is not None and new_stock != old_stock:
        # Record manual raw stock change transaction
        tx = models.InventoryTransaction(
            raw_ingredient_id=ing.id,
            transaction_type="manual_adjustment",
            qty=float(new_stock - old_stock),
            user_id=current_user.id,
            notes="Manual raw material stock adjustment from web inventory screen."
        )
        db.add(tx)
        
        # Synchronize batch records for the manual adjustments
        from .services.fifo_service import FifoService
        FifoService.adjust_ingredient_batches_on_manual(ing.id, old_stock, new_stock, current_user.id, db)
        
    clear_costing_cache()
    db.commit()
    
    # Synchronize warehouse stock for Main Facility
    try:
        from .database import sync_warehouse_stock_for_main_facility
        sync_warehouse_stock_for_main_facility(db, raw_ingredient_id=ing.id)
        db.commit()
    except Exception as e:
        logger.error(f"Error syncing warehouse stock: {e}")
        
    try:
        from .notifications import check_and_trigger_low_stock_alerts
        check_and_trigger_low_stock_alerts([ingredient_id], db)
    except Exception as e:
        logger.error(f"Failed to trigger low stock push alert: {e}")
    db.refresh(ing)
    ing.used_in_products = []
    return serialize_raw_ingredient(ing, include_finance=current_user.role == "owner")


# ----------------------------------------------------
# DASHBOARD ANALYTICS ENDPOINT
# ----------------------------------------------------
@app.get("/dashboard/analytics")
def get_dashboard_analytics(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Compiles consolidated KPI metrics and sales trends for the home dashboard.
    Optimized to run SQL aggregates directly in the database instead of loading full tables.
    """
    from sqlalchemy import func

    raw_items_count = db.query(models.RawIngredient).count()

    partners_count = db.query(models.ConsignmentPartner).count()

    # Staff receive operational performance only. Monetary dashboard analytics
    # are assembled exclusively for authenticated owner sessions.
    if current_user.role != "owner":
        operational_totals = db.query(
            func.sum(models.ConsignmentItem.qty_delivered),
            func.sum(models.ConsignmentItem.units_sold),
            func.sum(models.ConsignmentItem.qty_pulled_out),
        ).first()
        total_delivered = operational_totals[0] or 0
        total_sold = operational_totals[1] or 0
        total_wasted = operational_totals[2] or 0
        return {
            "raw_items_count": raw_items_count,
            "consignment_partners_count": partners_count,
            "consignment_efficiency_rate": round(
                total_sold / total_delivered * 100.0 if total_delivered > 0 else 0.0,
                2,
            ),
            "consignment_waste_percentage": round(
                total_wasted / total_delivered * 100.0 if total_delivered > 0 else 0.0,
                2,
            ),
        }

    # 1. Total Raw Inventory Value (calculated in DB)
    inventory_valuation = db.query(
        func.sum(models.RawIngredient.available_stock * models.RawIngredient.cost_per_gram_unit)
    ).scalar() or 0.0

    # 2. Overall Sales Volume & Profit (Consignment) (calculated in DB in a single query)
    res = db.query(
        func.sum(models.ConsignmentItem.qty_delivered),
        func.sum(models.ConsignmentItem.units_sold),
        func.sum(models.ConsignmentItem.qty_pulled_out),
        func.sum(models.ConsignmentItem.units_sold * models.ConsignmentItem.reseller_price_snapshot),
        func.sum(models.ConsignmentItem.qty_delivered * models.ConsignmentItem.cost_per_unit_snapshot)
    ).first()

    total_delivered = res[0] or 0
    total_sold = res[1] or 0
    total_wasted = res[2] or 0
    total_sales_revenue = res[3] or 0.0
    total_payout_cost = res[4] or 0.0

    overall_efficiency = (total_sold / total_delivered * 100.0) if total_delivered > 0 else 0.0
    overall_waste_pct = (total_wasted / total_delivered * 100.0) if total_delivered > 0 else 0.0

    # 4. Reseller Sales revenue (calculated in DB)
    total_reseller_revenue = db.query(func.sum(models.ResellerOrder.grand_total)).scalar() or 0.0

    # 4b. Market Events Sales revenue (calculated in DB)
    total_market_revenue = db.query(func.sum(models.MarketEventSale.total_amount)).scalar() or 0.0

    # 5. Combined sales summary
    total_revenue = total_sales_revenue + total_reseller_revenue + total_market_revenue
    net_consignment_profit = total_sales_revenue - total_payout_cost

    return {
        "raw_inventory_value": round(inventory_valuation, 2),
        "raw_items_count": raw_items_count,
        "consignment_partners_count": partners_count,
        "consignment_sales": round(total_sales_revenue, 2),
        "reseller_sales": round(total_reseller_revenue, 2),
        "market_sales": round(total_market_revenue, 2),
        "combined_sales": round(total_revenue, 2),
        "consignment_net_profit": round(net_consignment_profit, 2),
        "consignment_efficiency_rate": round(overall_efficiency, 2),
        "consignment_waste_percentage": round(overall_waste_pct, 2)
    }


# ----------------------------------------------------
# CONSOLIDATED DASHBOARD SUMMARY ENDPOINT (SUPER FAST)
# ----------------------------------------------------
@app.get("/dashboard/summary")
def get_dashboard_summary(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Consolidates dashboard KPIs, stock alerts, ex-date alerts, low margin warnings,
    unpaid partner collections, today's schedule, and sanitation counts in 1 request.
    Reduces cold-starts and connection pool explosion in serverless environments.
    """
    from datetime import date, timedelta, datetime
    from sqlalchemy import func
    from .routers.costing import get_profit_margin_analysis

    today_date = date.today()
    today_str = today_date.isoformat()
    warning_date = today_date + timedelta(days=15)

    # 1. KPIs (identical to get_dashboard_analytics but in same session)
    inventory_valuation = db.query(
        func.sum(models.RawIngredient.available_stock * models.RawIngredient.cost_per_gram_unit)
    ).scalar() or 0.0
    raw_items_count = db.query(models.RawIngredient).count()
    partners_count = db.query(models.ConsignmentPartner).count()

    res = db.query(
        func.sum(models.ConsignmentItem.qty_delivered),
        func.sum(models.ConsignmentItem.units_sold),
        func.sum(models.ConsignmentItem.qty_pulled_out),
        func.sum(models.ConsignmentItem.units_sold * models.ConsignmentItem.reseller_price_snapshot),
        func.sum(models.ConsignmentItem.qty_delivered * models.ConsignmentItem.cost_per_unit_snapshot)
    ).first()

    total_delivered = res[0] or 0
    total_sold = res[1] or 0
    total_wasted = res[2] or 0
    total_sales_revenue = res[3] or 0.0
    total_payout_cost = res[4] or 0.0

    overall_efficiency = (total_sold / total_delivered * 100.0) if total_delivered > 0 else 0.0
    overall_waste_pct = (total_wasted / total_delivered * 100.0) if total_delivered > 0 else 0.0

    total_reseller_revenue = db.query(func.sum(models.ResellerOrder.grand_total)).scalar() or 0.0
    total_market_revenue = db.query(func.sum(models.MarketEventSale.total_amount)).scalar() or 0.0
    total_revenue = total_sales_revenue + total_reseller_revenue + total_market_revenue
    net_consignment_profit = total_sales_revenue - total_payout_cost

    # Unified COGS & Profit calculations
    consignment_cogs = db.query(
        func.sum(models.ConsignmentItem.units_sold * models.ConsignmentItem.cost_per_unit_snapshot)
    ).scalar() or 0.0

    reseller_cogs = db.query(
        func.sum(models.ResellerOrderItem.quantity * models.ProductSKU.cost_per_unit)
    ).join(
        models.ProductSKU, models.ResellerOrderItem.sku == models.ProductSKU.sku
    ).scalar() or 0.0

    market_cogs = db.query(
        func.sum(models.MarketEventSaleItem.quantity * models.ProductSKU.cost_per_unit)
    ).join(
        models.ProductSKU, models.MarketEventSaleItem.sku == models.ProductSKU.sku
    ).scalar() or 0.0

    combined_cogs = consignment_cogs + reseller_cogs + market_cogs
    combined_net_profit = total_revenue - combined_cogs
    missing_reseller_costs = db.query(models.ResellerOrderItem.id).join(
        models.ProductSKU, models.ResellerOrderItem.sku == models.ProductSKU.sku
    ).filter(
        models.ResellerOrderItem.quantity > 0,
        (
            (func.coalesce(models.ProductSKU.cost_per_unit, 0.0) <= 0.0)
            | (models.ProductSKU.cost_per_unit >= models.ResellerOrderItem.price_snapshot)
        ),
    ).first() is not None
    missing_market_costs = db.query(models.MarketEventSaleItem.id).join(
        models.ProductSKU, models.MarketEventSaleItem.sku == models.ProductSKU.sku
    ).filter(
        models.MarketEventSaleItem.quantity > 0,
        (
            (func.coalesce(models.ProductSKU.cost_per_unit, 0.0) <= 0.0)
            | (models.ProductSKU.cost_per_unit >= models.MarketEventSaleItem.price_snapshot)
        ),
    ).first() is not None
    missing_consignment_costs = db.query(models.ConsignmentItem.id).filter(
        models.ConsignmentItem.units_sold > 0,
        (
            (func.coalesce(models.ConsignmentItem.cost_per_unit_snapshot, 0.0) <= 0.0)
            | (
                models.ConsignmentItem.cost_per_unit_snapshot
                >= models.ConsignmentItem.reseller_price_snapshot
            )
        ),
    ).first() is not None
    combined_costing_complete = not (
        missing_reseller_costs or missing_market_costs or missing_consignment_costs
    )

    analytics = {
        "raw_inventory_value": round(inventory_valuation, 2),
        "raw_items_count": raw_items_count,
        "consignment_partners_count": partners_count,
        "consignment_sales": round(total_sales_revenue, 2),
        "reseller_sales": round(total_reseller_revenue, 2),
        "market_sales": round(total_market_revenue, 2),
        "combined_sales": round(total_revenue, 2),
        "consignment_net_profit": round(net_consignment_profit, 2),
        "consignment_efficiency_rate": round(overall_efficiency, 2),
        "consignment_waste_percentage": round(overall_waste_pct, 2),
        "combined_cogs": round(combined_cogs, 2),
        "combined_net_profit": round(combined_net_profit, 2),
        "combined_costing_complete": combined_costing_complete,
    }

    # 2. Urgent Low Stock (available_stock <= reorder_level)
    low_stock_ings = db.query(models.RawIngredient).filter(
        models.RawIngredient.reorder_level > 0,
        models.RawIngredient.available_stock <= models.RawIngredient.reorder_level
    ).all()
    low_stock = [
        {
            "id": ing.id,
            "name": ing.name,
            "available_stock": ing.available_stock,
            "reorder_level": ing.reorder_level,
            "unit": ing.unit,
            "supplier_id": ing.supplier_id,
            "item_type": "raw_ingredient",
        } for ing in low_stock_ings
    ]
    low_stock_products = db.query(models.ProductSKU).filter(
        models.ProductSKU.sku != "SKU",
        models.ProductSKU.retail_price > 0,
        func.coalesce(models.ProductSKU.warehouse_stock, 0) < 15,
    ).all()
    low_stock.extend([
        {
            "id": product.sku,
            "sku": product.sku,
            "name": product.product_name,
            "available_stock": product.warehouse_stock or 0,
            "reorder_level": 15,
            "unit": "jars",
            "supplier_id": None,
            "item_type": "finished_good",
        }
        for product in low_stock_products
    ])

    today_str = today_date.isoformat()
    warning_str = (today_date + timedelta(days=15)).isoformat()

    # 3. Expiring Batches (within next 15 days)
    batches_query = db.query(models.IngredientBatch).filter(
        models.IngredientBatch.expiry_date != None,
        models.IngredientBatch.expiry_date != "",
        models.IngredientBatch.expiry_date >= today_str,
        models.IngredientBatch.expiry_date <= warning_str
    ).options(joinedload(models.IngredientBatch.raw_ingredient)).all()
    expiring_batches = [
        {
            "id": b.id,
            "raw_ingredient_id": b.raw_ingredient_id,
            "ingredient_name": b.raw_ingredient.name if b.raw_ingredient else "Unknown",
            "expiry_date": b.expiry_date.isoformat() if isinstance(b.expiry_date, (date, datetime)) else str(b.expiry_date),
            "qty": b.quantity
        } for b in batches_query
    ]

    # 4. Low Margin Products (gross margin < 55%) using cached profit margins
    cost_analysis = get_profit_margin_analysis(db)
    valid_cost_analysis = [
        item for item in cost_analysis if item.get("cost_status", "ok") == "ok"
    ]
    low_margin_products = [
        item for item in valid_cost_analysis if item.get("gross_margin_pct", 0.0) < 55.0
    ]

    # 5. Unpaid deliveries & total AR
    deliveries = db.query(models.ConsignmentDelivery).options(
        joinedload(models.ConsignmentDelivery.items).joinedload(models.ConsignmentItem.product),
        joinedload(models.ConsignmentDelivery.partner)
    ).filter(
        models.ConsignmentDelivery.is_paid == False
    ).order_by(models.ConsignmentDelivery.delivery_date.desc()).all()

    unpaid_deliveries_list = []
    total_unpaid_ar = 0.0
    for d in deliveries:
        items_out = []
        delivery_total = 0.0
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
            
            delivery_total += rev
            
            prod_name = item.product.product_name if item.product else item.sku
            size = item.product.size if item.product else ''
            
            items_out.append({
                "id": item.id,
                "sku": item.sku,
                "product_name": prod_name,
                "size": size,
                "qty_delivered": qty,
                "units_sold": sold,
                "qty_pulled_out": pulled,
                "reseller_price_snapshot": reseller_price,
                "cost_per_unit_snapshot": cost,
                "store_price_snapshot": store_price,
                "efficiency_rate": round(eff_rate, 2),
                "food_waste_percentage": round(waste, 2),
                "sales_revenue": round(rev, 2),
                "net_profit": round(net_prof, 2),
                "notes": item.notes
            })
        
        total_unpaid_ar += delivery_total
        unpaid_deliveries_list.append({
            "id": d.id,
            "partner_name": d.partner.name if d.partner else "Unknown",
            "delivery_date": d.delivery_date,
            "dr_number": d.dr_number,
            "is_paid": False,
            "payment_date": d.payment_date,
            "items": items_out
        })

    # 6. Today's production plan or fallback to the most recent one
    plan = db.query(models.ProductionPlan).filter(
        models.ProductionPlan.plan_date == today_str
    ).first()
    if not plan:
        plan = db.query(models.ProductionPlan).order_by(
            models.ProductionPlan.plan_date.desc()
        ).first()

    today_plan_data = None
    if plan:
        # Pre-fetch products to avoid N+1 queries in targets
        targets_out = []
        for t in plan.targets:
            p = db.query(models.ProductSKU).filter(models.ProductSKU.sku == t.sku).first()
            targets_out.append({
                "id": t.id,
                "sku": t.sku,
                "outlet": t.outlet,
                "target_qty": t.target_qty,
                "product_name": p.product_name if p else t.sku,
                "size": p.size if p else ''
            })
        today_plan_data = {
            "id": plan.id,
            "plan_date": plan.plan_date,
            "status": plan.status,
            "targets": targets_out,
            "created_at": plan.created_at.isoformat() if isinstance(plan.created_at, (date, datetime)) else str(plan.created_at)
        }

    # 7. Cleaning checklist counts
    total_cleaning_tasks = db.query(models.CleaningTask).count()
    completed_cleaning_tasks_today = db.query(models.CleaningTask).filter(
        models.CleaningTask.last_done_date == today_str
    ).count()

    # 8. Waste Rate Trend line chart data (last 10 deliveries)
    recent_deliveries = db.query(models.ConsignmentDelivery).options(
        joinedload(models.ConsignmentDelivery.items),
        joinedload(models.ConsignmentDelivery.partner)
    ).order_by(models.ConsignmentDelivery.delivery_date.desc()).limit(10).all()

    waste_trend = []
    for d in reversed(recent_deliveries):
        total_del = sum(item.qty_delivered for item in d.items)
        total_pull = sum(item.qty_pulled_out or 0 for item in d.items)
        waste_pct = (total_pull / total_del * 100.0) if total_del > 0 else 0.0
        waste_trend.append({
            "date": d.delivery_date.isoformat() if isinstance(d.delivery_date, (date, datetime)) else str(d.delivery_date),
            "waste_pct": round(waste_pct, 1),
            "partner": d.partner.name if d.partner else "Unknown"
        })

    # 9. Top vs Low Margin products
    sorted_by_margin = sorted(valid_cost_analysis, key=lambda x: x.get("net_margin_pct", 0.0), reverse=True)
    top_margins = [
        {
            "product_name": item["product_name"],
            "sku": item["sku"],
            "net_margin_pct": item["net_margin_pct"],
            "gross_margin_pct": item["gross_margin_pct"]
        } for item in sorted_by_margin[:5]
    ]
    valid_low_margins = [item for item in sorted_by_margin if item.get("selling_price", 0.0) > 0.0]
    low_margins = [
        {
            "product_name": item["product_name"],
            "sku": item["sku"],
            "net_margin_pct": item["net_margin_pct"],
            "gross_margin_pct": item["gross_margin_pct"]
        } for item in (valid_low_margins[-5:] if len(valid_low_margins) >= 5 else valid_low_margins)
    ]

    # 10. Per Category Averages (Summary) for Dashboard
    category_groups = {}
    for item in valid_cost_analysis:
        cat = item.get("category", "General")
        if not cat:
            cat = "General"
        cat_lower = cat.lower().strip()
        
        # Map raw DB categories to exact clean business category display names
        if "sweet" in cat_lower or "savory" in cat_lower or "spread" in cat_lower or "sauce" in cat_lower or "oil" in cat_lower:
            cat_display = "Spreads & Sauces"
        elif "sandwich" in cat_lower or "salad" in cat_lower:
            cat_display = "Sandwiches & Salads"
        else:
            continue # skip deleted/inactive categories
            
        if cat_display not in category_groups:
            category_groups[cat_display] = {
                "selling_price": [],
                "food_cost": [],
                "labor_cost": [],
                "utility_cost": [],
                "net_profit": [],
                "gross_margin_pct": [],
                "net_margin_pct": []
            }
        category_groups[cat_display]["selling_price"].append(item.get("selling_price", 0.0))
        category_groups[cat_display]["food_cost"].append(item.get("food_cost", 0.0))
        category_groups[cat_display]["labor_cost"].append(item.get("labor_cost", 0.0))
        category_groups[cat_display]["utility_cost"].append(item.get("utility_cost", 0.0))
        category_groups[cat_display]["net_profit"].append(item.get("net_profit", 0.0))
        category_groups[cat_display]["gross_margin_pct"].append(item.get("gross_margin_pct", 0.0))
        category_groups[cat_display]["net_margin_pct"].append(item.get("net_margin_pct", 0.0))

    category_averages = []
    for cat, vals in category_groups.items():
        n = len(vals["selling_price"])
        if n > 0:
            category_averages.append({
                "category": cat,
                "count": n,
                "avg_price": round(sum(vals["selling_price"]) / n, 2),
                "avg_food_cost": round(sum(vals["food_cost"]) / n, 2),
                "avg_labor_cost": round(sum(vals["labor_cost"]) / n, 2),
                "avg_utility_cost": round(sum(vals["utility_cost"]) / n, 2),
                "avg_net_profit": round(sum(vals["net_profit"]) / n, 2),
                "avg_gross_margin_pct": round(sum(vals["gross_margin_pct"]) / n, 2),
                "avg_net_margin_pct": round(sum(vals["net_margin_pct"]) / n, 2)
            })

    operational_analytics = {
        "raw_items_count": raw_items_count,
        "consignment_partners_count": partners_count,
        "consignment_efficiency_rate": round(overall_efficiency, 2),
        "consignment_waste_percentage": round(overall_waste_pct, 2),
    }
    response = {
        "viewer_role": "owner" if current_user.role == "owner" else "staff",
        "analytics": analytics if current_user.role == "owner" else operational_analytics,
        "low_stock": low_stock,
        "expiring_batches": expiring_batches,
        "today_plan": today_plan_data,
        "cleaning_summary": {
            "total_tasks": total_cleaning_tasks,
            "completed_tasks": completed_cleaning_tasks_today
        },
        "waste_trend": waste_trend,
    }
    if current_user.role == "owner":
        response.update({
            "low_margin_products": low_margin_products,
            "unpaid_deliveries": unpaid_deliveries_list,
            "total_unpaid_ar": round(total_unpaid_ar, 2),
            "top_margins": top_margins,
            "low_margins": low_margins,
            "category_averages": category_averages,
        })
    return response

# ----------------------------------------------------
# SUPPLIER ROUTES
# ----------------------------------------------------
@app.get("/suppliers", response_model=List[schemas.SupplierOut], dependencies=[Depends(auth.get_current_user)])
def get_all_suppliers(db: Session = Depends(get_db)):
    return db.query(models.Supplier).all()

@app.post("/suppliers", response_model=schemas.SupplierOut)
def create_supplier(payload: schemas.SupplierCreate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.require_owner)):
    supplier = models.Supplier(
        name=sanitize_html(payload.name),
        contact_name=sanitize_html(payload.contact_name),
        email=sanitize_html(payload.email),
        phone=sanitize_html(payload.phone),
        address=sanitize_html(payload.address)
    )
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return supplier

@app.put("/suppliers/{supplier_id}", response_model=schemas.SupplierOut)
def update_supplier(supplier_id: int, payload: schemas.SupplierUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.require_owner)):
    supplier = db.query(models.Supplier).filter(models.Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    
    for k, v in payload.model_dump(exclude_unset=True).items():
        if isinstance(v, str):
            v = sanitize_html(v)
        setattr(supplier, k, v)
        
    db.commit()
    db.refresh(supplier)
    return supplier

@app.delete("/suppliers/{supplier_id}")
def delete_supplier(supplier_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(auth.require_owner)):
    supplier = db.query(models.Supplier).filter(models.Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
        
    db.delete(supplier)
    db.commit()
    return {"detail": "Supplier deleted successfully"}

# ----------------------------------------------------
# INVENTORY TRANSACTION ROUTES
# ----------------------------------------------------
@app.get("/inventory-transactions", response_model=List[schemas.InventoryTransactionOut], dependencies=[Depends(auth.get_current_user)])
def get_inventory_transactions(limit: int = 100, skip: int = 0, db: Session = Depends(get_db)):
    txs = db.query(models.InventoryTransaction)\
            .filter(
                models.InventoryTransaction.transaction_type
                != models.MARKET_SALE_IDEMPOTENCY_TRANSACTION_TYPE
            )\
            .options(
                joinedload(models.InventoryTransaction.user),
                joinedload(models.InventoryTransaction.product),
                joinedload(models.InventoryTransaction.raw_ingredient),
                joinedload(models.InventoryTransaction.warehouse)
            )\
            .order_by(models.InventoryTransaction.created_at.desc())\
            .offset(skip)\
            .limit(limit)\
            .all()
            
    result = []
    for tx in txs:
        username = tx.user.username if tx.user else "System"
        wh_name = tx.warehouse.name if tx.warehouse else "Main Facility"
        
        item_name = "Unknown Item"
        if tx.sku and tx.product:
            item_name = f"[SKU] {tx.product.product_name}"
        elif tx.raw_ingredient_id and tx.raw_ingredient:
            item_name = f"[Raw] {tx.raw_ingredient.name}"
            
        result.append(schemas.InventoryTransactionOut(
            id=tx.id,
            user_id=tx.user_id,
            sku=tx.sku,
            raw_ingredient_id=tx.raw_ingredient_id,
            transaction_type=tx.transaction_type,
            qty=tx.qty,
            batch_reference=tx.batch_reference,
            notes=tx.notes,
            created_at=tx.created_at,
            user_username=username,
            item_name=item_name,
            warehouse_id=tx.warehouse_id,
            warehouse_name=wh_name
        ))
    return result


# ----------------------------------------------------
# WAREHOUSE ENDPOINTS
# ----------------------------------------------------
@app.get("/warehouses", response_model=List[schemas.WarehouseOut], dependencies=[Depends(auth.get_current_user)])
def get_warehouses(db: Session = Depends(get_db)):
    return db.query(models.Warehouse).all()

@app.post("/warehouses", response_model=schemas.WarehouseOut, dependencies=[Depends(auth.require_owner)])
def create_warehouse(payload: schemas.WarehouseCreate, db: Session = Depends(get_db)):
    wh = models.Warehouse(name=payload.name, location=payload.location, is_active=payload.is_active)
    db.add(wh)
    try:
        db.commit()
        db.refresh(wh)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail="Warehouse name already exists or invalid parameters")
    return wh

@app.put("/warehouses/{warehouse_id}", response_model=schemas.WarehouseOut, dependencies=[Depends(auth.require_owner)])
def update_warehouse(warehouse_id: int, payload: schemas.WarehouseCreate, db: Session = Depends(get_db)):
    wh = db.query(models.Warehouse).filter(models.Warehouse.id == warehouse_id).first()
    if not wh:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    wh.name = payload.name
    wh.location = payload.location
    wh.is_active = payload.is_active
    try:
        db.commit()
        db.refresh(wh)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail="Warehouse name conflicts with an existing location")
    return wh

@app.delete("/warehouses/{warehouse_id}", dependencies=[Depends(auth.require_owner)])
def delete_warehouse(warehouse_id: int, db: Session = Depends(get_db)):
    if warehouse_id == 1:
        raise HTTPException(status_code=400, detail="Cannot delete default Main Facility warehouse")
    wh = db.query(models.Warehouse).filter(models.Warehouse.id == warehouse_id).first()
    if not wh:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    db.delete(wh)
    db.commit()
    return {"detail": "Warehouse deleted successfully"}

@app.get("/warehouses/stocks", response_model=List[schemas.WarehouseStockOut], dependencies=[Depends(auth.get_current_user)])
def get_warehouse_stocks(db: Session = Depends(get_db)):
    stocks = db.query(models.WarehouseStock)\
               .options(
                   joinedload(models.WarehouseStock.warehouse),
                   joinedload(models.WarehouseStock.raw_ingredient),
                   joinedload(models.WarehouseStock.product)
               )\
               .all()
    result = []
    for s in stocks:
        wh_name = s.warehouse.name if s.warehouse else "Unknown"
        ing_name = s.raw_ingredient.name if s.raw_ingredient else None
        prod_name = s.product.product_name if s.product else None
        result.append(schemas.WarehouseStockOut(
            warehouse_id=s.warehouse_id,
            warehouse_name=wh_name,
            raw_ingredient_id=s.raw_ingredient_id,
            ingredient_name=ing_name,
            sku=s.sku,
            product_name=prod_name,
            quantity=s.quantity
        ))
    return result

@app.post("/warehouses/transfer", dependencies=[Depends(auth.get_current_user)])
def transfer_warehouse_inventory(payload: schemas.WarehouseTransferRequest, current_user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    user_id = current_user.id

    # Validate warehouses
    src_wh = db.query(models.Warehouse).filter(models.Warehouse.id == payload.source_warehouse_id).first()
    dest_wh = db.query(models.Warehouse).filter(models.Warehouse.id == payload.destination_warehouse_id).first()
    if not src_wh or not dest_wh:
        raise HTTPException(status_code=404, detail="Source or destination warehouse not found")
    if payload.source_warehouse_id == payload.destination_warehouse_id:
        raise HTTPException(status_code=400, detail="Source and destination warehouses must be different")
    if payload.quantity <= 0:
        raise HTTPException(status_code=400, detail="Transfer quantity must be greater than zero")

    # Get source and destination stocks
    if payload.raw_ingredient_id:
        item_id = payload.raw_ingredient_id
        item_type = "raw"
        item = db.query(models.RawIngredient).filter(models.RawIngredient.id == item_id).first()
        if not item:
            raise HTTPException(status_code=404, detail="Raw ingredient not found")
        item_name = item.name
        
        src_stock = db.query(models.WarehouseStock).filter(
            models.WarehouseStock.warehouse_id == payload.source_warehouse_id,
            models.WarehouseStock.raw_ingredient_id == item_id
        ).first()
        
        dest_stock = db.query(models.WarehouseStock).filter(
            models.WarehouseStock.warehouse_id == payload.destination_warehouse_id,
            models.WarehouseStock.raw_ingredient_id == item_id
        ).first()
    elif payload.sku:
        sku = payload.sku
        item_type = "sku"
        item = db.query(models.ProductSKU).filter(models.ProductSKU.sku == sku).first()
        if not item:
            raise HTTPException(status_code=404, detail="Product SKU not found")
        item_name = item.product_name
        
        src_stock = db.query(models.WarehouseStock).filter(
            models.WarehouseStock.warehouse_id == payload.source_warehouse_id,
            models.WarehouseStock.sku == sku
        ).first()
        
        dest_stock = db.query(models.WarehouseStock).filter(
            models.WarehouseStock.warehouse_id == payload.destination_warehouse_id,
            models.WarehouseStock.sku == sku
        ).first()
    else:
        raise HTTPException(status_code=400, detail="Must specify either raw_ingredient_id or sku")

    # Check available quantity
    available = src_stock.quantity if src_stock else 0.0
    if available < payload.quantity:
        raise HTTPException(status_code=400, detail=f"Insufficient stock in source warehouse: {src_wh.name}. Available: {available}, Requested: {payload.quantity}")

    # Deduct from source
    src_stock.quantity -= payload.quantity
    
    # Add to destination
    if not dest_stock:
        if item_type == "raw":
            dest_stock = models.WarehouseStock(warehouse_id=payload.destination_warehouse_id, raw_ingredient_id=item_id, quantity=payload.quantity)
        else:
            dest_stock = models.WarehouseStock(warehouse_id=payload.destination_warehouse_id, sku=sku, quantity=payload.quantity)
        db.add(dest_stock)
    else:
        dest_stock.quantity += payload.quantity

    # Synchronize primary stock fields if default Main Facility (ID: 1) is involved
    if payload.source_warehouse_id == 1:
        if item_type == "raw":
            item.available_stock -= payload.quantity
        else:
            item.warehouse_stock -= payload.quantity
    if payload.destination_warehouse_id == 1:
        if item_type == "raw":
            item.available_stock += payload.quantity
        else:
            item.warehouse_stock += payload.quantity

    # Create InventoryTransaction logs
    notes_deduct = f"Transfer from {src_wh.name} to {dest_wh.name} ({payload.quantity} units)"
    notes_add = f"Transfer from {src_wh.name} to {dest_wh.name} ({payload.quantity} units)"
    
    if item_type == "raw":
        tx_deduct = models.InventoryTransaction(
            user_id=user_id,
            raw_ingredient_id=item_id,
            transaction_type="manual_adjustment",
            qty=-payload.quantity,
            notes=notes_deduct,
            warehouse_id=payload.source_warehouse_id
        )
        tx_add = models.InventoryTransaction(
            user_id=user_id,
            raw_ingredient_id=item_id,
            transaction_type="manual_adjustment",
            qty=payload.quantity,
            notes=notes_add,
            warehouse_id=payload.destination_warehouse_id
        )
    else:
        tx_deduct = models.InventoryTransaction(
            user_id=user_id,
            sku=sku,
            transaction_type="manual_adjustment",
            qty=-payload.quantity,
            notes=notes_deduct,
            warehouse_id=payload.source_warehouse_id
        )
        tx_add = models.InventoryTransaction(
            user_id=user_id,
            sku=sku,
            transaction_type="manual_adjustment",
            qty=payload.quantity,
            notes=notes_add,
            warehouse_id=payload.destination_warehouse_id
        )
    db.add_all([tx_deduct, tx_add])
    db.commit()
    return {"detail": f"Successfully transferred {payload.quantity} units of {item_name} from {src_wh.name} to {dest_wh.name}"}


# ----------------------------------------------------
# DATABASE BACKUP ENDPOINT
# ----------------------------------------------------
@app.get("/backup", dependencies=[Depends(auth.require_owner), Depends(auth.check_demo_mode)])
def export_database_backup(db: Session = Depends(get_db)):
    """
    Exports the entire database contents (all tables) as a structured JSON backup.
    Only accessible to Owner accounts.
    """
    import json
    from fastapi.responses import JSONResponse
    
    # 1. Gather all table contents
    data = {
        "users": [
            {"id": u.id, "username": u.username, "role": u.role, "is_active": u.is_active}
            for u in db.query(models.User).all()
        ],
        "suppliers": [
            {"id": s.id, "name": s.name, "contact_person": s.contact_person, "email": s.email, "phone": s.phone, "address": s.address}
            for s in db.query(models.Supplier).all()
        ],
        "raw_ingredients": [
            {
                "id": r.id, "name": r.name, "category": r.category, "unit": r.unit, "price": r.price,
                "net_weight": r.net_weight, "cost_per_gram_unit": r.cost_per_gram_unit,
                "available_stock": r.available_stock, "reorder_level": r.reorder_level, "supplier_id": r.supplier_id
            }
            for r in db.query(models.RawIngredient).all()
        ],
        "product_skus": [
            {
                "sku": p.sku, "product_name": p.product_name, "size": p.size, "retail_price": p.retail_price,
                "reseller_price": p.reseller_price, "warehouse_stock": p.warehouse_stock,
                "cost_per_unit": p.cost_per_unit, "density_multiplier": p.density_multiplier
            }
            for p in db.query(models.ProductSKU).all()
        ],
        "recipes": [
            {
                "sku": r.sku, "portion_size": r.portion_size, "yield_weight": r.yield_weight,
                "yield_unit": r.yield_unit, "labor_cost_per_batch": r.labor_cost_per_batch,
                "ingredients": [
                    {
                        "ingredient_type": i.ingredient_type, "raw_ingredient_id": i.raw_ingredient_id,
                        "sub_sku": i.sub_sku, "base_qty": i.base_qty, "base_unit": i.base_unit
                    }
                    for i in r.ingredients
                ]
            }
            for r in db.query(models.Recipe).all()
        ],
        "discount_tiers": [
            {"id": d.id, "min_subtotal": d.min_subtotal, "discount_percentage": d.discount_percentage}
            for d in db.query(models.DiscountTier).all()
        ],
        "reseller_orders": [
            {
                "id": o.id, "reseller_name": o.reseller_name, "order_date": o.order_date, "subtotal": o.subtotal,
                "discount_percentage": o.discount_percentage, "discount_amount": o.discount_amount,
                "tax_rate": o.tax_rate, "tax_amount": o.tax_amount, "grand_total": o.grand_total,
                "is_paid": o.is_paid, "notes": o.notes, "created_at": str(o.created_at),
                "items": [
                    {"sku": i.sku, "quantity": i.quantity, "price_snapshot": i.price_snapshot}
                    for i in o.items
                ]
            }
            for o in db.query(models.ResellerOrder).all()
        ],
        "consignment_partners": [
            {"id": p.id, "name": p.name, "discount_rate": p.discount_rate, "collection_frequency": p.collection_frequency, "minimum_order_amount": p.minimum_order_amount}
            for p in db.query(models.ConsignmentPartner).all()
        ],
        "consignment_deliveries": [
            {
                "id": d.id, "partner_id": d.partner_id, "delivery_date": d.delivery_date, "dr_number": d.dr_number,
                "is_paid": d.is_paid, "payment_date": d.payment_date,
                "items": [
                    {
                        "sku": i.sku, "qty_delivered": i.qty_delivered, "units_sold": i.units_sold, "qty_pulled_out": i.qty_pulled_out,
                        "reseller_price_snapshot": i.reseller_price_snapshot, "cost_per_unit_snapshot": i.cost_per_unit_snapshot,
                        "store_price_snapshot": i.store_price_snapshot, "notes": i.notes
                    }
                    for i in d.items
                ]
            }
            for d in db.query(models.ConsignmentDelivery).all()
        ],
        "overhead_configs": [
            {"id": c.id, "label": c.label, "category": c.category, "annual_cost": c.annual_cost, "monthly_cost": c.monthly_cost}
            for c in db.query(models.OverheadConfig).all()
        ],
        "category_overhead_rates": [
            {"id": r.id, "category": r.category, "monthly_allocated_overhead": r.monthly_allocated_overhead, "target_portions_count": r.target_portions_count, "allocated_overhead_per_portion": r.allocated_overhead_per_portion}
            for r in db.query(models.CategoryOverheadRate).all()
        ],
        "maintenance_assets": [
            {"id": a.id, "area": a.area, "item_name": a.item_name, "style_or_kind": a.style_or_kind, "condition": a.condition, "remarks": a.remarks, "replacement_date": a.replacement_date, "last_checked": str(a.last_checked)}
            for a in db.query(models.MaintenanceAsset).all()
        ],
        "cleaning_tasks": [
            {"id": t.id, "task_name": t.task_name, "frequency": t.frequency, "last_done_date": t.last_done_date, "remarks": t.remarks}
            for t in db.query(models.CleaningTask).all()
        ],
        "inventory_transactions": [
            {
                "id": t.id, "user_id": t.user_id, "sku": t.sku, "raw_ingredient_id": t.raw_ingredient_id,
                "transaction_type": t.transaction_type, "qty": t.qty, "batch_reference": t.batch_reference,
                "notes": t.notes, "created_at": str(t.created_at)
            }
            for t in db.query(models.InventoryTransaction).all()
        ]
    }
    
    # 2. Optionally write to a local backup file on disk (only on local environments)
    try:
        os.makedirs("backups", exist_ok=True)
        from datetime import datetime
        fn = f"backups/backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(fn, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception:
        pass # Ignore permission/filesystem errors in serverless cloud environments
        
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": "attachment; filename=hh-hub-backup.json"}
    )


# ----------------------------------------------------
# PUSH NOTIFICATION ENDPOINTS
# ----------------------------------------------------
from .notifications import trigger_push_notifications

@app.post("/push/subscribe", dependencies=[Depends(auth.check_demo_mode)])
def subscribe_push(payload: schemas.PushSubscriptionIn, current_user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    user_id = current_user.id
    existing = db.query(models.PushSubscription).filter(models.PushSubscription.endpoint == payload.endpoint).first()
    if existing:
        existing.p256dh = payload.keys.p256dh
        existing.auth = payload.keys.auth
        existing.user_id = user_id
    else:
        new_sub = models.PushSubscription(
            user_id=user_id,
            endpoint=payload.endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth
        )
        db.add(new_sub)
    db.commit()
    return {"detail": "Push subscription successfully registered."}

@app.post("/push/test", dependencies=[Depends(auth.require_owner), Depends(auth.check_demo_mode)])
def test_push_notifications(db: Session = Depends(get_db)):
    trigger_push_notifications(
        title="H+H System Status Check",
        body="Verification message: Push notification server channel is active and online.",
        db=db
    )
    return {"detail": "Test push dispatch triggered."}


# ----------------------------------------------------
# MATERIAL REQUIREMENTS PLANNING (MRP) ENDPOINTS
# ----------------------------------------------------
@app.get("/mrp/projections", dependencies=[Depends(auth.get_current_user)])
def get_mrp_projections(db: Session = Depends(get_db)):
    from datetime import datetime, timedelta
    
    # 1. Fetch consumption transactions in the last 30 days
    cutoff_date = datetime.now() - timedelta(days=30)
    txs = db.query(models.InventoryTransaction)\
        .filter(models.InventoryTransaction.transaction_type == "consume",
                models.InventoryTransaction.created_at >= cutoff_date)\
        .all()
        
    # Group consumption by raw_ingredient_id
    consumption_totals = {}
    for tx in txs:
        if tx.raw_ingredient_id:
            qty_abs = abs(tx.qty)
            consumption_totals[tx.raw_ingredient_id] = consumption_totals.get(tx.raw_ingredient_id, 0.0) + qty_abs
            
    # 2. Fetch all raw ingredients and map their projections
    ingredients = db.query(models.RawIngredient).all()
    projections = []
    
    for ing in ingredients:
        total_consumed = consumption_totals.get(ing.id, 0.0)
        daily_burn = round(total_consumed / 30.0, 2)
        
        stock = ing.available_stock or 0.0
        days_left = float("inf")
        if daily_burn > 0:
            days_left = round(stock / daily_burn, 1)
            
        # Determine safety status: danger (<3 days), warning (<14 days), ok
        status = "ok"
        if days_left < 3.0:
            status = "danger"
        elif days_left < 14.0:
            status = "warning"
        elif stock <= (ing.reorder_level or 0.0):
            status = "warning" # also warn if below static reorder level
            
        # Suggested replenishment to restore stock to 30 days of safety supply
        safety_qty = daily_burn * 30.0
        suggested_buy = 0.0
        if stock < safety_qty:
            suggested_buy = round(safety_qty - stock, 2)
        elif stock <= (ing.reorder_level or 0.0):
            # If below static reorder level, suggest buying at least net_weight or a default reorder amount
            suggested_buy = round(max(ing.net_weight or 1000.0, (ing.reorder_level or 0.0) * 2), 2)
            
        supplier_name = ing.supplier.name if ing.supplier else "Unassigned Vendor"
        supplier_id = ing.supplier.id if ing.supplier else None
        
        projections.append({
            "ingredient_id": ing.id,
            "ingredient_name": ing.name,
            "unit": ing.unit,
            "available_stock": stock,
            "daily_burn_rate": daily_burn,
            "days_to_depletion": days_left if days_left != float("inf") else "Infinite",
            "status": status,
            "suggested_replenishment": suggested_buy,
            "supplier_id": supplier_id,
            "supplier_name": supplier_name,
            "cost_per_unit": ing.price
        })
        
    return projections

@app.post("/mrp/draft-po", dependencies=[Depends(auth.get_current_user)])
def generate_draft_po(payload: dict, db: Session = Depends(get_db)):
    from datetime import datetime
    supplier_id = payload.get("supplier_id")
    items = payload.get("items", [])
    
    supplier_name = "Unassigned Vendor"
    supplier_contact = "N/A"
    if supplier_id:
        supplier = db.query(models.Supplier).filter(models.Supplier.id == supplier_id).first()
        if supplier:
            supplier_name = supplier.name
            supplier_contact = supplier.contact_info or "N/A"
            
    po_number = f"DRAFT-PO-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    po_items = []
    grand_total = 0.0
    
    for item in items:
        ing_id = item.get("ingredient_id")
        qty = item.get("quantity", 0.0)
        
        ing = db.query(models.RawIngredient).filter(models.RawIngredient.id == ing_id).first()
        if ing:
            subtotal = qty * (ing.price or 0.0)
            grand_total += subtotal
            po_items.append({
                "ingredient_id": ing.id,
                "ingredient_name": ing.name,
                "unit": ing.unit,
                "quantity": qty,
                "unit_price": ing.price or 0.0,
                "subtotal": round(subtotal, 2)
            })
            
    return {
        "po_number": po_number,
        "date": datetime.now().strftime("%Y-%m-%d"),
        "supplier_name": supplier_name,
        "supplier_contact": supplier_contact,
        "items": po_items,
        "grand_total": round(grand_total, 2)
    }


@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    from sqlalchemy import text
    try:
        # Run a simple SELECT 1 query to verify database ping
        db.execute(text("SELECT 1"))
        demo_mode = (os.getenv("DEMO_MODE") == "true") or (os.getenv("ENVIRONMENT") == "demo")
        res = {
            "status": "healthy",
            "database": "online",
            "environment": os.getenv("ENVIRONMENT", os.getenv("VERCEL_ENV", "development")),
            "demo_mode": demo_mode
        }
        if demo_mode:
            res["demo_owner_username"] = os.getenv("DEMO_OWNER_USERNAME", "demo-owner")
            res["demo_owner_password"] = os.getenv("DEMO_OWNER_PASSWORD", "owner123")
            res["demo_staff_username"] = os.getenv("DEMO_STAFF_USERNAME", "demo-staff")
            res["demo_staff_password"] = os.getenv("DEMO_STAFF_PASSWORD", "staff123")
        return res
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Database connection error: {str(e)}"
        )
