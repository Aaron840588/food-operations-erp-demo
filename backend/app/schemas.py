from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Dict, List, Literal, Optional, Union
from datetime import datetime, date, time
from decimal import Decimal

# ----------------------------------------------------
# SUPPLIER SCHEMAS
# ----------------------------------------------------
class SupplierBase(BaseModel):
    name: str
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None

class SupplierCreate(SupplierBase):
    pass

class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None

class SupplierOut(SupplierBase):
    id: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ----------------------------------------------------
# RAW INGREDIENT SCHEMAS
# ----------------------------------------------------
class RawIngredientBase(BaseModel):
    name: str
    category: Optional[str] = None
    unit: str
    price: float
    net_weight: float
    available_stock: Optional[float] = 0.0
    reorder_level: Optional[float] = 0.0
    shop: Optional[str] = None
    brand: Optional[str] = None
    remarks: Optional[str] = None
    supplier_id: Optional[int] = None

class RawIngredientCreate(RawIngredientBase):
    pass

class RawIngredientUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    unit: Optional[str] = None
    price: Optional[float] = None
    net_weight: Optional[float] = None
    available_stock: Optional[float] = Field(default=None, ge=0.0)
    reorder_level: Optional[float] = None
    shop: Optional[str] = None
    brand: Optional[str] = None
    remarks: Optional[str] = None
    supplier_id: Optional[int] = None

class RawIngredientOut(RawIngredientBase):
    id: int
    cost_per_gram_unit: float
    last_updated: Optional[datetime] = None
    supplier: Optional[SupplierOut] = None
    used_in_products: Optional[List[str]] = []

    class Config:
        from_attributes = True


# ----------------------------------------------------
# PRODUCT SKU SCHEMAS
# ----------------------------------------------------
class ProductSKUBase(BaseModel):
    sku: str
    product_name: str
    category: str
    size: str
    retail_price: float
    reseller_price: float
    pack_qty: Optional[int] = 1
    storage_life: Optional[str] = None
    serving_requirement: Optional[str] = None
    cost_override: Optional[float] = None
    cost_per_unit: Optional[float] = 0.0
    labor_cost: Optional[float] = 0.0
    utility_cost: Optional[float] = 3.28
    warehouse_stock: Optional[int] = 0
    density_multiplier: Optional[float] = 1.0
    is_active: Optional[bool] = True

class ProductSKUCreate(ProductSKUBase):
    pass

class ProductSKUUpdate(BaseModel):
    product_name: Optional[str] = None
    category: Optional[str] = None
    size: Optional[str] = None
    retail_price: Optional[float] = Field(default=None, ge=0)
    reseller_price: Optional[float] = Field(default=None, ge=0)
    pack_qty: Optional[int] = Field(default=None, ge=0)
    storage_life: Optional[str] = None
    serving_requirement: Optional[str] = None
    cost_override: Optional[float] = None
    cost_per_unit: Optional[float] = None
    labor_cost: Optional[float] = None
    utility_cost: Optional[float] = None
    warehouse_stock: Optional[int] = Field(default=None, ge=0)
    density_multiplier: Optional[float] = None
    is_active: Optional[bool] = None

class ProductSKUOut(ProductSKUBase):
    last_updated: Optional[datetime] = None
    reserved_stock: Optional[int] = 0
    available_stock: Optional[int] = 0

    class Config:
        from_attributes = True


# ----------------------------------------------------
# RECIPE SCHEMAS
# ----------------------------------------------------
class RecipeItemBase(BaseModel):
    ingredient_type: str # 'raw' or 'sku'
    raw_ingredient_id: Optional[int] = None
    sub_sku: Optional[str] = None
    base_qty: float
    base_unit: str

class RecipeItemCreate(RecipeItemBase):
    pass

class RecipeItemUpdate(BaseModel):
    base_qty: Optional[float] = None

class RecipeItemOut(RecipeItemBase):
    id: int
    raw_ingredient_name: Optional[str] = None
    sub_product_name: Optional[str] = None
    calculated_cost: float = 0.0

    class Config:
        from_attributes = True

class RecipeBase(BaseModel):
    sku: Optional[str] = None
    yield_weight: float
    yield_unit: Optional[str] = 'g'
    portion_size: Optional[float] = None
    portion_unit: Optional[str] = 'g'
    notes: Optional[str] = None

class RecipeCreate(RecipeBase):
    ingredients: List[RecipeItemCreate]

class RecipeUpdate(BaseModel):
    yield_weight: float
    yield_unit: Optional[str] = 'g'
    portion_size: Optional[float] = None
    portion_unit: Optional[str] = 'g'
    notes: Optional[str] = None
    ingredients: List[RecipeItemCreate]

class RecipeOut(RecipeBase):
    id: int
    product_name: Optional[str] = None
    size: Optional[str] = None
    cost_override: Optional[float] = None
    calculated_batch_cost: float = 0.0
    calculated_portion_cost: float = 0.0
    ingredients: List[RecipeItemOut]

    class Config:
        from_attributes = True

class RecipeCostPreviewOut(BaseModel):
    calculated_batch_cost: float
    calculated_portion_cost: float
    servings: int


# ----------------------------------------------------
# PRODUCTION FORECAST & PLAN SCHEMAS
# ----------------------------------------------------
class ProductionTargetBase(BaseModel):
    sku: str
    outlet: str
    target_qty: int

class ProductionTargetCreate(ProductionTargetBase):
    pass

class ProductionTargetOut(ProductionTargetBase):
    id: int
    product_name: str
    size: str

    class Config:
        from_attributes = True

class ProductionPlanCreate(BaseModel):
    plan_date: Union[str, date] # YYYY-MM-DD
    targets: List[ProductionTargetCreate]

class ProductionPlanOut(BaseModel):
    id: int
    plan_date: Union[str, date]
    status: str
    targets: List[ProductionTargetOut]
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class ForecastItem(BaseModel):
    sku: str
    quantity: int
    outlet: str

class ProductionForecastIn(BaseModel):
    items: List[ForecastItem]

class IngredientRequirement(BaseModel):
    ingredient_name: str
    category: Optional[str] = "Other / uncategorized"
    total_needed: float
    unit: str
    available_stock: float
    deficit: float
    amount_per_pack: float
    packs_to_buy: int
    estimated_cost: float
    parent_products: List[str] = []

class RecipeBatchRequirement(BaseModel):
    recipe_name: str
    target_sku: str
    batches_needed: float
    scaled_yield: float
    yield_unit: str
    scaled_ingredients: List[RecipeItemOut]

class ProductionForecastOut(BaseModel):
    scaled_recipes: List[RecipeBatchRequirement]
    material_checklist: List[IngredientRequirement]
    total_estimated_raw_material_cost: float


# ----------------------------------------------------
# CONSIGNMENT SCHEMAS
# ----------------------------------------------------
class ConsignmentItemOut(BaseModel):
    id: int
    sku: str
    product_name: str
    size: str
    qty_delivered: int
    units_sold: int
    qty_pulled_out: int
    reseller_price_snapshot: float
    cost_per_unit_snapshot: float
    store_price_snapshot: float
    efficiency_rate: float
    food_waste_percentage: float
    sales_revenue: float
    net_profit: float
    notes: Optional[str] = None

    class Config:
        from_attributes = True

class ConsignmentDeliveryCreate(BaseModel):
    partner_id: int
    delivery_date: Union[str, date] # YYYY-MM-DD
    dr_number: Optional[str] = None
    items: List[ProductionTargetBase] # Reusing SKU/Qty structures

class ConsignmentItemUpdate(BaseModel):
    units_sold: Optional[int] = None
    qty_pulled_out: Optional[int] = None
    notes: Optional[str] = None

class ConsignmentDeliveryOut(BaseModel):
    id: int
    partner_name: str
    delivery_date: Union[str, date]
    dr_number: Optional[str] = None
    is_paid: bool
    payment_date: Optional[Union[str, date]] = None
    items: List[ConsignmentItemOut]

    class Config:
        from_attributes = True

class ConsignmentPartnerBase(BaseModel):
    name: str
    discount_rate: float
    collection_frequency: Optional[str] = 'Weekly'
    minimum_order_amount: Optional[float] = 1500.00
    is_active: Optional[bool] = True

class ConsignmentPartnerOut(ConsignmentPartnerBase):
    id: int
    total_deliveries_count: int = 0
    average_efficiency_rate: float = 0.0
    average_waste_percentage: float = 0.0

    class Config:
        from_attributes = True


# ----------------------------------------------------
# RESELLER ORDER SCHEMAS
# ----------------------------------------------------
class ResellerOrderItemCreate(BaseModel):
    sku: str
    quantity: int = Field(gt=0)

class ResellerOrderItemOut(BaseModel):
    id: int
    sku: str
    product_name: str
    size: str
    quantity: int
    price_snapshot: float
    item_subtotal: float

    class Config:
        from_attributes = True

class ResellerOrderCreate(BaseModel):
    reseller_name: str = Field(min_length=1, max_length=100)
    order_date: Union[str, date] # YYYY-MM-DD
    items: List[ResellerOrderItemCreate] = Field(min_length=1)
    notes: Optional[str] = None
    tax_rate: float = Field(default=12.0, ge=0.0, le=100.0)
    manual_discount_percentage: Optional[float] = Field(default=None, ge=0.0, le=100.0)

    @field_validator("reseller_name")
    @classmethod
    def reseller_name_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Reseller customer name is required")
        return value

class ResellerOrderOut(BaseModel):
    id: int
    reseller_name: str
    order_date: Union[str, date]
    subtotal: float
    discount_percentage: float
    discount_amount: float
    tax_rate: float
    tax_amount: float
    grand_total: float
    is_paid: bool
    notes: Optional[str] = None
    items: List[ResellerOrderItemOut]

    class Config:
        from_attributes = True


# ----------------------------------------------------
# MAINTENANCE & CLEANING SCHEMAS
# ----------------------------------------------------
class MaintenanceAssetBase(BaseModel):
    area: str
    item_name: str
    style_or_kind: Optional[str] = None
    condition: Optional[str] = 'OK'
    remarks: Optional[str] = None
    replacement_date: Optional[Union[str, date]] = None

class MaintenanceAssetOut(MaintenanceAssetBase):
    id: int
    last_checked: datetime

    class Config:
        from_attributes = True

class CleaningTaskBase(BaseModel):
    task_name: str
    frequency: Optional[str] = 'Daily'
    last_done_date: Optional[Union[str, date]] = None
    remarks: Optional[str] = None

class CleaningTaskOut(CleaningTaskBase):
    id: int

    class Config:
        from_attributes = True


class CleaningTaskCreate(BaseModel):
    task_name: str
    frequency: Optional[str] = 'Daily'


class MaintenanceAssetCreate(BaseModel):
    area: str
    item_name: str
    style_or_kind: Optional[str] = None



# ----------------------------------------------------
# DYNAMIC OVERHEAD & GIFT SET SCHEMAS
# ----------------------------------------------------
class CategoryOverheadRateBase(BaseModel):
    category: str
    labor_cost_per_unit: float
    utility_cost_per_unit: float

class CategoryOverheadRateOut(CategoryOverheadRateBase):
    class Config:
        from_attributes = True

class GiftSetItemCreate(BaseModel):
    sku: str
    quantity: int

class GiftSetItemOut(BaseModel):
    id: int
    sku: str
    product_name: str
    size: str
    quantity: int
    cost_per_unit: float = 0.0

    class Config:
        from_attributes = True

class GiftSetBase(BaseModel):
    name: str
    retail_price: float
    reseller_price: float
    packaging_cost: Optional[float] = 0.0
    notes: Optional[str] = None

class GiftSetCreate(GiftSetBase):
    items: List[GiftSetItemCreate]

class GiftSetOut(GiftSetBase):
    id: int
    items: List[GiftSetItemOut]
    calculated_total_cost: float = 0.0
    gross_margin_pct: float = 0.0
    net_margin_pct: float = 0.0

    class Config:
        from_attributes = True


# ----------------------------------------------------
# AUTH & USER SCHEMAS
# ----------------------------------------------------
class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    token: str
    username: str
    role: str

class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=100, pattern=r"^[A-Za-z0-9._-]+$")
    password: str = Field(min_length=8, max_length=128)
    role: Literal["owner", "staff"] = "staff"
    hourly_rate: float = Field(default=0.0, ge=0.0, le=10000.0)

class UserUpdate(BaseModel):
    hourly_rate: float = Field(ge=0.0, le=10000.0)

class UserOut(BaseModel):
    id: int
    username: str
    role: str
    is_active: bool
    hourly_rate: float = 0.0

    class Config:
        from_attributes = True

class DiscountTierOut(BaseModel):
    id: int
    min_subtotal: float
    discount_percentage: float

    class Config:
        from_attributes = True

class DiscountTierUpdate(BaseModel):
    min_subtotal: float
    discount_percentage: float


# ----------------------------------------------------
# INVENTORY TRANSACTION SCHEMAS
# ----------------------------------------------------
class InventoryTransactionOut(BaseModel):
    id: int
    user_id: Optional[int] = None
    sku: Optional[str] = None
    raw_ingredient_id: Optional[int] = None
    transaction_type: str
    qty: float
    batch_reference: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    user_username: Optional[str] = None
    item_name: Optional[str] = None
    warehouse_id: Optional[int] = None
    warehouse_name: Optional[str] = None

    class Config:
        from_attributes = True


# ----------------------------------------------------
# WAREHOUSE SCHEMAS
# ----------------------------------------------------
class WarehouseBase(BaseModel):
    name: str
    location: Optional[str] = None
    is_active: Optional[bool] = True

class WarehouseCreate(WarehouseBase):
    pass

class WarehouseOut(WarehouseBase):
    id: int

    class Config:
        from_attributes = True

class WarehouseStockOut(BaseModel):
    warehouse_id: int
    warehouse_name: str
    raw_ingredient_id: Optional[int] = None
    ingredient_name: Optional[str] = None
    sku: Optional[str] = None
    product_name: Optional[str] = None
    quantity: float

    class Config:
        from_attributes = True

class WarehouseTransferRequest(BaseModel):
    source_warehouse_id: int
    destination_warehouse_id: int
    raw_ingredient_id: Optional[int] = None
    sku: Optional[str] = None
    quantity: float

# ----------------------------------------------------
# PUSH NOTIFICATION SCHEMAS
# ----------------------------------------------------
class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str

class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys

# ----------------------------------------------------
# INGREDIENT BATCH SCHEMAS
# ----------------------------------------------------
class IngredientBatchBase(BaseModel):
    raw_ingredient_id: int
    batch_code: str
    quantity: float
    expiry_date: Optional[str] = None

class IngredientBatchCreate(IngredientBatchBase):
    pass

class IngredientBatchOut(IngredientBatchBase):
    id: int
    created_at: datetime
    ingredient_name: Optional[str] = None

    class Config:
        from_attributes = True


# ----------------------------------------------------
# TIMESHEETS
# ----------------------------------------------------
class TimesheetManualCreate(BaseModel):
    client_reference: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9:_-]+$")
    work_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    clock_in: datetime
    clock_out: Optional[datetime] = None
    employee_name: Optional[str] = Field(default=None, max_length=100)
    notes: Optional[str] = Field(default=None, max_length=1000)
    proof_image_data: str = Field(min_length=32, max_length=4_000_000)
    proof_image_type: str = Field(pattern=r"^image/(jpeg|png|webp)$")


class TimesheetImportRow(BaseModel):
    values: Dict[str, str]


class TimesheetImportCreate(BaseModel):
    rows: List[TimesheetImportRow] = Field(min_length=1, max_length=20_000)


class TimesheetReviewUpdate(BaseModel):
    review_status: Literal["Approved", "Rejected"]


class TimesheetEntryOut(BaseModel):
    id: int
    employee_user_id: Optional[int] = None
    employee_name: str
    machine_employee_id: Optional[str] = None
    work_date: str
    clock_in: Optional[datetime] = None
    clock_out: Optional[datetime] = None
    source: str
    review_status: str
    has_proof: bool = False
    notes: Optional[str] = None
    duration_hours: float = 0.0
    hourly_rate: float = 0.0
    labor_cost: float = 0.0
    production_plan_id: Optional[int] = None
    allocation_status: str = "not_ready"
    created_at: datetime

    class Config:
        from_attributes = True


class TimesheetPage(BaseModel):
    items: List[TimesheetEntryOut]
    total: int
    limit: int
    offset: int


class TimesheetProofOut(BaseModel):
    data_url: str
    mime_type: str


class TimesheetAllocationUpdate(BaseModel):
    production_plan_id: Optional[int] = None


class TimesheetLaborEmployeeSummary(BaseModel):
    employee_user_id: Optional[int] = None
    employee_name: str
    hourly_rate: float
    approved_hours: float
    labor_cost: float
    allocated_hours: float
    unallocated_hours: float
    missing_rate_hours: float


class TimesheetLaborSummary(BaseModel):
    date_from: str
    date_to: str
    approved_hours: float
    total_labor_cost: float
    allocated_hours: float
    unallocated_hours: float
    missing_rate_hours: float
    employees: List[TimesheetLaborEmployeeSummary]


# ----------------------------------------------------
# MARKET EVENT SCHEMAS
# ----------------------------------------------------
class MarketEventAllocationBase(BaseModel):
    sku: str = Field(min_length=1)
    quantity: int = Field(ge=0)
    wasted_quantity: Optional[int] = Field(default=0, ge=0)
    waste_reason: Optional[str] = Field(default="", max_length=255)

class MarketEventAllocationCreate(MarketEventAllocationBase):
    quantity: int = Field(gt=0)
    wasted_quantity: Optional[int] = Field(default=0, ge=0)
    waste_reason: Optional[str] = Field(default="", max_length=255)

class MarketEventAllocationUpdate(BaseModel):
    sku: str = Field(min_length=1)
    # ``quantity`` is retained only for Draft allocation replacement and
    # historical closeout clients. Active-to-Active edits must send the
    # explicit desired booth balance in ``remaining_quantity``.
    quantity: Optional[int] = Field(default=None, ge=0)
    remaining_quantity: Optional[int] = Field(default=None, ge=0)
    wasted_quantity: Optional[int] = Field(default=0, ge=0)
    waste_reason: Optional[str] = Field(default="", max_length=255)

class MarketEventAllocationOut(MarketEventAllocationBase):
    id: int
    product_name: Optional[str] = ""
    size: Optional[str] = ""
    current_stock: Optional[int] = 0
    retail_price: Optional[float] = 0.0
    cost_per_unit: Optional[float] = 0.0
    sold_quantity: Optional[int] = 0
    remaining_quantity: Optional[int] = 0

    class Config:
        from_attributes = True

MarketEventStatus = Literal["Draft", "Active", "Completed", "Cancelled"]


class MarketEventBase(BaseModel):
    name: str
    event_date: str # YYYY-MM-DD
    location: str
    staff_assigned: Optional[str] = ""
    notes: Optional[str] = ""
    status: Optional[MarketEventStatus] = "Draft"
    initial_cash_balance: Optional[float] = Field(default=0.0, ge=0)
    opening_float: Optional[float] = Field(default=None, ge=0)
    actual_closing_cash: Optional[float] = Field(default=None, ge=0)
    cash_adjustments: Optional[float] = 0.0
    cash_adjustments_notes: Optional[str] = ""
    total_expenses: Optional[float] = Field(default=0.0, ge=0)
    expense_notes: Optional[str] = ""
    cash_expenses: Optional[Decimal] = Field(default=Decimal("0.00"), ge=0)
    cash_refunds: Optional[Decimal] = Field(default=Decimal("0.00"), ge=0)
    gcash_sales: Optional[Decimal] = Field(default=None, ge=0)
    bpi_sales: Optional[Decimal] = Field(default=None, ge=0)

class MarketEventCreate(MarketEventBase):
    allocations: List[MarketEventAllocationCreate]
    recurrence: Optional[str] = "none"
    recurrence_count: Optional[int] = 1

class MarketEventUpdate(BaseModel):
    name: Optional[str] = None
    event_date: Optional[str] = None
    location: Optional[str] = None
    staff_assigned: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[MarketEventStatus] = None
    allocations: Optional[List[Union[MarketEventAllocationCreate, MarketEventAllocationUpdate]]] = None
    initial_cash_balance: Optional[float] = Field(default=None, ge=0)
    opening_float: Optional[float] = Field(default=None, ge=0)
    actual_closing_cash: Optional[float] = Field(default=None, ge=0)
    cash_adjustments: Optional[float] = None
    cash_adjustments_notes: Optional[str] = None
    total_expenses: Optional[float] = Field(default=None, ge=0)
    expense_notes: Optional[str] = None
    cash_expenses: Optional[Decimal] = Field(default=None, ge=0)
    cash_refunds: Optional[Decimal] = Field(default=None, ge=0)
    gcash_sales: Optional[Decimal] = Field(default=None, ge=0)
    bpi_sales: Optional[Decimal] = Field(default=None, ge=0)

class MarketEventOut(MarketEventBase):
    id: int
    is_deleted: Optional[bool] = False
    allocations: List[MarketEventAllocationOut]
    gross_sales: float = 0.0
    estimated_revenue: float = 0.0
    estimated_cost: Optional[float] = 0.0
    potential_profit: Optional[float] = 0.0
    metrics_basis: str = "forecast"
    costing_complete: bool = True
    financials_visible: bool = True
    cash_sales: Optional[float] = 0.0
    total_tips: Optional[float] = 0.0
    ending_cashbox_balance: Optional[float] = 0.0
    digital_sales_total: Optional[float] = 0.0
    payment_breakdown: Optional[Dict[str, float]] = None
    food_waste_quantity: int = 0
    food_leftover_quantity: int = 0
    food_waste_cost: Optional[float] = 0.0

    class Config:
        from_attributes = True


# ----------------------------------------------------
# MARKET EVENT SALES SCHEMAS
# ----------------------------------------------------
class MarketEventSaleItemBase(BaseModel):
    sku: str = Field(min_length=1)
    quantity: int = Field(gt=0)

class MarketEventSaleItemCreate(MarketEventSaleItemBase):
    pass

class MarketEventSaleItemOut(MarketEventSaleItemBase):
    id: int
    product_name: str
    size: str
    price_snapshot: float

    class Config:
        from_attributes = True

MarketEventPaymentMethod = Literal[
    "Cash",
    "GCash",
    "BPI / Bank Transfer",
    "Bank Transfer",
    "Maya",
    "Card",
    "Complimentary / Gift",
    "Pautang",
    "Mixed",
]

MarketEventPromotionCode = Literal[
    "CLASSIC_DUO",
    "SIGNATURE_DUO",
    "COMBO_DUO",
    "B1T1",
]
MarketEventDiscountType = Literal["PERCENTAGE", "FIXED"]


class MarketEventSaleCreate(BaseModel):
    payment_method: MarketEventPaymentMethod
    items: List[MarketEventSaleItemCreate] = Field(min_length=1)
    client_reference: str = Field(
        min_length=8,
        max_length=64,
        pattern=r"^[A-Za-z0-9:_-]+$",
    )
    # Current clients send this so catalog price drift is rejected before any
    # allocation mutation. It remains optional for legacy POS replays and
    # internal preorder fulfillment; the server still prices those requests
    # authoritatively from current catalog values.
    expected_subtotal: Optional[Decimal] = Field(
        default=None,
        ge=0,
        max_digits=12,
        decimal_places=2,
    )
    promotion_code: Optional[MarketEventPromotionCode] = None
    discount_type: Optional[MarketEventDiscountType] = None
    discount_value: Optional[Decimal] = Field(
        default=None,
        ge=0,
        max_digits=12,
        decimal_places=2,
    )
    cash_received: Optional[Decimal] = Field(default=None, ge=0)
    tip_amount: Optional[Decimal] = Field(default=Decimal("0.00"), ge=0)
    payment_reference: Optional[str] = Field(default=None, max_length=100)
    customer_name: Optional[str] = Field(default=None, max_length=255)
    is_preorder: Optional[bool] = False
    preorder_customer_name: Optional[str] = None
    preorder_payment_status: Optional[Literal["Paid", "Unpaid"]] = None
    preorder_fulfillment_status: Optional[Literal["Pending", "Picked Up"]] = None

    @model_validator(mode="after")
    def validate_manual_discount_pair(self):
        if (self.discount_type is None) != (self.discount_value is None):
            raise ValueError("discount_type and discount_value must be supplied together")
        if (
            self.discount_type == "PERCENTAGE"
            and self.discount_value is not None
            and self.discount_value > Decimal("100")
        ):
            raise ValueError("percentage discount_value cannot exceed 100")
        return self

class MarketEventSaleUpdate(BaseModel):
    payment_method: Optional[MarketEventPaymentMethod] = None
    preorder_payment_status: Optional[Literal["Paid", "Unpaid"]] = None
    preorder_fulfillment_status: Optional[Literal["Pending", "Picked Up"]] = None

class MarketEventSaleOut(BaseModel):
    id: int
    event_id: int
    cashier_username: Optional[str] = None
    payment_method: str
    subtotal_amount: float = 0.0
    discount_type: Optional[str] = None
    discount_value: Optional[float] = None
    manual_discount_amount: float = 0.0
    promotion_code: Optional[str] = None
    promotion_discount_amount: float = 0.0
    promotion_snapshot: Optional[str] = None
    discount_amount: float = 0.0
    total_amount: float
    cash_received: Optional[Decimal] = None
    change_given: Decimal = Decimal("0.00")
    tip_amount: Decimal = Decimal("0.00")
    payment_reference: Optional[str] = None
    customer_name: Optional[str] = None
    is_collected: bool = True
    timestamp: datetime
    items: List[MarketEventSaleItemOut]
    is_preorder: bool = False
    preorder_customer_name: Optional[str] = None
    preorder_payment_status: Optional[str] = None
    preorder_fulfillment_status: Optional[str] = None

    class Config:
        from_attributes = True


# ----------------------------------------------------
# TIMESHEET CALCULATOR SCHEMAS
# ----------------------------------------------------
class TimesheetCalculatorShift(BaseModel):
    date: str
    start: str
    end: str
    total_hours: Optional[float] = None
    working_days: Optional[float] = None
    total_pay: Optional[float] = None

class TimesheetCalculatorAllowance(BaseModel):
    label: str
    amount: Optional[float] = None

class TimesheetCalculatorSummary(BaseModel):
    total_hours: Optional[float] = None
    working_days: Optional[float] = None
    paid_work: Optional[float] = None
    allowances: List[TimesheetCalculatorAllowance] = []
    total_pay: Optional[float] = None
    status: Optional[str] = None
    remarks: Optional[str] = None

class TimesheetCalculatorPeriod(BaseModel):
    period_name: str
    side: str
    rate: Optional[float] = None
    hours_per_shift: Optional[float] = None
    standard_working_hours: Optional[float] = None
    hourly_rate: Optional[float] = None
    shifts: List[TimesheetCalculatorShift] = []
    summary: TimesheetCalculatorSummary

class TimesheetCalculatorAdvance(BaseModel):
    date: str
    amount: float
    status: Optional[str] = None

class TimesheetCalculatorEmployee(BaseModel):
    employee_name: str
    periods: List[TimesheetCalculatorPeriod] = []
    cash_advances: List[TimesheetCalculatorAdvance] = []

class TimesheetCalculatorResponse(BaseModel):
    employees: Dict[str, TimesheetCalculatorEmployee]


# ----------------------------------------------------
# CONTROLLED GOOGLE SHEETS SYNCHRONIZATION
# ----------------------------------------------------
class SheetSyncCheckRequest(BaseModel):
    source_keys: Optional[List[str]] = Field(default=None, max_length=10)


class SheetSyncReviewRequest(BaseModel):
    action: Literal["accept", "reject", "ignore"]
    resolution_note: Optional[str] = Field(default=None, max_length=500)


class SheetSyncSettingsUpdateRequest(BaseModel):
    auto_apply_prices_enabled: bool


class SheetSyncConfigStatusOut(BaseModel):
    enabled: bool
    configured: bool
    status_code: str
    approved_spreadsheet_count: int
    service_account_configured: bool
    authentication_mode: str
    auto_apply_prices_enabled: bool
    auto_apply_eligible_fields: List[str]
    auto_apply_max_price_change_pct: float
    auto_check_interval_minutes: int
    approved_sources: List[Dict[str, object]]


class SheetSyncRunOut(BaseModel):
    public_id: str
    trigger_type: str
    status: str
    source_keys: List[str]
    summary: Dict[str, object]
    requested_by_username: Optional[str] = None
    started_at: datetime
    completed_at: Optional[datetime] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None


class SheetSyncChangeEventOut(BaseModel):
    event_type: str
    actor_username: Optional[str] = None
    payload: Dict[str, object]
    created_at: datetime


class SheetSyncChangeOut(BaseModel):
    public_id: str
    run_public_id: str
    source_key: str
    source_name: str
    sheet_name: str
    source_row_number: int
    stable_identifier: str
    source_header: str
    destination_entity: str
    destination_field: str
    raw_source_value: object
    previous_value: object
    proposed_value: object
    risk_level: str
    approval_mode: str
    status: str
    detected_at: datetime
    decided_at: Optional[datetime] = None
    applied_at: Optional[datetime] = None
    decided_by_username: Optional[str] = None
    applied_by_username: Optional[str] = None
    resolution_note: Optional[str] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    events: List[SheetSyncChangeEventOut] = Field(default_factory=list)


class SheetSyncQueueOut(BaseModel):
    counts: Dict[str, int]
    changes: List[SheetSyncChangeOut]


# ----------------------------------------------------
# NORMALIZED CUSTOMER PREORDERS
# ----------------------------------------------------
PreorderStatus = Literal[
    "Pending",
    "Confirmed",
    "Preparing",
    "Ready",
    "Fulfilled",
    "Cancelled",
    "No-show",
]
PreorderPaymentStatus = Literal["Unpaid", "Partial", "Paid", "Receivable", "Refunded"]
PreorderFulfillmentMethod = Literal["Pickup", "Delivery"]


class PreorderFormCreate(BaseModel):
    model_config = {"extra": "forbid"}

    name: str = Field(min_length=1, max_length=120)
    event_id: Optional[int] = Field(default=None, gt=0)
    is_enabled: bool = False
    allowed_fulfillment_methods: List[PreorderFulfillmentMethod] = Field(
        default_factory=lambda: ["Pickup", "Delivery"],
        min_length=1,
        max_length=2,
    )
    payment_preferences: List[str] = Field(default_factory=list, max_length=8)
    extension: Dict[str, object] = Field(default_factory=dict, max_length=10)

    @field_validator("name")
    @classmethod
    def strip_form_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Form name is required")
        return value

    @field_validator("allowed_fulfillment_methods")
    @classmethod
    def unique_fulfillment_methods(
        cls,
        value: List[PreorderFulfillmentMethod],
    ) -> List[PreorderFulfillmentMethod]:
        return list(dict.fromkeys(value))

    @field_validator("payment_preferences")
    @classmethod
    def clean_payment_preferences(cls, value: List[str]) -> List[str]:
        cleaned = []
        for preference in value:
            preference = preference.strip()
            if not preference:
                continue
            if len(preference) > 50:
                raise ValueError("Payment preferences must be 50 characters or fewer")
            if preference not in cleaned:
                cleaned.append(preference)
        return cleaned


class PreorderFormUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    event_id: Optional[int] = Field(default=None, gt=0)
    is_enabled: Optional[bool] = None
    allowed_fulfillment_methods: Optional[List[PreorderFulfillmentMethod]] = Field(
        default=None,
        min_length=1,
        max_length=2,
    )
    payment_preferences: Optional[List[str]] = Field(default=None, max_length=8)
    extension: Optional[Dict[str, object]] = Field(default=None, max_length=10)

    @field_validator("name")
    @classmethod
    def strip_optional_form_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Form name is required")
        return value

    @field_validator("allowed_fulfillment_methods")
    @classmethod
    def unique_optional_fulfillment_methods(
        cls,
        value: Optional[List[PreorderFulfillmentMethod]],
    ) -> Optional[List[PreorderFulfillmentMethod]]:
        return None if value is None else list(dict.fromkeys(value))

    @field_validator("payment_preferences")
    @classmethod
    def clean_optional_payment_preferences(
        cls,
        value: Optional[List[str]],
    ) -> Optional[List[str]]:
        if value is None:
            return None
        return PreorderFormCreate.clean_payment_preferences(value)

    @model_validator(mode="after")
    def reject_null_non_nullable_updates(self):
        for field_name in (
            "name",
            "is_enabled",
            "allowed_fulfillment_methods",
            "payment_preferences",
            "extension",
        ):
            if field_name in self.model_fields_set and getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null")
        return self


class PreorderFormOut(BaseModel):
    id: int
    name: str
    public_token: Optional[str] = None
    token_hint: str
    is_enabled: bool
    event_id: Optional[int] = None
    event_name: Optional[str] = None
    event_date: Optional[str] = None
    event_location: Optional[str] = None
    allowed_fulfillment_methods: List[PreorderFulfillmentMethod]
    payment_preferences: List[str]
    extension: Dict[str, object]
    created_by_username: Optional[str] = None
    updated_by_username: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class PublicPreorderEventOut(BaseModel):
    name: str
    event_date: str
    location: str


class PublicPreorderCatalogProductOut(BaseModel):
    sku: str
    product_name: str
    category: str
    size: str
    retail_price: Decimal


class PublicPreorderCatalogOut(BaseModel):
    form_name: str
    event: Optional[PublicPreorderEventOut] = None
    allowed_fulfillment_methods: List[PreorderFulfillmentMethod]
    payment_preferences: List[str]
    currency: Literal["PHP"] = "PHP"
    stock_reservation_mode: Literal["none_until_pos_fulfillment"] = "none_until_pos_fulfillment"
    products: List[PublicPreorderCatalogProductOut]


class PublicPreorderItemCreate(BaseModel):
    model_config = {"extra": "forbid"}

    sku: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9._:/+-]+$")
    quantity: int = Field(gt=0, le=50)

    @field_validator("sku")
    @classmethod
    def clean_public_sku(cls, value: str) -> str:
        return value.strip()


class PublicPreorderCreate(BaseModel):
    model_config = {"extra": "forbid"}

    submission_reference: str = Field(
        min_length=8,
        max_length=64,
        pattern=r"^[A-Za-z0-9:_-]+$",
    )
    customer_name: str = Field(min_length=1, max_length=120)
    contact_email: Optional[str] = Field(default=None, max_length=254)
    contact_phone: Optional[str] = Field(default=None, max_length=50)
    requested_fulfillment_date: date
    requested_fulfillment_time: time
    fulfillment_method: PreorderFulfillmentMethod
    delivery_address: Optional[str] = Field(default=None, max_length=1000)
    notes: Optional[str] = Field(default=None, max_length=2000)
    payment_preference: Optional[str] = Field(default=None, max_length=100)
    items: List[PublicPreorderItemCreate] = Field(min_length=1, max_length=20)
    extension: Dict[str, object] = Field(default_factory=dict, max_length=10)

    @model_validator(mode="after")
    def validate_customer_and_fulfillment(self):
        self.customer_name = self.customer_name.strip()
        self.contact_email = (self.contact_email or "").strip().lower() or None
        self.contact_phone = (self.contact_phone or "").strip() or None
        self.delivery_address = (self.delivery_address or "").strip() or None
        self.notes = (self.notes or "").strip() or None
        self.payment_preference = (self.payment_preference or "").strip() or None
        if not self.customer_name:
            raise ValueError("Customer name is required")
        if not self.contact_email and not self.contact_phone:
            raise ValueError("At least one contact method is required")
        if self.contact_email:
            local, separator, domain = self.contact_email.partition("@")
            if not separator or not local or "." not in domain or any(char.isspace() for char in self.contact_email):
                raise ValueError("A valid contact email is required")
        if self.contact_phone:
            digit_count = sum(character.isdigit() for character in self.contact_phone)
            if digit_count < 6:
                raise ValueError("Contact phone must contain at least 6 digits")
        if self.fulfillment_method == "Delivery" and not self.delivery_address:
            raise ValueError("Delivery address is required for delivery orders")
        if self.fulfillment_method == "Pickup":
            self.delivery_address = None
        return self


class PreorderItemOut(BaseModel):
    id: int
    sku: str
    product_name: str
    size: str
    quantity: int
    unit_price: Decimal
    line_total: Decimal


class PublicPreorderReceiptOut(BaseModel):
    public_reference: str
    status: PreorderStatus
    payment_status: PreorderPaymentStatus
    total_amount: Decimal
    currency: Literal["PHP"] = "PHP"
    requested_fulfillment_date: date
    requested_fulfillment_time: time
    fulfillment_method: PreorderFulfillmentMethod
    stock_reserved: Literal[False] = False
    submitted_at: datetime
    items: List[PreorderItemOut]


class PreorderStatusHistoryOut(BaseModel):
    id: int
    sequence_number: int
    action: str
    source: Literal["public", "internal", "system"]
    from_status: Optional[PreorderStatus] = None
    to_status: PreorderStatus
    from_payment_status: Optional[PreorderPaymentStatus] = None
    to_payment_status: PreorderPaymentStatus
    actor_username: Optional[str] = None
    note: Optional[str] = None
    payload: Dict[str, object]
    created_at: datetime


class PreorderAuditEventOut(BaseModel):
    id: int
    action: str
    actor_username: str
    payload: Dict[str, object]
    created_at: datetime


class PreorderSummaryOut(BaseModel):
    id: int
    public_reference: str
    form_id: int
    form_name: str
    event_id: Optional[int] = None
    event_name: Optional[str] = None
    customer_name: str
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    requested_fulfillment_date: date
    requested_fulfillment_time: time
    fulfillment_method: PreorderFulfillmentMethod
    status: PreorderStatus
    payment_status: PreorderPaymentStatus
    total_amount: Decimal
    total_units: int
    created_at: datetime
    updated_at: datetime


class PreorderDetailOut(PreorderSummaryOut):
    delivery_address: Optional[str] = None
    notes: Optional[str] = None
    payment_preference: Optional[str] = None
    extension: Dict[str, object]
    fulfillment_sale_id: Optional[int] = None
    fulfillment_client_reference: str
    fulfilled_at: Optional[datetime] = None
    items: List[PreorderItemOut]
    status_history: List[PreorderStatusHistoryOut]
    audit_events: List[PreorderAuditEventOut]


class PreorderListOut(BaseModel):
    items: List[PreorderSummaryOut]
    total: int
    page: int
    page_size: int


class PreorderTransitionRequest(BaseModel):
    model_config = {"extra": "forbid"}

    status: Optional[PreorderStatus] = None
    payment_status: Optional[PreorderPaymentStatus] = None
    note: Optional[str] = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def require_transition(self):
        self.note = (self.note or "").strip() or None
        if self.status is None and self.payment_status is None:
            raise ValueError("A status or payment status transition is required")
        return self


class PreorderEventAssignmentRequest(BaseModel):
    model_config = {"extra": "forbid"}

    event_id: int = Field(gt=0)
    note: Optional[str] = Field(default=None, max_length=500)


class PreorderFulfillmentRequest(BaseModel):
    model_config = {"extra": "forbid"}

    payment_method: MarketEventPaymentMethod
    payment_status: Literal["Paid", "Receivable"] = "Paid"
    cash_received: Optional[Decimal] = Field(default=None, ge=0)
    payment_reference: Optional[str] = Field(default=None, max_length=100)
    note: Optional[str] = Field(default=None, max_length=500)


class PreorderItemInput(BaseModel):
    sku: str
    quantity: int = Field(gt=0, le=999)

class PreorderItemsUpdateRequest(BaseModel):
    items: List[PreorderItemInput] = Field(min_length=1)

class PreorderFormDisabledSkusRequest(BaseModel):
    disabled_skus: List[str]




