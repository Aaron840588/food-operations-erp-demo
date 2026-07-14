import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Load .env file from the root folder
ROOT_DIR = os.path.dirname(os.path.dirname(BASE_DIR))
dotenv_path = os.path.join(ROOT_DIR, ".env")
load_dotenv(dotenv_path)

DEFAULT_DB_PATH = os.path.join(os.path.dirname(BASE_DIR), "happy_noether.db")
DATABASE_URL = os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL") or f"sqlite:///{DEFAULT_DB_PATH}"

# Clean prefix if the user accidentally pasted "DATABASE_URL=" as part of the value
if DATABASE_URL.startswith("DATABASE_URL="):
    DATABASE_URL = DATABASE_URL.replace("DATABASE_URL=", "", 1)

# SQLAlchemy 1.4+ deprecated 'postgres://' in favor of 'postgresql://'
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Demo Mode Protection & Separation
DEMO_MODE = (os.getenv("DEMO_MODE") == "true") or (os.getenv("ENVIRONMENT") == "demo")
PRODUCTION_REF_ID = "lstdqfvbhimqrhhgrnqy"

if DEMO_MODE and DATABASE_URL:
    if PRODUCTION_REF_ID in DATABASE_URL:
        raise RuntimeError(
            "CRITICAL SECURITY ERROR: Connection to the PRODUCTION Supabase database is BLOCKED in DEMO_MODE!"
        )

# Enable foreign key support for SQLite
connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

# Configure connection pool settings for Postgres (essential for Supabase serverless stability)
pool_args = {}
if not DATABASE_URL.startswith("sqlite"):
    pool_args = {
        "pool_size": 5,
        "max_overflow": 10,
        "pool_recycle": 300,
        "pool_pre_ping": True
    }

engine = create_engine(DATABASE_URL, connect_args=connect_args, **pool_args)

# For SQLite, ensure foreign keys are enabled on connection
if DATABASE_URL.startswith("sqlite"):
    from sqlalchemy import event
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def sync_warehouse_stock_for_main_facility(db, raw_ingredient_id=None, sku=None):
    """
    Synchronizes the primary warehouse_stocks table for the default 'Main Facility' (ID: 1)
    with RawIngredient.available_stock and ProductSKU.warehouse_stock values.
    """
    from . import models
    if raw_ingredient_id:
        ing = db.query(models.RawIngredient).filter(models.RawIngredient.id == raw_ingredient_id).first()
        if ing:
            stock = db.query(models.WarehouseStock).filter(
                models.WarehouseStock.warehouse_id == 1,
                models.WarehouseStock.raw_ingredient_id == raw_ingredient_id
            ).first()
            qty_val = float(ing.available_stock or 0.0)
            if stock:
                stock.quantity = qty_val
            else:
                stock = models.WarehouseStock(
                    warehouse_id=1,
                    raw_ingredient_id=raw_ingredient_id,
                    quantity=qty_val
                )
                db.add(stock)
    elif sku:
        prod = db.query(models.ProductSKU).filter(models.ProductSKU.sku == sku).first()
        if prod:
            stock = db.query(models.WarehouseStock).filter(
                models.WarehouseStock.warehouse_id == 1,
                models.WarehouseStock.sku == sku
            ).first()
            qty_val = float(prod.warehouse_stock or 0)
            if stock:
                stock.quantity = qty_val
            else:
                stock = models.WarehouseStock(
                    warehouse_id=1,
                    sku=sku,
                    quantity=qty_val
                )
                db.add(stock)
