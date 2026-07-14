"use client";

import React, { useEffect, useState } from "react";
import { api, type ProductSKUOut, type ProductionForecastOut } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { getProductBusinessCategory, BUSINESS_CATEGORIES } from "@/lib/utils";
import { ProductSizeBadge } from "@/components/ui/ProductSizeBadge";
import { ProductDisplay } from "@/components/ui/ProductDisplay";
import { 
  CalendarRange, 
  Calculator, 
  Printer, 
  CheckSquare, 
  ShoppingCart,
  ChefHat,
  Plus,
  Minus,
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

export default function PlannerPage() {
  const [products, setProducts] = useState<ProductSKUOut[]>([]);
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
  const [recommendations, setRecommendations] = useState<Array<{ sku: string; name: string; size: string; currentStock: number; suggestedQty: number }>>([]);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);

  useEffect(() => {
    api.getProducts().then(res => {
      const filtered = (res || []).filter((p) => p.sku !== "SKU" && p.is_active !== false);
      setProducts(filtered);

      // Generate smart cooking recommendations based on warehouse stock levels (if stock is below 15 jars)
      const lowStockProducts = filtered.filter((p) => (p.warehouse_stock ?? 0) < 15);
      const suggestions = lowStockProducts.map((p) => ({
        sku: p.sku,
        name: p.product_name,
        size: p.size,
        currentStock: p.warehouse_stock ?? 0,
        suggestedQty: 24 // Suggest standard double batch (2 boxes of 12)
      }));
      setRecommendations(suggestions);
    }).catch(console.error);
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

  const getSortedCategoryKeys = (groups: { [key: string]: any }) => {
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

    const groups: { [category: string]: typeof forecast.material_checklist } = {};
    
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
  products.forEach(p => {
    const cat = getProductBusinessCategory(p);
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(p);
  });

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
            {["All", "Spreads & Sauces", "Sandwiches & Salads"].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all border-2 cursor-pointer ${
                  selectedCategory === cat
                    ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                    : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <Card className="rounded-3xl border-slate-200 shadow-sm overflow-hidden">
            <CardContent className="p-0 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse border border-slate-200 text-sm text-slate-700">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-black uppercase tracking-wider text-xs">
                      <th className="px-4 py-3 border-r border-slate-200 2xl:px-6 2xl:py-4.5">Product Name &amp; SKU</th>
                      <th className="px-3 py-3 border-r border-slate-200 text-right 2xl:px-6 2xl:py-4.5">In Warehouse</th>
                      <th className="px-3 py-3 text-center 2xl:px-6 2xl:py-4.5">Schedule Target</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150 font-semibold text-slate-700">
                    {Object.entries(categories)
                      .filter(([catName]) => selectedCategory === "All" || catName === selectedCategory)
                      .map(([catName, catProds]) => {
                        if (catProds.length === 0) return null;
                        
                        // Group by size group
                        const sizeGroups: { [size: string]: ProductSKUOut[] } = {};
                        catProds.forEach(p => {
                          const sizeLower = (p.size || "").toLowerCase().trim();
                          let sizeGroup = "Other Sizes";
                          if (catName === "Spreads & Sauces") {
                            const isSavory = p.sku.includes("SVR") || p.sku.startsWith("PP") || p.sku.startsWith("CGO") || p.sku.startsWith("CLS");
                            if (sizeLower.includes("sampler") || sizeLower.includes("sam") || sizeLower.includes("110")) {
                              sizeGroup = isSavory ? "Savory Spreads (Sampler / 100g)" : "Sweet Spreads (Sampler / 100g)";
                            } else if (sizeLower.includes("indulge") || sizeLower.includes("ind") || sizeLower.includes("240") || sizeLower.includes("220") || sizeLower.includes("250")) {
                              sizeGroup = isSavory ? "Savory Spreads (Indulge / 200g)" : "Sweet Spreads (Indulge / 240g)";
                            }
                          } else {
                            if (sizeLower.includes("half") || sizeLower.includes("hf")) {
                              sizeGroup = "Half Size (Snack Portion)";
                            } else if (sizeLower.includes("full") || sizeLower.includes("fl")) {
                              sizeGroup = "Full Size (Double Portion)";
                            } else if (sizeLower.includes("solo") || sizeLower.includes("sl")) {
                              sizeGroup = "Solo Size (Single Portion)";
                            }
                          }
                          if (!sizeGroups[sizeGroup]) sizeGroups[sizeGroup] = [];
                          sizeGroups[sizeGroup].push(p);
                        });

                        return (
                          <React.Fragment key={catName}>
                            {/* Category Row */}
                            <tr className="bg-[#885625]/5 select-none border-t-2 border-slate-200">
                              <td colSpan={3} className="px-4 py-3 2xl:px-6 2xl:py-4">
                                <span className="text-sm font-heading font-black text-[#885625] uppercase tracking-wider flex items-center gap-1.5">
                                  🚀 {catName}
                                </span>
                              </td>
                            </tr>

                            {Object.entries(sizeGroups).map(([sizeGroupName, items]) => {
                              if (items.length === 0) return null;
                              return (
                                <React.Fragment key={sizeGroupName}>
                                  {/* Size Row */}
                                  <tr className="bg-slate-50/50 select-none border-t border-b border-slate-100">
                                    <td colSpan={3} className="px-4 py-2.5 2xl:px-8 2xl:py-3">
                                      <span className="text-xs font-black text-slate-500 uppercase tracking-wider">
                                        📦 {sizeGroupName}
                                      </span>
                                    </td>
                                  </tr>

                                  {items.map((p) => {
                                    const qty = quantities[p.sku] || 0;
                                    return (
                                      <tr key={p.sku} className="hover:bg-slate-50/20 transition-colors">
                                        <td className="px-4 py-3 border-r border-slate-200 2xl:px-8 2xl:py-4">
                                          <ProductDisplay
                                            sku={p.sku}
                                            productName={p.product_name}
                                            category={p.category}
                                            size={p.size}
                                            isActive={p.is_active}
                                          />
                                        </td>
                                        <td className="px-3 py-3 border-r border-slate-200 text-right font-mono font-black text-slate-900 text-sm 2xl:px-6 2xl:py-4 2xl:text-base">
                                          {p.warehouse_stock} units
                                        </td>
                                        <td className="px-3 py-3">
                                          <div className="flex justify-center items-center gap-2">
                                            <button
                                              onClick={() => handleQtyChange(p.sku, qty - 1)}
                                              type="button"
                                              className="w-8 h-8 rounded-lg border-2 border-slate-200 flex items-center justify-center hover:bg-slate-100 cursor-pointer text-slate-600 bg-white"
                                            >
                                              <Minus size={11} className="stroke-[3]" />
                                            </button>
                                            <input
                                              type="number"
                                              min={0}
                                              placeholder="0"
                                              value={qty || ""}
                                              onChange={(e) => handleQtyChange(p.sku, parseInt(e.target.value) || 0)}
                                              className="w-16 h-8 text-center font-mono font-black text-xs border-2 border-slate-200 rounded-lg text-slate-800 focus:border-primary focus:ring-0"
                                            />
                                            <button
                                              onClick={() => handleQtyChange(p.sku, qty + 1)}
                                              type="button"
                                              className="w-8 h-8 rounded-lg border-2 border-slate-200 flex items-center justify-center hover:bg-slate-100 cursor-pointer text-slate-600 bg-white"
                                            >
                                              <Plus size={11} className="stroke-[3]" />
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
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
              </div>
            </CardContent>
          </Card>

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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const scaledSkus = forecast.scaled_recipes.map((r: any) => r.target_sku);
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
                    const categoryShortageCount = items.filter((item: any) => item.deficit > 0).length;

                    return (
                      <div key={category} className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-3xs">
                        {/* Collapsible Header */}
                        <button
                          type="button"
                          onClick={() => toggleCategoryCollapsed(category)}
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
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead>
                                <tr className="bg-slate-50/50 border-b border-slate-150 text-slate-550 font-black uppercase tracking-wider text-[10px]">
                                  <th className="px-4 py-3">Ingredient</th>
                                  <th className="px-4 py-3 text-right">Needed</th>
                                  <th className="px-4 py-3 text-right">In Stock</th>
                                  <th className="px-4 py-3 text-right">Deficit</th>
                                  <th className="px-4 py-3 text-right">Packs to Buy</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                                {items.map((item: any, idx: number) => (
                                  <tr key={idx} className={`hover:bg-slate-50/20 transition-colors ${item.deficit > 0 ? "bg-rose-50/40 text-rose-900 font-bold" : ""}`}>
                                    <td className="px-4 py-3">
                                      <div className="flex flex-col">
                                        <span className="text-sm font-black text-slate-800">{item.ingredient_name}</span>
                                        {item.parent_products && item.parent_products.length > 0 && (
                                          <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                                            Used in: {item.parent_products.join(", ")}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono text-slate-800">{item.total_needed} {item.unit}</td>
                                    <td className="px-4 py-3 text-right font-mono text-slate-400">{item.available_stock} {item.unit}</td>
                                    <td className={`px-4 py-3 text-right font-mono font-black ${item.deficit > 0 ? "text-rose-600 text-sm" : "text-slate-450"}`}>
                                      {item.deficit > 0 ? `${item.deficit} ${item.unit}` : "-"}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                      {item.packs_to_buy > 0 ? (
                                        <Badge variant="warning" className="font-bold py-2 px-2.5 rounded-lg text-[10px]">Buy {item.packs_to_buy} pack{item.packs_to_buy > 1 ? "s" : ""}</Badge>
                                      ) : (
                                        <Badge variant="success" className="font-bold py-2 px-2.5 rounded-lg text-[10px]">Sufficient</Badge>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>

                            {category === "Other / uncategorized" && (
                              <div className="p-3 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-500 italic font-semibold flex items-center gap-1.5">
                                💡 Tip: You can assign these materials to custom categories in the <strong>Inventory</strong> tab.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </CardContent>
            </Card>

            {/* Scaled Recipes */}
            <Card className="lg:col-span-5 print:border-0 print:shadow-none print:bg-white rounded-3xl border-slate-200 shadow-sm overflow-hidden">
              <CardHeader className="p-5 sm:p-6 2xl:p-8 border-b border-slate-100 bg-slate-50/50 print:px-0 print:border-0">
                <div className="flex items-center gap-2">
                  <ChefHat size={18} className="text-slate-500" />
                  <CardTitle className="text-base md:text-lg font-heading font-black">Scaled Kitchen Recipe Sheets</CardTitle>
                </div>
                <CardDescription className="print:hidden">Cooking directions scaled to batch sizes.</CardDescription>
              </CardHeader>
              <CardContent className="p-5 sm:p-6 2xl:p-8 space-y-4 print:px-0">
                <div className="space-y-6 max-h-[500px] overflow-y-auto pr-1 print:max-h-none print:overflow-visible print:pr-0">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {forecast.scaled_recipes.map((recipe: any, idx: number) => (
                    <div key={idx} className="p-5 bg-slate-50 border border-slate-200 rounded-2xl space-y-4 print:bg-white print:p-0 print:border-0 print:border-b print:border-slate-100 print:rounded-none print:pb-6 print:mb-6">
                      
                      {/* Recipe Title & Batch info */}
                      <div className="flex justify-between items-start border-b border-slate-200 pb-3 print:border-slate-100">
                        <div>
                          <h4 className="font-heading font-black text-sm md:text-base uppercase tracking-wide text-slate-800">{recipe.recipe_name}</h4>
                          <span className="text-xs text-slate-400 block mt-1 font-mono font-bold">SKU Code: {recipe.target_sku}</span>
                        </div>
                        <div className="text-right">
                          <Badge variant="info" className="font-bold py-1 px-2.5 rounded-lg text-xs">
                            {recipe.batches_needed} Batch{recipe.batches_needed !== 1 ? "es" : ""} needed
                          </Badge>
                          <span className="text-xs text-slate-500 block mt-1.5 font-bold">Yield: {recipe.scaled_yield} {recipe.yield_unit}</span>
                        </div>
                      </div>

                      {/* Recipe table list */}
                      <div className="grid grid-cols-1 gap-y-2 text-sm font-bold text-slate-650">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {recipe.scaled_ingredients.map((ing: any, i: number) => (
                          <div key={i} className="flex justify-between items-center py-2 border-b border-slate-100/50">
                            <span className="text-slate-800 text-base">{ing.raw_ingredient_name || ing.sub_product_name}</span>
                            <span className="font-mono font-black text-[#885625] text-base">{ing.base_qty} {ing.base_unit}</span>
                          </div>
                        ))}
                      </div>

                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
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
                {getActiveTargets().map((t, idx) => {
                  const p = products.find(prod => prod.sku === t.sku);
                  return (
                    <div key={idx} className="flex justify-between">
                      <span className="flex items-center gap-2">{p ? p.product_name : t.sku} <ProductSizeBadge size={p?.size} sku={t.sku} /></span>
                      <span className="font-mono font-black text-slate-900">{t.quantity} jars</span>
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
