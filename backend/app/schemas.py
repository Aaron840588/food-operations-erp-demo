from pydantic import BaseModel, Field, field_validator
from typing import Dict, List, Literal, Optional, Union
from datetime import datetime, date

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
    retail_price: Optional[float] = None
    reseller_price: Optional[float] = None
    pack_qty: Optional[int] = None
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
    username: str
    password: str
    role: str = "staff" # "owner" or "staff"

class UserOut(BaseModel):
    id: int
    username: str
    role: str
    is_active: bool

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


# ----------------------------------------------------
# MARKET EVENT SCHEMAS
# ----------------------------------------------------
class MarketEventAllocationBase(BaseModel):
    sku: str = Field(min_length=1)
    quantity: int
    wasted_quantity: Optional[int] = 0
    waste_reason: Optional[str] = ""

class MarketEventAllocationCreate(MarketEventAllocationBase):
    quantity: int = Field(gt=0)
    wasted_quantity: Optional[int] = 0
    waste_reason: Optional[str] = ""

class MarketEventAllocationUpdate(BaseModel):
    sku: str = Field(min_length=1)
    quantity: int
    wasted_quantity: Optional[int] = 0
    waste_reason: Optional[str] = ""

class MarketEventAllocationOut(MarketEventAllocationBase):
    id: int
    product_name: Optional[str] = ""
    size: Optional[str] = ""
    current_stock: Optional[int] = 0
    retail_price: Optional[float] = 0.0
    cost_per_unit: Optional[float] = 0.0

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
    initial_cash_balance: Optional[float] = 0.0
    actual_closing_cash: Optional[float] = None
    cash_adjustments: Optional[float] = 0.0
    cash_adjustments_notes: Optional[str] = ""
    total_expenses: Optional[float] = 0.0
    expense_notes: Optional[str] = ""

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
    initial_cash_balance: Optional[float] = None
    actual_closing_cash: Optional[float] = None
    cash_adjustments: Optional[float] = None
    cash_adjustments_notes: Optional[str] = None
    total_expenses: Optional[float] = None
    expense_notes: Optional[str] = None

class MarketEventOut(MarketEventBase):
    id: int
    is_deleted: Optional[bool] = False
    allocations: List[MarketEventAllocationOut]
    estimated_revenue: float = 0.0
    estimated_cost: Optional[float] = 0.0
    potential_profit: Optional[float] = 0.0
    metrics_basis: str = "forecast"
    costing_complete: bool = True
    financials_visible: bool = True

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

class MarketEventSaleCreate(BaseModel):
    payment_method: Literal["Cash", "GCash", "Maya", "Card", "Mixed"]
    items: List[MarketEventSaleItemCreate] = Field(min_length=1)
    client_reference: str = Field(
        min_length=8,
        max_length=64,
        pattern=r"^[A-Za-z0-9:_-]+$",
    )
    is_preorder: Optional[bool] = False
    preorder_customer_name: Optional[str] = None
    preorder_payment_status: Optional[Literal["Paid", "Unpaid"]] = None
    preorder_fulfillment_status: Optional[Literal["Pending", "Picked Up"]] = None

class MarketEventSaleUpdate(BaseModel):
    payment_method: Optional[Literal["Cash", "GCash", "Maya", "Card", "Mixed"]] = None
    preorder_payment_status: Optional[Literal["Paid", "Unpaid"]] = None
    preorder_fulfillment_status: Optional[Literal["Pending", "Picked Up"]] = None

class MarketEventSaleOut(BaseModel):
    id: int
    event_id: int
    cashier_username: Optional[str] = None
    payment_method: str
    total_amount: float
    timestamp: datetime
    items: List[MarketEventSaleItemOut]
    is_preorder: bool = False
    preorder_customer_name: Optional[str] = None
    preorder_payment_status: Optional[str] = None
    preorder_fulfillment_status: Optional[str] = None

    class Config:
        from_attributes = True



