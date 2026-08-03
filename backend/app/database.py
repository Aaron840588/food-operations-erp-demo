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
    Stage Main Facility mirror updates in the caller's current transaction.

    This helper deliberately never commits or rolls back.  Callers own the
    complete unit of work so a mirror failure cannot leave the legacy stock,
    FIFO batches, or inventory ledger committed independently.
    """
    from . import models

    if raw_ingredient_id is not None and sku is not None:
        raise ValueError("Provide either raw_ingredient_id or sku, not both.")

    # All inventory readers treat warehouse ID 1 as Main Facility.  Keep that
    # stable instead of silently redirecting stock to an arbitrary warehouse.
    target_wh = db.query(models.Warehouse).filter(models.Warehouse.id == 1).first()
    if target_wh is None:
        named_main_facility = db.query(models.Warehouse).filter(
            models.Warehouse.name == "Main Facility"
        ).first()
        if named_main_facility is not None:
            raise RuntimeError(
                "Main Facility exists with a noncanonical ID; expected warehouse ID 1."
            )
    if target_wh is None:
        target_wh = models.Warehouse(id=1, name="Main Facility", is_active=True)
        db.add(target_wh)
        db.flush()

    target_wh_id = target_wh.id

    if raw_ingredient_id is not None:
        ingredient = db.query(models.RawIngredient).filter(
            models.RawIngredient.id == raw_ingredient_id
        ).first()
        if ingredient is None:
            raise LookupError(f"Raw ingredient {raw_ingredient_id} not found.")

        stock = db.query(models.WarehouseStock).filter(
            models.WarehouseStock.warehouse_id == target_wh_id,
            models.WarehouseStock.raw_ingredient_id == raw_ingredient_id,
        ).order_by(models.WarehouseStock.id.asc()).first()
        quantity = float(ingredient.available_stock or 0.0)
        if stock is None:
            stock = models.WarehouseStock(
                warehouse_id=target_wh_id,
                raw_ingredient_id=raw_ingredient_id,
                quantity=quantity,
            )
            db.add(stock)
        else:
            stock.quantity = quantity
        db.flush()
        return stock

    if sku is not None:
        product = db.query(models.ProductSKU).filter(
            models.ProductSKU.sku == sku
        ).first()
        if product is None:
            raise LookupError(f"Product SKU {sku} not found.")

        stock = db.query(models.WarehouseStock).filter(
            models.WarehouseStock.warehouse_id == target_wh_id,
            models.WarehouseStock.sku == sku,
        ).order_by(models.WarehouseStock.id.asc()).first()
        quantity = float(product.warehouse_stock or 0)
        if stock is None:
            stock = models.WarehouseStock(
                warehouse_id=target_wh_id,
                sku=sku,
                quantity=quantity,
            )
            db.add(stock)
        else:
            stock.quantity = quantity
        db.flush()
        return stock

    # Bulk reconciliation fetches each table once instead of issuing a mirror
    # lookup for every product and ingredient.
    existing_stocks = db.query(models.WarehouseStock).filter(
        models.WarehouseStock.warehouse_id == target_wh_id
    ).order_by(models.WarehouseStock.id.asc()).all()
    product_stocks = {
        stock.sku: stock
        for stock in existing_stocks
        if stock.sku is not None and stock.sku not in (None, "")
    }
    ingredient_stocks = {
        stock.raw_ingredient_id: stock
        for stock in existing_stocks
        if stock.raw_ingredient_id is not None
    }

    for product in db.query(models.ProductSKU).all():
        quantity = float(product.warehouse_stock or 0)
        stock = product_stocks.get(product.sku)
        if stock is None:
            db.add(models.WarehouseStock(
                warehouse_id=target_wh_id,
                sku=product.sku,
                quantity=quantity,
            ))
        else:
            stock.quantity = quantity

    for ingredient in db.query(models.RawIngredient).all():
        quantity = float(ingredient.available_stock or 0.0)
        stock = ingredient_stocks.get(ingredient.id)
        if stock is None:
            db.add(models.WarehouseStock(
                warehouse_id=target_wh_id,
                raw_ingredient_id=ingredient.id,
                quantity=quantity,
            ))
        else:
            stock.quantity = quantity

    db.flush()

