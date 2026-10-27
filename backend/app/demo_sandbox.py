"""Stateless, isolated demo transport for the ORIGINAL ERP endpoints.

Each call reconstructs a private in-memory SQLite workspace from bounded,
parameterized row data, executes the existing business handler, and returns a
compressed state snapshot. No production engine, credentials, or cloud clients
are used. Browser state is deliberately untrusted and has no real authority.
"""
from __future__ import annotations

import base64
import asyncio
import hashlib
import json
import zlib
from contextvars import ContextVar
from datetime import date, timedelta
from pathlib import Path

import httpx2 as httpx
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from . import auth, models
from .database import Base, get_db, sync_warehouse_stock_for_main_facility
from .services.costing_service import CostingService, isolated_demo_costing

MAX_STATE = 2_000_000
MAX_ROWS = 5000
_session: ContextVar[Session] = ContextVar("demo_database")
_role: ContextVar[str] = ContextVar("demo_role", default="owner")
EXCLUDED_TABLES = {"refresh_tokens", "push_subscriptions", "login_rate_limits"}
TABLES = [table for table in Base.metadata.sorted_tables if table.name not in EXCLUDED_TABLES]
_capacity = asyncio.Semaphore(8)
PREFIXES = ("/products", "/raw-ingredients", "/suppliers", "/warehouses", "/inventory-transactions", "/dashboard", "/costing", "/production", "/consignment", "/resellers", "/tasks", "/timesheets", "/gift-sets", "/users", "/preorders", "/mrp", "/market-events", "/sample-export")


class DemoCall(BaseModel):
    path: str = Field(max_length=1500)
    method: str = Field(default="GET", pattern="^(GET|POST|PUT|PATCH|DELETE)$")
    payload: dict | list | None = None
    state: str | None = Field(default=None, max_length=MAX_STATE)
    role: str = Field(default="owner", pattern="^(owner|staff)$")


def snapshot(db: Session) -> str:
    tables = {}
    count = 0
    for table in TABLES:
        rows = [dict(row._mapping) for row in db.execute(text(f'SELECT * FROM "{table.name}"'))]
        if table.name == "users":
            for row in rows:
                row["hashed_password"] = "demo-login-disabled"
        count += len(rows)
        tables[table.name] = rows
    if count > MAX_ROWS:
        raise HTTPException(413, "Sample workspace is full. Reset the demo to continue.")
    encoded = json.dumps(tables, separators=(",", ":"), allow_nan=False).encode()
    if len(encoded) > MAX_STATE:
        raise HTTPException(413, "Sample workspace is full. Reset the demo to continue.")
    return base64.b64encode(zlib.compress(encoded)).decode()


def restore(db: Session, state: str):
    try:
        packed = base64.b64decode(state, validate=True)
        inflater = zlib.decompressobj()
        raw = inflater.decompress(packed, MAX_STATE + 1)
        if len(raw) > MAX_STATE or not inflater.eof or inflater.unused_data:
            raise ValueError("state limit")
        data = json.loads(raw)
        allowed = {t.name: t for t in TABLES}
        if not isinstance(data, dict) or set(data) != set(allowed):
            raise ValueError("table set")
        count = 0
        # Insert bound scalar values only; never execute SQL received from a client.
        for table in TABLES:
            rows = data[table.name]
            if not isinstance(rows, list):
                raise ValueError("rows")
            count += len(rows)
            if count > MAX_ROWS:
                raise ValueError("row limit")
            keys = [c.name for c in table.columns]
            for row in rows:
                if not isinstance(row, dict) or set(row) != set(keys) or any(not isinstance(v, (str, int, float, bool, type(None))) for v in row.values()):
                    raise ValueError("columns")
            if rows:
                cols = ','.join(f'"{key}"' for key in keys)
                binds = ','.join(f':{key}' for key in keys)
                db.execute(text(f'INSERT INTO "{table.name}" ({cols}) VALUES ({binds})'), rows)
        db.commit()
    except Exception as error:
        db.rollback()
        raise HTTPException(400, "Invalid or outdated sample workspace. Reset the demo.") from error


def seed(db: Session):
    today = date.today()
    db.add_all([
        models.User(id=1, username="Sample Owner", hashed_password="demo-login-disabled", role="owner", hourly_rate=100),
        models.User(id=2, username="Sample Staff", hashed_password="demo-login-disabled", role="staff", hourly_rate=85),
        models.Supplier(id=1, name="Sample pantry supplier", contact_person="Fictional supplier", email="pantry@example.invalid"),
        models.Warehouse(id=1, name="Main Facility", location="Sample kitchen"),
        models.Warehouse(id=2, name="Sample market stall", location="Fictional market"),
        models.ConsignmentPartner(id=1, name="Sample cafÃ©", discount_rate=0.1, minimum_order_amount=0),
        models.ConsignmentPartner(id=2, name="Sample grocery", discount_rate=0.12, minimum_order_amount=0),
        models.DiscountTier(min_subtotal=0, discount_percentage=10),
        models.DiscountTier(min_subtotal=2000, discount_percentage=15),
        models.CleaningTask(task_name="Sanitize preparation surfaces", frequency="Daily"),
        models.CleaningTask(task_name="Clean storage shelves", frequency="Weekly"),
        models.MaintenanceAsset(area="Kitchen", item_name="Sample refrigerator", style_or_kind="Cold storage"),
        models.CategoryOverheadRate(category="Spreads & Sauces", labor_cost_per_unit=12, utility_cost_per_unit=5),
        models.CategoryOverheadRate(category="Sandwiches & Salads", labor_cost_per_unit=15, utility_cost_per_unit=4),
    ])
    db.flush()
    ingredients = [("Basil", 300, 1000), ("Olive oil", 500, 1000), ("Tomatoes", 120, 1000), ("Bread", 100, 20), ("Lettuce", 100, 1000), ("Jar", 12, 1)]
    for i, (name, price, weight) in enumerate(ingredients, 1):
        unit = "pc" if name in ("Bread", "Jar") else "g"
        qty = 200 if unit == "pc" else 20000
        db.add(models.RawIngredient(id=i, name=name, category="Packaging" if name == "Jar" else "Ingredients", unit=unit, price=price, net_weight=weight, cost_per_gram_unit=price / weight, available_stock=qty, reorder_level=20, supplier_id=1))
        db.add(models.IngredientBatch(raw_ingredient_id=i, batch_code=f"SAMPLE-{i}", quantity=qty, expiry_date=(today+timedelta(days=45)).isoformat()))
    db.flush()
    catalog = [("PESTO-180", "Basil pesto", "Spreads & Sauces", "180g", 240, [(1,100),(2,70),(6,1)]), ("TOMATO-250", "Roasted tomato sauce", "Spreads & Sauces", "250g", 190, [(3,240),(2,10),(6,1)]), ("SANDWICH-1", "Garden sandwich", "Sandwiches & Salads", "1 pc", 180, [(4,2),(5,80)])]
    for sku, name, category, size, price, recipe in catalog:
        db.add(models.ProductSKU(sku=sku, product_name=name, category=category, size=size, retail_price=price, reseller_price=price*.9, warehouse_stock=60, labor_cost=12, utility_cost=5))
        db.flush()
        item = models.Recipe(sku=sku, yield_weight=1, yield_unit="pc", portion_size=1, portion_unit="pc", notes="Fictional sample recipe. Illustrative quantities and costs.")
        db.add(item)
        db.flush()
        for ingredient_id, qty in recipe:
            db.add(models.RecipeItem(recipe_id=item.id, ingredient_type="raw", raw_ingredient_id=ingredient_id, base_qty=qty, base_unit="pc" if ingredient_id in (4,6) else "g"))
    db.flush()
    for ingredient in db.query(models.RawIngredient).all():
        sync_warehouse_stock_for_main_facility(db, raw_ingredient_id=ingredient.id)
    for product in db.query(models.ProductSKU).all():
        sync_warehouse_stock_for_main_facility(db, sku=product.sku)
    db.add(models.MarketEvent(id=1, name="Sample weekend market", event_date=today.isoformat(), location="Fictional town square", staff_assigned="Sample Staff", status="Draft", initial_cash_balance=500))
    demo_token = "sample-public-order-form-000000000001"
    db.add(models.PreorderForm(name="Fictional sample preorder form", token_hash=hashlib.sha256(demo_token.encode()).hexdigest(), token_hint=demo_token[-8:], is_enabled=True))
    db.commit()
    CostingService.compute_all_sku_costs_in_memory(db, persist=True)


def install_demo_sandbox(app: FastAPI):
    sandbox = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    # Rebuild routes with a separate dependency provider. Never override the real app.
    sandbox.include_router(app.router)
    sandbox.router.on_startup.clear()
    sandbox.router.on_shutdown.clear()

    def demo_db():
        yield _session.get()

    def demo_user(db: Session = Depends(get_db)):
        return db.get(models.User, 1 if _role.get() == "owner" else 2)

    sandbox.dependency_overrides[get_db] = demo_db
    sandbox.dependency_overrides[auth.get_current_user] = demo_user

    @app.post("/demo-workspace", include_in_schema=False)
    async def call_demo(request: Request):
        if request.headers.get("content-length", "0").isdigit() and int(request.headers.get("content-length", "0")) > MAX_STATE + 100_000:
            raise HTTPException(413, "Sample request is too large.")
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > MAX_STATE + 100_000:
                raise HTTPException(413, "Sample request is too large.")
            body.extend(chunk)
        try:
            call = DemoCall.model_validate_json(bytes(body))
        except Exception as error:
            raise HTTPException(400, "Invalid sample request.") from error
        path = call.path.split("?", 1)[0]
        if ".." in path or "%" in path or "\\" in path or "#" in call.path or not path.startswith("/"):
            raise HTTPException(400, "Invalid sample endpoint.")
        if not any(path == prefix or path.startswith(prefix + "/") for prefix in PREFIXES):
            raise HTTPException(400, "This connection is outside the fictional workspace.")
        if path.endswith("/upload") or path.endswith("/manual"):
            raise HTTPException(400, "Use synthetic timesheet import rows in the public demo; private files and proof photos are not accepted.")
        async with _capacity:
            engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
            connection = engine.raw_connection()
            connection.executescript(Path(__file__).with_name("resources").joinpath("demo-schema.sql").read_text())
            connection.close()
            db = Session(engine)
            token = _session.set(db)
            role_token = _role.set(call.role)
            cache_token = isolated_demo_costing.set(True)
            try:
                if call.state:
                    restore(db, call.state)
                else:
                    seed(db)
                if path == '/sample-export':
                    if call.role != 'owner' or call.method != 'GET':
                        raise HTTPException(403, 'Sample owner view is required for export.')
                    encoded = snapshot(db)
                    rows = json.loads(zlib.decompress(base64.b64decode(encoded)))
                    for user in rows.get('users', []):
                        user.pop('hashed_password', None)
                    for form in rows.get('preorder_forms', []):
                        form.pop('token_hash', None)
                    return JSONResponse({'state': encoded, 'data': {'notice': 'Fictional sample data only', 'tables': rows}, 'status': 200}, headers={'Cache-Control': 'no-store'})
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=sandbox, raise_app_exceptions=False), base_url="http://isolated-demo.invalid") as client:
                    response = await client.request(call.method, call.path, json=call.payload)
                if response.status_code >= 500:
                    db.rollback()
                    return JSONResponse({"detail": "Sample operation could not complete. Your previous state is preserved."}, status_code=503)
                data = response.json() if response.content else None
                return JSONResponse({"state": snapshot(db), "data": data, "status": response.status_code}, headers={"Cache-Control": "no-store", "X-Demo-Workspace": "isolated"})
            finally:
                isolated_demo_costing.reset(cache_token)
                _role.reset(role_token)
                _session.reset(token)
                db.close()
                engine.dispose()
