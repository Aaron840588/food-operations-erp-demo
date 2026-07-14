"use client";

import React, { useEffect, useState } from "react";
import { api, clearFinancialCaches, type IngredientBatchOut, type InventoryTransactionOut, type MrpProjectionOut, type ProductSKUOut, type RawIngredientOut, type SupplierOut, type WarehouseOut, type WarehouseStockOut } from "@/lib/api";
import { Package, RefreshCw, AlertTriangle, CalendarClock, TrendingDown, Warehouse, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ProductSizeBadge } from "@/components/ui/ProductSizeBadge";

// Sub-components
import StockList from "@/components/inventory/StockList";
import BatchManager from "@/components/inventory/BatchManager";
import WarehouseManager from "@/components/inventory/WarehouseManager";
import MrpForecast from "@/components/inventory/MrpForecast";
import AuditLedger from "@/components/inventory/AuditLedger";

export default function InventoryPage() {
  const [activeTab, setActiveTab] = useState<"stocks" | "batches" | "mrp" | "warehouses" | "audit">("stocks");
  const [products, setProducts] = useState<ProductSKUOut[]>([]);
  const [ingredients, setIngredients] = useState<RawIngredientOut[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOut[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransactionOut[]>([]);
  const [batches, setBatches] = useState<IngredientBatchOut[]>([]);
  const [mrpProjections, setMrpProjections] = useState<MrpProjectionOut[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOut[]>([]);
  const [warehouseStocks, setWarehouseStocks] = useState<WarehouseStockOut[]>([]);
  
  // Pagination states
  const [auditSkip, setAuditSkip] = useState(0);
  const [hasMoreAudit, setHasMoreAudit] = useState(true);
  const [loadingMoreAudit, setLoadingMoreAudit] = useState(false);
  
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [loadedTabs, setLoadedTabs] = useState<Record<string, boolean>>({});
  const [userRole, setUserRole] = useState<"owner" | "staff" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Edit states
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editingIngredient, setEditingIngredient] = useState<any | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const fetchTab = async (tabName: typeof activeTab, force = false) => {
    if (loadedTabs[tabName] && !force) {
      setLoading(false);
      return;
    }
    
    if (force) {
      setTabLoading(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      if (tabName === "stocks") {
        if (!force) {
          try {
            const cachedProds = localStorage.getItem("hh_cache_market_products");
            const cachedIngredients = localStorage.getItem("hh_cache_raw_ingredients");
            const cachedSuppliers = localStorage.getItem("hh_cache_suppliers");
            if (cachedProds && cachedIngredients && cachedSuppliers) {
              setProducts(JSON.parse(cachedProds));
              setIngredients(JSON.parse(cachedIngredients));
              setSuppliers(JSON.parse(cachedSuppliers));
              setLoading(false); // Render instantly!
              setLoadedTabs(prev => ({ ...prev, stocks: true }));
              
              // Run background refresh
              Promise.all([
                api.getProducts().catch(() => []),
                api.getRawIngredients().catch(() => []),
                api.getSuppliers().catch(() => [])
              ]).then(([prodRes, rawRes, supRes]) => {
                setProducts(prodRes);
                setIngredients(rawRes);
                setSuppliers(supRes);
                localStorage.setItem("hh_cache_market_products", JSON.stringify(prodRes));
                localStorage.setItem("hh_cache_raw_ingredients", JSON.stringify(rawRes));
                localStorage.setItem("hh_cache_suppliers", JSON.stringify(supRes));
              }).catch(console.error);
              return;
            }
          } catch (e) {
            console.error("Error reading stocks cache:", e);
          }
        }

        const [prodRes, rawRes, supRes] = await Promise.all([
          api.getProducts().catch(() => []),
          api.getRawIngredients().catch(() => []),
          api.getSuppliers().catch(() => [])
        ]);
        setProducts(prodRes);
        setIngredients(rawRes);
        setSuppliers(supRes);

        // Cache locally for instant load next time
        localStorage.setItem("hh_cache_market_products", JSON.stringify(prodRes));
        localStorage.setItem("hh_cache_raw_ingredients", JSON.stringify(rawRes));
        localStorage.setItem("hh_cache_suppliers", JSON.stringify(supRes));
      } else if (tabName === "batches") {
        const [rawRes, batchRes] = await Promise.all([
          api.getRawIngredients().catch(() => []),
          api.getRawIngredientBatches().catch(() => [])
        ]);
        setIngredients(rawRes);
        setBatches(batchRes);
      } else if (tabName === "mrp") {
        const [rawRes, mrpRes] = await Promise.all([
          api.getRawIngredients().catch(() => []),
          api.getMrpProjections().catch(() => [])
        ]);
        setIngredients(rawRes);
        setMrpProjections(mrpRes);
      } else if (tabName === "warehouses") {
        const [whRes, whStockRes, prodRes, rawRes] = await Promise.all([
          api.getWarehouses().catch(() => []),
          api.getWarehouseStocks().catch(() => []),
          api.getProducts().catch(() => []),
          api.getRawIngredients().catch(() => [])
        ]);
        setWarehouses(whRes);
        setWarehouseStocks(whStockRes);
        setProducts(prodRes);
        setIngredients(rawRes);
      } else if (tabName === "audit") {
        const txRes = await api.getInventoryTransactions(50, 0).catch(() => []);
        setTransactions(txRes);
        setAuditSkip(50);
        setHasMoreAudit(txRes.length === 50);
      }
      
      setLoadedTabs(prev => ({ ...prev, [tabName]: true }));
    } catch (err: unknown) {
      console.error(err);
      setError("Unable to connect to database. Please check your internet connection.");
    } finally {
      setLoading(false);
      setTabLoading(false);
    }
  };

  const loadMoreTransactions = async () => {
    if (loadingMoreAudit || !hasMoreAudit) return;
    setLoadingMoreAudit(true);
    try {
      const nextTxs = await api.getInventoryTransactions(50, auditSkip).catch(() => []);
      if (nextTxs.length < 50) {
        setHasMoreAudit(false);
      }
      setTransactions(prev => [...prev, ...nextTxs]);
      setAuditSkip(prev => prev + 50);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMoreAudit(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void api.getCurrentUser().then((session) => {
      if (cancelled) return;
      const role = session.role === "owner" ? "owner" : "staff";
      if (role !== "owner") clearFinancialCaches();
      setUserRole(role);
    }).catch(() => {
      if (cancelled) return;
      clearFinancialCaches();
      setUserRole("staff");
      setError("Unable to verify inventory permissions. Please sign in again.");
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!userRole) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTab(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, userRole]);

  const handleRefresh = () => {
    fetchTab(activeTab, true);
  };

  const handleSaveProductEdit = async () => {
    if (!editingProduct) return;
    setSavingEdit(true);
    try {
      await api.updateProduct(editingProduct.sku, {
        product_name: editingProduct.product_name,
        retail_price: parseFloat(editingProduct.retail_price) || 0,
        reseller_price: parseFloat(editingProduct.reseller_price) || 0,
        pack_qty: parseInt(editingProduct.pack_qty) || 1,
        storage_life: editingProduct.storage_life,
        serving_requirement: editingProduct.serving_requirement,
        cost_override: editingProduct.cost_override !== "" && editingProduct.cost_override !== null ? parseFloat(editingProduct.cost_override) : null,
        density_multiplier: parseFloat(editingProduct.density_multiplier) || 1.0,
        labor_cost: parseFloat(editingProduct.labor_cost) !== undefined ? parseFloat(editingProduct.labor_cost) : 0.0,
        utility_cost: parseFloat(editingProduct.utility_cost) !== undefined ? parseFloat(editingProduct.utility_cost) : 3.28,
        is_active: editingProduct.is_active
      });
      setEditingProduct(null);
      await fetchTab(activeTab, true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      alert(`Error saving SKU settings: ${err.message}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSaveIngredientEdit = async () => {
    if (!editingIngredient) return;
    setSavingEdit(true);
    try {
      await api.updateRawIngredient(editingIngredient.id, {
        name: editingIngredient.name,
        category: editingIngredient.category,
        unit: editingIngredient.unit,
        price: parseFloat(editingIngredient.price) || 0,
        net_weight: parseFloat(editingIngredient.net_weight) || 0,
        brand: editingIngredient.brand,
        shop: editingIngredient.shop,
        reorder_level: parseFloat(editingIngredient.reorder_level) || 0,
        supplier_id: editingIngredient.supplier_id ? parseInt(editingIngredient.supplier_id) : null
      });
      await api.recalculateAllCosts();
      setEditingIngredient(null);
      await fetchTab(activeTab, true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      alert(`Error saving ingredient configurations: ${err.message}`);
    } finally {
      setSavingEdit(false);
    }
  };

  if (loading && !loadedTabs[activeTab]) {
    return (
      <div className="min-h-[70vh] w-full flex flex-col items-center justify-center text-slate-500 gap-4">
        <RefreshCw className="animate-spin text-primary" size={48} />
        <span className="text-sm font-heading font-extrabold uppercase tracking-wider">Loading Warehouse Ledger...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-white border border-slate-200 rounded-3xl max-w-xl mx-auto my-16 shadow-lg">
        <AlertTriangle className="text-amber-500 mb-6" size={64} />
        <h3 className="font-heading font-black text-slate-800 text-xl uppercase tracking-wide">Inventory Error</h3>
        <p className="text-sm text-slate-500 mt-3 mb-8 leading-relaxed max-w-md">{error}</p>
        <Button onClick={handleRefresh} variant="primary" size="lg" leftIcon={<RefreshCw size={18} />}>
          Retry Connection
        </Button>
      </div>
    );
  }

  const tabs = [
    { id: "stocks", label: "Stock", icon: Package },
    { id: "batches", label: "FIFO Batches", icon: CalendarClock },
    { id: "mrp", label: "Depletion Forecast", icon: TrendingDown },
    { id: "warehouses", label: "Warehouses", icon: Warehouse },
    { id: "audit", label: "Audit Log", icon: ScrollText }
  ] as const;

  return (
    <div className="space-y-6 flex flex-col">
      
      {/* Friendly Guide Header */}
      <div className="bg-[#fcf8f2] border border-[#ece5da] rounded-2xl p-5 sm:p-6 flex flex-col md:flex-row md:justify-between md:items-center gap-5">
        <div className="flex items-start sm:items-center gap-4">
          <div className="p-3 bg-primary/10 text-primary rounded-2xl shrink-0">
            <Package size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-heading font-bold text-slate-900 leading-tight">Inventory &amp; stock control</h2>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              Manage finished goods SKUs, raw ingredients, and multi-location warehouses.
            </p>
          </div>
        </div>
        <Button
          onClick={handleRefresh}
          variant="outline"
          size="lg"
          className="w-full md:w-auto bg-white"
          leftIcon={<RefreshCw size={16} />}
        >
          Refresh Stock Levels
        </Button>
      </div>

      {/* Tabs Menu */}
      <div className="scroll-fade-x flex gap-1 whitespace-nowrap bg-white/70 p-1.5 rounded-2xl border border-slate-200" role="tablist" aria-label="Inventory views">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`inline-flex min-h-11 items-center gap-2 px-4 py-2.5 rounded-xl transition-colors cursor-pointer text-sm font-bold ${
              activeTab === tab.id
                ? "bg-[#885625]/10 text-primary font-black"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            }`}
          >
            <tab.icon size={16} /> {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Panels */}
      <div className="flex-1 relative">
        {tabLoading && (
          <div className="absolute inset-0 bg-white/80 z-40 flex flex-col items-center justify-center rounded-2xl min-h-[40vh] gap-3">
            <RefreshCw className="animate-spin text-primary" size={32} />
            <span className="text-sm font-heading font-extrabold tracking-wider uppercase text-slate-500">Refreshing Tab Data...</span>
          </div>
        )}

        {activeTab === "stocks" && (
          <StockList
            products={products}
            ingredients={ingredients}
            isOwner={userRole === "owner"}
            onRefresh={handleRefresh}
            onEditProduct={setEditingProduct}
            onEditIngredient={setEditingIngredient}
          />
        )}

        {activeTab === "batches" && (
          <BatchManager
            batches={batches}
            ingredients={ingredients}
            onRefresh={handleRefresh}
          />
        )}

        {activeTab === "warehouses" && (
          <WarehouseManager
            warehouses={warehouses}
            warehouseStocks={warehouseStocks}
            ingredients={ingredients}
            products={products}
            onRefresh={handleRefresh}
          />
        )}

        {activeTab === "mrp" && (
          <MrpForecast
            mrpProjections={mrpProjections}
            suppliers={suppliers}
            onRefresh={handleRefresh}
          />
        )}

        {activeTab === "audit" && (
          <AuditLedger
            transactions={transactions}
            hasMore={hasMoreAudit}
            loadingMore={loadingMoreAudit}
            onLoadMore={loadMoreTransactions}
          />
        )}
      </div>

      {/* 5. EDIT PRODUCT SKU MODAL */}
      {userRole === "owner" && editingProduct && (
        <Modal
          isOpen={!!editingProduct}
          onClose={() => setEditingProduct(null)}
          title="Edit Product SKU Settings"
          size="md"
        >
          <div className="space-y-5 text-sm font-semibold text-slate-600">
            <div className="grid grid-cols-2 gap-4 border-b border-slate-100 pb-4">
              <div>
                <span className="text-xs text-slate-400 font-bold uppercase block">SKU Code</span>
                <span className="font-mono font-black text-slate-800 text-lg mt-0.5 block">{editingProduct.sku}</span>
              </div>
              <div>
                <span className="text-xs text-slate-400 font-bold uppercase block">Product Size</span>
                <ProductSizeBadge size={editingProduct.size} sku={editingProduct.sku} className="mt-1 text-xs" />
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-450 font-bold uppercase tracking-wider block mb-1.5">Product Name</label>
              <input
                type="text"
                value={editingProduct.product_name}
                onChange={(e) => setEditingProduct({ ...editingProduct, product_name: e.target.value })}
                className="w-full text-base font-bold"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-slate-450 font-bold uppercase tracking-wider block mb-1.5">Retail SRP (₱)</label>
                <input
                  type="number"
                  value={editingProduct.retail_price}
                  onChange={(e) => setEditingProduct({ ...editingProduct, retail_price: e.target.value })}
                  className="w-full font-mono text-base font-bold"
                />
              </div>
              <div>
                <label className="text-xs text-slate-450 font-bold uppercase tracking-wider block mb-1.5">Wholesale (₱)</label>
                <input
                  type="number"
                  value={editingProduct.reseller_price}
                  onChange={(e) => setEditingProduct({ ...editingProduct, reseller_price: e.target.value })}
                  className="w-full font-mono text-base font-bold"
                />
              </div>
              <div>
                <label className="text-xs text-slate-450 font-bold uppercase tracking-wider block mb-1.5">Items/Pack</label>
                <input
                  type="number"
                  value={editingProduct.pack_qty}
                  onChange={(e) => setEditingProduct({ ...editingProduct, pack_qty: e.target.value })}
                  className="w-full font-mono text-base font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-455 font-bold uppercase tracking-wider block mb-1.5">Shelf Life</label>
                <input
                  type="text"
                  value={editingProduct.storage_life || ""}
                  onChange={(e) => setEditingProduct({ ...editingProduct, storage_life: e.target.value })}
                  className="w-full text-base font-bold"
                />
              </div>
              <div>
                <label className="text-xs text-slate-455 font-bold uppercase tracking-wider block mb-1.5">Serving Requirement</label>
                <input
                  type="text"
                  value={editingProduct.serving_requirement || ""}
                  onChange={(e) => setEditingProduct({ ...editingProduct, serving_requirement: e.target.value })}
                  className="w-full text-base font-bold"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-455 font-bold uppercase tracking-wider block mb-1.5">Product Active Status</label>
              <select
                value={editingProduct.is_active === false ? "inactive" : "active"}
                onChange={(e) => setEditingProduct({ ...editingProduct, is_active: e.target.value === "active" })}
                className="w-full text-sm font-bold bg-white h-12 border-2 border-slate-200 rounded-xl"
              >
                <option value="active">Active (Visible in selectors & POS)</option>
                <option value="inactive">Inactive (Archived & hidden from selectors)</option>
              </select>
            </div>

            {/* Collapsible / Progressive disclosure for overrides */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-4">
              <span className="text-xs text-primary font-black uppercase tracking-wider block">Advanced Configuration</span>
              
              <div>
                <label className="text-xs text-slate-455 font-bold uppercase tracking-wider block mb-1.5">Manual Cost Override (₱)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="Computed from recipes cost"
                  value={editingProduct.cost_override !== null && editingProduct.cost_override !== undefined ? editingProduct.cost_override : ""}
                  onChange={(e) => setEditingProduct({ ...editingProduct, cost_override: e.target.value === "" ? null : parseFloat(e.target.value) })}
                  className="w-full bg-white text-sm font-mono font-bold"
                />
              </div>

              <div>
                <label className="text-xs text-slate-455 font-bold uppercase tracking-wider block mb-1.5">Density conversion multiplier</label>
                <input
                  type="number"
                  step="0.0001"
                  value={editingProduct.density_multiplier !== null && editingProduct.density_multiplier !== undefined ? editingProduct.density_multiplier : "1.0000"}
                  onChange={(e) => setEditingProduct({ ...editingProduct, density_multiplier: e.target.value })}
                  className="w-full bg-white text-sm font-mono font-bold"
                />
              </div>

              <div>
                <label className="text-xs text-slate-455 font-bold uppercase tracking-wider block mb-1.5">Labor Cost Allocation (₱)</label>
                <input
                  type="number"
                  step="0.01"
                  value={editingProduct.labor_cost !== null && editingProduct.labor_cost !== undefined ? editingProduct.labor_cost : ""}
                  onChange={(e) => setEditingProduct({ ...editingProduct, labor_cost: e.target.value })}
                  className="w-full bg-white text-sm font-mono font-bold"
                />
              </div>

              <div>
                <label className="text-xs text-slate-455 font-bold uppercase tracking-wider block mb-1.5">Utility Cost Allocation (₱)</label>
                <input
                  type="number"
                  step="0.01"
                  value={editingProduct.utility_cost !== null && editingProduct.utility_cost !== undefined ? editingProduct.utility_cost : ""}
                  onChange={(e) => setEditingProduct({ ...editingProduct, utility_cost: e.target.value })}
                  className="w-full bg-white text-sm font-mono font-bold"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 pt-5 mt-8">
              <Button variant="outline" size="lg" className="h-12 text-sm" onClick={() => setEditingProduct(null)}>
                Close
              </Button>
              <Button variant="primary" size="lg" className="h-12 text-sm" onClick={handleSaveProductEdit} isLoading={savingEdit}>
                Save Changes
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* 6. EDIT INGREDIENT MODAL */}
      {userRole === "owner" && editingIngredient && (
        <Modal
          isOpen={!!editingIngredient}
          onClose={() => setEditingIngredient(null)}
          title="Edit Material Cost &amp; Vendor"
          size="md"
        >
          <div className="space-y-5 text-sm font-semibold text-slate-600">
            <div>
              <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Ingredient Name</label>
              <input
                type="text"
                value={editingIngredient.name}
                onChange={(e) => setEditingIngredient({ ...editingIngredient, name: e.target.value })}
                className="w-full font-heading font-bold text-base text-slate-800"
              />
            </div>

            <div>
              <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Shopping/Storage Category</label>
              <select
                value={editingIngredient.category || "Other / uncategorized"}
                onChange={(e) => setEditingIngredient({ ...editingIngredient, category: e.target.value })}
                className="w-full text-sm font-bold bg-white h-12 border-2 border-slate-200 rounded-xl px-3"
              >
                <option value="Liquids and water">Liquids and water</option>
                <option value="Dairy">Dairy</option>
                <option value="Oils and fats">Oils and fats</option>
                <option value="Sweeteners">Sweeteners</option>
                <option value="Powders and dry ingredients">Powders and dry ingredients</option>
                <option value="Fruits and vegetables">Fruits and vegetables</option>
                <option value="Seasonings and flavorings">Seasonings and flavorings</option>
                <option value="Toppings and inclusions">Toppings and inclusions</option>
                <option value="Packaging materials">Packaging materials</option>
                <option value="Other / uncategorized">Other / uncategorized</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Brand Name</label>
                <input
                  type="text"
                  value={editingIngredient.brand || ""}
                  onChange={(e) => setEditingIngredient({ ...editingIngredient, brand: e.target.value })}
                  className="w-full text-base font-bold text-slate-800"
                />
              </div>
              <div>
                <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Purchase Shop</label>
                <input
                  type="text"
                  value={editingIngredient.shop || ""}
                  onChange={(e) => setEditingIngredient({ ...editingIngredient, shop: e.target.value })}
                  className="w-full text-base font-bold text-slate-800"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Package Price (₱)</label>
                <input
                  type="number"
                  value={editingIngredient.price}
                  onChange={(e) => setEditingIngredient({ ...editingIngredient, price: e.target.value })}
                  className="w-full font-mono text-base font-bold text-slate-800"
                />
              </div>
              <div>
                <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Net Content</label>
                <input
                  type="number"
                  value={editingIngredient.net_weight}
                  onChange={(e) => setEditingIngredient({ ...editingIngredient, net_weight: e.target.value })}
                  className="w-full font-mono text-base font-bold text-slate-800"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Unit (g/pcs)</label>
                <input
                  type="text"
                  value={editingIngredient.unit}
                  onChange={(e) => setEditingIngredient({ ...editingIngredient, unit: e.target.value })}
                  className="w-full font-mono text-base font-bold text-slate-800"
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Safety Stock Limit</label>
                <input
                  type="number"
                  value={editingIngredient.reorder_level}
                  onChange={(e) => setEditingIngredient({ ...editingIngredient, reorder_level: e.target.value })}
                  className="w-full font-mono text-base font-bold text-slate-800"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Assigned Supplier</label>
              <select
                value={editingIngredient.supplier_id || ""}
                onChange={(e) => setEditingIngredient({ ...editingIngredient, supplier_id: e.target.value === "" ? null : parseInt(e.target.value) })}
                className="w-full text-sm font-bold bg-white h-12 border-2 border-slate-200 rounded-xl"
              >
                <option value="">No Supplier Assigned</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.contact_person || "No Contact"})</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 pt-5 mt-8">
              <Button variant="outline" size="lg" className="h-12 text-sm" onClick={() => setEditingIngredient(null)}>
                Close
              </Button>
              <Button variant="primary" size="lg" className="h-12 text-sm font-bold" onClick={handleSaveIngredientEdit} isLoading={savingEdit}>
                Save &amp; Recalculate
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
