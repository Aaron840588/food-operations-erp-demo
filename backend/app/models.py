from sqlalchemy import Column, Integer, String, Float, ForeignKey, Boolean, Date, Text, DateTime, func, CheckConstraint, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.ext.hybrid import hybrid_property
from .database import Base

MARKET_SALE_IDEMPOTENCY_TRANSACTION_TYPE = "market_sale_idempotency"
MARKET_SALE_IDEMPOTENCY_PREFIX = "MARKET_SALE_REF:"

class RawIngredient(Base):
    __tablename__ = "raw_ingredients"
    __table_args__ = (
        CheckConstraint("available_stock >= 0.0", name="check_positive_available_stock"),
    )

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False, index=True)
    category = Column(String(100))
    unit = Column(String(50), nullable=False)
    price = Column(Float, nullable=False)
    net_weight = Column(Float, nullable=False)
    cost_per_gram_unit = Column(Float, default=0.0)
    available_stock = Column(Float, default=0.0)
    reorder_level = Column(Float, default=0.0)
    shop = Column(String(255))
    brand = Column(String(255))
    remarks = Column(Text)
    last_updated = Column(DateTime, default=func.now(), onupdate=func.now())

    supplier_id = Column(Integer, ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True)
    supplier = relationship("Supplier", back_populates="raw_ingredients")
    recipe_items = relationship("RecipeItem", back_populates="raw_ingredient")


class ProductSKU(Base):
    __tablename__ = "product_skus"
    __table_args__ = (
        CheckConstraint("warehouse_stock >= 0", name="check_positive_warehouse_stock"),
    )

    sku = Column(String(100), primary_key=True, index=True)
    product_name = Column(String(255), nullable=False, index=True)
    category = Column(String(100), nullable=False)
    size = Column(String(50), nullable=False)
    retail_price = Column(Float, nullable=False)
    reseller_price = Column(Float, nullable=False)
    pack_qty = Column(Integer, default=1)
    storage_life = Column(String(100))
    serving_requirement = Column(String(255))
    cost_override = Column(Float, nullable=True)
    cost_per_unit = Column(Float, default=0.0)
    labor_cost = Column(Float, nullable=False, default=0.0)
    utility_cost = Column(Float, nullable=False, default=0.0)
    warehouse_stock = Column(Integer, default=0)
    density_multiplier = Column(Float, default=1.0)
    is_active = Column(Boolean, default=True, nullable=False)
    last_updated = Column(DateTime, default=func.now(), onupdate=func.now())

    # Relationships
    recipe = relationship("Recipe", back_populates="product", uselist=False)
    consignment_items = relationship("ConsignmentItem", back_populates="product")
    reseller_items = relationship("ResellerOrderItem", back_populates="product")


class Recipe(Base):
    __tablename__ = "recipes"

    id = Column(Integer, primary_key=True, index=True)
    sku = Column(String(100), ForeignKey("product_skus.sku", ondelete="CASCADE"), unique=True)
    yield_weight = Column(Float, nullable=False)
    yield_unit = Column(String(50), default="g")
    portion_size = Column(Float)
    portion_unit = Column(String(50), default="g")
    notes = Column(Text)
    created_at = Column(DateTime, default=func.now())

    # Relationships
    product = relationship("ProductSKU", back_populates="recipe")
    ingredients = relationship("RecipeItem", back_populates="recipe", cascade="all, delete-orphan")


class RecipeItem(Base):
    __tablename__ = "recipe_items"

    id = Column(Integer, primary_key=True, index=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False)
    ingredient_type = Column(String(50), nullable=False) # 'raw' or 'sku'
    raw_ingredient_id = Column(Integer, ForeignKey("raw_ingredients.id", ondelete="SET NULL"), index=True)
    sub_sku = Column(String(100), ForeignKey("product_skus.sku", ondelete="SET NULL"), index=True)
    base_qty = Column(Float, nullable=False)
    base_unit = Column(String(50), nullable=False)

    # Relationships
    recipe = relationship("Recipe", back_populates="ingredients")
    raw_ingredient = relationship("RawIngredient", back_populates="recipe_items")
    sub_product = relationship("ProductSKU")


class OverheadConfig(Base):
    __tablename__ = "overhead_configs"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(String(50), nullable=False) # 'utility' or 'labor'
    particular = Column(String(100), unique=True, nullable=False, index=True)
    cost_per_month = Column(Float, default=0.0)
    cost_per_day = Column(Float, default=0.0)
    hourly_rate = Column(Float, default=0.0)
    notes = Column(Text)


class ProductionPlan(Base):
    __tablename__ = "production_plans"

    id = Column(Integer, primary_key=True, index=True)
    plan_date = Column(String(10), unique=True, nullable=False, index=True) # YYYY-MM-DD
    status = Column(String(50), default="draft") # 'draft', 'forecasted', 'completed'
    created_at = Column(DateTime, default=func.now())

    # Relationships
    targets = relationship("ProductionTarget", back_populates="plan", cascade="all, delete-orphan")


class ProductionTarget(Base):
    __tablename__ = "production_targets"

    id = Column(Integer, primary_key=True, index=True)
    plan_id = Column(Integer, ForeignKey("production_plans.id", ondelete="CASCADE"), nullable=False)
    sku = Column(String(100), ForeignKey("product_skus.sku", ondelete="CASCADE"), nullable=False, index=True)
    outlet = Column(String(100), nullable=False) # e.g. AA Mart, ECM, General
    target_qty = Column(Integer, nullable=False)

    # Relationships
    plan = relationship("ProductionPlan", back_populates="targets")
    product = relationship("ProductSKU")


class ProductionBatch(Base):
    __tablename__ = "production_batches"

    id = Column(Integer, primary_key=True, index=True)
    batch_date = Column(String(10), nullable=False, index=True) # YYYY-MM-DD
    sku = Column(String(100), ForeignKey("product_skus.sku", ondelete="SET NULL"), index=True)
    qty_produced = Column(Integer, nullable=False)
    qty_delivered = Column(Integer, nullable=False)
    actual_yield = Column(Float)
    staff_hours = Column(Float)
    notes = Column(Text)

    product = relationship("ProductSKU")


class ConsignmentPartner(Base):
    __tablename__ = "consignment_partners"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False, index=True)
    discount_rate = Column(Float, default=0.10)
    collection_frequency = Column(String(100), default="Weekly")
    minimum_order_amount = Column(Float, default=1500.00)
    is_active = Column(Boolean, default=True, nullable=False)

    # Relationships
    deliveries = relationship("ConsignmentDelivery", back_populates="partner", cascade="all, delete-orphan")


class ConsignmentDelivery(Base):
    __tablename__ = "consignment_deliveries"

    id = Column(Integer, primary_key=True, index=True)
    partner_id = Column(Integer, ForeignKey("consignment_partners.id", ondelete="CASCADE"), nullable=False)
    delivery_date = Column(String(10), nullable=False, index=True) # YYYY-MM-DD
    dr_number = Column(String(100))
    is_paid = Column(Boolean, default=False) # False = unpaid, True = paid
    payment_date = Column(String(10))
    created_at = Column(DateTime, default=func.now())

    # Relationships
    partner = relationship("ConsignmentPartner", back_populates="deliveries")
    items = relationship("ConsignmentItem", back_populates="delivery", cascade="all, delete-orphan")


class ConsignmentItem(Base):
    __tablename__ = "consignment_items"

    id = Column(Integer, primary_key=True, index=True)
    delivery_id = Column(Integer, ForeignKey("consignment_deliveries.id", ondelete="CASCADE"), nullable=False)
    sku = Column(String(100), ForeignKey("product_skus.sku", ondelete="CASCADE"), nullable=False)
    qty_delivered = Column(Integer, nullable=False)
    units_sold = Column(Integer, default=0)
    qty_pulled_out = Column(Integer, default=0)
    reseller_price_snapshot = Column(Float, nullable=False)
    cost_per_unit_snapshot = Column(Float, nullable=False)
    store_price_snapshot = Column(Float, nullable=False)
    notes = Column(Text)

    # Relationships
    delivery = relationship("ConsignmentDelivery", back_populates="items")
    product = relationship("ProductSKU", back_populates="consignment_items")


class ResellerOrder(Base):
    __tablename__ = "reseller_orders"

    id = Column(Integer, primary_key=True, index=True)
    reseller_name = Column(String(100), nullable=False)
    order_date = Column(String(10), nullable=False) # YYYY-MM-DD
    subtotal = Column(Float, default=0.0)
    discount_percentage = Column(Float, default=0.0)
    discount_amount = Column(Float, default=0.0)
    tax_rate = Column(Float, default=0.0)
    tax_amount = Column(Float, default=0.0)
    grand_total = Column(Float, default=0.0)
    is_paid = Column(Boolean, default=False) # False = unpaid, True = paid
    notes = Column(Text)
    created_at = Column(DateTime, default=func.now())

    # Relationships
    items = relationship("ResellerOrderItem", back_populates="order", cascade="all, delete-orphan")


class ResellerOrderItem(Base):
    __tablename__ = "reseller_order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("reseller_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    sku = Column(String(100), ForeignKey("product_skus.sku", ondelete="CASCADE"), nullable=False, index=True)
    quantity = Column(Integer, nullable=False)
    price_snapshot = Column(Float, nullable=False)

    # Relationships
    order = relationship("ResellerOrder", back_populates="items")
    product = relationship("ProductSKU", back_populates="reseller_items")


class MaintenanceAsset(Base):
    __tablename__ = "maintenance_assets"

    id = Column(Integer, primary_key=True, index=True)
    area = Column(String(100), nullable=False) # Production Area, Kitchen, CR
    item_name = Column(String(255), nullable=False)
    style_or_kind = Column(String(255))
    condition = Column(String(100), default="OK")
    remarks = Column(Text)
    replacement_date = Column(String(10)) # YYYY-MM-DD
    last_checked = Column(DateTime, default=func.now(), onupdate=func.now())


class CleaningTask(Base):
    __tablename__ = "cleaning_tasks"

    id = Column(Integer, primary_key=True, index=True)
    task_name = Column(String(255), unique=True, nullable=False)
    frequency = Column(String(50), default="Daily")
    last_done_date = Column(String(10)) # YYYY-MM-DD
    remarks = Column(Text)


class GiftSet(Base):
    __tablename__ = "gift_sets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False, index=True)
    retail_price = Column(Float, nullable=False)
    reseller_price = Column(Float, nullable=False)
    packaging_cost = Column(Float, default=0.0)
    notes = Column(Text)

    # Relationships
    items = relationship("GiftSetItem", back_populates="gift_set", cascade="all, delete-orphan")


class GiftSetItem(Base):
    __tablename__ = "gift_set_items"

    id = Column(Integer, primary_key=True, index=True)
    gift_set_id = Column(Integer, ForeignKey("gift_sets.id", ondelete="CASCADE"), nullable=False, index=True)
    sku = Column(String(100), ForeignKey("product_skus.sku", ondelete="CASCADE"), nullable=False, index=True)
    quantity = Column(Integer, nullable=False)

    # Relationships
    gift_set = relationship("GiftSet", back_populates="items")
    product = relationship("ProductSKU")


class CategoryOverheadRate(Base):
    __tablename__ = "category_overhead_rates"
    category = Column(String(100), primary_key=True, index=True)
    labor_cost_per_unit = Column(Float, default=0.0)
    utility_cost_per_unit = Column(Float, default=0.0)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False, default="staff")  # "owner" or "staff"
    is_active = Column(Boolean, default=True)


class TimesheetEntry(Base):
    __tablename__ = "timesheet_entries"

    id = Column(Integer, primary_key=True, index=True)
    client_reference = Column(String(64), nullable=True, unique=True, index=True)
    employee_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    employee_name = Column(String(100), nullable=False, index=True)
    machine_employee_id = Column(String(100), nullable=True, index=True)
    work_date = Column(String(10), nullable=False, index=True)  # YYYY-MM-DD
    clock_in = Column(DateTime, nullable=True)
    clock_out = Column(DateTime, nullable=True)
    source = Column(String(20), nullable=False)  # machine | manual
    review_status = Column(String(20), nullable=False, default="Pending")
    proof_image_data = Column(Text, nullable=True)
    proof_image_type = Column(String(50), nullable=True)
    notes = Column(Text, nullable=True)
    imported_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime, default=func.now(), nullable=False)

    employee = relationship("User", foreign_keys=[employee_user_id])
    imported_by = relationship("User", foreign_keys=[imported_by_user_id])

    @property
    def has_proof(self):
        return bool(self.proof_image_data)


class LoginRateLimit(Base):
    __tablename__ = "login_rate_limits"
    __table_args__ = (
        UniqueConstraint("scope", "identifier_hash", name="uq_login_rate_limits_scope_identifier"),
    )

    id = Column(Integer, primary_key=True, index=True)
    scope = Column(String(20), nullable=False)
    identifier_hash = Column(String(64), nullable=False)
    failures = Column(Integer, nullable=False, default=0)
    window_started_at = Column(DateTime, nullable=False)
    locked_until = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)

class Supplier(Base):
    __tablename__ = "suppliers"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False, index=True)
    contact_person = Column(String(255))
    email = Column(String(255))
    phone = Column(String(50))
    address = Column(Text)
    created_at = Column(DateTime, default=func.now())
    raw_ingredients = relationship("RawIngredient", back_populates="supplier")

class InventoryTransaction(Base):
    __tablename__ = "inventory_transactions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    sku = Column(String(100), ForeignKey("product_skus.sku", ondelete="CASCADE"), nullable=True, index=True)
    raw_ingredient_id = Column(Integer, ForeignKey("raw_ingredients.id", ondelete="CASCADE"), nullable=True, index=True)
    transaction_type = Column(String(50), nullable=False)  # 'receive', 'consume', 'production_add', 'consignment_deduct', 'waste', 'manual_adjustment'
    qty = Column(Float, nullable=False)
    batch_reference = Column(String(100))
    notes = Column(Text)
    created_at = Column(DateTime, default=func.now())
    warehouse_id = Column(Integer, ForeignKey("warehouses.id", ondelete="SET NULL"), nullable=True, index=True)

    user = relationship("User")
    product = relationship("ProductSKU")
    raw_ingredient = relationship("RawIngredient")
    warehouse = relationship("Warehouse")

class DiscountTier(Base):
    __tablename__ = "discount_tiers"
    id = Column(Integer, primary_key=True, index=True)
    min_subtotal = Column(Float, nullable=False, unique=True)
    discount_percentage = Column(Float, nullable=False)

class Warehouse(Base):
    __tablename__ = "warehouses"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False, index=True)
    location = Column(String(255))
    is_active = Column(Boolean, default=True)

    stocks = relationship("WarehouseStock", back_populates="warehouse", cascade="all, delete-orphan")

class WarehouseStock(Base):
    __tablename__ = "warehouse_stocks"
    id = Column(Integer, primary_key=True, index=True)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id", ondelete="CASCADE"), nullable=False)
    raw_ingredient_id = Column(Integer, ForeignKey("raw_ingredients.id", ondelete="CASCADE"), nullable=True, index=True)
    sku = Column(String(100), ForeignKey("product_skus.sku", ondelete="CASCADE"), nullable=True, index=True)
    quantity = Column(Float, default=0.0)

    warehouse = relationship("Warehouse", back_populates="stocks")
    raw_ingredient = relationship("RawIngredient")
    product = relationship("ProductSKU")

class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    endpoint = Column(Text, unique=True, nullable=False)
    p256dh = Column(String(255), nullable=False)
    auth = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=func.now())

    user = relationship("User")

class IngredientBatch(Base):
    __tablename__ = "ingredient_batches"
    id = Column(Integer, primary_key=True, index=True)
    raw_ingredient_id = Column(Integer, ForeignKey("raw_ingredients.id", ondelete="CASCADE"), nullable=False, index=True)
    batch_code = Column(String(100), nullable=False)
    quantity = Column(Float, default=0.0)
    expiry_date = Column(String(10), nullable=True, index=True)
    created_at = Column(DateTime, default=func.now())

    raw_ingredient = relationship("RawIngredient")


class MarketEvent(Base):
    __tablename__ = "market_events"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    event_date = Column(String(10), nullable=False, index=True) # YYYY-MM-DD
    location = Column(String(255), nullable=False)
    staff_assigned = Column(String(255), default="")
    notes = Column(Text, default="")
    status = Column(String(50), default="Draft") # 'Draft', 'Active', 'Completed', 'Cancelled'
    is_deleted = Column(Boolean, default=False)
    initial_cash_balance = Column(Float, default=0.0, nullable=False)
    actual_closing_cash = Column(Float, nullable=True)
    cash_adjustments = Column(Float, default=0.0, nullable=False)
    cash_adjustments_notes = Column(Text, default="", nullable=False)
    total_expenses = Column(Float, default=0.0, nullable=False)
    expense_notes = Column(Text, default="", nullable=False)

    allocations = relationship("MarketEventAllocation", back_populates="market_event", cascade="all, delete-orphan")


class MarketEventAllocation(Base):
    __tablename__ = "market_event_allocations"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("market_events.id", ondelete="CASCADE"), nullable=False)
    sku = Column(String(100), ForeignKey("product_skus.sku", ondelete="CASCADE"), nullable=False)
    quantity = Column(Integer, nullable=False, default=0)
    wasted_quantity = Column(Integer, default=0, nullable=False)
    waste_reason = Column(String(255), nullable=True)

    market_event = relationship("MarketEvent", back_populates="allocations")
    product = relationship("ProductSKU")


class MarketEventSale(Base):
    __tablename__ = "market_event_sales"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("market_events.id", ondelete="CASCADE"), nullable=False)
    cashier_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    payment_method = Column(String(100), nullable=False) # Cash, GCash, Maya, Card, Mixed
    total_amount = Column(Float, nullable=False, default=0.0)
    timestamp = Column(DateTime, default=func.now())
    is_preorder = Column(Boolean, default=False, nullable=False)
    preorder_customer_name = Column(String(255), nullable=True)
    preorder_payment_status = Column(String(50), nullable=True) # Paid, Unpaid
    preorder_fulfillment_status = Column(String(50), nullable=True) # Pending, Picked Up

    market_event = relationship("MarketEvent")
    cashier = relationship("User")
    items = relationship("MarketEventSaleItem", back_populates="sale", cascade="all, delete-orphan")


class MarketEventSaleItem(Base):
    __tablename__ = "market_event_sale_items"

    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("market_event_sales.id", ondelete="CASCADE"), nullable=False)
    sku = Column(String(100), ForeignKey("product_skus.sku", ondelete="CASCADE"), nullable=False, index=True)
    quantity = Column(Integer, nullable=False, default=1)
    price_snapshot = Column(Float, nullable=False, default=0.0)

    sale = relationship("MarketEventSale", back_populates="items")
    product = relationship("ProductSKU")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(255), unique=True, nullable=False, index=True)
    username = Column(String(255), ForeignKey("users.username", ondelete="CASCADE"), nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=func.now())
    is_revoked = Column(Boolean, default=False)
