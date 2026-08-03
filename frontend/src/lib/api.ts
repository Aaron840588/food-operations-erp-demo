/* eslint-disable @typescript-eslint/no-explicit-any */
import { offlineDb } from "./indexedDb";
import {
  getUnconfirmedMutationMessage,
  isReplayUnsafeMutation,
} from "./offlinePolicy";
import { isCurrentLineupProduct } from "./utils";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

// ----------------------------------------------------
// TYPESCRIPT SCHEMAS MAPPED FROM BACKEND PYDANTIC
// ----------------------------------------------------
export interface SupplierBase {
  name: string;
  contact_name?: string | null;
  contact_person?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}

export type SupplierCreate = SupplierBase;
export type SupplierUpdate = Partial<SupplierBase>;
export interface SupplierOut extends SupplierBase {
  id: number;
  created_at?: string | null;
}

export interface RawIngredientBase {
  name: string;
  category?: string | null;
  unit: string;
  price: number;
  net_weight: number;
  available_stock: number;
  reorder_level: number;
  shop?: string | null;
  brand?: string | null;
  remarks?: string | null;
  supplier_id?: number | null;
}

export type RawIngredientCreate = RawIngredientBase;
export type RawIngredientUpdate = Partial<RawIngredientBase>;
export interface RawIngredientOut extends Omit<RawIngredientBase, "price"> {
  id: number;
  price?: number;
  cost_per_gram_unit?: number;
  last_updated?: string | null;
  supplier?: SupplierOut | null;
  used_in_products?: string[];
}

export interface ProductSKUBase {
  sku: string;
  product_name: string;
  category: string;
  size: string;
  retail_price: number;
  reseller_price: number;
  pack_qty?: number;
  storage_life?: string | null;
  serving_requirement?: string | null;
  cost_override?: number | null;
  cost_per_unit?: number;
  labor_cost?: number;
  utility_cost?: number;
  warehouse_stock: number;
  density_multiplier?: number;
  is_active?: boolean;
}

export type ProductSKUCreate = ProductSKUBase;
export type ProductSKUUpdate = Partial<Omit<ProductSKUBase, 'sku'>>;
export interface ProductSKUOut extends ProductSKUBase {
  last_updated?: string | null;
  reserved_stock?: number;
  available_stock?: number;
}

export interface RecipeItemBase {
  ingredient_type: "raw" | "sku";
  raw_ingredient_id?: number | null;
  sub_sku?: string | null;
  base_qty: number;
  base_unit: string;
}

export type RecipeItemCreate = RecipeItemBase;
export interface RecipeItemOut extends RecipeItemBase {
  id: number;
  raw_ingredient_name?: string | null;
  sub_product_name?: string | null;
  calculated_cost: number;
}

export interface RecipeBase {
  sku: string;
  yield_weight: number;
  yield_unit?: string;
  portion_size?: number | null;
  portion_unit?: string;
  notes?: string | null;
}

export interface RecipeCreate extends RecipeBase {
  ingredients: RecipeItemCreate[];
}

export interface RecipeOut extends RecipeBase {
  id: number;
  created_at?: string | null;
  product_name?: string | null;
  size?: string | null;
  cost_override?: number | null;
  calculated_batch_cost: number;
  calculated_portion_cost: number;
  ingredients: RecipeItemOut[];
}

export interface RecipeCostPreviewOut {
  calculated_batch_cost: number;
  calculated_portion_cost: number;
  servings: number;
}

export interface ProductionTargetBase {
  sku: string;
  outlet: string;
  target_qty: number;
}

export type ProductionTargetCreate = ProductionTargetBase;
export interface ProductionTargetOut extends ProductionTargetBase {
  id: number;
  product_name?: string;
  size?: string;
}

export interface ProductionPlanBase {
  plan_date: string;
  status?: string;
}

export interface ProductionPlanCreate extends ProductionPlanBase {
  targets: ProductionTargetCreate[];
}

export interface ProductionPlanOut extends ProductionPlanBase {
  id: number;
  created_at?: string | null;
  targets: ProductionTargetOut[];
  targets_count?: number;
}

export interface ProductionCatalogItem {
  sku: string;
  product_name: string;
  category: string;
  size: string;
  warehouse_stock: number;
  is_active: boolean;
  yield_weight: number;
  yield_unit: string;
  portion_size: number;
  portion_unit: string;
  units_per_batch: number;
}

export interface ConsignmentPartnerBase {
  name: string;
  discount_rate: number;
  collection_frequency?: string;
  minimum_order_amount: number;
  is_active?: boolean;
}

export type ConsignmentPartnerCreate = ConsignmentPartnerBase;
export interface ConsignmentPartnerOut extends ConsignmentPartnerBase {
  id: number;
  total_deliveries_count?: number;
  average_efficiency_rate?: number;
  average_waste_percentage?: number;
}

export interface ConsignmentItemBase {
  sku: string;
  qty_delivered: number;
  units_sold?: number;
  qty_pulled_out?: number;
  reseller_price_snapshot: number;
  cost_per_unit_snapshot: number;
  store_price_snapshot: number;
  notes?: string | null;
}

export type ConsignmentItemCreate = ConsignmentItemBase;
export interface ConsignmentItemOut extends ConsignmentItemBase {
  id: number;
  product_name: string;
  size: string;
  efficiency_rate: number;
  food_waste_percentage: number;
  sales_revenue: number;
  net_profit: number;
}

export interface ConsignmentDeliveryBase {
  partner_id: number;
  delivery_date: string;
  dr_number?: string | null;
}

export interface ConsignmentDeliveryCreate extends ConsignmentDeliveryBase {
  items: { sku: string; target_qty: number; outlet: string }[];
}

export interface ConsignmentDeliveryOut extends ConsignmentDeliveryBase {
  id: number;
  partner_name: string;
  is_paid: boolean;
  payment_date?: string | null;
  items: ConsignmentItemOut[];
}

export interface ResellerOrderItemBase {
  sku: string;
  quantity: number;
}

export type ResellerOrderItemCreate = ResellerOrderItemBase;
export interface ResellerOrderItemOut extends ResellerOrderItemBase {
  id: number;
  product_name?: string;
  size?: string;
  price_snapshot?: number;
}

export interface ResellerOrderBase {
  reseller_name: string;
  order_date: string;
  notes?: string | null;
}

export interface ResellerOrderCreate extends ResellerOrderBase {
  items: ResellerOrderItemCreate[];
  tax_rate?: number;
  manual_discount_percentage?: number | null;
}

export interface ResellerOrderOut extends ResellerOrderBase {
  id: number;
  subtotal: number;
  discount_percentage: number;
  discount_amount: number;
  tax_amount: number;
  grand_total: number;
  is_paid: boolean;
  payment_date?: string | null;
  items: ResellerOrderItemOut[];
}

export interface MarketEventBase {
  name: string;
  event_date: string;
  location: string;
  staff_assigned?: string | null;
  notes?: string | null;
  status?: string;
  initial_cash_balance?: number;
  opening_float?: number | null;
  actual_closing_cash?: number | null;
  cash_adjustments?: number;
  cash_adjustments_notes?: string | null;
  total_expenses?: number;
  expense_notes?: string | null;
  cash_expenses?: number | null;
  cash_refunds?: number | null;
  gcash_sales?: number | null;
  bpi_sales?: number | null;
}

export interface MarketEventAllocationBase {
  sku: string;
  quantity: number;
  wasted_quantity?: number;
  waste_reason?: string | null;
}

export type MarketEventAllocationCreate = MarketEventAllocationBase;
export interface MarketEventAllocationOut extends MarketEventAllocationBase {
  id: number;
  product_name?: string;
  size?: string;
  current_stock?: number;
  retail_price?: number;
  cost_per_unit?: number | null;
  sold_quantity?: number;
  remaining_quantity?: number;
}

export interface MarketEventCreate extends MarketEventBase {
  allocations: MarketEventAllocationCreate[];
  recurrence?: string;
  recurrence_count?: number;
}

export interface MarketEventOut extends MarketEventBase {
  id: number;
  allocations: MarketEventAllocationOut[];
  is_deleted: boolean;
  estimated_revenue: number;
  estimated_cost: number | null;
  potential_profit: number | null;
  metrics_basis: "forecast" | "actual";
  costing_complete: boolean;
  financials_visible: boolean;
  cash_sales: number | null;
  total_tips?: number | null;
  ending_cashbox_balance: number | null;
  digital_sales_total: number | null;
  payment_breakdown: Record<string, number> | null;
  food_waste_quantity: number;
  food_leftover_quantity: number;
  food_waste_cost: number | null;
}

export interface MarketEventSaleItemBase {
  sku: string;
  quantity: number;
  price_snapshot?: number;
}

export type MarketEventSaleItemCreate = MarketEventSaleItemBase;
export interface MarketEventSaleItemOut extends MarketEventSaleItemBase {
  id: number;
  product_name?: string;
  size?: string;
}

export interface MarketEventSaleCreate {
  payment_method: string;
  items: MarketEventSaleItemCreate[];
  client_reference: string;
  expected_subtotal?: number | null;
  promotion_code?: "CLASSIC_DUO" | "SIGNATURE_DUO" | "COMBO_DUO" | "B1T1" | null;
  discount_type?: "PERCENTAGE" | "FIXED" | null;
  discount_value?: number | null;
  cash_received?: number | null;
  tip_amount?: number | null;
  payment_reference?: string | null;
  customer_name?: string | null;
  cashier_username?: string;
  is_preorder?: boolean;
  preorder_customer_name?: string | null;
  preorder_payment_status?: string | null;
  preorder_fulfillment_status?: string | null;
}

export interface MarketEventSaleUpdate {
  payment_method?: string;
  preorder_payment_status?: string;
  preorder_fulfillment_status?: string;
}

export interface MarketEventSaleOut {
  id: number;
  event_id: number;
  cashier_username?: string;
  payment_method: string;
  subtotal_amount: number;
  discount_type?: "PERCENTAGE" | "FIXED" | null;
  discount_value?: number | null;
  manual_discount_amount: number;
  promotion_code?: "CLASSIC_DUO" | "SIGNATURE_DUO" | "COMBO_DUO" | "B1T1" | "COMPLIMENTARY" | null;
  promotion_discount_amount: number;
  promotion_snapshot?: string | null;
  discount_amount: number;
  total_amount: number;
  cash_received?: number | null;
  change_given?: number;
  tip_amount?: number;
  payment_reference?: string | null;
  customer_name?: string | null;
  is_collected: boolean;
  timestamp: string;
  items: MarketEventSaleItemOut[];
  is_preorder?: boolean;
  preorder_customer_name?: string | null;
  preorder_payment_status?: string | null;
  preorder_fulfillment_status?: string | null;
}

export interface PublicPreorderCatalogProduct {
  sku: string;
  product_name: string;
  category: "Spreads & Sauces" | "Sandwiches & Salads";
  size: string;
  retail_price: number | string;
}

export interface PublicPreorderCatalog {
  form_name: string;
  event: {
    name: string;
    event_date: string;
    location: string;
  } | null;
  allowed_fulfillment_methods: Array<"Pickup" | "Delivery">;
  payment_preferences: string[];
  currency: "PHP";
  stock_reservation_mode: "none_until_pos_fulfillment";
  products: PublicPreorderCatalogProduct[];
}

export interface PublicPreorderSubmission {
  submission_reference: string;
  customer_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  requested_fulfillment_date: string;
  requested_fulfillment_time: string;
  fulfillment_method: "Pickup" | "Delivery";
  delivery_address: string | null;
  notes: string | null;
  payment_preference: string | null;
  items: Array<{ sku: string; quantity: number }>;
  extension: Record<string, never>;
}

export interface PublicPreorderReceipt {
  public_reference: string;
  status: string;
  payment_status: string;
  total_amount: number | string;
  currency: "PHP";
  requested_fulfillment_date: string;
  requested_fulfillment_time: string;
  fulfillment_method: "Pickup" | "Delivery";
  stock_reserved: false;
  submitted_at: string;
  items: Array<{
    id: number;
    sku: string;
    product_name: string;
    size: string;
    quantity: number;
    unit_price: number | string;
    line_total: number | string;
  }>;
}

export interface PreorderItemOut {
  id: number;
  sku: string;
  product_name_snapshot: string;
  size_snapshot: string;
  quantity: number;
  unit_price_snapshot: number | string;
  line_total_snapshot: number | string;
}

export interface PreorderSummary {
  id: number;
  public_reference: string;
  customer_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  requested_fulfillment_date: string;
  requested_fulfillment_time: string;
  fulfillment_method: "Pickup" | "Delivery";
  status: string;
  payment_status: string;
  total_amount: number;
  total_units: number;
  event_id: number | null;
  event_name: string | null;
  created_at: string;
}

export interface PreorderDetail extends PreorderSummary {
  delivery_address: string | null;
  notes: string | null;
  payment_preference: string | null;
  items: PreorderItemOut[];
}

export interface PreordersListResponse {
  items: PreorderSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface PreorderFormOut {
  id: number;
  name: string;
  is_enabled: boolean;
  event_id: number | null;
  token_hint: string;
  public_url?: string;
  created_at: string;
}

export interface CleaningTaskOut {
  id: number;
  task_name: string;
  frequency: string;
  last_done_date?: string | null;
  done_by_username?: string | null;
  remarks?: string | null;
}

export interface TimesheetEntryOut {
  id: number;
  employee_user_id?: number | null;
  employee_name: string;
  machine_employee_id?: string | null;
  work_date: string;
  clock_in?: string | null;
  clock_out?: string | null;
  source: "machine" | "manual";
  review_status: "Pending" | "Approved" | "Rejected";
  has_proof: boolean;
  notes?: string | null;
  duration_hours: number;
  hourly_rate: number;
  labor_cost: number;
  production_plan_id?: number | null;
  allocation_status: "not_ready" | "missing_rate" | "unallocated" | "allocated";
  created_at: string;
}

export interface TimesheetPage {
  items: TimesheetEntryOut[];
  total: number;
  limit: number;
  offset: number;
}

export interface TimesheetProofOut {
  data_url: string;
  mime_type: string;
}

export interface TimesheetLaborEmployeeSummary {
  employee_user_id?: number | null;
  employee_name: string;
  hourly_rate: number;
  approved_hours: number;
  labor_cost: number;
  allocated_hours: number;
  unallocated_hours: number;
  missing_rate_hours: number;
}

export interface TimesheetLaborSummary {
  date_from: string;
  date_to: string;
  approved_hours: number;
  total_labor_cost: number;
  allocated_hours: number;
  unallocated_hours: number;
  missing_rate_hours: number;
  employees: TimesheetLaborEmployeeSummary[];
}

export interface TimesheetCalculatorShift {
  date: string;
  start: string;
  end: string;
  total_hours?: number | null;
  working_days?: number | null;
  total_pay?: number | null;
}

export interface TimesheetCalculatorAllowance {
  label: string;
  amount?: number | null;
}

export interface TimesheetCalculatorSummary {
  total_hours?: number | null;
  working_days?: number | null;
  paid_work?: number | null;
  allowances: TimesheetCalculatorAllowance[];
  total_pay?: number | null;
  status?: string | null;
  remarks?: string | null;
}

export interface TimesheetCalculatorPeriod {
  period_name: string;
  side: "left" | "right";
  rate?: number | null;
  hours_per_shift?: number | null;
  standard_working_hours?: number | null;
  hourly_rate?: number | null;
  shifts: TimesheetCalculatorShift[];
  summary: TimesheetCalculatorSummary;
}

export interface TimesheetCalculatorAdvance {
  date: string;
  amount: number;
  status?: string | null;
}

export interface TimesheetCalculatorEmployee {
  employee_name: string;
  periods: TimesheetCalculatorPeriod[];
  cash_advances: TimesheetCalculatorAdvance[];
}

export interface TimesheetCalculatorResponse {
  employees: Record<string, TimesheetCalculatorEmployee>;
}

export interface AppVersionResponse {
  version: string;
  update_timestamp: string;
}

export interface SheetSyncApprovedField {
  source_header: string;
  destination_field: string;
  risk_level: "low" | "medium" | "high";
  approval_mode: "manual_review" | "auto_apply";
  auto_apply_eligible: boolean;
}

export interface SheetSyncApprovedSource {
  key: string;
  display_name: string;
  sheet_name: string;
  range: string;
  identifier_header: string;
  fields: SheetSyncApprovedField[];
}

export interface SheetSyncConfigStatus {
  enabled: boolean;
  configured: boolean;
  status_code: string;
  approved_spreadsheet_count: number;
  service_account_configured: boolean;
  authentication_mode: string;
  auto_apply_prices_enabled: boolean;
  auto_apply_eligible_fields: string[];
  auto_apply_max_price_change_pct: number;
  auto_check_interval_minutes: number;
  approved_sources: SheetSyncApprovedSource[];
}

export interface SheetSyncRun {
  public_id: string;
  trigger_type: string;
  status: "running" | "completed" | "completed_with_errors" | "failed";
  source_keys: string[];
  summary: Record<string, unknown>;
  requested_by_username?: string | null;
  started_at: string;
  completed_at?: string | null;
  error_code?: string | null;
  error_message?: string | null;
}

export interface SheetSyncChangeEvent {
  event_type: string;
  actor_username?: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export type SheetSyncChangeStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "ignored"
  | "applied"
  | "failed"
  | "conflict";

export interface SheetSyncChange {
  public_id: string;
  run_public_id: string;
  source_key: string;
  source_name: string;
  sheet_name: string;
  source_row_number: number;
  stable_identifier: string;
  source_header: string;
  destination_entity: string;
  destination_field: string;
  raw_source_value: unknown;
  previous_value: unknown;
  proposed_value: unknown;
  risk_level: "low" | "medium" | "high";
  approval_mode: "manual_review" | "auto_apply";
  status: SheetSyncChangeStatus;
  detected_at: string;
  decided_at?: string | null;
  applied_at?: string | null;
  decided_by_username?: string | null;
  applied_by_username?: string | null;
  resolution_note?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  events: SheetSyncChangeEvent[];
}

export interface SheetSyncQueue {
  counts: Record<SheetSyncChangeStatus, number>;
  changes: SheetSyncChange[];
}


export interface UserOut {
  id: number;
  username: string;
  role: "owner" | "staff";
  is_active: boolean;
  hourly_rate: number;
}

export interface MaintenanceAssetOut {
  id: number;
  area: string;
  item_name: string;
  style_or_kind?: string | null;
  condition: string;
  remarks?: string | null;
  replacement_date?: string | null;
  last_checked?: string | null;
}

export interface DiscountTierOut {
  id: number;
  min_subtotal: number;
  discount_percentage: number;
}

export interface InventoryTransactionOut {
  id: number;
  user_id?: number | null;
  sku?: string | null;
  raw_ingredient_id?: number | null;
  transaction_type: string;
  qty: number;
  batch_reference?: string | null;
  notes?: string | null;
  created_at?: string | null;
  user_username?: string | null;
  item_name?: string | null;
  warehouse_id?: number | null;
  warehouse_name?: string | null;
}

export interface WarehouseOut {
  id: number;
  name: string;
  location?: string | null;
  is_active?: boolean;
}

export interface WarehouseStockOut {
  warehouse_id: number;
  warehouse_name: string;
  raw_ingredient_id?: number | null;
  ingredient_name?: string | null;
  sku?: string | null;
  product_name?: string | null;
  quantity: number;
}

export interface IngredientBatchOut {
  id: number;
  raw_ingredient_id: number;
  batch_code: string;
  quantity: number;
  expiry_date?: string | null;
  created_at?: string | null;
  ingredient_name?: string | null;
}

export interface MrpProjectionOut {
  ingredient_id: number;
  ingredient_name: string;
  unit: string;
  available_stock: number;
  daily_burn_rate: number;
  days_to_depletion: number | "Infinite";
  suggested_replenishment: number;
  status: "success" | "warning" | "danger";
  supplier_id?: number | null;
}

export interface DraftPurchaseOrderOut {
  po_number: string;
  supplier_name: string;
  supplier_contact?: string | null;
  items: Array<{ ingredient_name: string; quantity: number; unit: string; subtotal: number }>;
  grand_total: number;
}

export interface ProductionForecastOut {
  scaled_recipes: Array<{
    recipe_name: string;
    target_sku: string;
    batches_needed: number;
    scaled_yield: number;
    yield_unit: string;
    scaled_ingredients: RecipeItemOut[];
  }>;
  material_checklist: Array<{
    ingredient_name: string;
    category?: string;
    total_needed: number;
    unit: string;
    available_stock: number;
    deficit: number;
    amount_per_pack: number;
    packs_to_buy: number;
    estimated_cost: number;
    parent_products?: string[];
  }>;
  total_estimated_raw_material_cost: number;
}

export interface GiftSetOut {
  id: number;
  name: string;
  retail_price: number;
  reseller_price: number;
  packaging_cost?: number;
  notes?: string | null;
  items: Array<{ id: number; sku: string; product_name: string; size: string; quantity: number; cost_per_unit?: number }>;
  calculated_total_cost: number;
  gross_margin_pct: number;
  net_margin_pct: number;
}

export interface CostAnalysisOut {
  sku: string;
  product_name: string;
  category: string;
  size: string;
  selling_price: number;
  reseller_price: number;
  food_cost: number;
  cost_override: number | null;
  cost_status: "ok" | "missing_recipe" | "missing_cost_input" | "invalid_cost";
  cost_status_message: string | null;
  labor_cost: number;
  utility_cost: number;
  total_cost: number;
  net_profit: number;
  gross_margin_pct: number;
  net_margin_pct: number;
}

export interface DashboardMetric {
  value: number;
  previous_value: number | null;
  change_pct: number | null;
  direction: "up" | "down" | "flat";
}

export interface OwnerDashboardAlert {
  id: string;
  priority: "critical" | "warning" | "info";
  type: string;
  message: string;
  impact: string;
  due: string;
  action_label: string;
  action_href: string;
}

export interface OwnerDashboardProduct {
  sku: string;
  product_name: string;
  size: string;
  category: "Spreads & Sauces" | "Sandwiches & Salads";
  selling_price: number;
  food_cost: number;
  labor_cost: number;
  utility_cost: number;
  total_cost: number;
  gross_profit: number;
  net_profit: number;
  gross_margin_pct: number;
  net_margin_pct: number;
  units_sold: number;
  weekly_net_sales: number;
  cost_status: "ok" | "missing_recipe" | "missing_cost_input" | "invalid_cost" | "legacy_estimate";
  cost_status_message: string | null;
}

export interface OwnerWeeklyDashboard {
  timezone: "Asia/Manila";
  refreshed_at: string;
  period: {
    start: string;
    end: string;
    data_through: string;
    label: string;
    previous_start: string;
    previous_end: string;
    previous_label: string;
    is_current_week: boolean;
  };
  confidence: {
    status: "complete" | "estimated" | "needs_review";
    gap_count: number;
    gaps: string[];
    invalid_product_count: number;
  };
  kpis: {
    weekly_net_sales: DashboardMetric;
    weekly_food_cost: DashboardMetric;
    contribution_profit: DashboardMetric;
    pending_collectibles: DashboardMetric & {
      count: number;
      overdue_total: number;
      overdue_count: number;
    };
  };
  sales_by_channel: Array<{ channel: string; net_sales: number }>;
  cost_by_category: Array<{
    category: string;
    food_cost: number;
    labor_cost: number;
    utility_cost: number;
    total_cost: number;
  }>;
  cost_breakdown: Array<{ name: string; value: number }>;
  labor_basis: "approved_timesheets" | "standard";
  alerts: OwnerDashboardAlert[];
  product_analysis: OwnerDashboardProduct[];
}

export interface DashboardSummaryOut {
  viewer_role: "owner" | "staff";
  analytics: Record<string, number | string | boolean | null>;
  low_stock: Array<Record<string, unknown>>;
  expiring_batches: Array<Record<string, unknown>>;
  today_plan: Record<string, unknown> | null;
  cleaning_summary: { total_tasks: number; completed_tasks: number };
  waste_trend: Array<Record<string, unknown>>;
  pending_timesheets_count: number;
  missing_cost_warnings_count?: number;
  unpaid_deliveries?: Array<Record<string, unknown>>;
  owner_weekly?: OwnerWeeklyDashboard;
}

export interface CategoryOverheadRateOut {
  category: string;
  labor_cost_per_unit: number;
  utility_cost_per_unit: number;
}

export interface LoginResponse {
  token: string;
  username: string;
  role: string;
}

export interface AuthenticatedUser {
  username: string;
  role: string;
}

// ----------------------------------------------------
// AUTH TOKEN STATE & SILENT REFRESH QUEUE
// ----------------------------------------------------
let activeAccessToken: string | null = null;
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

export function getAccessToken(): string | null {
  return activeAccessToken;
}

export function setAccessToken(token: string | null) {
  activeAccessToken = token;
}

const FINANCIAL_CACHE_KEYS = [
  "hh_cache_dashboard_summary",
  "hh_cache_cost_analysis",
  "hh_cache_market_products",
  "hh_cache_raw_ingredients",
  "hh_cache_gift_sets",
  "hh_cache_overhead_rates",
] as const;

export function clearFinancialCaches() {
  if (typeof window === "undefined") return;
  try {
    FINANCIAL_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
    // localStorage can be unavailable in private browsing.
  }
}

function applyAuthenticatedRole(role: string) {
  if (typeof window === "undefined") return;
  try {
    const previousRole = localStorage.getItem("hh_user_role");
    if (role !== "owner" || (previousRole && previousRole !== role)) {
      clearFinancialCaches();
    }
    localStorage.setItem("hh_user_role", role);
  } catch {
    // localStorage can be unavailable in private browsing.
  }
}

function subscribeTokenRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

function onRefreshed(token: string) {
  refreshSubscribers.forEach(cb => cb(token));
  refreshSubscribers = [];
}

function isMarketEventSaleMutation(path: string, method: string): boolean {
  return method.toUpperCase() === "POST" && /^\/market-events\/\d+\/sales$/.test(path);
}

function isNonQueueableFinancialMutation(path: string, method: string): boolean {
  return (
    method.toUpperCase() === "POST"
    && (path === "/resellers/orders" || isMarketEventSaleMutation(path, method))
  );
}

function isNonQueueableTimesheetMutation(path: string, method: string): boolean {
  return method.toUpperCase() === "POST" && path === "/timesheets/manual";
}

function isNonQueueableSheetSyncMutation(path: string, method: string): boolean {
  return method.toUpperCase() !== "GET" && path.startsWith("/sheet-sync/");
}

function isNonQueueablePublicPreorderMutation(path: string, method: string): boolean {
  return method.toUpperCase() === "POST" && /^\/preorders\/public\/[^/]+$/.test(path);
}

function isNonQueueableProductionMutation(path: string, method: string): boolean {
  return method.toUpperCase() !== "GET" && path.startsWith("/production/plans");
}

function isNonQueueableMutation(path: string, method: string): boolean {
  return isReplayUnsafeMutation(path, method);
}

export class UnconfirmedMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnconfirmedMutationError";
  }
}

export class UnconfirmedFinancialMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnconfirmedFinancialMutationError";
  }
}

export class UnconfirmedTimesheetMutationError extends Error {
  constructor() {
    super("The manual timesheet could not be confirmed and was not queued. Reconnect, then submit it again; the request reference prevents duplicates.");
    this.name = "UnconfirmedTimesheetMutationError";
  }
}

export class UnconfirmedSheetSyncMutationError extends Error {
  constructor() {
    super("The Google Sheets review action could not be confirmed and was not queued. Reconnect and check the review queue before retrying.");
    this.name = "UnconfirmedSheetSyncMutationError";
  }
}

export class UnconfirmedPublicPreorderError extends Error {
  constructor() {
    super("Your pre-order could not be confirmed. Your form is still here; reconnect and retry with the same submission reference.");
    this.name = "UnconfirmedPublicPreorderError";
  }
}

export class UnconfirmedProductionMutationError extends Error {
  constructor() {
    super("Production completion could not be confirmed and was not queued. Reconnect, then retry the same date and targets; completion is idempotent.");
    this.name = "UnconfirmedProductionMutationError";
  }
}

function createUnconfirmedFinancialMutationError(path: string, method: string) {
  if (isMarketEventSaleMutation(path, method)) {
    return new UnconfirmedFinancialMutationError(
      "The Market POS sale could not be confirmed and was not added to the generic replay queue."
    );
  }
  return new UnconfirmedFinancialMutationError(
    "The wholesale invoice could not be confirmed and was not queued. Check recent invoices before retrying; your cart has been kept."
  );
}

function createUnconfirmedMutationError(path: string, method: string) {
  if (isNonQueueableProductionMutation(path, method)) {
    return new UnconfirmedProductionMutationError();
  }
  if (isNonQueueablePublicPreorderMutation(path, method)) {
    return new UnconfirmedPublicPreorderError();
  }
  if (isNonQueueableSheetSyncMutation(path, method)) {
    return new UnconfirmedSheetSyncMutationError();
  }
  if (isNonQueueableTimesheetMutation(path, method)) {
    return new UnconfirmedTimesheetMutationError();
  }
  if (isNonQueueableFinancialMutation(path, method)) {
    return createUnconfirmedFinancialMutationError(path, method);
  }
  return new UnconfirmedMutationError(getUnconfirmedMutationMessage(path, method));
}

function isUnconfirmedMutationError(error: unknown): error is Error {
  return error instanceof UnconfirmedFinancialMutationError
    || error instanceof UnconfirmedMutationError
    || error instanceof UnconfirmedTimesheetMutationError
    || error instanceof UnconfirmedSheetSyncMutationError
    || error instanceof UnconfirmedPublicPreorderError
    || error instanceof UnconfirmedProductionMutationError;
}

async function parseJsonResponse(
  response: Response,
  path: string,
  method: string,
): Promise<any> {
  try {
    return await response.json();
  } catch (error) {
    // A successful financial/production write may already be committed even
    // when its response body is truncated or otherwise unreadable. Preserve
    // the idempotent request for reconciliation instead of treating this as a
    // definitive server rejection.
    if (isNonQueueableMutation(path, method)) {
      throw createUnconfirmedMutationError(path, method);
    }
    throw error;
  }
}

async function fetchJson(path: string, options?: RequestInit): Promise<any> {
  const url = `${API_BASE_URL}${path}`;
  const method = options?.method || "GET";

  const headers: Record<string, string> = {
    ...(typeof FormData !== "undefined" && options?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    ...(options?.headers as Record<string, string> || {}),
  };

  if (activeAccessToken) {
    headers["Authorization"] = `Bearer ${activeAccessToken}`;
  }

  let response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: "include",
      headers,
    });
  } catch (fetchErr) {
    if (isNonQueueableMutation(path, method)) {
      throw createUnconfirmedMutationError(path, method);
    }
    throw fetchErr;
  }

  if (!response.ok) {
    if (
      response.status >= 500
      && isNonQueueableMutation(path, method)
    ) {
      throw createUnconfirmedMutationError(path, method);
    }

    // If unauthorized (401), handle auto-refresh tokens
    if (response.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
      if (!navigator.onLine) {
        throw new Error("Your session could not be verified while offline. Reconnect before continuing.");
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          subscribeTokenRefresh(async (token) => {
            try {
              headers["Authorization"] = `Bearer ${token}`;
              let retryResponse: Response;
              try {
                retryResponse = await fetch(url, { ...options, credentials: "include", headers });
              } catch (error) {
                if (isNonQueueableMutation(path, options?.method || "GET")) {
                  throw createUnconfirmedMutationError(path, options?.method || "GET");
                }
                throw error;
              }
              if (
                retryResponse.status >= 500
                && isNonQueueableMutation(path, options?.method || "GET")
              ) {
                throw createUnconfirmedMutationError(path, options?.method || "GET");
              }
              if (!retryResponse.ok) throw new Error("Retry failed");
              resolve(await parseJsonResponse(retryResponse, path, method));
            } catch (error) {
              reject(error);
            }
          });
        });
      }

      isRefreshing = true;
      try {
        const refreshResponse = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" }
        });

        if (refreshResponse.ok) {
          const res = await refreshResponse.json();
          activeAccessToken = res.token;
          applyAuthenticatedRole(res.role);
          onRefreshed(res.token);
          isRefreshing = false;
          
          // Retry the original request
          headers["Authorization"] = `Bearer ${res.token}`;
          let retryRes: Response;
          try {
            retryRes = await fetch(url, { ...options, credentials: "include", headers });
          } catch (error) {
            if (isNonQueueableMutation(path, options?.method || "GET")) {
              throw createUnconfirmedMutationError(path, options?.method || "GET");
            }
            throw error;
          }
          if (
            retryRes.status >= 500
            && isNonQueueableMutation(path, options?.method || "GET")
          ) {
            throw createUnconfirmedMutationError(path, options?.method || "GET");
          }
          if (!retryRes.ok) throw new Error("Retry failed");
          return parseJsonResponse(retryRes, path, method);
        } else {
          throw new Error("Refresh failed");
        }
      } catch (refreshErr) {
        isRefreshing = false;
        if (isUnconfirmedMutationError(refreshErr)) {
          throw refreshErr;
        }
        console.error("[API] Session expired. Redirecting to login...", refreshErr);
        activeAccessToken = null;
        clearFinancialCaches();
        try {
          localStorage.removeItem("hh_logged_in");
          localStorage.removeItem("hh_user_name");
          localStorage.removeItem("hh_user_role");
        } catch {}
        window.location.href = "/login";
      }
    }
    
    let errorDetail = response.statusText ? `API Request failed (${response.status}: ${response.statusText})` : `API Request failed (${response.status})`;
    try {
      const responseText = await response.text();
      if (responseText && responseText.trim()) {
        try {
          const errJson = JSON.parse(responseText);
          if (errJson && errJson.detail) {
            if (Array.isArray(errJson.detail)) {
              errorDetail = errJson.detail.map((d: Record<string, unknown>) => {
                const locStr = Array.isArray(d.loc) ? d.loc.join(".") : "";
                const msgStr = typeof d.msg === "string" ? d.msg : String(d.msg || "");
                return locStr ? `${locStr}: ${msgStr}` : msgStr;
              }).join("; ");
            } else {
              errorDetail = typeof errJson.detail === "string" ? errJson.detail : JSON.stringify(errJson.detail);
            }
          } else if (errJson && typeof errJson.message === "string" && errJson.message.trim()) {
            errorDetail = errJson.message;
          } else if (errJson && typeof errJson.error === "string" && errJson.error.trim()) {
            errorDetail = errJson.error;
          }
        } catch {
          if (responseText.length < 200) {
            errorDetail = responseText.trim();
          }
        }
      }
    } catch {
      // ignore fallback
    }
    throw new Error(errorDetail);
  }

  return parseJsonResponse(response, path, method);
}

export const api = {
  // ----------------------------------------------------
  // SECURITY & AUTH
  // ----------------------------------------------------
  login: (username: string, passcode: string): Promise<LoginResponse> => 
    fetchJson("/login", {
      method: "POST",
      body: JSON.stringify({ username, password: passcode }),
    }).then(res => {
      clearFinancialCaches();
      activeAccessToken = res.token;
      applyAuthenticatedRole(res.role);
      return res;
    }),

  refreshSession: (): Promise<LoginResponse> =>
    fetchJson("/auth/refresh", { method: "POST" }).then(res => {
      activeAccessToken = res.token;
      applyAuthenticatedRole(res.role);
      return res;
    }),

  getCurrentUser: (): Promise<AuthenticatedUser> => fetchJson("/auth/me"),

  logout: (): Promise<{ message: string }> =>
    fetchJson("/auth/logout", { method: "POST" }).then(res => {
      activeAccessToken = null;
      clearFinancialCaches();
      return res;
    }),

  // ----------------------------------------------------
  // GENERAL & ANALYTICS
  // ----------------------------------------------------
  getDashboardAnalytics: (): Promise<any> => fetchJson("/dashboard/analytics"),
  getDashboardSummary: (filters?: { period?: "all" | "7d" | "30d" | "custom" | "week"; date_from?: string; date_to?: string }): Promise<DashboardSummaryOut> => {
    const params = new URLSearchParams();
    if (filters?.period) params.set("period", filters.period);
    if (filters?.date_from) params.set("date_from", filters.date_from);
    if (filters?.date_to) params.set("date_to", filters.date_to);
    const query = params.toString();
    return fetchJson(`/dashboard/summary${query ? `?${query}` : ""}`);
  },

  // ----------------------------------------------------
  // PRODUCT SKUs
  // ----------------------------------------------------
  getProducts: (category?: string): Promise<ProductSKUOut[]> => {
    const qs = category ? `?category=${encodeURIComponent(category)}` : "";
    return fetchJson(`/products${qs}`).then((products: ProductSKUOut[]) =>
      products.filter(isCurrentLineupProduct)
    );
  },
  updateProduct: (sku: string, data: ProductSKUUpdate): Promise<ProductSKUOut> => 
    fetchJson(`/products/${sku}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // ----------------------------------------------------
  // RAW INGREDIENTS
  // ----------------------------------------------------
  getRawIngredients: (): Promise<RawIngredientOut[]> => fetchJson("/raw-ingredients"),
  updateRawIngredient: (id: number, data: RawIngredientUpdate): Promise<RawIngredientOut> => 
    fetchJson(`/raw-ingredients/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  getInventoryTransactions: (limit?: number, skip?: number): Promise<InventoryTransactionOut[]> => {
    let url = "/inventory-transactions";
    const params = new URLSearchParams();
    if (limit !== undefined) params.append("limit", limit.toString());
    if (skip !== undefined) params.append("skip", skip.toString());
    const query = params.toString();
    if (query) url += `?${query}`;
    return fetchJson(url);
  },

  // ----------------------------------------------------
  // COSTING
  // ----------------------------------------------------
  recalculateAllCosts: (): Promise<{ message: string }> => fetchJson("/costing/recalculate-all", { method: "POST" }),
  getSkuCostDetails: (sku: string): Promise<RecipeOut> => fetchJson(`/costing/sku/${sku}`),
  previewSkuCost: (sku: string, data: Omit<RecipeCreate, "sku">): Promise<RecipeCostPreviewOut> =>
    fetchJson(`/costing/sku/${sku}/preview`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getAllRecipes: (): Promise<any[]> => fetchJson("/costing/recipes"),
  updateSkuRecipe: (sku: string, data: any): Promise<any> =>
    fetchJson(`/costing/sku/${sku}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  getCostAnalysis: (): Promise<CostAnalysisOut[]> =>
    fetchJson("/costing/analysis").then((rows: CostAnalysisOut[]) =>
      rows.filter(isCurrentLineupProduct)
    ),
  updateRecipeItem: (itemId: number, data: any): Promise<any> => 
    fetchJson(`/costing/recipe-items/${itemId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // ----------------------------------------------------
  // PRODUCTION PLANS
  // ----------------------------------------------------
  getProductionCatalog: (): Promise<ProductionCatalogItem[]> =>
    fetchJson("/production/catalog"),
  getPlans: (): Promise<ProductionPlanOut[]> => fetchJson("/production/plans"),
  getPlan: (id: number): Promise<ProductionPlanOut> => fetchJson(`/production/plans/${id}`),
  createPlan: (data: ProductionPlanCreate): Promise<ProductionPlanOut> => 
    fetchJson("/production/plans", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  completePlan: (id: number): Promise<ProductionPlanOut> =>
    fetchJson(`/production/plans/${id}/complete`, { method: "POST" }),
  completeProductionPlan: (data: ProductionPlanCreate): Promise<ProductionPlanOut> =>
    fetchJson("/production/plans/complete", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  runForecast: (items: { sku: string; quantity: number; outlet: string }[]): Promise<ProductionForecastOut> =>
    fetchJson("/production/forecast", {
      method: "POST",
      body: JSON.stringify({ items }),
    }),

  // ----------------------------------------------------
  // CONSIGNMENT PARTNERS & DELIVERIES
  // ----------------------------------------------------
  getPartners: (): Promise<ConsignmentPartnerOut[]> => fetchJson("/consignment/partners"),
  updatePartner: (partnerId: number, data: any): Promise<ConsignmentPartnerOut> =>
    fetchJson(`/consignment/partners/${partnerId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  getPartnerDeliveries: (partnerId: number, limit?: number, skip?: number): Promise<ConsignmentDeliveryOut[]> => {
    let url = `/consignment/partners/${partnerId}/deliveries`;
    const params = new URLSearchParams();
    if (limit !== undefined) params.append("limit", limit.toString());
    if (skip !== undefined) params.append("skip", skip.toString());
    const query = params.toString();
    if (query) url += `?${query}`;
    return fetchJson(url);
  },
  getUnpaidDeliveries: (): Promise<ConsignmentDeliveryOut[]> => fetchJson("/consignment/deliveries/unpaid"),
  recordConsignmentDelivery: (data: ConsignmentDeliveryCreate): Promise<ConsignmentDeliveryOut> => 
    fetchJson("/consignment/deliveries", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getDeliveryDetails: (id: number): Promise<ConsignmentDeliveryOut> => fetchJson(`/consignment/deliveries/${id}`),
  updateDeliveryItem: (itemId: number, data: { units_sold?: number; qty_pulled_out?: number }): Promise<ConsignmentItemOut> => 
    fetchJson(`/consignment/delivery-items/${itemId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  updateDeliveryDR: (deliveryId: number, drNumber: string): Promise<ConsignmentDeliveryOut> => 
    fetchJson(`/consignment/deliveries/${deliveryId}?dr_number=${encodeURIComponent(drNumber)}`, {
      method: "PUT",
    }),
  payDelivery: (deliveryId: number, paymentDate: string): Promise<any> => 
    fetchJson(`/consignment/deliveries/${deliveryId}/pay?payment_date=${encodeURIComponent(paymentDate)}`, {
      method: "POST",
    }),
  deleteConsignmentDelivery: (deliveryId: number): Promise<any> =>
    fetchJson(`/consignment/deliveries/${deliveryId}`, {
      method: "DELETE",
    }),

  // ----------------------------------------------------
  // RESELLER ORDERS
  // ----------------------------------------------------
  getResellerOrders: (limit?: number, skip?: number): Promise<ResellerOrderOut[]> => {
    let url = "/resellers/orders";
    const params = new URLSearchParams();
    if (limit !== undefined) params.append("limit", limit.toString());
    if (skip !== undefined) params.append("skip", skip.toString());
    const query = params.toString();
    if (query) url += `?${query}`;
    return fetchJson(url);
  },
  getResellerOrder: (id: number): Promise<ResellerOrderOut> => fetchJson(`/resellers/orders/${id}`),
  createResellerOrder: (data: ResellerOrderCreate): Promise<ResellerOrderOut> => 
    fetchJson("/resellers/orders", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  payResellerOrder: (id: number): Promise<ResellerOrderOut> => fetchJson(`/resellers/orders/${id}/pay`, { method: "POST" }),
  deleteResellerOrder: (id: number): Promise<any> => fetchJson(`/resellers/orders/${id}`, { method: "DELETE" }),

  // ----------------------------------------------------
  // MAINTENANCE & TASKS
  // ----------------------------------------------------
  getCleaningTasks: (): Promise<CleaningTaskOut[]> => fetchJson("/tasks/cleaning"),
  completeCleaningTask: (id: number, dateDone: string, remarks?: string): Promise<any> => {
    const qs = remarks ? `&remarks=${encodeURIComponent(remarks)}` : "";
    return fetchJson(`/tasks/cleaning/${id}/complete?date_done=${encodeURIComponent(dateDone)}${qs}`, {
      method: "POST",
    });
  },
  getMaintenanceAssets: (area?: string): Promise<MaintenanceAssetOut[]> => {
    const qs = area ? `?area=${encodeURIComponent(area)}` : "";
    return fetchJson(`/tasks/maintenance${qs}`);
  },
  updateMaintenanceAsset: (id: number, data: Partial<MaintenanceAssetOut>): Promise<MaintenanceAssetOut> => 
    fetchJson(`/tasks/maintenance/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  createCleaningTask: (data: { task_name: string; frequency?: string }): Promise<CleaningTaskOut> =>
    fetchJson("/tasks/cleaning", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteCleaningTask: (id: number): Promise<{ message: string }> =>
    fetchJson(`/tasks/cleaning/${id}`, {
      method: "DELETE",
    }),
  createMaintenanceAsset: (data: { area: string; item_name: string; style_or_kind?: string | null }): Promise<MaintenanceAssetOut> =>
    fetchJson("/tasks/maintenance", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteMaintenanceAsset: (id: number): Promise<{ message: string }> =>
    fetchJson(`/tasks/maintenance/${id}`, {
      method: "DELETE",
    }),

  // ----------------------------------------------------
  // TIMESHEETS
  // ----------------------------------------------------
  getTimesheets: (limit = 50, offset = 0): Promise<TimesheetPage> =>
    fetchJson(`/timesheets?limit=${limit}&offset=${offset}`),
  importMachineTimesheets: (rows: Array<Record<string, string>>): Promise<TimesheetEntryOut[]> =>
    fetchJson("/timesheets/import", {
      method: "POST",
      body: JSON.stringify({ rows: rows.map(values => ({ values })) }),
    }),
  createManualTimesheet: (data: {
    client_reference: string;
    work_date: string;
    clock_in: string;
    clock_out?: string | null;
    employee_name?: string;
    notes?: string;
    proof_image_data: string;
    proof_image_type: "image/jpeg" | "image/png" | "image/webp";
  }): Promise<TimesheetEntryOut> => fetchJson("/timesheets/manual", {
    method: "POST",
    body: JSON.stringify(data),
  }),
  getTimesheetProof: (id: number): Promise<TimesheetProofOut> => fetchJson(`/timesheets/${id}/proof`),
  reviewTimesheet: (id: number, review_status: "Approved" | "Rejected"): Promise<TimesheetEntryOut> =>
    fetchJson(`/timesheets/${id}/review`, {
      method: "PATCH",
      body: JSON.stringify({ review_status }),
    }),
  getTimesheetLaborSummary: (date_from: string, date_to: string): Promise<TimesheetLaborSummary> =>
    fetchJson(`/timesheets/labor-summary?date_from=${encodeURIComponent(date_from)}&date_to=${encodeURIComponent(date_to)}`),
  allocateTimesheet: (id: number, production_plan_id: number | null): Promise<TimesheetEntryOut> =>
    fetchJson(`/timesheets/${id}/allocation`, {
      method: "PATCH",
      body: JSON.stringify({ production_plan_id }),
    }),
  getTimesheetCalculatorData: (): Promise<TimesheetCalculatorResponse> =>
    fetchJson("/timesheets/calculator"),
  uploadTimesheetCalculatorFile: (formData: FormData): Promise<TimesheetCalculatorResponse> =>
    fetchJson("/timesheets/calculator/upload", {
      method: "POST",
      body: formData,
    }),


  // ----------------------------------------------------
  // GIFT SET BUNDLES & OVERHEAD RATES
  // ----------------------------------------------------
  getGiftSets: (): Promise<GiftSetOut[]> => fetchJson("/gift-sets"),
  getGiftSet: (id: number): Promise<GiftSetOut> => fetchJson(`/gift-sets/${id}`),
  createGiftSet: (data: { name: string; retail_price: number; reseller_price: number; packaging_cost?: number; notes?: string | null; items: Array<{ sku: string; quantity: number }> }): Promise<GiftSetOut> =>
    fetchJson("/gift-sets", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteGiftSet: (id: number): Promise<any> => fetchJson(`/gift-sets/${id}`, {
    method: "DELETE",
  }),
  getOverheadRates: (): Promise<CategoryOverheadRateOut[]> => fetchJson("/gift-sets/overhead-rates"),
  updateOverheadRate: (category: string, data: CategoryOverheadRateOut): Promise<CategoryOverheadRateOut> =>
    fetchJson(`/gift-sets/overhead-rates/${category}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // ----------------------------------------------------
  // SYSTEM SETTINGS & USER ACCOUNTS (Owner-Only)
  // ----------------------------------------------------
  getDiscountTiers: (): Promise<DiscountTierOut[]> => fetchJson("/resellers/discount-tiers"),
  createDiscountTier: (data: { min_subtotal: number; discount_percentage: number }): Promise<DiscountTierOut> => 
    fetchJson("/resellers/discount-tiers", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateDiscountTier: (id: number, data: { min_subtotal?: number; discount_percentage?: number }): Promise<DiscountTierOut> => 
    fetchJson(`/resellers/discount-tiers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteDiscountTier: (id: number): Promise<any> => fetchJson(`/resellers/discount-tiers/${id}`, {
    method: "DELETE",
  }),
  getUsers: (): Promise<UserOut[]> => fetchJson("/users"),
  createUser: (data: { username: string; password: string; role: "owner" | "staff"; hourly_rate?: number }): Promise<UserOut> => fetchJson("/users", {
    method: "POST",
    body: JSON.stringify(data),
  }),
  updateUser: (id: number, data: { hourly_rate: number }): Promise<UserOut> => fetchJson(`/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  }),
  resetTestData: (): Promise<{ message: string }> => fetchJson("/admin/reset-test-data", {
    method: "POST",
  }),
  getAppVersion: (): Promise<AppVersionResponse> => fetchJson("/version"),
  forceRefreshDevices: (): Promise<{ message: string; update_timestamp: string }> => fetchJson("/admin/force-refresh", {
    method: "POST",
  }),
  getSheetSyncStatus: (): Promise<SheetSyncConfigStatus> => fetchJson("/sheet-sync/status"),
  updateSheetSyncSettings: (autoApplyPricesEnabled: boolean): Promise<SheetSyncConfigStatus> =>
    fetchJson("/sheet-sync/settings", {
      method: "PATCH",
      body: JSON.stringify({ auto_apply_prices_enabled: autoApplyPricesEnabled }),
    }),
  getSheetSyncRuns: (limit = 20): Promise<SheetSyncRun[]> => fetchJson(`/sheet-sync/runs?limit=${limit}`),
  getSheetSyncChanges: (status?: SheetSyncChangeStatus): Promise<SheetSyncQueue> =>
    fetchJson(`/sheet-sync/changes${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  checkSheetSyncUpdates: (sourceKeys?: string[]): Promise<SheetSyncRun> =>
    fetchJson("/sheet-sync/check", {
      method: "POST",
      body: JSON.stringify({ source_keys: sourceKeys?.length ? sourceKeys : null }),
    }),
  autoCheckSheetSyncUpdates: (): Promise<SheetSyncRun> =>
    fetchJson("/sheet-sync/auto-check", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  reviewSheetSyncChange: (
    changePublicId: string,
    action: "accept" | "reject" | "ignore",
    resolutionNote?: string,
  ): Promise<SheetSyncChange> => fetchJson(`/sheet-sync/changes/${encodeURIComponent(changePublicId)}/review`, {
    method: "POST",
    body: JSON.stringify({ action, resolution_note: resolutionNote?.trim() || null }),
  }),
  getBackupBlob: async (): Promise<Blob> => {
    const token = activeAccessToken;
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const response = await fetch(`${API_BASE_URL}/backup`, { credentials: "include", headers });
    if (!response.ok) {
      throw new Error("Failed to download database backup");
    }
    return response.blob();
  },

  // ----------------------------------------------------
  // SUPPLIERS
  // ----------------------------------------------------
  getSuppliers: (): Promise<SupplierOut[]> => fetchJson("/suppliers"),
  createSupplier: (data: SupplierCreate): Promise<SupplierOut> => 
    fetchJson("/suppliers", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateSupplier: (id: number, data: SupplierUpdate): Promise<SupplierOut> => 
    fetchJson(`/suppliers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteSupplier: (id: number): Promise<any> => fetchJson(`/suppliers/${id}`, {
    method: "DELETE",
  }),

  // ----------------------------------------------------
  // WAREHOUSES & TRANSFERS
  // ----------------------------------------------------
  getWarehouses: (): Promise<WarehouseOut[]> => fetchJson("/warehouses"),
  createWarehouse: (data: Omit<WarehouseOut, "id">): Promise<WarehouseOut> =>
    fetchJson("/warehouses", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateWarehouse: (id: number, data: Partial<Omit<WarehouseOut, "id">>): Promise<WarehouseOut> =>
    fetchJson(`/warehouses/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteWarehouse: (id: number): Promise<any> => fetchJson(`/warehouses/${id}`, {
    method: "DELETE",
  }),
  getWarehouseStocks: (): Promise<WarehouseStockOut[]> => fetchJson("/warehouses/stocks"),
  transferWarehouseInventory: (data: { source_warehouse_id: number; destination_warehouse_id: number; raw_ingredient_id?: number | null; sku?: string | null; quantity: number }): Promise<any> => 
    fetchJson("/warehouses/transfer", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // ----------------------------------------------------
  // PUSH NOTIFICATIONS
  // ----------------------------------------------------
  subscribePush: (data: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<any> => 
    fetchJson("/push/subscribe", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  testPush: (): Promise<any> => fetchJson("/push/test", {
    method: "POST",
  }),

  // ----------------------------------------------------
  // INGREDIENT BATCHES (FIFO)
  // ----------------------------------------------------
  getRawIngredientBatches: (): Promise<IngredientBatchOut[]> => fetchJson("/raw-ingredients/batches"),
  intakeRawIngredientBatch: (data: { raw_ingredient_id: number; batch_code: string; quantity: number; expiry_date?: string | null }): Promise<IngredientBatchOut> =>
    fetchJson("/raw-ingredients/batches/intake", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // ----------------------------------------------------
  // MRP FORECASTING
  // ----------------------------------------------------
  getMrpProjections: (): Promise<MrpProjectionOut[]> => fetchJson("/mrp/projections"),
  generateDraftPo: (data: { supplier_id: number; items: { ingredient_id: number; quantity: number }[] }): Promise<DraftPurchaseOrderOut> =>
    fetchJson("/mrp/draft-po", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  
  // ----------------------------------------------------
  // MARKET EVENTS ENDPOINTS
  // ----------------------------------------------------
  getMarketEvents: (): Promise<MarketEventOut[]> => fetchJson("/market-events"),
  getMarketEventsAnalytics: (): Promise<any> => fetchJson("/market-events/analytics/summary"),
  getMarketEvent: (id: number): Promise<MarketEventOut> => fetchJson(`/market-events/${id}`),
  createMarketEvent: (data: MarketEventCreate): Promise<MarketEventOut> => 
    fetchJson("/market-events", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateMarketEvent: (id: number, data: Partial<MarketEventCreate>): Promise<MarketEventOut> => 
    fetchJson(`/market-events/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteMarketEvent: (id: number): Promise<any> => fetchJson(`/market-events/${id}`, {
    method: "DELETE",
  }),
  createMarketEventSale: (eventId: number, data: MarketEventSaleCreate): Promise<MarketEventSaleOut> => 
    fetchJson(`/market-events/${eventId}/sales`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateMarketEventPreorder: (eventId: number, saleId: number, data: MarketEventSaleUpdate): Promise<MarketEventSaleOut> =>
    fetchJson(`/market-events/${eventId}/sales/${saleId}/preorder`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  getMarketEventSales: (eventId: number): Promise<MarketEventSaleOut[]> => fetchJson(`/market-events/${eventId}/sales`),
  undoMarketEventSale: (eventId: number, saleId: number): Promise<{ message: string }> => fetchJson(`/market-events/${eventId}/sales/${saleId}/undo`, {
    method: "DELETE",
  }),

  getPublicPreorderCatalog: (publicToken: string): Promise<PublicPreorderCatalog> =>
    fetchJson(`/preorders/public/${encodeURIComponent(publicToken)}`),
  submitPublicPreorder: (
    publicToken: string,
    data: PublicPreorderSubmission,
  ): Promise<PublicPreorderReceipt> =>
    fetchJson(`/preorders/public/${encodeURIComponent(publicToken)}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getPreorders: (params?: { q?: string; status?: string; payment_status?: string; page?: number; page_size?: number }): Promise<PreordersListResponse> => {
    const searchParams = new URLSearchParams();
    if (params?.q) searchParams.append("q", params.q);
    if (params?.status) searchParams.append("status", params.status);
    if (params?.payment_status) searchParams.append("payment_status", params.payment_status);
    if (params?.page) searchParams.append("page", String(params.page));
    if (params?.page_size) searchParams.append("page_size", String(params.page_size));
    const qs = searchParams.toString();
    return fetchJson(`/preorders${qs ? `?${qs}` : ""}`);
  },
  getPreorderDetail: (preorderId: number): Promise<PreorderDetail> =>
    fetchJson(`/preorders/${preorderId}`),
  updatePreorderStatus: (preorderId: number, status: string): Promise<PreorderDetail> =>
    fetchJson(`/preorders/${preorderId}/transition`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),
  updatePreorderItems: (preorderId: number, items: Array<{ sku: string; quantity: number }>): Promise<PreorderDetail> =>
    fetchJson(`/preorders/${preorderId}/items`, {
      method: "PATCH",
      body: JSON.stringify({ items }),
    }),
  getPreorderForms: (): Promise<PreorderFormOut[]> =>
    fetchJson(`/preorders/forms`),
  getFormDisabledSkus: (formId: number): Promise<string[]> =>
    fetchJson(`/preorders/forms/${formId}/disabled-skus`),
  updateFormDisabledSkus: (formId: number, disabledSkus: string[]): Promise<string[]> =>
    fetchJson(`/preorders/forms/${formId}/disabled-skus`, {
      method: "PATCH",
      body: JSON.stringify({ disabled_skus: disabledSkus }),
    }),
  
  // ----------------------------------------------------
  // OFFLINE ACTIONS SYNC
  // ----------------------------------------------------
  getOfflineActionsCount: (): Promise<number> => offlineDb.getOfflineActions().then(a => a.length),
  syncOfflineChanges: async (): Promise<{ success: number; failed: number; discarded: number }> => {
    if (typeof window === "undefined") return { success: 0, failed: 0, discarded: 0 };

    const actions = await offlineDb.getOfflineActions();
    if (actions.length === 0) return { success: 0, failed: 0, discarded: 0 };

    await offlineDb.clearOfflineActions();
    console.warn(`[Offline Sync] Discarded ${actions.length} legacy generic action(s); automatic mutation replay is disabled.`);

    window.dispatchEvent(new Event("hh-offline-actions-updated"));
    return { success: 0, failed: 0, discarded: actions.length };
  }
};
