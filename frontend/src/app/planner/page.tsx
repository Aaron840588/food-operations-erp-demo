"use client";

import React, { useEffect, useState } from "react";
import { api, type ProductSKUOut, type ProductionForecastOut } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import {
  BUSINESS_CATEGORIES,
  UNCATEGORIZED_BUSINESS_CATEGORY,
  formatProductQuantity,
  getProductBusinessCategory,
  getProductSizeGroup,
  isCurrentLineupProduct,
} from "@/lib/utils";
import { ProductSizeBadge } from "@/components/ui/ProductSizeBadge";
import { ProductDisplay } from "@/components/ui/ProductDisplay";
import { 
  CalendarRange, 
  Calculator, 
  Printer, 
  CheckSquare, 
  ShoppingCart,
  ChefHat,
  AlertTriangle,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Search
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ConfirmationModal } from "@/components/ui/Modal";
import {
  DataTableScroll,
  DataTableShell,
  TableCell,
  TableEmptyState,
  TableHeaderCell,
  TableHeaderRow,
  TableLoadingState,
  TableRow,
} from "@/components/ui/DataTable";
import { NumericQuantityInput } from "@/components/ui/NumericQuantityInput";

type MaterialChecklistGroups = Record<string, ProductionForecastOut["material_checklist"]>;

export default function PlannerPage() {
  const [products, setProducts] = useState<ProductSKUOut[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [quantities, setQuantities] = useState<{ [sku: string]: number }>({});
  const [planDate, setPlanDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedOutlet, setSelectedOutlet] = useState("General Stock");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  const [forecast, setForecast] = useState<ProductionForecastOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  
  // Shopping list category grouping, collapsed state, and search state
  const [checklistSearch, setChecklistSearch] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<{ [category: string]: boolean }>({});

  // Automatic suggestions state
  const [recommendations, setRecommendations] = useState<Array<{ sku: string; name: string; category: string; size: string; currentStock: number; suggestedQty: number }>>([]);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);

  useEffect(() => {
    api.getProducts().then(res => {
      const filtered = (res || []).filter((p) => p.sku !== "SKU" && p.is_active !== false && isCurrentLineupProduct(p));
      setProducts(filtered);

      // Generate smart cooking recommendations based on warehouse stock levels (if stock is below 15 jars)
      const lowStockProducts = filtered.filter((p) => (p.warehouse_stock ?? 0) < 15);
      const suggestions = lowStockProducts.map((p) => ({
        sku: p.sku,
        name: p.product_name,
        category: p.category,
        size: p.size,
        currentStock: p.warehouse_stock ?? 0,
        suggestedQty: 24 // Suggest standard double batch (2 boxes of 12)
      }));
      setRecommendations(suggestions);
    }).catch(console.error).finally(() => setProductsLoading(false));
  }, []);

  const handleQtyChange = (sku: string, val: number) => {
    setQuantities(prev => ({
      ...prev,
      [sku]: Math.max(0, val)
    }));
  };

  const getActiveTargets = () => {
    return Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([sku, qty]) => ({
        sku,
        quantity: qty,
        outlet: selectedOutlet
      }));
  };

  const CATEGORY_ORDER = [
    "Liquids and water",
    "Dairy",
    "Oils and fats",
    "Sweeteners",
    "Powders and dry ingredients",
    "Fruits and vegetables",
    "Seasonings and flavorings",
    "Toppings and inclusions",
    "Packaging materials",
    "Other / uncategorized"
  ];

  const getSortedCategoryKeys = (groups: MaterialChecklistGroups) => {
    return Object.keys(groups).sort((a, b) => {
      const idxA = CATEGORY_ORDER.indexOf(a);
      const idxB = CATEGORY_ORDER.indexOf(b);
      const valA = idxA === -1 ? 999 : idxA;
      const valB = idxB === -1 ? 999 : idxB;
      
      if (valA !== valB) return valA - valB;
      return a.localeCompare(b);
    });
  };

  const getGroupedChecklist = () => {
    if (!forecast || !forecast.material_checklist) return {};
    
    const searchLower = checklistSearch.toLowerCase().trim();
    const filtered = forecast.material_checklist.filter(item => 
      item.ingredient_name.toLowerCase().includes(searchLower) ||
      (item.category && item.category.toLowerCase().includes(searchLower))
    );

    const groups: MaterialChecklistGroups = {};
    
    filtered.forEach(item => {
      const cat = item.category || "Other / uncategorized";
      if (!groups[cat]) {
        groups[cat] = [];
      }
      groups[cat].push(item);
    });

    return groups;
  };

  const toggleCategoryCollapsed = (category: string) => {
    setCollapsedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  const handleForecast = async () => {
    const targets = getActiveTargets();
    if (targets.length === 0) {
      alert("Please enter target quantities for at least one product before computing.");
      return;
    }
    setLoading(true);
    setForecast(null);
    try {
      const res = await api.runForecast(targets);
      setForecast(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePlan = async () => {
    const targets = getActiveTargets();
    if (targets.length === 0) return;

    setSaving(true);
    setMessage(null);
    try {
      const targetPayload = targets.map(t => ({
        sku: t.sku,
        outlet: t.outlet,
        target_qty: t.quantity
      }));
      const plan = await api.createPlan({
        plan_date: planDate,
        targets: targetPayload
      });
      
      await api.completePlan(plan.id);
      
      setMessage({
        type: "success",
        text: `Successfully completed Production Plan for ${planDate}! Raw ingredients deducted and finished warehouse stock added.`
      });
      setQuantities({});
      setForecast(null);
      setIsConfirmOpen(false);
    } catch (err: unknown) {
      setMessage({
        type: "error",
        text: `Error saving production plan: ${getErrorMessage(err, "Operation failed")}`
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // One-click recommendation apply helper
  const handleApplyAllRecommendations = () => {
    if (recommendations.length === 0) return;
    
    const prefilled: { [sku: string]: number } = {};
    recommendations.forEach(r => {
      prefilled[r.sku] = r.suggestedQty;
    });
    setQuantities(prefilled);
    
    // Auto trigger forecasting helper message
    alert("Smart suggestions applied! Click 'Compute Buying List & Recipes' below to scale ingredients.");
  };

  // Group products by business category
  const categories: Record<string, ProductSKUOut[]> = {};
  BUSINESS_CATEGORIES.forEach(c => {
    categories[c] = [];
  });
  categories[UNCATEGORIZED_BUSINESS_CATEGORY] = [];
  products.forEach(p => {
    const cat = getProductBusinessCategory(p);
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(p);
  });
  const visibleCategoryEntries = Object.entries(categories)
    .filter(([categoryName]) => selectedCategory === "All" || categoryName === selectedCategory);
  const visibleProductCount = visibleCategoryEntries.reduce((total, [, items]) => total + items.length, 0);

  return (
    <div className="space-y-5 2xl:space-y-6 flex flex-col pb-16 print:p-0 print:space-y-0">
      
      {/* Friendly Planning Header */}
      <div className="bg-[#fcf8f2] border border-[#ece5da] rounded-2xl p-4 sm:p-5 2xl:p-6 flex items-start sm:items-center gap-4 print:hidden">
        <div className="flex items-start sm:items-center gap-4">
          <div className="p-3 bg-primary/10 text-primary rounded-2xl shrink-0">
            <CalendarRange size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-heading font-bold text-slate-900 leading-tight">Production planner</h2>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              Plan daily kitchen batches and automatically compute ingredient shopping requirements and scaled recipe sheets.
            </p>
          </div>
        </div>
      </div>

      {/* Smart Production Assistant Recommendations Card */}
      {recommendations.length > 0 && (
        <Card variant="glass" className="border-l-8 border-l-primary bg-primary-light/5 shadow-xs rounded-3xl print:hidden overflow-hidden">
          <CardHeader className="p-5 sm:p-6 2xl:p-8 border-b border-orange-100">
            <div className="flex items-center gap-3">
              <Sparkles className="text-primary shrink-0 animate-pulse" size={24} />
              <div>
                <CardTitle className="text-base md:text-lg font-heading font-black text-slate-850">
                  Smart Kitchen Suggestions
                </CardTitle>
                <CardDescription className="text-xs text-slate-550 mt-1">
                  The system detected items running low in warehouse stock (under 15 jars). We recommend scheduling these batches today:
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-5 sm:p-6 2xl:p-8 space-y-4">
            <div className="flex flex-wrap gap-2.5">
              {(showAllSuggestions ? recommendations : recommendations.slice(0, 4)).map(r => (
                <div key={r.sku} className="px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-650 flex items-center gap-2.5 shadow-3xs hover:border-slate-350 transition-all">
                  <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0"></span>
                  <span className="flex items-center gap-1.5 truncate"><span className="truncate">{r.name}</span> <ProductSizeBadge size={r.size} sku={r.sku} /></span>
                  <span className="text-slate-400 font-mono font-normal whitespace-nowrap">Stock: {r.currentStock}</span>
                  <Badge variant="warning" className="font-black text-[10px] py-0.5 px-1.5 rounded bg-amber-50 text-amber-700">+{r.suggestedQty}</Badge>
                </div>
              ))}
            </div>
            
            <div className="flex items-center gap-3 pt-2.5 border-t border-slate-100/50 flex-wrap">
              <Button
                type="button"
                size="sm"
                variant="primary"
                className="font-black text-xs h-9 px-4 bg-emerald-600 hover:bg-emerald-700 border-emerald-500"
                onClick={handleApplyAllRecommendations}
              >
                Apply All Suggestions (One-Click Prefill)
              </Button>
              
              {recommendations.length > 4 && (
                <button
                  type="button"
                  onClick={() => setShowAllSuggestions(!showAllSuggestions)}
                  className="text-xs font-black text-[#885625] hover:underline cursor-pointer flex items-center gap-1 uppercase tracking-wider"
                >
                  {showAllSuggestions ? "Collapse list" : `Show All Suggestions (+${recommendations.length - 4})`}
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 1. PLAN CHECKLIST SHEET */}
      <Card className="rounded-3xl border-slate-200 shadow-sm overflow-hidden print:hidden">
        <CardHeader className="p-5 sm:p-6 2xl:p-8 bg-slate-50/50 border-b border-slate-150 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
          <div>
            <CardTitle className="text-lg md:text-xl font-heading font-black text-slate-800">Schedule Production Targets</CardTitle>
            <CardDescription className="text-sm mt-1 text-slate-500">Set scheduled production quantities for each product SKU:</CardDescription>
          </div>
          
          <div className="flex flex-wrap items-center gap-4 text-xs md:text-sm font-bold font-heading text-slate-600">
            <div className="flex items-center gap-2">
              <span>Plan Date:</span>
              <input
                type="date"
                value={planDate}
                onChange={(e) => setPlanDate(e.target.value)}
                className="px-4 py-2 border-2 border-slate-200 rounded-xl font-bold font-mono text-slate-800 bg-white"
              />
            </div>
            <div className="flex items-center gap-2">
              <span>Target Storage Destination:</span>
              <select
                value={selectedOutlet}
                onChange={(e) => setSelectedOutlet(e.target.value)}
                className="px-4 py-2 border-2 border-slate-200 rounded-xl font-bold text-slate-800 bg-white h-11"
              >
                <option value="General Stock">Main Facility (General)</option>
                <option value="AA Mart">AA Mart Outflow</option>
                <option value="Kitchen Angels">Kitchen Angels Outflow</option>
                <option value="Likhang Laguna">Likhang Laguna Outflow</option>
                <option value="OTOP">OTOP Outflow</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5 sm:p-6 2xl:p-8">
          {/* Category Tabs Selector (Unifying UI/Design language!) */}
          <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
            {["All", ...BUSINESS_CATEGORIES, UNCATEGORIZED_BUSINESS_CATEGORY].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                aria-pressed={selectedCategory === cat}
                className={`min-h-10 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all border-2 cursor-pointer ${
                  selectedCategory === cat
                    ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                    : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <DataTableShell className="rounded-3xl">
            <DataTableScroll label="Production target products" className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left text-sm text-slate-700">
                  <thead>
                    <TableHeaderRow>
                      <TableHeaderCell className="border-r border-slate-200">Product Name &amp; SKU</TableHeaderCell>
                      <TableHeaderCell align="right" className="border-r border-slate-200">In Warehouse</TableHeaderCell>
                      <TableHeaderCell align="center">Schedule Target</TableHeaderCell>
                    </TableHeaderRow>
                  </thead>
                  <tbody className="font-semibold text-slate-700">
                    {productsLoading ? (
                      <TableLoadingState colSpan={3} title="Loading production products…" />
                    ) : visibleProductCount === 0 ? (
                      <TableEmptyState
                        colSpan={3}
                        title="No products in this category"
                        description="Choose another category or review the active product lineup."
                      />
                    ) : null}
                    {!productsLoading && visibleCategoryEntries.map(([catName, catProds]) => {
                        if (catProds.length === 0) return null;
                        
                        const sizeGroups = new Map<string, { label: string; order: number; items: ProductSKUOut[] }>();
                        catProds.forEach((product) => {
                          const group = getProductSizeGroup(product);
                          const existing = sizeGroups.get(group.key);
                          if (existing) {
                            existing.items.push(product);
                          } else {
                            sizeGroups.set(group.key, { label: group.label, order: group.order, items: [product] });
                          }
                        });

                        return (
                          <React.Fragment key={catName}>
                            {/* Category Row */}
                            <tr className="select-none border-t-2 border-slate-200 bg-[#885625]/5">
                              <th scope="rowgroup" colSpan={3} className="px-4 py-3 text-left sm:px-5">
                                <span className="flex items-center gap-1.5 font-heading text-sm font-black uppercase tracking-wider text-[#885625]">
                                  {catName}
                                </span>
                              </th>
                            </tr>

                            {[...sizeGroups.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)).map((sizeGroup) => {
                              return (
                                <React.Fragment key={sizeGroup.label}>
                                  {/* Size Row */}
                                  <tr className="select-none border-y border-slate-100 bg-slate-50/70">
                                    <th scope="rowgroup" colSpan={3} className="px-4 py-2.5 text-left text-xs font-black uppercase tracking-wider text-slate-500 sm:px-5">
                                      {sizeGroup.label}
                                    </th>
                                  </tr>

                                  {sizeGroup.items.map((p) => {
                                    const qty = quantities[p.sku] || 0;
                                    return (
                                      <TableRow key={p.sku}>
                                        <TableCell className="border-r border-slate-200">
                                          <ProductDisplay
                                            sku={p.sku}
                                            productName={p.product_name}
                                            category={p.category}
                                            size={p.size}
                                            isActive={p.is_active}
                                          />
                                        </TableCell>
                                        <TableCell align="right" className="border-r border-slate-200 font-mono font-black tabular-nums text-slate-900">
                                          {formatProductQuantity(p, p.warehouse_stock ?? 0)}
                                        </TableCell>
                                        <TableCell align="center">
                                          <NumericQuantityInput
                                            value={qty}
                                            onChange={(value) => handleQtyChange(p.sku, value)}
                                            label={`Schedule target for ${p.product_name}`}
                                            className="justify-center"
                                          />
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </React.Fragment>
                              );
                            })}
                          </React.Fragment>
                        );
                    })}
                  </tbody>
                </table>
            </DataTableScroll>
          </DataTableShell>

          <div className="flex justify-end gap-3 pt-6 border-t border-slate-100 mt-8">
            <Button
              onClick={handleForecast}
              isLoading={loading}
              variant="primary"
              size="lg"
              className="h-12 font-bold px-6"
              leftIcon={!loading ? <Calculator size={16} /> : undefined}
            >
              {loading ? "Computing..." : "Compute Buying List & Recipes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {message && (
        <div className={`p-5 rounded-2xl text-sm font-bold border print:hidden flex items-center gap-3 ${
          message.type === "error" 
            ? "bg-rose-50 text-rose-700 border-rose-200" 
            : "bg-emerald-50 text-emerald-700 border-emerald-200"
        }`}>
          <AlertTriangle size={18} className="shrink-0 text-emerald-600 animate-pulse" />
          <span>{message.text}</span>
        </div>
      )}

      {/* 2. FORECAST RESULTS SECTION */}
      {forecast && (
        <div className="space-y-6 2xl:space-y-8 print:space-y-4">
          
          {/* Missing Recipes Warnings */}
          {(() => {
            const activeTargets = getActiveTargets();
            const scaledSkus = forecast.scaled_recipes.map((recipe) => recipe.target_sku);
            const missingSkus = activeTargets.filter(t => !scaledSkus.includes(t.sku));
            
            if (missingSkus.length > 0) {
              return (
                <div className="p-5 rounded-2xl text-sm font-bold border-2 bg-amber-50 text-amber-800 border-amber-200 flex flex-col gap-3 print:hidden animate-fade-in shadow-3xs">
                  <div className="flex items-center gap-2.5">
                    <AlertTriangle size={18} className="shrink-0 text-amber-600 animate-bounce" />
                    <span className="font-heading uppercase tracking-wide text-xs text-amber-700 font-black">Warning: No Recipes Configured for Selected SKU</span>
                  </div>
                  <p className="font-semibold text-slate-650 leading-relaxed">
                    The following selected items do not have any recipes or raw ingredients configured in the database:
                  </p>
                  <ul className="list-disc pl-6 space-y-1.5 mt-1 font-bold text-slate-800 font-mono text-xs">
                    {missingSkus.map(t => {
                      const prod = products.find(p => p.sku === t.sku);
                      return (
                        <li key={t.sku}>
                          <span className="flex flex-wrap items-center gap-2">
                            {prod ? prod.product_name : t.sku} <ProductSizeBadge size={prod?.size} sku={t.sku} /> <span>&mdash; SKU Code: {t.sku}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-xs text-slate-500 mt-2 font-semibold">
                    You can configure ingredients and yields under the <strong>Recipe Costing & Margins</strong> tab.
                  </p>
                </div>
              );
            }
            return null;
          })()}

          {/* Action buttons (Print and save) */}
          <div className="flex justify-end gap-3 print:hidden">
            <Button
              onClick={handlePrint}
              variant="outline"
              size="lg"
              className="h-12 bg-white"
              leftIcon={<Printer size={16} />}
            >
              Print Cooking Sheets
            </Button>
            <Button
              onClick={() => setIsConfirmOpen(true)}
              disabled={saving}
              variant="secondary"
              size="lg"
              className="h-12 text-slate-900 font-bold bg-[#cfaf45]"
              leftIcon={<CheckSquare size={16} />}
            >
              Log Finished Production
            </Button>
          </div>

          {/* Budget Valuation Highlight */}
          <Card className="print:hidden border-l-8 border-l-primary bg-primary-light/5 shadow-xs rounded-2xl overflow-hidden">
            <CardContent className="p-5 sm:p-6 2xl:p-8 flex flex-col sm:flex-row justify-between items-center gap-4">
              <div>
                <span className="text-xs text-slate-450 font-bold uppercase tracking-wider block">Estimated Buying Budget</span>
                <p className="text-xs text-slate-505 leading-relaxed font-semibold mt-0.5">Estimated cash payout needed for raw materials replenishment.</p>
              </div>
              <span className="text-2xl font-black text-primary font-mono shrink-0">
                ₱{forecast.total_estimated_raw_material_cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 2xl:gap-8 items-start print:grid-cols-1 print:gap-4">
            
            {/* Buying Checklist */}
            <Card className="lg:col-span-7 print:hidden rounded-3xl border-slate-200 shadow-sm overflow-hidden">
              <CardHeader className="p-5 sm:p-6 2xl:p-8 border-b border-slate-100 bg-slate-50/50 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <ShoppingCart size={18} className="text-slate-500" />
                    <CardTitle className="text-base md:text-lg font-heading font-black">Ingredient Shopping Checklist</CardTitle>
                  </div>
                  {/* Search Bar */}
                  <div className="relative w-full sm:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                      type="text"
                      placeholder="Search ingredients..."
                      value={checklistSearch}
                      onChange={(e) => setChecklistSearch(e.target.value)}
                      className="w-full pl-9 pr-4 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4 sm:p-6 space-y-4">
                {(() => {
                  const groups = getGroupedChecklist();
                  const sortedKeys = getSortedCategoryKeys(groups);

                  if (sortedKeys.length === 0) {
                    return (
                      <div className="py-12 text-center text-slate-455 font-semibold italic">
                        No ingredients found matching your search.
                      </div>
                    );
                  }

                  return sortedKeys.map((category) => {
                    const items = groups[category];
                    const isCollapsed = !!collapsedCategories[category];
                    const categoryShortageCount = items.filter((item) => item.deficit > 0).length;
                    const categoryPanelId = `shopping-category-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

                    return (
                      <div key={category} className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-3xs">
                        {/* Collapsible Header */}
                        <button
                          type="button"
                          onClick={() => toggleCategoryCollapsed(category)}
                          aria-expanded={!isCollapsed}
                          aria-controls={categoryPanelId}
                          className="w-full flex items-center justify-between p-4 bg-slate-50 border-b border-slate-200 font-black text-slate-800 text-sm hover:bg-slate-100/50 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <span>{category}</span>
                            <span className="inline-flex h-5 items-center justify-center rounded-full bg-slate-200 px-2 text-[10px] font-bold text-slate-600">
                              {items.length} item{items.length !== 1 ? "s" : ""}
                            </span>
                            {categoryShortageCount > 0 && (
                              <span className="inline-flex h-5 items-center justify-center rounded-full bg-rose-100 px-2 text-[10px] font-black text-rose-700">
                                {categoryShortageCount} shortage{categoryShortageCount !== 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                          {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                        </button>

                        {/* Collapsible Content */}
                        {!isCollapsed && (
                          <DataTableScroll id={categoryPanelId} label={`${category} ingredient shopping checklist`} className="overflow-x-auto">
                            <table className="w-full min-w-[660px] border-collapse text-left text-sm">
                              <thead>
                                <TableHeaderRow>
                                  <TableHeaderCell>Ingredient</TableHeaderCell>
                                  <TableHeaderCell align="right">Needed</TableHeaderCell>
                                  <TableHeaderCell align="right">In Stock</TableHeaderCell>
                                  <TableHeaderCell align="right">Deficit</TableHeaderCell>
                                  <TableHeaderCell align="right">Packs to Buy</TableHeaderCell>
                                </TableHeaderRow>
                              </thead>
                              <tbody className="font-semibold text-slate-700">
                                {items.map((item) => (
                                  <TableRow key={item.raw_ingredient_id ?? `${item.ingredient_name}-${item.unit}`} className={item.deficit > 0 ? "bg-rose-50/40 font-bold text-rose-900" : ""}>
                                    <TableCell>
                                      <div className="flex flex-col">
                                        <span className="text-sm font-black text-slate-800">{item.ingredient_name}</span>
                                        {item.parent_products && item.parent_products.length > 0 && (
                                          <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                                            Used in: {item.parent_products.join(", ")}
                                          </span>
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell align="right" className="font-mono tabular-nums text-slate-800">{item.total_needed} {item.unit}</TableCell>
                                    <TableCell align="right" className="font-mono tabular-nums text-slate-400">{item.available_stock} {item.unit}</TableCell>
                                    <TableCell align="right" className={`font-mono font-black tabular-nums ${item.deficit > 0 ? "text-rose-600" : "text-slate-450"}`}>
                                      {item.deficit > 0 ? `${item.deficit} ${item.unit}` : "-"}
                                    </TableCell>
                                    <TableCell align="right">
                                      {item.packs_to_buy > 0 ? (
                                        <Badge variant="warning" className="font-bold py-2 px-2.5 rounded-lg text-[10px]">Buy {item.packs_to_buy} pack{item.packs_to_buy > 1 ? "s" : ""}</Badge>
                                      ) : (
                                        <Badge variant="success" className="font-bold py-2 px-2.5 rounded-lg text-[10px]">Sufficient</Badge>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </tbody>
                            </table>

                            {category === "Other / uncategorized" && (
                              <div className="p-3 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-500 italic font-semibold flex items-center gap-1.5">
                                💡 Tip: You can assign these materials to custom categories in the <strong>Inventory</strong> tab.
                              </div>
                            )}
                          </DataTableScroll>
                        )}
                      </div>
                    );
                  });
                })()}
              </CardContent>
            </Card>

            {/* Production Summary and Scaled Recipes Column */}
            <div className="lg:col-span-5 space-y-5 print:space-y-0">
              <Card className="rounded-3xl border-slate-200 shadow-sm overflow-hidden bg-white print:hidden">
                <CardHeader className="p-5 bg-slate-50/50 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <CheckSquare size={18} className="text-[#885625]" />
                    <CardTitle className="text-base font-heading font-black text-slate-800">Production Summary</CardTitle>
                  </div>
                  <CardDescription className="text-xs text-slate-500">
                    Summary of items selected to produce. Ideal for screenshotting.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-5 space-y-2">
                  <div className="divide-y divide-slate-100 text-slate-800 font-bold">
                    {getActiveTargets().map((target) => {
                      const product = products.find((item) => item.sku === target.sku);
                      return (
                        <div key={target.sku} className="flex items-center justify-between py-2.5 text-sm">
                          <span>{product?.product_name || target.sku} ({product?.size || "N/A"})</span>
                          <span className="font-mono text-[#885625] font-black shrink-0">{target.quantity} pcs</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <Card className="print:border-0 print:shadow-none print:bg-white rounded-3xl border-slate-200 shadow-sm overflow-hidden">
                <CardHeader className="p-5 sm:p-6 2xl:p-8 border-b border-slate-100 bg-slate-50/50 print:px-0 print:border-0">
                  <div className="flex items-center gap-2">
                    <ChefHat size={18} className="text-slate-500" />
                    <CardTitle className="text-base md:text-lg font-heading font-black">Scaled Kitchen Recipe Sheets</CardTitle>
                  </div>
                  <CardDescription className="print:hidden">Cooking directions scaled to batch sizes.</CardDescription>
                </CardHeader>
                <CardContent className="p-5 sm:p-6 2xl:p-8 space-y-4 print:px-0">
                  <div className="space-y-6 max-h-[500px] overflow-y-auto pr-1 print:max-h-none print:overflow-visible print:pr-0">
                    {forecast.scaled_recipes.map((recipe) => {
                      const targetProduct = products.find((product) => product.sku === recipe.target_sku);
                      return (
                        <div key={`${recipe.target_sku}-${recipe.recipe_name}`} className="p-5 bg-slate-50 border border-slate-200 rounded-2xl space-y-4 print:bg-white print:p-0 print:border-0 print:border-b print:border-slate-100 print:rounded-none print:pb-6 print:mb-6">
                          <div className="flex justify-between items-start border-b border-slate-200 pb-3 print:border-slate-100">
                            <ProductDisplay
                              sku={recipe.target_sku}
                              productName={targetProduct?.product_name || recipe.recipe_name}
                              category={targetProduct?.category || UNCATEGORIZED_BUSINESS_CATEGORY}
                              size={targetProduct?.size}
                              variant="compact"
                              showMissingSize={false}
                            />
                            <div className="text-right">
                              <Badge variant="info" className="font-bold py-1 px-2.5 rounded-lg text-xs">
                                {recipe.batches_needed} Batch{recipe.batches_needed !== 1 ? "es" : ""} needed
                              </Badge>
                              <span className="text-xs text-slate-500 block mt-1.5 font-bold">Yield: {recipe.scaled_yield} {recipe.yield_unit}</span>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-y-2 text-sm font-bold text-slate-650">
                            {recipe.scaled_ingredients.map((ingredient) => {
                              const subProduct = ingredient.sub_sku ? products.find((product) => product.sku === ingredient.sub_sku) : null;
                              return (
                                <div key={ingredient.id ?? `${ingredient.ingredient_type}-${ingredient.raw_ingredient_id ?? ingredient.sub_sku}`} className="flex min-h-12 items-center justify-between gap-4 border-b border-slate-100/50 py-2">
                                  {subProduct ? (
                                    <ProductDisplay
                                      sku={subProduct.sku}
                                      productName={subProduct.product_name}
                                      category={subProduct.category}
                                      size={subProduct.size}
                                      variant="compact"
                                      showIcon={false}
                                    />
                                  ) : (
                                    <span className="text-base text-slate-800">{ingredient.raw_ingredient_name || ingredient.sub_product_name}</span>
                                  )}
                                  <span className="shrink-0 font-mono text-base font-black tabular-nums text-[#885625]">{ingredient.base_qty} {ingredient.base_unit}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation modal dialog */}
      {isConfirmOpen && (
        <ConfirmationModal
          isOpen={isConfirmOpen}
          onClose={() => setIsConfirmOpen(false)}
          onConfirm={handleSavePlan}
          title="Complete Production Plan"
          confirmLabel="Confirm Complete"
          type="warning"
          isLoading={saving}
          message={
            <div className="space-y-4 font-sans text-sm text-slate-650 leading-relaxed">
              <p className="font-bold text-slate-800 text-base">Are you sure you want to log these targets as completed?</p>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl max-h-36 overflow-y-auto text-sm font-bold text-slate-700 space-y-2">
                {getActiveTargets().map((t) => {
                  const p = products.find(prod => prod.sku === t.sku);
                  return (
                    <div key={t.sku} className="flex min-h-12 items-center justify-between gap-4">
                      <ProductDisplay
                        sku={t.sku}
                        productName={p?.product_name || t.sku}
                        category={p?.category || UNCATEGORIZED_BUSINESS_CATEGORY}
                        size={p?.size}
                        variant="compact"
                        showIcon={false}
                        showMissingSize={false}
                      />
                      <span className="shrink-0 font-mono font-black tabular-nums text-slate-900">
                        {formatProductQuantity(p || { sku: t.sku }, t.quantity)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-slate-450 leading-normal">
                This transaction will write stock deductions for raw ingredients according to recipe BOM, and add the product counts to the finished warehouse stocks. This action cannot be undone.
              </p>
            </div>
          }
        />
      )}
    </div>
  );
}
