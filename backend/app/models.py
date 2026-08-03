from sqlalchemy import Column, Integer, String, Float, Numeric, ForeignKey, Boolean, Date, Time, Text, DateTime, func, CheckConstraint, UniqueConstraint
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


class IngredientPriceHistory(Base):
    __tablename__ = "ingredient_price_history"

    id = Column(Integer, primary_key=True, index=True)
    raw_ingredient_id = Column(
        Integer,
        ForeignKey("raw_ingredients.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    previous_price = Column(Float, nullable=False)
    new_price = Column(Float, nullable=False)
    previous_net_weight = Column(Float, nullable=False)
    new_net_weight = Column(Float, nullable=False)
    previous_unit_cost = Column(Float, nullable=False)
    new_unit_cost = Column(Float, nullable=False)
    changed_by_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    source = Column(String(50), nullable=False, default="inventory_edit")
    changed_at = Column(DateTime, nullable=False, default=func.now(), index=True)

    raw_ingredient = relationship("RawIngredient")
    changed_by = relationship("User")


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
    food_cost_snapshot = Column(Float, nullable=True)
    labor_cost_snapshot = Column(Float, nullable=True)
    utility_cost_snapshot = Column(Float, nullable=True)
    total_cost_snapshot = Column(Float, nullable=True)
    cost_status_snapshot = Column(String(30), nullable=True)
    cost_snapshot_recorded_at = Column(DateTime, nullable=True, default=func.now())
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
    food_cost_snapshot = Column(Float, nullable=True)
    labor_cost_snapshot = Column(Float, nullable=True)
    utility_cost_snapshot = Column(Float, nullable=True)
    total_cost_snapshot = Column(Float, nullable=True)
    cost_status_snapshot = Column(String(30), nullable=True)
    cost_snapshot_recorded_at = Column(DateTime, nullable=True, default=func.now())

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
    hourly_rate = Column(Float, nullable=False, default=0.0)


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
    production_plan_id = Column(Integer, ForeignKey("production_plans.id", ondelete="SET NULL"), nullable=True, index=True)
    approved_hourly_rate = Column(Float, nullable=True)
    created_at = Column(DateTime, default=func.now(), nullable=False)

    employee = relationship("User", foreign_keys=[employee_user_id])
    imported_by = relationship("User", foreign_keys=[imported_by_user_id])
    production_plan = relationship("ProductionPlan")

    @property
    def has_proof(self):
        return bool(self.proof_image_data)

    @property
    def duration_hours(self):
        if not self.clock_in or not self.clock_out:
            return 0.0
        return round(max(0.0, (self.clock_out - self.clock_in).total_seconds() / 3600.0), 4)

    @property
    def hourly_rate(self):
        if self.approved_hourly_rate is not None:
            return round(float(self.approved_hourly_rate), 2)
        return round(float(self.employee.hourly_rate or 0.0), 2) if self.employee else 0.0

    @property
    def labor_cost(self):
        return round(self.duration_hours * self.hourly_rate, 2)

    @property
    def allocation_status(self):
        if self.review_status != "Approved" or self.duration_hours <= 0:
            return "not_ready"
        if self.hourly_rate <= 0:
            return "missing_rate"
        return "allocated" if self.production_plan_id else "unallocated"


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
    # Explicit closeout buckets. ``total_expenses`` and ``cash_adjustments``
    # remain for backwards compatibility with historical event records.
    cash_expenses = Column(Numeric(12, 2), default=0, nullable=False)
    cash_refunds = Column(Numeric(12, 2), default=0, nullable=False)
    # Null means that the account balance has not been reconciled yet. An
    # explicit zero is meaningful and must not fall back to the POS total.
    gcash_sales = Column(Numeric(12, 2), nullable=True)
    bpi_sales = Column(Numeric(12, 2), nullable=True)

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
    __table_args__ = (
        UniqueConstraint("event_id", "client_reference", name="uq_market_event_sale_client_reference"),
    )

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("market_events.id", ondelete="CASCADE"), nullable=False)
    cashier_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    client_reference = Column(String(64), nullable=True)
    payment_method = Column(String(100), nullable=False) # Cash, GCash, Maya, Card, Mixed
    subtotal_amount = Column(Numeric(12, 2), nullable=False, default=0)
    discount_type = Column(String(20), nullable=True)
    discount_value = Column(Numeric(12, 2), nullable=True)
    manual_discount_amount = Column(Numeric(12, 2), nullable=False, default=0)
    promotion_code = Column(String(50), nullable=True)
    promotion_discount_amount = Column(Numeric(12, 2), nullable=False, default=0)
    promotion_snapshot = Column(Text, nullable=True)
    discount_amount = Column(Numeric(12, 2), nullable=False, default=0)
    # Net sale amount after the immutable promotion/discount snapshot.
    total_amount = Column(Numeric(12, 2), nullable=False, default=0)
    cash_received = Column(Numeric(12, 2), nullable=True)
    change_given = Column(Numeric(12, 2), nullable=False, default=0)
    tip_amount = Column(Numeric(12, 2), nullable=False, default=0)
    payment_reference = Column(String(100), nullable=True)
    customer_name = Column(String(255), nullable=True)
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
    price_snapshot = Column(Numeric(12, 2), nullable=False, default=0)
    food_cost_snapshot = Column(Float, nullable=True)
    labor_cost_snapshot = Column(Float, nullable=True)
    utility_cost_snapshot = Column(Float, nullable=True)
    total_cost_snapshot = Column(Float, nullable=True)
    cost_status_snapshot = Column(String(30), nullable=True)
    cost_snapshot_recorded_at = Column(DateTime, nullable=True, default=func.now())

    sale = relationship("MarketEventSale", back_populates="items")
    product = relationship("ProductSKU")


class SheetSyncSource(Base):
    """Auditable mirror of a source that is also hard-coded in the v1 registry."""

    __tablename__ = "sheet_sync_sources"

    id = Column(Integer, primary_key=True, index=True)
    source_key = Column(String(100), unique=True, nullable=False, index=True)
    display_name = Column(String(255), nullable=False)
    spreadsheet_id = Column(String(128), nullable=False)
    sheet_name = Column(String(255), nullable=False)
    cell_range = Column(String(64), nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=func.now())
    updated_at = Column(DateTime, nullable=False, default=func.now(), onupdate=func.now())


class SheetSyncMapping(Base):
    """Read-only database mirror of a reviewed code-defined field mapping."""

    __tablename__ = "sheet_sync_mappings"
    __table_args__ = (
        UniqueConstraint(
            "source_id",
            "source_header",
            "destination_entity",
            "destination_field",
            name="uq_sheet_sync_mapping_definition",
        ),
        CheckConstraint(
            "approval_mode IN ('manual_review', 'auto_apply')",
            name="check_sheet_sync_mapping_approval",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    source_id = Column(Integer, ForeignKey("sheet_sync_sources.id", ondelete="CASCADE"), nullable=False, index=True)
    source_header = Column(String(255), nullable=False)
    destination_entity = Column(String(100), nullable=False)
    destination_field = Column(String(100), nullable=False)
    expected_type = Column(String(50), nullable=False)
    risk_level = Column(String(20), nullable=False)
    approval_mode = Column(String(30), nullable=False, default="manual_review")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=func.now())

    source = relationship("SheetSyncSource")


class SheetSyncRun(Base):
    __tablename__ = "sheet_sync_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('running', 'completed', 'completed_with_errors', 'failed')",
            name="check_sheet_sync_run_status",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    public_id = Column(String(36), unique=True, nullable=False, index=True)
    trigger_type = Column(String(30), nullable=False, default="manual")
    status = Column(String(30), nullable=False, default="running", index=True)
    source_keys_json = Column(Text, nullable=False, default="[]")
    summary_json = Column(Text, nullable=False, default="{}")
    requested_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    started_at = Column(DateTime, nullable=False, default=func.now())
    completed_at = Column(DateTime, nullable=True)
    error_code = Column(String(100), nullable=True)
    error_message = Column(Text, nullable=True)

    requested_by = relationship("User")


class SheetSyncSnapshot(Base):
    __tablename__ = "sheet_sync_snapshots"
    __table_args__ = (
        UniqueConstraint("run_id", "source_id", "row_number", name="uq_sheet_sync_snapshot_row"),
        CheckConstraint(
            "validation_status IN ('valid', 'invalid', 'duplicate', 'missing_identifier', 'blank')",
            name="check_sheet_sync_snapshot_validation_status",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(Integer, ForeignKey("sheet_sync_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    source_id = Column(Integer, ForeignKey("sheet_sync_sources.id", ondelete="RESTRICT"), nullable=False, index=True)
    stable_identifier = Column(String(255), nullable=True, index=True)
    row_number = Column(Integer, nullable=False)
    raw_payload_json = Column(Text, nullable=False, default="{}")
    normalized_payload_json = Column(Text, nullable=False, default="{}")
    payload_hash = Column(String(64), nullable=False, index=True)
    validation_status = Column(String(30), nullable=False)
    validation_errors_json = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime, nullable=False, default=func.now())

    run = relationship("SheetSyncRun")
    source = relationship("SheetSyncSource")


class SheetSyncChange(Base):
    __tablename__ = "sheet_sync_changes"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'accepted', 'rejected', 'ignored', 'applied', 'failed', 'conflict')",
            name="check_sheet_sync_change_status",
        ),
        CheckConstraint(
            "approval_mode IN ('manual_review', 'auto_apply')",
            name="check_sheet_sync_change_approval",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    public_id = Column(String(36), unique=True, nullable=False, index=True)
    fingerprint = Column(String(64), unique=True, nullable=False, index=True)
    run_id = Column(Integer, ForeignKey("sheet_sync_runs.id", ondelete="RESTRICT"), nullable=False, index=True)
    source_id = Column(Integer, ForeignKey("sheet_sync_sources.id", ondelete="RESTRICT"), nullable=False, index=True)
    snapshot_id = Column(Integer, ForeignKey("sheet_sync_snapshots.id", ondelete="RESTRICT"), nullable=False, index=True)
    stable_identifier = Column(String(255), nullable=False, index=True)
    source_row_number = Column(Integer, nullable=False)
    source_header = Column(String(255), nullable=False)
    destination_entity = Column(String(100), nullable=False)
    destination_field = Column(String(100), nullable=False)
    raw_source_value_json = Column(Text, nullable=False, default="null")
    previous_value_json = Column(Text, nullable=False, default="null")
    proposed_value_json = Column(Text, nullable=False, default="null")
    destination_version = Column(String(64), nullable=False)
    risk_level = Column(String(20), nullable=False)
    approval_mode = Column(String(30), nullable=False, default="manual_review")
    status = Column(String(30), nullable=False, default="pending", index=True)
    detected_at = Column(DateTime, nullable=False, default=func.now())
    decided_at = Column(DateTime, nullable=True)
    applied_at = Column(DateTime, nullable=True)
    decided_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    applied_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    resolution_note = Column(Text, nullable=True)
    error_code = Column(String(100), nullable=True)
    error_message = Column(Text, nullable=True)

    run = relationship("SheetSyncRun")
    source = relationship("SheetSyncSource")
    snapshot = relationship("SheetSyncSnapshot")
    decided_by = relationship("User", foreign_keys=[decided_by_user_id])
    applied_by = relationship("User", foreign_keys=[applied_by_user_id])


class SheetSyncChangeEvent(Base):
    __tablename__ = "sheet_sync_change_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('detected', 'accepted', 'rejected', 'ignored', 'applied', 'failed', 'conflict')",
            name="check_sheet_sync_change_event_type",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    change_id = Column(Integer, ForeignKey("sheet_sync_changes.id", ondelete="RESTRICT"), nullable=False, index=True)
    event_type = Column(String(30), nullable=False, index=True)
    actor_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    event_payload_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, nullable=False, default=func.now())

    change = relationship("SheetSyncChange")
    actor = relationship("User")


class PreorderForm(Base):
    """Owner-managed public preorder entry point.

    The opaque token is the only public locator. Direct database access remains
    service-role-only; public catalog and submission access is mediated by the
    FastAPI router so product and customer fields can be deliberately minimized.
    """

    __tablename__ = "preorder_forms"
    __table_args__ = (
        CheckConstraint("length(token_hash) = 64", name="check_preorder_form_token_hash"),
        CheckConstraint("length(trim(name)) > 0", name="check_preorder_form_name"),
    )

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    token_hash = Column(String(64), unique=True, nullable=False, index=True)
    token_hint = Column(String(12), nullable=False)
    is_enabled = Column(Boolean, nullable=False, default=False, index=True)
    event_id = Column(Integer, ForeignKey("market_events.id", ondelete="RESTRICT"), nullable=True, index=True)
    fulfillment_methods_json = Column(Text, nullable=False, default='["Pickup","Delivery"]')
    payment_preferences_json = Column(Text, nullable=False, default="[]")
    extension_json = Column(Text, nullable=False, default="{}")
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    updated_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime, nullable=False, default=func.now(), server_default=func.now())
    updated_at = Column(DateTime, nullable=False, default=func.now(), onupdate=func.now(), server_default=func.now())

    event = relationship("MarketEvent")
    created_by = relationship("User", foreign_keys=[created_by_user_id])
    updated_by = relationship("User", foreign_keys=[updated_by_user_id])
    preorders = relationship("Preorder", back_populates="form")


class Preorder(Base):
    """Normalized customer preorder with server-priced immutable snapshots.

    V1 intentionally makes no inventory reservation. Stock is deducted only by
    the existing Market Event POS commit when a Ready preorder is fulfilled.
    """

    __tablename__ = "preorders"
    __table_args__ = (
        UniqueConstraint("form_id", "submission_reference", name="uq_preorder_form_submission_reference"),
        CheckConstraint(
            "status IN ('Pending', 'Confirmed', 'Preparing', 'Ready', 'Fulfilled', 'Cancelled', 'No-show')",
            name="check_preorder_status",
        ),
        CheckConstraint(
            "payment_status IN ('Unpaid', 'Partial', 'Paid', 'Receivable', 'Refunded')",
            name="check_preorder_payment_status",
        ),
        CheckConstraint(
            "fulfillment_method IN ('Pickup', 'Delivery')",
            name="check_preorder_fulfillment_method",
        ),
        CheckConstraint("total_amount > 0", name="check_preorder_total_positive"),
        CheckConstraint("length(submission_fingerprint) = 64", name="check_preorder_submission_fingerprint"),
        CheckConstraint("length(public_reference) >= 12", name="check_preorder_public_reference"),
        CheckConstraint(
            "((contact_email IS NOT NULL AND length(trim(contact_email)) > 0) "
            "OR (contact_phone IS NOT NULL AND length(trim(contact_phone)) > 0))",
            name="check_preorder_contact_present",
        ),
        CheckConstraint(
            "(fulfillment_method = 'Pickup' OR "
            "(delivery_address IS NOT NULL AND length(trim(delivery_address)) > 0))",
            name="check_preorder_delivery_address",
        ),
        CheckConstraint(
            "(fulfillment_payment_status_intent IS NULL OR "
            "fulfillment_payment_status_intent IN ('Paid', 'Receivable'))",
            name="check_preorder_fulfillment_intent",
        ),
        CheckConstraint(
            "((status = 'Fulfilled' AND fulfillment_sale_id IS NOT NULL AND fulfilled_at IS NOT NULL) OR "
            "(status <> 'Fulfilled' AND fulfillment_sale_id IS NULL AND fulfilled_at IS NULL))",
            name="check_preorder_fulfillment_link",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    public_reference = Column(String(24), unique=True, nullable=False, index=True)
    form_id = Column(Integer, ForeignKey("preorder_forms.id", ondelete="RESTRICT"), nullable=False, index=True)
    event_id = Column(Integer, ForeignKey("market_events.id", ondelete="RESTRICT"), nullable=True, index=True)
    submission_reference = Column(String(64), nullable=False)
    submission_fingerprint = Column(String(64), nullable=False)
    fulfillment_client_reference = Column(String(64), unique=True, nullable=False, index=True)
    customer_name = Column(String(120), nullable=False, index=True)
    contact_email = Column(String(254), nullable=True, index=True)
    contact_phone = Column(String(50), nullable=True, index=True)
    requested_fulfillment_date = Column(Date, nullable=False, index=True)
    requested_fulfillment_time = Column(Time, nullable=False)
    fulfillment_method = Column(String(20), nullable=False, index=True)
    delivery_address = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    payment_preference = Column(String(100), nullable=True)
    status = Column(String(20), nullable=False, default="Pending", index=True)
    payment_status = Column(String(20), nullable=False, default="Unpaid", index=True)
    total_amount = Column(Numeric(12, 2), nullable=False, default=0)
    fulfillment_payment_status_intent = Column(String(20), nullable=True)
    extension_json = Column(Text, nullable=False, default="{}")
    fulfillment_sale_id = Column(
        Integer,
        ForeignKey("market_event_sales.id", ondelete="RESTRICT"),
        nullable=True,
        unique=True,
        index=True,
    )
    updated_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime, nullable=False, default=func.now(), index=True)
    updated_at = Column(DateTime, nullable=False, default=func.now(), onupdate=func.now())
    fulfilled_at = Column(DateTime, nullable=True)

    form = relationship("PreorderForm", back_populates="preorders")
    event = relationship("MarketEvent")
    fulfillment_sale = relationship("MarketEventSale")
    updated_by = relationship("User")
    items = relationship(
        "PreorderItem",
        back_populates="preorder",
        order_by="PreorderItem.id",
    )
    status_history = relationship(
        "PreorderStatusHistory",
        back_populates="preorder",
        order_by="PreorderStatusHistory.sequence_number",
    )
    audit_events = relationship(
        "PreorderAuditEvent",
        back_populates="preorder",
        foreign_keys="PreorderAuditEvent.preorder_id",
        order_by="PreorderAuditEvent.id",
    )


class PreorderItem(Base):
    __tablename__ = "preorder_items"
    __table_args__ = (
        UniqueConstraint("preorder_id", "sku", name="uq_preorder_item_sku"),
        CheckConstraint("quantity > 0", name="check_preorder_item_quantity_positive"),
        CheckConstraint("unit_price_snapshot > 0", name="check_preorder_item_unit_price_positive"),
        CheckConstraint("line_total_snapshot > 0", name="check_preorder_item_line_total_positive"),
    )

    id = Column(Integer, primary_key=True, index=True)
    preorder_id = Column(Integer, ForeignKey("preorders.id", ondelete="RESTRICT"), nullable=False, index=True)
    sku = Column(String(100), ForeignKey("product_skus.sku", ondelete="RESTRICT"), nullable=False, index=True)
    product_name_snapshot = Column(String(255), nullable=False)
    size_snapshot = Column(String(50), nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_price_snapshot = Column(Numeric(12, 2), nullable=False)
    line_total_snapshot = Column(Numeric(12, 2), nullable=False)
    created_at = Column(DateTime, nullable=False, default=func.now())

    preorder = relationship("Preorder", back_populates="items")
    product = relationship("ProductSKU")


class PreorderStatusHistory(Base):
    __tablename__ = "preorder_status_history"
    __table_args__ = (
        UniqueConstraint("preorder_id", "sequence_number", name="uq_preorder_status_history_sequence"),
        CheckConstraint(
            "to_status IN ('Pending', 'Confirmed', 'Preparing', 'Ready', 'Fulfilled', 'Cancelled', 'No-show')",
            name="check_preorder_history_to_status",
        ),
        CheckConstraint(
            "to_payment_status IN ('Unpaid', 'Partial', 'Paid', 'Receivable', 'Refunded')",
            name="check_preorder_history_to_payment_status",
        ),
        CheckConstraint("source IN ('public', 'internal', 'system')", name="check_preorder_history_source"),
        CheckConstraint(
            "(source <> 'internal' OR actor_username_snapshot IS NOT NULL)",
            name="check_preorder_history_internal_actor",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    preorder_id = Column(Integer, ForeignKey("preorders.id", ondelete="RESTRICT"), nullable=False, index=True)
    sequence_number = Column(Integer, nullable=False)
    action = Column(String(50), nullable=False, index=True)
    source = Column(String(20), nullable=False)
    from_status = Column(String(20), nullable=True)
    to_status = Column(String(20), nullable=False)
    from_payment_status = Column(String(20), nullable=True)
    to_payment_status = Column(String(20), nullable=False)
    actor_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_username_snapshot = Column(String(100), nullable=True)
    note = Column(Text, nullable=True)
    payload_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, nullable=False, default=func.now(), index=True)

    preorder = relationship("Preorder", back_populates="status_history")
    actor = relationship("User")


class PreorderAuditEvent(Base):
    """Append-only actor audit for every authenticated preorder mutation."""

    __tablename__ = "preorder_audit_events"
    __table_args__ = (
        CheckConstraint(
            "((form_id IS NOT NULL AND preorder_id IS NULL) OR "
            "(form_id IS NULL AND preorder_id IS NOT NULL))",
            name="check_preorder_audit_single_subject",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    form_id = Column(Integer, ForeignKey("preorder_forms.id", ondelete="RESTRICT"), nullable=True, index=True)
    preorder_id = Column(Integer, ForeignKey("preorders.id", ondelete="RESTRICT"), nullable=True, index=True)
    action = Column(String(50), nullable=False, index=True)
    actor_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_username_snapshot = Column(String(100), nullable=False)
    payload_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, nullable=False, default=func.now(), index=True)

    form = relationship("PreorderForm")
    preorder = relationship("Preorder", back_populates="audit_events", foreign_keys=[preorder_id])
    actor = relationship("User")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(255), unique=True, nullable=False, index=True)
    username = Column(String(255), ForeignKey("users.username", ondelete="CASCADE"), nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=func.now())
    is_revoked = Column(Boolean, default=False)

