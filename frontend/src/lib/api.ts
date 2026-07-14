/* eslint-disable @typescript-eslint/no-explicit-any */
import { offlineDb } from "./indexedDb";
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
  product_name?: string;
  size?: string;
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
  ingredients: RecipeItemOut[];
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
  discount_rate: number;
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
  actual_closing_cash?: number | null;
  cash_adjustments?: number;
  cash_adjustments_notes?: string | null;
  total_expenses?: number;
  expense_notes?: string | null;
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
  cost_per_unit?: number | null;
}

export interface MarketEventCreate extends MarketEventBase {
  allocations: MarketEventAllocationCreate[];
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
}

export interface MarketEventSaleItemBase {
  sku: string;
  quantity?: number;
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
  total_amount: number;
  timestamp: string;
  items: MarketEventSaleItemOut[];
  is_preorder?: boolean;
  preorder_customer_name?: string | null;
  preorder_payment_status?: string | null;
  preorder_fulfillment_status?: string | null;
}

export interface CleaningTaskOut {
  id: number;
  task_name: string;
  frequency: string;
  last_done_date?: string | null;
  done_by_username?: string | null;
  remarks?: string | null;
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
  cost_status: "ok" | "missing_recipe" | "invalid_cost";
  cost_status_message: string | null;
  labor_cost: number;
  utility_cost: number;
  total_cost: number;
  net_profit: number;
  gross_margin_pct: number;
  net_margin_pct: number;
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

// Helper to extract description for offline queueing
function getActionDescription(path: string, method: string): string {
  if (path.includes("/tasks/cleaning/") && path.includes("/complete")) {
    return "Sanitation task completed";
  }
  if (path.includes("/tasks/maintenance/")) {
    return "Maintenance asset updated";
  }
  if (path.includes("/products/")) {
    const sku = path.split("/").pop()?.split("?")[0] || "";
    return `Stock adjusted for SKU: ${sku}`;
  }
  if (path.includes("/raw-ingredients/")) {
    const id = path.split("/").pop()?.split("?")[0] || "";
    return `Stock adjusted for Ingredient ID: ${id}`;
  }
  return `${method} request to ${path.split("?")[0]}`;
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

export class UnconfirmedFinancialMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnconfirmedFinancialMutationError";
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

async function fetchJson(path: string, options?: RequestInit): Promise<any> {
  const url = `${API_BASE_URL}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
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
    const method = options?.method || "GET";
    if (isNonQueueableFinancialMutation(path, method)) {
      throw createUnconfirmedFinancialMutationError(path, method);
    }
    // If it's a write mutation and we are on the client side, queue it to IndexedDB!
    if (method !== "GET" && typeof window !== "undefined") {
      console.warn(`[API] Network error. Queuing ${method} ${path} offline...`);
      const body = options?.body ? JSON.parse(options.body as string) : null;
      const description = getActionDescription(path, method);
      
      try {
        await offlineDb.saveOfflineAction({
          url: path,
          method,
          body,
          description
        });
        
        // Dispatch custom event to notify UI to update offline change indicators
        window.dispatchEvent(new Event("hh-offline-actions-updated"));
        
        // Return a mock successful response matching what the frontend expects
        if (body) {
          return { ...body, id: Date.now(), message: "Queued offline" };
        }
        return { message: "Queued offline", id: Date.now() };
      } catch (dbErr) {
        console.error("Failed to queue action in IndexedDB:", dbErr);
      }
    }
    throw fetchErr;
  }

  if (!response.ok) {
    const method = options?.method || "GET";
    if (
      response.status >= 500
      && isNonQueueableFinancialMutation(path, method)
    ) {
      throw createUnconfirmedFinancialMutationError(path, method);
    }

    // If unauthorized (401), handle auto-refresh tokens
    if (response.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
      if (!navigator.onLine) {
        console.warn("[API] 401 Unauthorized while offline. Keeping optimistic session active.");
        return {};
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
                if (isNonQueueableFinancialMutation(path, options?.method || "GET")) {
                  throw createUnconfirmedFinancialMutationError(path, options?.method || "GET");
                }
                throw error;
              }
              if (
                retryResponse.status >= 500
                && isNonQueueableFinancialMutation(path, options?.method || "GET")
              ) {
                throw createUnconfirmedFinancialMutationError(path, options?.method || "GET");
              }
              if (!retryResponse.ok) throw new Error("Retry failed");
              resolve(await retryResponse.json());
            } catch (error) {
              reject(error);
            }
          });
        });
      }

      isRefreshing = true;
      try {
        console.log("[API] Access token expired. Attempting session refresh...");
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
            if (isNonQueueableFinancialMutation(path, options?.method || "GET")) {
              throw createUnconfirmedFinancialMutationError(path, options?.method || "GET");
            }
            throw error;
          }
          if (
            retryRes.status >= 500
            && isNonQueueableFinancialMutation(path, options?.method || "GET")
          ) {
            throw createUnconfirmedFinancialMutationError(path, options?.method || "GET");
          }
          if (!retryRes.ok) throw new Error("Retry failed");
          return retryRes.json();
        } else {
          throw new Error("Refresh failed");
        }
      } catch (refreshErr) {
        isRefreshing = false;
        if (refreshErr instanceof UnconfirmedFinancialMutationError) {
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
    
    let errorDetail = "API Request failed";
    try {
      const errJson = await response.json();
      errorDetail = errJson.detail || errorDetail;
    } catch {
      // ignore
    }
    throw new Error(errorDetail);
  }

  return response.json();
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

  getHealth: (): Promise<{
    status: string;
    database: string;
    environment: string;
    demo_mode?: boolean;
    demo_owner_username?: string;
    demo_owner_password?: string;
    demo_staff_username?: string;
    demo_staff_password?: string;
  }> =>
    fetchJson("/health"),

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
  getDashboardSummary: (): Promise<any> => fetchJson("/dashboard/summary"),

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
  getSkuCostDetails: (sku: string): Promise<any> => fetchJson(`/costing/sku/${sku}`),
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
  getPlans: (): Promise<ProductionPlanOut[]> => fetchJson("/production/plans"),
  getPlan: (id: number): Promise<ProductionPlanOut> => fetchJson(`/production/plans/${id}`),
  createPlan: (data: ProductionPlanCreate): Promise<ProductionPlanOut> => 
    fetchJson("/production/plans", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  completePlan: (id: number): Promise<ProductionPlanOut> => fetchJson(`/production/plans/${id}/complete`, { method: "POST" }),
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
  createUser: (data: any): Promise<any> => fetchJson("/users", {
    method: "POST",
    body: JSON.stringify(data),
  }),
  resetTestData: (): Promise<{ message: string }> => fetchJson("/admin/reset-test-data", {
    method: "POST",
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
  
  // ----------------------------------------------------
  // OFFLINE ACTIONS SYNC
  // ----------------------------------------------------
  getOfflineActionsCount: (): Promise<number> => offlineDb.getOfflineActions().then(a => a.length),
  syncOfflineChanges: async (): Promise<{ success: number; failed: number }> => {
    if (typeof window === "undefined") return { success: 0, failed: 0 };
    
    const actions = await offlineDb.getOfflineActions();
    if (actions.length === 0) return { success: 0, failed: 0 };

    console.log(`[Offline Sync] Found ${actions.length} pending offline changes. Syncing...`);
    
    let successCount = 0;
    let failedCount = 0;

    for (const action of actions) {
      if (isNonQueueableFinancialMutation(action.url, action.method)) {
        console.error(
          `[Offline Sync] Financial action #${action.id} requires manual review and was not replayed.`
        );
        failedCount++;
        continue;
      }
      try {
        const url = `${API_BASE_URL}${action.url}`;
        const token = activeAccessToken;

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const res = await fetch(url, {
          method: action.method,
          credentials: "include",
          headers,
          body: action.body ? JSON.stringify(action.body) : undefined
        });

        if (res.ok) {
          await offlineDb.deleteOfflineAction(action.id!);
          successCount++;
        } else {
          console.error(`[Offline Sync] Failed to replay action #${action.id}:`, await res.text());
          failedCount++;
        }
      } catch (err) {
        console.error(`[Offline Sync] Connection error replaying action #${action.id}:`, err);
        failedCount++;
        break;
      }
    }

    window.dispatchEvent(new Event("hh-offline-actions-updated"));
    return { success: successCount, failed: failedCount };
  }
};
