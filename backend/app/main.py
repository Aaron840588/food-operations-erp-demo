from fastapi import FastAPI, Depends, HTTPException, Request, Response, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, or_, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, joinedload
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Dict
from .database import (
    engine,
    get_db,
    Base,
    SessionLocal,
    sync_warehouse_stock_for_main_facility,
)
from . import models, schemas, auth
from .routers import costing, production, consignment, reseller, tasks, gift_sets, market_events, timesheets, sheet_sync, preorders
from .routers.costing import clear_costing_cache
from .services.costing_service import CostingService
from .services.master_data_service import MasterDataValidationError, apply_product_updates
from .services.login_rate_limiter import client_limiter, username_limiter
from .services.database_login_rate_limiter import db_client_limiter, db_username_limiter
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

_migrations_executed = False

def run_startup_migrations():
    global _migrations_executed
    configured_app = globals().get("app")
    if configured_app is not None and get_db in configured_app.dependency_overrides:
        return
    if _migrations_executed:
        return
    _migrations_executed = True

    # --- PostgreSQL-safe data repairs (run on ALL dialects BEFORE the guard) ---
    from sqlalchemy import text as _text
    try:
        with engine.connect() as _conn:
            # 1. Ensure OTOP partner exists
            _otop = _conn.execute(_text(
                "SELECT id FROM consignment_partners WHERE LOWER(name) = 'otop'"
            )).first()
            if not _otop:
                _conn.execute(_text(
                    "INSERT INTO consignment_partners "
                    "(name, discount_rate, collection_frequency, minimum_order_amount, is_active) "
                    "VALUES ('OTOP', 0.10, 'Monthly', 0.00, TRUE)"
                ))
                _conn.commit()
                _otop = _conn.execute(_text(
                    "SELECT id FROM consignment_partners WHERE LOWER(name) = 'otop'"
                )).first()
                logger.info("Startup data-repair: Created OTOP consignment partner.")

            if _otop:
                _otop_id = _otop[0]
                # 2. Ensure delivery DR-20260803-00004 exists and is linked to OTOP
                _del = _conn.execute(_text(
                    "SELECT id FROM consignment_deliveries WHERE dr_number = 'DR-20260803-00004'"
                )).first()
                if not _del:
                    _conn.execute(_text(
                        "INSERT INTO consignment_deliveries "
                        "(partner_id, delivery_date, dr_number, is_paid) "
                        "VALUES (:pid, '2026-08-03', 'DR-20260803-00004', FALSE)"
                    ), {"pid": _otop_id})
                    _conn.commit()
                    _del = _conn.execute(_text(
                        "SELECT id FROM consignment_deliveries WHERE dr_number = 'DR-20260803-00004'"
                    )).first()
                    logger.info("Startup data-repair: Created delivery DR-20260803-00004.")
                else:
                    # Ensure the delivery is linked to OTOP (not a stale partner_id)
                    _conn.execute(_text(
                        "UPDATE consignment_deliveries SET partner_id = :pid "
                        "WHERE dr_number = 'DR-20260803-00004' AND partner_id != :pid"
                    ), {"pid": _otop_id})
                    _conn.commit()

                # 3. Ensure the delivery has the exact OTOP shipment items (39 jars, 6,010 PHP total reseller value)
                if _del:
                    _del_id = _del[0]
                    _conn.execute(_text("DELETE FROM consignment_items WHERE delivery_id = :did"), {"did": _del_id})
                    _items = [
                        ("CGO-SAM-SVR", 15, 110.0, 130.0, 59.29),  # 15 jars Chili Garlic Oil Sampler 100g = 1,650 PHP
                        ("CM-SAM-SWT",   4, 160.0, 190.0, 52.46),  # 4 jars Creamy Matcha Sampler 100g = 640 PHP
                        ("PP-SAM-SVR",   8, 210.0, 250.0, 104.54), # 8 jars Pesto with Pili Sampler 100g = 1,680 PHP
                        ("YP-SAM-SWT",   8, 130.0, 150.0, 51.60),  # 8 jars Yema with Pili Sampler 100g = 1,040 PHP
                        ("YP-IND-SWT",   4, 250.0, 295.0, 94.69),  # 4 jars Yema with Pili Indulge 240g = 1,000 PHP
                    ]
                    for _sku, _qty, _rp, _sp, _cost in _items:
                        _conn.execute(_text(
                            "INSERT INTO consignment_items "
                            "(delivery_id, sku, qty_delivered, units_sold, qty_pulled_out, "
                            "reseller_price_snapshot, store_price_snapshot, cost_per_unit_snapshot) "
                            "VALUES (:did, :sku, :qty, 0, 0, :rp, :sp, :cost)"
                        ), {"did": _del_id, "sku": _sku, "qty": _qty,
                            "rp": _rp, "sp": _sp, "cost": _cost})
                    _conn.commit()
                    logger.info("Startup data-repair: Replaced items for DR-20260803-00004 (39 jars, Total 6,010 PHP).")
    except Exception as _repair_err:
        logger.warning(f"Startup data-repair (OTOP): {_repair_err}")
    # --- End PostgreSQL-safe data repairs ---

    if engine.dialect.name == "postgresql":
        logger.info(
            "Skipping legacy startup schema bootstrap; PostgreSQL is managed "
            "exclusively by reviewed Supabase migrations."
        )
        return
    try:
        from sqlalchemy import text
        Base.metadata.create_all(bind=engine)
        with engine.connect() as conn:
            startup_statements = [
                "ALTER TABLE product_skus ADD COLUMN is_active BOOLEAN DEFAULT TRUE",
                "UPDATE product_skus SET is_active = TRUE WHERE is_active IS NULL",
                "ALTER TABLE market_events ADD COLUMN initial_cash_balance FLOAT DEFAULT 0.0",
                "ALTER TABLE market_events ADD COLUMN actual_closing_cash FLOAT",
                "ALTER TABLE market_events ADD COLUMN cash_adjustments FLOAT DEFAULT 0.0",
                "ALTER TABLE market_events ADD COLUMN cash_adjustments_notes TEXT DEFAULT ''",
                "ALTER TABLE market_event_sales ADD COLUMN is_preorder BOOLEAN DEFAULT FALSE",
                "ALTER TABLE market_event_sales ADD COLUMN preorder_customer_name VARCHAR(255)",
                "ALTER TABLE market_event_sales ADD COLUMN preorder_payment_status VARCHAR(50)",
                "ALTER TABLE market_event_sales ADD COLUMN preorder_fulfillment_status VARCHAR(50)",
                "ALTER TABLE market_event_sales ADD COLUMN client_reference VARCHAR(64)",
                "ALTER TABLE market_event_sales ADD COLUMN cash_received NUMERIC(12, 2)",
                "ALTER TABLE market_event_sales ADD COLUMN change_given NUMERIC(12, 2) DEFAULT 0.00",
                "ALTER TABLE market_event_sales ADD COLUMN tip_amount NUMERIC(12, 2) DEFAULT 0.00",
                "ALTER TABLE market_event_sales ADD COLUMN payment_reference VARCHAR(100)",
                "ALTER TABLE market_event_sales ADD COLUMN subtotal_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00",
                "ALTER TABLE market_event_sales ADD COLUMN discount_type VARCHAR(20)",
                "ALTER TABLE market_event_sales ADD COLUMN discount_value NUMERIC(12, 2)",
                "ALTER TABLE market_event_sales ADD COLUMN manual_discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00",
                "ALTER TABLE market_event_sales ADD COLUMN promotion_code VARCHAR(50)",
                "ALTER TABLE market_event_sales ADD COLUMN promotion_discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00",
                "ALTER TABLE market_event_sales ADD COLUMN promotion_snapshot TEXT",
                "ALTER TABLE market_event_sales ADD COLUMN discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00",
                "ALTER TABLE market_event_sales ADD COLUMN customer_name VARCHAR(255)",
                (
                    "UPDATE market_event_sales SET subtotal_amount = COALESCE("
                    "(SELECT SUM(item.quantity * item.price_snapshot) "
                    "FROM market_event_sale_items AS item "
                    "WHERE item.sale_id = market_event_sales.id), "
                    "total_amount, 0.00) "
                    "WHERE COALESCE(subtotal_amount, 0.00) = 0.00"
                ),
                (
                    "UPDATE market_event_sales SET discount_amount = CASE "
                    "WHEN subtotal_amount > total_amount "
                    "THEN subtotal_amount - total_amount ELSE 0.00 END, "
                    "manual_discount_amount = COALESCE(manual_discount_amount, 0.00), "
                    "promotion_discount_amount = COALESCE(promotion_discount_amount, 0.00), "
                    "promotion_snapshot = COALESCE("
                    "promotion_snapshot, "
                    "'{\"code\":\"LEGACY\",\"rule\":\"historical_total_only\"}'"
                    ")"
                ),
                (
                    "INSERT INTO market_event_allocations "
                    "(event_id, sku, quantity, wasted_quantity, waste_reason) "
                    "SELECT DISTINCT sale.event_id, item.sku, 0, 0, NULL "
                    "FROM market_event_sales AS sale "
                    "JOIN market_event_sale_items AS item ON item.sale_id = sale.id "
                    "WHERE NOT EXISTS ("
                    "SELECT 1 FROM market_event_allocations AS allocation "
                    "WHERE allocation.event_id = sale.event_id "
                    "AND allocation.sku = item.sku)"
                ),
                "ALTER TABLE market_events ADD COLUMN total_expenses FLOAT DEFAULT 0.0",
                "ALTER TABLE market_events ADD COLUMN expense_notes TEXT DEFAULT ''",
                "ALTER TABLE market_event_allocations ADD COLUMN wasted_quantity INTEGER DEFAULT 0",
                "ALTER TABLE market_event_allocations ADD COLUMN waste_reason VARCHAR(255)",
                "ALTER TABLE market_events ADD COLUMN cash_expenses NUMERIC(12, 2) DEFAULT 0.00",
                "ALTER TABLE market_events ADD COLUMN cash_refunds NUMERIC(12, 2) DEFAULT 0.00",
                "ALTER TABLE market_events ADD COLUMN gcash_sales NUMERIC(12, 2)",
                "ALTER TABLE market_events ADD COLUMN bpi_sales NUMERIC(12, 2)",
                "UPDATE market_events SET cash_expenses = total_expenses WHERE COALESCE(cash_expenses, 0) = 0 AND COALESCE(total_expenses, 0) > 0",
                "ALTER TABLE consignment_partners ADD COLUMN is_active BOOLEAN DEFAULT TRUE",
                "UPDATE consignment_partners SET is_active = FALSE WHERE LOWER(name) IN ('artisan', 'kitchen angels')",
                "ALTER TABLE consignment_items ADD COLUMN food_cost_snapshot FLOAT",
                "ALTER TABLE consignment_items ADD COLUMN labor_cost_snapshot FLOAT",
                "ALTER TABLE consignment_items ADD COLUMN utility_cost_snapshot FLOAT",
                "ALTER TABLE consignment_items ADD COLUMN total_cost_snapshot FLOAT",
                "ALTER TABLE consignment_items ADD COLUMN cost_status_snapshot VARCHAR(30)",
                "ALTER TABLE consignment_items ADD COLUMN cost_snapshot_recorded_at DATETIME",
                "ALTER TABLE users ADD COLUMN hourly_rate FLOAT NOT NULL DEFAULT 0.0",
                "ALTER TABLE timesheet_entries ADD COLUMN production_plan_id INTEGER REFERENCES production_plans(id) ON DELETE SET NULL",
                "ALTER TABLE timesheet_entries ADD COLUMN approved_hourly_rate FLOAT",
                "CREATE INDEX IF NOT EXISTS ix_timesheet_entries_production_plan_id ON timesheet_entries(production_plan_id)",
                "CREATE INDEX IF NOT EXISTS ix_timesheet_entries_labor_summary ON timesheet_entries(review_status, work_date) WHERE review_status = 'Approved'",
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_timesheet_entries_client_reference ON timesheet_entries(client_reference) WHERE client_reference IS NOT NULL",
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_timesheet_entries_machine_identity ON timesheet_entries(machine_employee_id, work_date) WHERE source = 'machine' AND machine_employee_id IS NOT NULL",
            ]
            for stmt in startup_statements:
                try:
                    conn.execute(text(stmt))
                    conn.commit()
                except Exception:
                    conn.rollback()

            # Seed 'Drip Kofi' if not exists
            try:
                res = conn.execute(text("SELECT id FROM consignment_partners WHERE LOWER(name) = 'drip kofi'")).first()
                if not res:
                    conn.execute(text("INSERT INTO consignment_partners (name, discount_rate, collection_frequency, minimum_order_amount, is_active) VALUES ('Drip Kofi', 0.10, 'Weekly', 1500.00, TRUE)"))
                    conn.commit()
            except Exception:
                conn.rollback()

            # Seed / restore 'OTOP' partner and delivery DR-20260803-00004 if not exists
            try:
                res_otop = conn.execute(text("SELECT id FROM consignment_partners WHERE LOWER(name) = 'otop'")).first()
                if not res_otop:
                    conn.execute(text("INSERT INTO consignment_partners (name, discount_rate, collection_frequency, minimum_order_amount, is_active) VALUES ('OTOP', 0.10, 'Monthly', 0.00, TRUE)"))
                    conn.commit()
                    res_otop = conn.execute(text("SELECT id FROM consignment_partners WHERE LOWER(name) = 'otop'")).first()

                if res_otop:
                    otop_id = res_otop[0]
                    del_row = conn.execute(text("SELECT id FROM consignment_deliveries WHERE dr_number = 'DR-20260803-00004'")).first()
                    if not del_row:
                        conn.execute(text("INSERT INTO consignment_deliveries (partner_id, delivery_date, dr_number, is_paid) VALUES (:pid, '2026-08-03', 'DR-20260803-00004', FALSE)"), {"pid": otop_id})
                        conn.commit()
                        del_row = conn.execute(text("SELECT id FROM consignment_deliveries WHERE dr_number = 'DR-20260803-00004'")).first()
                    else:
                        conn.execute(text("UPDATE consignment_deliveries SET partner_id = :pid WHERE id = :did"), {"pid": otop_id, "did": del_row[0]})
                        conn.commit()

                    if del_row:
                        del_id = del_row[0]
                        item_count = conn.execute(text("SELECT COUNT(*) FROM consignment_items WHERE delivery_id = :did"), {"did": del_id}).scalar() or 0
                        if item_count == 0:
                            items_data = [
                                ('YP-IND-SWT', 4, 266.0, 295.0, 85.0),
                                ('YP-SAM-SWT', 6, 135.0, 150.0, 42.0),
                                ('CM-IND-SWT', 4, 338.0, 375.0, 110.0),
                                ('CM-SAM-SWT', 6, 171.0, 190.0, 55.0),
                                ('WM-IND-SWT', 4, 356.0, 395.0, 115.0),
                                ('WM-SAM-SWT', 6, 180.0, 200.0, 58.0),
                                ('PP-IND-SVR', 4, 446.0, 495.0, 145.0),
                                ('PP-SAM-SVR', 6, 225.0, 250.0, 72.0),
                                ('CGO-IND-SVR', 4, 225.0, 250.0, 70.0),
                                ('CGO-SAM-SVR', 6, 117.0, 130.0, 36.0),
                            ]
                            for sku, qty, r_price, s_price, cost in items_data:
                                conn.execute(text(
                                    "INSERT INTO consignment_items (delivery_id, sku, qty_delivered, units_sold, qty_pulled_out, reseller_price_snapshot, store_price_snapshot, cost_per_unit_snapshot) "
                                    "VALUES (:did, :sku, :qty, 0, 0, :r_price, :s_price, :cost)"
                                ), {"did": del_id, "sku": sku, "qty": qty, "r_price": r_price, "s_price": s_price, "cost": cost})
                            conn.commit()
            except Exception as otop_err:
                conn.rollback()
                logger.warning(f"Startup migration warning for OTOP restore: {otop_err}")

            # Ensure preorder_forms columns have server-level defaults
            for alter_stmt in (
                "ALTER TABLE preorder_forms ALTER COLUMN created_at SET DEFAULT NOW()",
                "ALTER TABLE preorder_forms ALTER COLUMN updated_at SET DEFAULT NOW()",
                "ALTER TABLE preorder_forms ALTER COLUMN is_enabled SET DEFAULT FALSE",
                "ALTER TABLE preorder_forms ALTER COLUMN fulfillment_methods_json SET DEFAULT '[]'",
                "ALTER TABLE preorder_forms ALTER COLUMN payment_preferences_json SET DEFAULT '[]'",
                "ALTER TABLE preorder_forms ALTER COLUMN extension_json SET DEFAULT '{}'",
            ):
                try:
                    conn.execute(text(alter_stmt))
                    conn.commit()
                except Exception:
                    conn.rollback()

            # Seed default preorder form if the table is empty
            try:
                existing = conn.execute(text(
                    "SELECT id FROM preorder_forms WHERE token_hash = '37a8eec1ce19687d132fe29051dca629d164e2c4958ba141d5f4133a33f0688f'"
                )).first()
                if not existing:
                    conn.execute(text(
                        "INSERT INTO preorder_forms "
                        "(name, token_hash, token_hint, is_enabled, "
                        " fulfillment_methods_json, payment_preferences_json, extension_json, "
                        " created_at, updated_at) "
                        "VALUES ("
                        "'Default Customer Pre-Order Form', "
                        "'37a8eec1ce19687d132fe29051dca629d164e2c4958ba141d5f4133a33f0688f', "
                        "'default', TRUE, "
                        "'[\"Pickup\",\"Delivery\"]', "
                        "'[\"Cash\",\"GCash\",\"BPI / Bank Transfer\"]', "
                        "'{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                    ))
                    conn.commit()
                    logger.info("Startup migration: Seeded default preorder form.")
            except Exception as pf_err:
                conn.rollback()
                logger.warning(f"Startup migration: Could not seed default preorder form: {pf_err}")
    except Exception as e:
        logger.warning(f"Startup migration warning: {e}")

APP_VERSION = "2.8.0"

app = FastAPI(
    title="Handmade+Homemade Hub API",
    version=APP_VERSION,
    description="Operations and business management API for H+H",
)

SYSTEM_UPDATE_TIMESTAMP = "release-2.8.0-2026-08-04"

# Keep refresh cookies HTTPS-only by default. Local development can opt out
# explicitly without weakening the production configuration.
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "true").lower() != "false"


@app.on_event("startup")
def seed_default_users():
    # Test clients override the request database before entering the app
    # lifespan. Startup writes must respect that isolation boundary instead of
    # mutating the developer's ignored SQLite database behind the test suite.
    if get_db in app.dependency_overrides:
        logger.info("Skipping live startup migrations for an overridden test database.")
        return

    run_startup_migrations()
    if engine.dialect.name == "postgresql":
        logger.info(
            "Skipping legacy PostgreSQL startup seeding; production data and "
            "schema changes are migration-managed."
        )
        return
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
        for statement in (
            "ALTER TABLE market_events ADD COLUMN cash_expenses NUMERIC(12, 2) DEFAULT 0.00",
            "ALTER TABLE market_events ADD COLUMN cash_refunds NUMERIC(12, 2) DEFAULT 0.00",
            "ALTER TABLE market_events ADD COLUMN gcash_sales NUMERIC(12, 2)",
            "ALTER TABLE market_events ADD COLUMN bpi_sales NUMERIC(12, 2)",
        ):
            try:
                db.execute(text(statement))
                db.commit()
            except Exception:
                db.rollback()
        try:
            db.execute(text(
                "UPDATE market_events SET cash_expenses = total_expenses "
                "WHERE COALESCE(cash_expenses, 0) = 0 AND COALESCE(total_expenses, 0) > 0"
            ))
            db.commit()
        except Exception:
            db.rollback()

        # Run live database migrations for market event cash tracking on FastAPI startup
        try:
            db.execute(text("ALTER TABLE market_events ADD COLUMN initial_cash_balance FLOAT DEFAULT 0.0"))
            db.commit()
        except Exception:
            db.rollback()
        try:
            db.execute(text("ALTER TABLE market_events ADD COLUMN actual_closing_cash FLOAT"))
            db.commit()
        except Exception:
            db.rollback()
        try:
            db.execute(text("ALTER TABLE market_events ADD COLUMN cash_adjustments FLOAT DEFAULT 0.0"))
            db.commit()
        except Exception:
            db.rollback()
        try:
            db.execute(text("ALTER TABLE market_events ADD COLUMN cash_adjustments_notes TEXT DEFAULT ''"))
            db.commit()
        except Exception:
            db.rollback()

        # Run live database migrations for market event sales preorder columns on FastAPI startup
        try:
            db.execute(text("ALTER TABLE market_event_sales ADD COLUMN is_preorder BOOLEAN DEFAULT FALSE"))
            db.commit()
        except Exception:
            db.rollback()
        try:
            db.execute(text("ALTER TABLE market_event_sales ADD COLUMN preorder_customer_name VARCHAR(255)"))
            db.commit()
        except Exception:
            db.rollback()
        try:
            db.execute(text("ALTER TABLE market_event_sales ADD COLUMN preorder_payment_status VARCHAR(100)"))
            db.commit()
        except Exception:
            db.rollback()
        try:
            db.execute(text("ALTER TABLE market_event_sales ADD COLUMN preorder_fulfillment_status VARCHAR(100)"))
            db.commit()
        except Exception:
            db.rollback()
        for statement in (
            "ALTER TABLE market_event_sales ADD COLUMN client_reference VARCHAR(64)",
            "ALTER TABLE market_event_sales ADD COLUMN cash_received NUMERIC(12, 2)",
            "ALTER TABLE market_event_sales ADD COLUMN change_given NUMERIC(12, 2) DEFAULT 0.00",
            "ALTER TABLE market_event_sales ADD COLUMN tip_amount NUMERIC(12, 2) DEFAULT 0.00",
            "ALTER TABLE market_event_sales ADD COLUMN payment_reference VARCHAR(100)",
        ):
            try:
                db.execute(text(statement))
                db.commit()
            except Exception:
                db.rollback()

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
        from .database import sync_warehouse_stock_for_main_facility
        sync_warehouse_stock_for_main_facility(db)
        db.commit()
        logger.info("Warehouse stock sync: Main Facility mirror reconciled.")
    except Exception as e:
        db.rollback()
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
    # Ensure tables exist on the very first request (Vercel serverless may skip
    # ASGI startup events). The _migrations_executed flag keeps this O(1) no-op
    # after the first invocation.
    run_startup_migrations()
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
app.include_router(timesheets.router, dependencies=[Depends(auth.get_current_user)])
app.include_router(gift_sets.router, dependencies=[Depends(auth.require_owner)])
app.include_router(market_events.router, dependencies=[Depends(auth.get_current_user)])
app.include_router(sheet_sync.router)
app.include_router(preorders.router)

@app.post("/login", response_model=schemas.LoginResponse)
def login(payload: schemas.LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    username_key = payload.username.strip().casefold()
    forwarded_for = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    client_key = forwarded_for or (request.client.host if request.client else "unknown")
    retry_after = max(username_limiter.retry_after(username_key), client_limiter.retry_after(client_key))
    try:
        retry_after = max(
            retry_after,
            db_username_limiter.retry_after(db, username_key),
            db_client_limiter.retry_after(db, client_key),
        )
    except SQLAlchemyError:
        db.rollback()
        logger.warning("Shared login limiter unavailable; retaining the process-local safety limit.")
    if retry_after:
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Please try again later.",
            headers={"Retry-After": str(retry_after)},
        )
    user = db.query(models.User).filter(models.User.username == payload.username).first()
    if not user or not auth.verify_password(payload.password, user.hashed_password):
        username_limiter.record_failure(username_key)
        client_limiter.record_failure(client_key)
        try:
            db_username_limiter.record_failure(db, username_key)
            db_client_limiter.record_failure(db, client_key)
        except SQLAlchemyError:
            db.rollback()
            logger.warning("Could not persist a failed login attempt; process-local limit remains active.")
        import time
        time.sleep(1.5) # Timing attack mitigation & brute-force delay throttling
        raise HTTPException(status_code=401, detail="Incorrect username or passcode")
    if not user.is_active:
        raise HTTPException(status_code=401, detail="User account is inactive")
        
    username_limiter.clear(username_key)
    try:
        db_username_limiter.clear(db, username_key)
    except SQLAlchemyError:
        db.rollback()
        logger.warning("Could not clear the shared username login limit after successful authentication.")
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

@app.post("/users", response_model=schemas.UserOut, dependencies=[Depends(auth.require_owner)])
def create_user(payload: schemas.UserCreate, db: Session = Depends(get_db)):
    existing = db.query(models.User).filter(models.User.username == payload.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
        
    hashed = auth.get_password_hash(payload.password)
    user = models.User(
        username=payload.username,
        hashed_password=hashed,
        role=payload.role,
        is_active=True,
        hourly_rate=payload.hourly_rate,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.get("/users", response_model=List[schemas.UserOut], dependencies=[Depends(auth.require_owner)])
def list_users(db: Session = Depends(get_db)):
    return db.query(models.User).order_by(models.User.username.asc()).all()


@app.patch("/users/{user_id}", response_model=schemas.UserOut, dependencies=[Depends(auth.require_owner)])
def update_user(user_id: int, payload: schemas.UserUpdate, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User account not found")
    user.hourly_rate = payload.hourly_rate
    if payload.hourly_rate > 0:
        db.query(models.TimesheetEntry).filter(
            models.TimesheetEntry.employee_user_id == user.id,
            models.TimesheetEntry.review_status == "Approved",
            or_(
                models.TimesheetEntry.approved_hourly_rate.is_(None),
                models.TimesheetEntry.approved_hourly_rate <= 0,
            ),
        ).update({models.TimesheetEntry.approved_hourly_rate: payload.hourly_rate}, synchronize_session=False)
    db.commit()
    db.refresh(user)
    return user

@app.post("/admin/reset-test-data", dependencies=[Depends(auth.require_owner)])
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
        db.query(models.IngredientPriceHistory).delete()
        
        # 5. Clear production batches & plans
        db.query(models.ProductionBatch).delete()
        db.query(models.ProductionTarget).delete()
        db.query(models.ProductionPlan).delete()

        # 5b. Clear dynamic attendance records and attached manual proof images.
        db.query(models.TimesheetEntry).delete()
        
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

    old_stock = float(product.warehouse_stock or 0)

    try:
        changes = apply_product_updates(product, changes)
    except MasterDataValidationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    new_stock = float(product.warehouse_stock or 0)
    stock_supplied = "warehouse_stock" in changes
    stock_changed = stock_supplied and new_stock != old_stock

    try:
        if stock_changed:
            db.add(models.InventoryTransaction(
                sku=product.sku,
                transaction_type="manual_adjustment",
                qty=new_stock - old_stock,
                user_id=current_user.id,
                notes="Manual finished goods stock adjustment from web inventory screen.",
            ))
        if stock_supplied:
            sync_warehouse_stock_for_main_facility(db, sku=product.sku)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.exception("Product update rolled back because stock synchronization failed.")
        raise HTTPException(
            status_code=500,
            detail="Product update failed; no inventory changes were saved.",
        ) from e

    clear_costing_cache()
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

    if payload.quantity <= 0:
        raise HTTPException(status_code=422, detail="Batch intake quantity must be greater than zero.")

    try:
        old_stock = float(ing.available_stock or 0.0)
        ing.available_stock = old_stock + float(payload.quantity)

        new_batch = models.IngredientBatch(
            raw_ingredient_id=payload.raw_ingredient_id,
            batch_code=payload.batch_code,
            quantity=payload.quantity,
            expiry_date=payload.expiry_date,
        )
        db.add(new_batch)

        db.add(models.InventoryTransaction(
            raw_ingredient_id=payload.raw_ingredient_id,
            transaction_type="receive",
            qty=float(payload.quantity),
            user_id=current_user.id,
            batch_reference=payload.batch_code,
            notes=f"Received intake batch {payload.batch_code} (Expiry: {payload.expiry_date or 'None'}) added to warehouse stock.",
        ))

        sync_warehouse_stock_for_main_facility(
            db,
            raw_ingredient_id=payload.raw_ingredient_id,
        )
        db.commit()
    except Exception as e:
        db.rollback()
        logger.exception("Raw-material intake rolled back because stock synchronization failed.")
        raise HTTPException(
            status_code=500,
            detail="Batch intake failed; no inventory changes were saved.",
        ) from e

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

    old_stock = float(ing.available_stock or 0.0)
    old_price = float(ing.price or 0.0)
    old_net_weight = float(ing.net_weight or 0.0)

    for k, v in changes.items():
        if isinstance(v, str):
            v = sanitize_html(v)
        setattr(ing, k, v)

    # SQLite has no matching database trigger and older PostgreSQL rows can
    # retain the previous value until an update is flushed.  Keep the stored
    # compatibility field synchronized whenever pack price/content changes;
    # the costing engine performs any required kg/g conversion at use time.
    if "price" in changes or "net_weight" in changes:
        ing.cost_per_gram_unit = (
            (ing.price or 0.0) / ing.net_weight
            if ing.net_weight and ing.net_weight > 0.0
            else 0.0
        )

    new_stock = float(ing.available_stock or 0.0)
    stock_supplied = "available_stock" in changes
    stock_changed = stock_supplied and new_stock != old_stock
    costing_inputs_changed = bool({"price", "net_weight", "unit"}.intersection(changes))
    price_basis_changed = bool({"price", "net_weight"}.intersection(changes)) and (
        float(ing.price or 0.0) != old_price
        or float(ing.net_weight or 0.0) != old_net_weight
    )

    try:
        if stock_changed:
            db.add(models.InventoryTransaction(
                raw_ingredient_id=ing.id,
                transaction_type="manual_adjustment",
                qty=new_stock - old_stock,
                user_id=current_user.id,
                notes="Manual raw material stock adjustment from web inventory screen.",
            ))

            from .services.fifo_service import FifoService
            FifoService.adjust_ingredient_batches_on_manual(
                ing.id,
                old_stock,
                new_stock,
                current_user.id,
                db,
            )
        if stock_supplied:
            sync_warehouse_stock_for_main_facility(
                db,
                raw_ingredient_id=ing.id,
            )

        if price_basis_changed:
            new_price = float(ing.price or 0.0)
            new_net_weight = float(ing.net_weight or 0.0)
            db.add(models.IngredientPriceHistory(
                raw_ingredient_id=ing.id,
                previous_price=old_price,
                new_price=new_price,
                previous_net_weight=old_net_weight,
                new_net_weight=new_net_weight,
                previous_unit_cost=(
                    old_price / old_net_weight if old_net_weight > 0.0 else 0.0
                ),
                new_unit_cost=(
                    new_price / new_net_weight if new_net_weight > 0.0 else 0.0
                ),
                changed_by_user_id=current_user.id,
                source="inventory_edit",
            ))

        # Downstream COGS readers use ProductSKU.cost_per_unit.  Stage those
        # snapshots without invoking the costing service's commit path so raw
        # edits and inventory synchronization remain one atomic transaction.
        if costing_inputs_changed:
            clear_costing_cache()
            computed_costs = CostingService.compute_all_sku_costs_in_memory(
                db,
                persist=False,
            )
            products = db.query(models.ProductSKU).filter(
                models.ProductSKU.sku.in_(computed_costs)
            ).all()
            for product in products:
                product.cost_per_unit = computed_costs[product.sku]

        db.commit()
    except Exception as e:
        db.rollback()
        logger.exception("Raw-material update rolled back because stock synchronization failed.")
        raise HTTPException(
            status_code=500,
            detail="Raw-material update failed; no inventory changes were saved.",
        ) from e

    clear_costing_cache()
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
    inventory_valuation = float(db.query(
        func.sum(models.RawIngredient.available_stock * models.RawIngredient.cost_per_gram_unit)
    ).scalar() or 0.0)

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
    total_sales_revenue = float(res[3] or 0.0)
    total_payout_cost = float(res[4] or 0.0)

    overall_efficiency = (total_sold / total_delivered * 100.0) if total_delivered > 0 else 0.0
    overall_waste_pct = (total_wasted / total_delivered * 100.0) if total_delivered > 0 else 0.0

    # 4. Reseller Sales revenue (calculated in DB)
    total_reseller_revenue = float(
        db.query(func.sum(models.ResellerOrder.grand_total)).scalar() or 0.0
    )

    # 4b. Market Events Sales revenue (calculated in DB, filtering out soft-deleted events)
    total_market_revenue = float(db.query(
        func.sum(models.MarketEventSale.total_amount)
    ).join(
        models.MarketEvent, models.MarketEventSale.event_id == models.MarketEvent.id
    ).filter(
        models.MarketEvent.is_deleted == False
    ).scalar() or 0.0)

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
    period: str = Query(default="all", pattern=r"^(all|7d|30d|custom|week)$"),
    date_from: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
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

    manila_now = datetime.now(timezone(timedelta(hours=8), name="Asia/Manila"))
    today_date = manila_now.date()
    today_str = today_date.isoformat()
    warning_date = today_date + timedelta(days=15)

    period_start = None
    period_end = today_date
    if period == "week":
        period_start = today_date - timedelta(days=today_date.weekday())
        period_end = period_start + timedelta(days=6)
    elif period == "7d":
        period_start = today_date - timedelta(days=6)
    elif period == "30d":
        period_start = today_date - timedelta(days=29)
    elif period == "custom":
        if not date_from or not date_to:
            raise HTTPException(status_code=400, detail="Custom dashboard periods require both start and end dates.")
        try:
            period_start = datetime.strptime(date_from, "%Y-%m-%d").date()
            period_end = datetime.strptime(date_to, "%Y-%m-%d").date()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Dashboard dates must use YYYY-MM-DD.") from exc
        if period_end < period_start:
            raise HTTPException(status_code=400, detail="Dashboard end date cannot be before start date.")
        if (period_end - period_start).days > 366:
            raise HTTPException(status_code=400, detail="Dashboard custom periods are limited to 366 days.")

    period_start_str = period_start.isoformat() if period_start else None
    period_end_str = period_end.isoformat()
    market_period_start = datetime.combine(period_start, datetime.min.time()) if period_start else None
    market_period_end = datetime.combine(period_end + timedelta(days=1), datetime.min.time())

    # 1. KPIs (identical to get_dashboard_analytics but in same session)
    inventory_valuation = float(db.query(
        func.sum(models.RawIngredient.available_stock * models.RawIngredient.cost_per_gram_unit)
    ).scalar() or 0.0)
    raw_items_count = db.query(models.RawIngredient).count()
    partners_count = db.query(models.ConsignmentPartner).count()

    consignment_totals_query = db.query(
        func.sum(models.ConsignmentItem.qty_delivered),
        func.sum(models.ConsignmentItem.units_sold),
        func.sum(models.ConsignmentItem.qty_pulled_out),
        func.sum(models.ConsignmentItem.units_sold * models.ConsignmentItem.reseller_price_snapshot),
        func.sum(models.ConsignmentItem.qty_delivered * models.ConsignmentItem.cost_per_unit_snapshot)
    ).join(models.ConsignmentDelivery, models.ConsignmentItem.delivery_id == models.ConsignmentDelivery.id)
    if period_start_str:
        consignment_totals_query = consignment_totals_query.filter(
            models.ConsignmentDelivery.delivery_date >= period_start_str,
            models.ConsignmentDelivery.delivery_date <= period_end_str,
        )
    res = consignment_totals_query.first()

    total_delivered = res[0] or 0
    total_sold = res[1] or 0
    total_wasted = res[2] or 0
    total_sales_revenue = float(res[3] or 0.0)
    total_payout_cost = float(res[4] or 0.0)

    overall_efficiency = (total_sold / total_delivered * 100.0) if total_delivered > 0 else 0.0
    overall_waste_pct = (total_wasted / total_delivered * 100.0) if total_delivered > 0 else 0.0

    reseller_revenue_query = db.query(func.sum(models.ResellerOrder.grand_total))
    if period_start_str:
        reseller_revenue_query = reseller_revenue_query.filter(
            models.ResellerOrder.order_date >= period_start_str,
            models.ResellerOrder.order_date <= period_end_str,
        )
    total_reseller_revenue = float(reseller_revenue_query.scalar() or 0.0)

    market_revenue_query = db.query(
        func.sum(models.MarketEventSale.total_amount)
    ).join(
        models.MarketEvent, models.MarketEventSale.event_id == models.MarketEvent.id
    ).filter(
        models.MarketEvent.is_deleted == False
    )
    if market_period_start:
        market_revenue_query = market_revenue_query.filter(
            models.MarketEventSale.timestamp >= market_period_start,
            models.MarketEventSale.timestamp < market_period_end,
        )
    # PostgreSQL returns ``Decimal`` for the NUMERIC market-sale total while
    # the consignment and reseller aggregates are floats. Normalize at the DB
    # boundary so a live market sale cannot crash the dashboard with a
    # float-plus-Decimal TypeError.
    total_market_revenue = float(market_revenue_query.scalar() or 0.0)
    total_revenue = total_sales_revenue + total_reseller_revenue + total_market_revenue
    net_consignment_profit = total_sales_revenue - total_payout_cost

    # Unified COGS & Profit calculations
    consignment_cogs_query = db.query(
        func.sum(models.ConsignmentItem.units_sold * models.ConsignmentItem.cost_per_unit_snapshot)
    ).join(models.ConsignmentDelivery, models.ConsignmentItem.delivery_id == models.ConsignmentDelivery.id)
    if period_start_str:
        consignment_cogs_query = consignment_cogs_query.filter(
            models.ConsignmentDelivery.delivery_date >= period_start_str,
            models.ConsignmentDelivery.delivery_date <= period_end_str,
        )
    consignment_cogs = float(consignment_cogs_query.scalar() or 0.0)

    reseller_cogs_query = db.query(
        func.sum(models.ResellerOrderItem.quantity * models.ProductSKU.cost_per_unit)
    ).join(
        models.ProductSKU, models.ResellerOrderItem.sku == models.ProductSKU.sku
    ).join(models.ResellerOrder, models.ResellerOrderItem.order_id == models.ResellerOrder.id)
    if period_start_str:
        reseller_cogs_query = reseller_cogs_query.filter(
            models.ResellerOrder.order_date >= period_start_str,
            models.ResellerOrder.order_date <= period_end_str,
        )
    reseller_cogs = float(reseller_cogs_query.scalar() or 0.0)

    market_cogs_query = db.query(
        func.sum(models.MarketEventSaleItem.quantity * models.ProductSKU.cost_per_unit)
    ).join(
        models.ProductSKU, models.MarketEventSaleItem.sku == models.ProductSKU.sku
    ).join(
        models.MarketEventSale, models.MarketEventSaleItem.sale_id == models.MarketEventSale.id
    ).join(
        models.MarketEvent, models.MarketEventSale.event_id == models.MarketEvent.id
    ).filter(
        models.MarketEvent.is_deleted == False
    )
    if market_period_start:
        market_cogs_query = market_cogs_query.filter(
            models.MarketEventSale.timestamp >= market_period_start,
            models.MarketEventSale.timestamp < market_period_end,
        )
    market_cogs = float(market_cogs_query.scalar() or 0.0)

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
    ).join(
        models.MarketEventSale, models.MarketEventSaleItem.sale_id == models.MarketEventSale.id
    ).join(
        models.MarketEvent, models.MarketEventSale.event_id == models.MarketEvent.id
    ).filter(
        models.MarketEvent.is_deleted == False,
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
        "period": period,
        "period_start": period_start_str,
        "period_end": period_end_str if period_start_str else None,
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
        "pending_timesheets_count": db.query(models.TimesheetEntry).filter(
            models.TimesheetEntry.review_status == "Pending",
            *([] if current_user.role == "owner" else [models.TimesheetEntry.employee_user_id == current_user.id]),
        ).count(),
    }
    if current_user.role == "owner":
        from .services.owner_dashboard_service import build_owner_weekly_dashboard

        owner_period_start = period_start
        owner_period_end = period_end
        if owner_period_start is None:
            owner_period_start = today_date - timedelta(days=today_date.weekday())
            owner_period_end = owner_period_start + timedelta(days=6)
        response.update({
            "low_margin_products": low_margin_products,
            "unpaid_deliveries": unpaid_deliveries_list,
            "total_unpaid_ar": round(total_unpaid_ar, 2),
            "top_margins": top_margins,
            "low_margins": low_margins,
            "category_averages": category_averages,
            "missing_cost_warnings_count": len([
                item for item in cost_analysis if item.get("cost_status", "ok") != "ok"
            ]),
            "owner_weekly": build_owner_weekly_dashboard(
                db,
                owner_period_start,
                owner_period_end,
                now=manila_now,
            ),
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

    if payload.source_warehouse_id == 1 or payload.destination_warehouse_id == 1:
        from .database import sync_warehouse_stock_for_main_facility
        if item_type == "raw":
            sync_warehouse_stock_for_main_facility(db, raw_ingredient_id=item_id)
        else:
            sync_warehouse_stock_for_main_facility(db, sku=sku)

    return {"detail": f"Successfully transferred {payload.quantity} units of {item_name} from {src_wh.name} to {dest_wh.name}"}


# ----------------------------------------------------
# DATABASE BACKUP ENDPOINT
# ----------------------------------------------------
@app.get("/backup", dependencies=[Depends(auth.require_owner)])
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

@app.post("/push/subscribe")
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

@app.post("/push/test", dependencies=[Depends(auth.require_owner)])
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
        return {
            "status": "healthy",
            "database": "online",
            "environment": os.getenv("ENVIRONMENT", os.getenv("VERCEL_ENV", "development"))
        }
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Database connection error: {str(e)}"
        )


@app.get("/version")
def get_version():
    return {
        "version": app.version,
        "update_timestamp": SYSTEM_UPDATE_TIMESTAMP
    }


@app.post("/admin/force-refresh")
def force_refresh_all_devices(current_user: models.User = Depends(auth.require_owner)):
    global SYSTEM_UPDATE_TIMESTAMP
    import time
    SYSTEM_UPDATE_TIMESTAMP = f"force-{time.time()}"
    return {"message": "Force refresh signal sent to all devices", "update_timestamp": SYSTEM_UPDATE_TIMESTAMP}
