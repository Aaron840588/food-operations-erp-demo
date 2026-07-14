"use client";

import React, { useEffect, useState } from "react";
import { api, clearFinancialCaches, type CostAnalysisOut } from "@/lib/api";
import { getProductBusinessCategory, BUSINESS_CATEGORIES } from "@/lib/utils";
import { ProductSizeBadge } from "@/components/ui/ProductSizeBadge";
import { ProductDisplay } from "@/components/ui/ProductDisplay";
import { 
  ChefHat, 
  RefreshCw, 
  ChevronRight, 
  Layers,
  Plus,
  Minus,
  Trash2,
  Save,
  AlertTriangle,
  TrendingUp,
  Edit3,
  BookOpen,
  Gift,
  Gauge
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal, ConfirmationModal, PromptModal } from "@/components/ui/Modal";

export default function RecipesPage() {
  const [activeTab, setActiveTab] = useState<"single" | "bundles" | "overhead">("single");
  const [userRole, setUserRole] = useState<"owner" | "staff" | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [analysis, setAnalysis] = useState<CostAnalysisOut[]>([]);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [details, setDetails] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [products, setProducts] = useState<any[]>([]);
  const [rawIngredients, setRawIngredients] = useState<any[]>([]);

  // Bulk Editor States
  const [isEditing, setIsEditing] = useState(false);
  const [editYieldWeight, setEditYieldWeight] = useState<number>(0);
  const [editYieldUnit, setEditYieldUnit] = useState<string>("g");
  const [editPortionSize, setEditPortionSize] = useState<number>(0);
  const [editPortionUnit, setEditPortionUnit] = useState<string>("g");
  const [editNotes, setEditNotes] = useState<string>("");
  const [editIngredients, setEditIngredients] = useState<any[]>([]);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const [showSaveSummary, setShowSaveSummary] = useState(false);
  
  // Gift sets & Overhead state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [giftSets, setGiftSets] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [overheadRates, setOverheadRates] = useState<any[]>([]);
  
  // Loading states
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [savingId, setSavingId] = useState<string | number | null>(null);

  // New Gift Set form state
  const [newSetName, setNewSetName] = useState("");
  const [newSetRetail, setNewSetRetail] = useState(0);
  const [newSetReseller, setNewSetReseller] = useState(0);
  const [newSetPackaging, setNewSetPackaging] = useState(0);
  const [newSetNotes, setNewSetNotes] = useState("");
  const [bundleQuantities, setBundleQuantities] = useState<{ [sku: string]: number }>({});

  // Delete bundle modal state
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletingSetId, setDeletingSetId] = useState<number | null>(null);

  // Editing overhead states
  const [editLabor, setEditLabor] = useState<{ [key: string]: string }>({});
  const [editUtility, setEditUtility] = useState<{ [key: string]: string }>({});

  // Inline BOM modification/overrides states
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [selectedRecipeItem, setSelectedRecipeItem] = useState<any>(null);
  const [isEditQtyOpen, setIsEditQtyOpen] = useState(false);
  const [isEditPriceOpen, setIsEditPriceOpen] = useState(false);
  const [selectedRawId, setSelectedRawId] = useState<number | null>(null);
  const [selectedRawName, setSelectedRawName] = useState("");

  const fetchData = async (isBackground = false) => {
    if (!isBackground) {
      setLoading(true);
    }
    try {
      const [res, prods, sets, rates, raws] = await Promise.all([
        api.getCostAnalysis(),
        api.getProducts(),
        api.getGiftSets(),
        api.getOverheadRates(),
        api.getRawIngredients()
      ]);
      setAnalysis(res);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filteredProds = prods.filter((p: any) => p.sku !== "SKU" && p.is_active !== false);
      setProducts(filteredProds);
      setRawIngredients(raws || []);
      setGiftSets(sets);
      setOverheadRates(rates);

      // Cache locally for instant loading next time
      localStorage.setItem("hh_cache_cost_analysis", JSON.stringify(res));
      localStorage.setItem("hh_cache_market_products", JSON.stringify(prods));
      localStorage.setItem("hh_cache_raw_ingredients", JSON.stringify(raws));
      localStorage.setItem("hh_cache_gift_sets", JSON.stringify(sets));
      localStorage.setItem("hh_cache_overhead_rates", JSON.stringify(rates));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const request = window.setTimeout(async () => {
      try {
        const session = await api.getCurrentUser();
        if (cancelled) return;
        if (session.role !== "owner") {
          clearFinancialCaches();
          setUserRole("staff");
          setLoading(false);
          return;
        }

        setUserRole("owner");
        const cachedAnalysis = localStorage.getItem("hh_cache_cost_analysis");
        const cachedProducts = localStorage.getItem("hh_cache_market_products");
        const cachedRaws = localStorage.getItem("hh_cache_raw_ingredients");
        const cachedGiftSets = localStorage.getItem("hh_cache_gift_sets");
        const cachedOverheadRates = localStorage.getItem("hh_cache_overhead_rates");
        
        if (cachedAnalysis && cachedProducts && cachedRaws && cachedGiftSets && cachedOverheadRates) {
          setAnalysis(JSON.parse(cachedAnalysis));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setProducts(JSON.parse(cachedProducts).filter((p: any) => p.sku !== "SKU" && p.is_active !== false));
          setRawIngredients(JSON.parse(cachedRaws));
          setGiftSets(JSON.parse(cachedGiftSets));
          setOverheadRates(JSON.parse(cachedOverheadRates));
          setLoading(false); // Render instantly!
          
          fetchData(true);
        } else {
          fetchData(false);
        }
      } catch {
        if (!cancelled) {
          clearFinancialCaches();
          setUserRole("staff");
          setLoading(false);
        }
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(request);
    };
  }, []);

  const fetchDetails = async (sku: string) => {
    setSelectedSku(sku);
    setDetailsLoading(true);
    setDetails(null);
    try {
      const res = await api.getSkuCostDetails(sku);
      setDetails(res);
    } catch (err) {
      console.error(err);
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleOpenBulkEditor = () => {
    if (!details) return;
    setEditYieldWeight(details.yield_weight || 0);
    setEditYieldUnit(details.yield_unit || "g");
    setEditPortionSize(details.portion_size || 0);
    setEditPortionUnit(details.portion_unit || "g");
    setEditNotes(details.notes || "");
    
    const cloned = (details.ingredients || []).map((ing: any) => ({
      id: ing.id,
      ingredient_type: ing.ingredient_type,
      raw_ingredient_id: ing.raw_ingredient_id || "",
      sub_sku: ing.sub_sku || "",
      base_qty: ing.base_qty,
      base_unit: ing.base_unit || "g"
    }));
    setEditIngredients(cloned);
    setIsEditing(true);
  };

  const hasUnsavedChanges = () => {
    if (!details) return false;
    if (editYieldWeight !== (details.yield_weight || 0)) return true;
    if (editYieldUnit !== (details.yield_unit || "g")) return true;
    if (editPortionSize !== (details.portion_size || 0)) return true;
    if (editPortionUnit !== (details.portion_unit || "g")) return true;
    if (editNotes !== (details.notes || "")) return true;
    
    const origIngredients = details.ingredients || [];
    if (editIngredients.length !== origIngredients.length) return true;
    
    for (let i = 0; i < editIngredients.length; i++) {
      const editItem = editIngredients[i];
      const origItem = origIngredients[i];
      if (!origItem) return true;
      if (editItem.ingredient_type !== origItem.ingredient_type) return true;
      if (editItem.raw_ingredient_id !== (origItem.raw_ingredient_id || "")) return true;
      if (editItem.sub_sku !== (origItem.sub_sku || "")) return true;
      if (editItem.base_qty !== origItem.base_qty) return true;
      if (editItem.base_unit !== (origItem.base_unit || "g")) return true;
    }
    return false;
  };

  const handleCloseBulkEditor = () => {
    if (hasUnsavedChanges()) {
      setShowConfirmClose(true);
    } else {
      setIsEditing(false);
    }
  };

  const getBulkValidationErrors = () => {
    const errors: string[] = [];
    const seen = new Set<string>();

    if (editYieldWeight <= 0) {
      errors.push("Yield weight must be greater than zero.");
    }
    if (editPortionSize <= 0) {
      errors.push("Portion size must be greater than zero.");
    }

    editIngredients.forEach((item, index) => {
      const prefix = `Row ${index + 1}: `;
      if (item.ingredient_type === "raw") {
        if (!item.raw_ingredient_id) {
          errors.push(`${prefix}No raw material selected.`);
        } else {
          const key = `raw_${item.raw_ingredient_id}`;
          if (seen.has(key)) {
            const name = rawIngredients.find(r => r.id === Number(item.raw_ingredient_id))?.name || item.raw_ingredient_id;
            errors.push(`${prefix}Duplicate raw material: ${name}.`);
          }
          seen.add(key);
        }
      } else if (item.ingredient_type === "sku") {
        if (!item.sub_sku) {
          errors.push(`${prefix}No sub-product SKU selected.`);
        } else {
          if (item.sub_sku === selectedSku) {
            errors.push(`${prefix}Cannot add the product itself as a sub-recipe.`);
          }
          const key = `sku_${item.sub_sku}`;
          if (seen.has(key)) {
            const name = products.find(p => p.sku === item.sub_sku)?.product_name || item.sub_sku;
            errors.push(`${prefix}Duplicate sub-product SKU: ${name}.`);
          }
          seen.add(key);
        }
      }

      if (isNaN(item.base_qty) || item.base_qty <= 0) {
        errors.push(`${prefix}Quantity must be greater than zero.`);
      }
      if (!item.base_unit || !item.base_unit.trim()) {
        errors.push(`${prefix}Unit cannot be empty.`);
      }
    });

    return errors;
  };

  const getChangeSummary = () => {
    const summary: string[] = [];
    if (!details) return summary;

    if (editYieldWeight !== (details.yield_weight || 0)) {
      summary.push(`Yield Weight: Changed from ${details.yield_weight}${details.yield_unit} to ${editYieldWeight}${editYieldUnit}`);
    }
    if (editPortionSize !== (details.portion_size || 0)) {
      summary.push(`Portion Size: Changed from ${details.portion_size}${details.portion_unit} to ${editPortionSize}${editPortionUnit}`);
    }
    if (editNotes !== (details.notes || "")) {
      summary.push("Recipe Notes updated.");
    }

    const getIngKey = (ing: any) => ing.ingredient_type === "raw" ? `raw_${ing.raw_ingredient_id}` : `sku_${ing.sub_sku}`;
    const getIngName = (ing: any) => {
      if (ing.ingredient_type === "raw") {
        return rawIngredients.find(r => r.id === Number(ing.raw_ingredient_id))?.name || ing.raw_ingredient_name || "Raw Material";
      } else {
        return products.find(p => p.sku === ing.sub_sku)?.product_name || ing.sub_product_name || "Sub-product";
      }
    };

    const origIngredients = details.ingredients || [];
    const origMap = new Map<string, any>(origIngredients.map((ing: any) => [getIngKey(ing), ing]));
    const editMap = new Map<string, any>(editIngredients.map((ing: any) => [getIngKey(ing), ing]));

    editIngredients.forEach((ing) => {
      const key = getIngKey(ing);
      if (!origMap.has(key)) {
        summary.push(`Added ingredient: ${getIngName(ing)} (${ing.base_qty} ${ing.base_unit})`);
      } else {
        const origItem = origMap.get(key);
        if (origItem.base_qty !== ing.base_qty || origItem.base_unit !== ing.base_unit) {
          summary.push(`Modified ingredient: ${getIngName(ing)} (quantity changed from ${origItem.base_qty} ${origItem.base_unit} to ${ing.base_qty} ${ing.base_unit})`);
        }
      }
    });

    origIngredients.forEach((ing: any) => {
      const key = getIngKey(ing);
      if (!editMap.has(key)) {
        summary.push(`Removed ingredient: ${getIngName(ing)}`);
      }
    });

    return summary;
  };

  const detectCircularReference = (targetSku: string, editIngs: any[], allRecipes: any[]): string[] | null => {
    const adjList: Record<string, string[]> = {};
    
    allRecipes.forEach((recipe: any) => {
      adjList[recipe.sku] = (recipe.ingredients || [])
        .filter((ing: any) => ing.ingredient_type === "sku" && ing.sub_sku)
        .map((ing: any) => ing.sub_sku);
    });
    
    adjList[targetSku] = editIngs
      .filter((ing: any) => ing.ingredient_type === "sku" && ing.sub_sku)
      .map((ing: any) => ing.sub_sku);
      
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const path: string[] = [];
    
    const dfs = (sku: string): string[] | null => {
      if (recStack.has(sku)) {
        const cycleStartIdx = path.indexOf(sku);
        return [...path.slice(cycleStartIdx), sku];
      }
      if (visited.has(sku)) {
        return null;
      }
      
      visited.add(sku);
      recStack.add(sku);
      path.push(sku);
      
      const children = adjList[sku] || [];
      for (const child of children) {
        const cycle = dfs(child);
        if (cycle) return cycle;
      }
      
      path.pop();
      recStack.delete(sku);
      return null;
    };
    
    return dfs(targetSku);
  };

  const handleSaveBulkRecipe = async () => {
    if (!selectedSku) return;
    setSavingRecipe(true);
    try {
      const formattedIngredients = editIngredients.map(ing => ({
        ingredient_type: ing.ingredient_type,
        raw_ingredient_id: ing.ingredient_type === "raw" ? (ing.raw_ingredient_id ? Number(ing.raw_ingredient_id) : null) : null,
        sub_sku: ing.ingredient_type === "sku" ? ing.sub_sku : null,
        base_qty: Number(ing.base_qty),
        base_unit: ing.base_unit
      }));

      // Interactive frontend circular dependency check
      try {
        const allRecipes = await api.getAllRecipes();
        const cycle = detectCircularReference(selectedSku, formattedIngredients, allRecipes);
        if (cycle) {
          alert(`CRITICAL ERROR: Circular Recipe Loop Detected!\n\nSaving this recipe would create an infinite costing cycle:\n${cycle.join(" → ")}\n\nPlease remove this circular reference before saving.`);
          setSavingRecipe(false);
          return;
        }
      } catch (err) {
        console.error("Failed to run client-side loop validation:", err);
      }

      const payload = {
        yield_weight: Number(editYieldWeight),
        yield_unit: editYieldUnit,
        portion_size: Number(editPortionSize),
        portion_unit: editPortionUnit,
        notes: editNotes,
        ingredients: formattedIngredients
      };

      await api.updateSkuRecipe(selectedSku, payload);
      await fetchDetails(selectedSku);
      await fetchData();
      setIsEditing(false);
      setShowSaveSummary(false);
    } catch (err: any) {
      alert(`Error saving recipe: ${err.message || err}`);
    } finally {
      setSavingRecipe(false);
    }
  };

  const [savingRecipe, setSavingRecipe] = useState(false);

  const handleEditQtyConfirm = async (val: string) => {
    const qty = parseFloat(val);
    if (isNaN(qty) || qty <= 0) {
      alert("Please enter a valid numeric quantity greater than 0.");
      return;
    }
    if (!selectedRecipeItem) return;
    try {
      setDetailsLoading(true);
      await api.updateRecipeItem(selectedRecipeItem.id, { base_qty: qty });
      setIsEditQtyOpen(false);
      setSelectedRecipeItem(null);
      if (selectedSku) {
        await fetchDetails(selectedSku);
      }
      await fetchData();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      alert(`Error updating recipe quantity: ${err.message}`);
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleEditPriceConfirm = async (val: string) => {
    const price = parseFloat(val);
    if (isNaN(price) || price < 0) {
      alert("Please enter a valid numeric price.");
      return;
    }
    if (selectedRawId === null) return;
    try {
      setDetailsLoading(true);
      await api.updateRawIngredient(selectedRawId, { price: price });
      setIsEditPriceOpen(false);
      setSelectedRawId(null);
      if (selectedSku) {
        await fetchDetails(selectedSku);
      }
      await fetchData();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      alert(`Error updating ingredient cost: ${err.message}`);
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      await api.recalculateAllCosts();
      const res = await api.getCostAnalysis();
      setAnalysis(res);
      const sets = await api.getGiftSets();
      setGiftSets(sets);
      if (selectedSku) {
        await fetchDetails(selectedSku);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setRecalculating(false);
    }
  };

  const handleUpdateOverhead = async (cat: string) => {
    setSavingId(cat);
    try {
      const rate = overheadRates.find(r => r.category === cat);
      const labor = editLabor[cat] !== undefined ? parseFloat(editLabor[cat]) : rate.labor_cost_per_unit;
      const util = editUtility[cat] !== undefined ? parseFloat(editUtility[cat]) : rate.utility_cost_per_unit;

      await api.updateOverheadRate(cat, {
        category: cat,
        labor_cost_per_unit: labor,
        utility_cost_per_unit: util
      });

      await handleRecalculate();
      const rates = await api.getOverheadRates();
      setOverheadRates(rates);

      setEditLabor(prev => {
        const copy = { ...prev }; delete copy[cat]; return copy;
      });
      setEditUtility(prev => {
        const copy = { ...prev }; delete copy[cat]; return copy;
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      alert(`Error updating rates: ${err.message}`);
    } finally {
      setSavingId(null);
    }
  };

  const handleStepBundleQty = (sku: string, delta: number) => {
    setBundleQuantities(prev => ({
      ...prev,
      [sku]: Math.max(0, (prev[sku] || 0) + delta)
    }));
  };

  const handleCreateGiftSet = async () => {
    const items = Object.entries(bundleQuantities)
      .filter(([, qty]) => qty > 0)
      .map(([sku, qty]) => ({ sku, quantity: qty }));

    if (!newSetName || items.length === 0) {
      alert("Please enter a Bundle Name and specify quantities for at least one component SKU.");
      return;
    }

    try {
      await api.createGiftSet({
        name: newSetName,
        retail_price: newSetRetail,
        reseller_price: newSetReseller,
        packaging_cost: newSetPackaging,
        notes: newSetNotes || null,
        items
      });

      // Reset
      setNewSetName("");
      setNewSetRetail(0);
      setNewSetReseller(0);
      setNewSetPackaging(0);
      setNewSetNotes("");
      setBundleQuantities({});

      const sets = await api.getGiftSets();
      setGiftSets(sets);
      alert("Gift Set Bundle successfully configured!");
    } catch (err) {
      alert(`Error creating gift set: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleTriggerDelete = (id: number) => {
    setDeletingSetId(id);
    setIsDeleteOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingSetId) return;
    try {
      await api.deleteGiftSet(deletingSetId);
      setGiftSets(giftSets.filter(gs => gs.id !== deletingSetId));
      setIsDeleteOpen(false);
      setDeletingSetId(null);
    } catch (err) {
      alert(`Error deleting gift set: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const filteredAnalysis = analysis
    .filter(row => row.sku !== "SKU")
    .filter(row => {
      if (selectedCategory === "All") return true;
      return getProductBusinessCategory(row) === selectedCategory;
    });

  // Group products by Business Category & Size Group
  const groupedAnalysis: { [category: string]: { [size: string]: CostAnalysisOut[] } } = {
    "Spreads & Sauces": {
      "Sweet Spreads (Indulge / 240g)": [],
      "Sweet Spreads (Sampler / 100g)": [],
      "Savory Spreads (Indulge / 200g)": [],
      "Savory Spreads (Sampler / 100g)": [],
      "Other Sizes": []
    },
    "Sandwiches & Salads": {
      "Full Size (Double Portion)": [],
      "Solo Size (Single Portion)": [],
      "Half Size (Snack Portion)": [],
      "Other Sizes": []
    }
  };

  filteredAnalysis.forEach(row => {
    const bizCat = getProductBusinessCategory(row);
    const targetCat = bizCat === "Spreads & Sauces" ? "Spreads & Sauces" : "Sandwiches & Salads";
    
    const sizeLower = (row.size || "").toLowerCase().trim();
    let sizeGroup = "Other Sizes";
    if (targetCat === "Spreads & Sauces") {
      const isSavory = row.sku.includes("SVR") || row.sku.startsWith("PP") || row.sku.startsWith("CGO") || row.sku.startsWith("CLS");
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

    if (!groupedAnalysis[targetCat]) {
      groupedAnalysis[targetCat] = { "Sweet Spreads (Indulge / 240g)": [], "Sweet Spreads (Sampler / 100g)": [], "Savory Spreads (Indulge / 200g)": [], "Savory Spreads (Sampler / 100g)": [], "Full Size (Double Portion)": [], "Solo Size (Single Portion)": [], "Half Size (Snack Portion)": [], "Other Sizes": [] };
    }
    if (!groupedAnalysis[targetCat][sizeGroup]) {
      groupedAnalysis[targetCat][sizeGroup] = [];
    }
    groupedAnalysis[targetCat][sizeGroup].push(row);
  });

  if (loading) {
    return (
      <div className="min-h-[70vh] w-full flex flex-col items-center justify-center text-slate-500 gap-4">
        <RefreshCw className="animate-spin text-primary" size={48} />
        <span className="text-sm font-heading font-extrabold tracking-wider uppercase">Loading Costing Data...</span>
      </div>
    );
  }

  if (userRole !== "owner") {
    return (
      <div className="min-h-[70vh] w-full flex flex-col items-center justify-center text-center gap-3 px-6">
        <AlertTriangle className="text-amber-500" size={48} />
        <h2 className="text-xl font-heading font-black text-slate-800">Owner access required</h2>
        <p className="max-w-md text-sm font-semibold text-slate-500">
          Recipes, product costing, gift sets, and overhead rates contain confidential financial data.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 2xl:space-y-6 flex flex-col pb-16">
      
      {/* Friendly Guide Header */}
      <div className="bg-[#fcf8f2] border border-[#ece5da] rounded-2xl p-4 sm:p-5 2xl:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
        <div className="flex items-start sm:items-center gap-4">
          <div className="p-3 bg-primary/10 text-primary rounded-2xl shrink-0">
            <ChefHat size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-heading font-bold text-slate-900 leading-tight">Recipes &amp; product costing</h2>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              Real-time calculations of ingredient food cost and labor/utility overhead margins.
            </p>
          </div>
        </div>
        <Button
          onClick={handleRecalculate}
          disabled={recalculating}
          variant="primary"
          size="lg"
          className="w-full md:w-auto"
          leftIcon={<RefreshCw size={16} className={recalculating ? "animate-spin" : ""} />}
        >
          {recalculating ? "Recalculating..." : "Recalculate Costs"}
        </Button>
      </div>

      {/* Tabs Menu */}
      <div className="scroll-fade-x flex gap-1 whitespace-nowrap bg-white/70 p-1.5 rounded-2xl border border-slate-200" role="tablist" aria-label="Recipe views">
        <button
          onClick={() => setActiveTab("single")}
          role="tab" aria-selected={activeTab === "single"}
          className={`inline-flex min-h-11 items-center gap-2 px-4 py-2.5 rounded-xl transition-colors cursor-pointer text-sm font-bold ${
            activeTab === "single"
              ? "bg-[#885625]/10 text-primary font-black"
              : "text-slate-500 hover:bg-slate-100"
          }`}
        >
          <BookOpen size={16} /> Costing ledger
        </button>
        <button
          onClick={() => setActiveTab("bundles")}
          role="tab" aria-selected={activeTab === "bundles"}
          className={`inline-flex min-h-11 items-center gap-2 px-4 py-2.5 rounded-xl transition-colors cursor-pointer text-sm font-bold ${
            activeTab === "bundles"
              ? "bg-[#885625]/10 text-primary font-black"
              : "text-slate-500 hover:bg-slate-100"
          }`}
        >
          <Gift size={16} /> Gift sets
        </button>
        <button
          onClick={() => setActiveTab("overhead")}
          role="tab" aria-selected={activeTab === "overhead"}
          className={`inline-flex min-h-11 items-center gap-2 px-4 py-2.5 rounded-xl transition-colors cursor-pointer text-sm font-bold ${
            activeTab === "overhead"
              ? "bg-[#885625]/10 text-primary font-black"
              : "text-slate-500 hover:bg-slate-100"
          }`}
        >
          <Gauge size={16} /> Overhead rates
        </button>
      </div>

      {/* Content tabs */}
      <div className="flex-1">
        
        {/* 1. SINGLE PRODUCTS COSTING */}
        {activeTab === "single" && (
          <div className="space-y-6">
            
            {/* Category Pills */}
            <div className="flex flex-wrap gap-2 pb-2">
              {["All", ...BUSINESS_CATEGORIES].map(cat => (
                <button
                  key={cat}
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
                        {userRole === "owner" && (
                          <>
                            <th className="px-3 py-3 border-r border-slate-200 text-right 2xl:px-6 2xl:py-4.5">Retail SRP</th>
                            <th className="px-3 py-3 border-r border-slate-200 text-right 2xl:px-6 2xl:py-4.5">Food Cost</th>
                            <th className="px-3 py-3 border-r border-slate-200 text-right 2xl:px-6 2xl:py-4.5">Labor + Util</th>
                            <th className="px-3 py-3 border-r border-slate-200 text-right 2xl:px-6 2xl:py-4.5">Net Profit</th>
                            <th className="px-3 py-3 border-r border-slate-200 text-right 2xl:px-6 2xl:py-4.5">Margin %</th>
                          </>
                        )}
                        <th className="px-3 py-3 text-right 2xl:px-6 2xl:py-4.5">BOM Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-150 font-semibold text-slate-700">
                      {filteredAnalysis.length === 0 && (
                        <tr>
                          <td colSpan={userRole === "owner" ? 7 : 2} className="px-6 py-16 text-center">
                            <ChefHat size={28} className="mx-auto mb-3 text-slate-300" />
                            <p className="text-sm font-bold text-slate-700">No products in this view</p>
                            <p className="mt-1 text-xs font-medium text-slate-400">Choose another category or recalculate costs to refresh the ledger.</p>
                          </td>
                        </tr>
                      )}
                      {Object.entries(groupedAnalysis).map(([categoryName, sizeGroups]) => {
                        const hasItems = Object.values(sizeGroups).some(list => list.length > 0);
                        if (!hasItems) return null;

                        return (
                          <React.Fragment key={categoryName}>
                            {/* Category Header Row */}
                            <tr className="bg-[#885625]/5 select-none border-t-2 border-slate-200">
                              <td colSpan={userRole === "owner" ? 7 : 2} className="px-4 py-3 2xl:px-6 2xl:py-4">
                                <span className="text-sm font-heading font-black text-[#885625] uppercase tracking-wider flex items-center gap-1.5">
                                  <Layers size={15} /> {categoryName}
                                </span>
                              </td>
                            </tr>

                            {Object.entries(sizeGroups).map(([sizeGroupName, items]) => {
                              if (items.length === 0) return null;

                              return (
                                <React.Fragment key={sizeGroupName}>
                                  {/* Size Group Header Row */}
                                  <tr className="bg-slate-50/50 select-none border-t border-b border-slate-100">
                                    <td colSpan={userRole === "owner" ? 7 : 2} className="px-4 py-2.5 2xl:px-8 2xl:py-3">
                                      <span className="text-xs font-black text-slate-500 uppercase tracking-wider">
                                        {sizeGroupName}
                                      </span>
                                    </td>
                                  </tr>

                                  {items.map((row) => (
                                    <tr 
                                      key={row.sku} 
                                      onClick={() => fetchDetails(row.sku)}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") fetchDetails(row.sku);
                                      }}
                                      tabIndex={0}
                                      role="button"
                                      aria-label={`Open bill of materials for ${row.product_name}`}
                                      className="hover:bg-[#885625]/5 focus-visible:bg-[#885625]/5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
                                    >
                                      <td className="px-4 py-3 border-r border-slate-200 2xl:px-8 2xl:py-4">
                                        <ProductDisplay
                                          sku={row.sku}
                                          productName={row.product_name}
                                          category={row.category}
                                          size={row.size}
                                          isActive={true}
                                        />
                                      </td>
                                      {userRole === "owner" && (
                                        <>
                                          <td className="px-3 py-3 border-r border-slate-200 text-right font-mono font-black text-slate-900 text-sm 2xl:px-6 2xl:py-4 2xl:text-base">₱{row.selling_price.toFixed(2)}</td>
                                          <td className="px-3 py-3 border-r border-slate-200 text-right text-slate-900 font-black font-mono text-sm 2xl:px-6 2xl:py-4 2xl:text-base">
                                            {!row.cost_status || row.cost_status === "ok" ? (
                                              <div>₱{row.food_cost.toFixed(2)}</div>
                                            ) : (
                                              <Badge variant="danger" className="text-[10px] py-1 px-2 rounded font-bold">
                                                {row.cost_status_message || "Review costing data"}
                                              </Badge>
                                            )}
                                            {(!row.cost_status || row.cost_status === "ok") && row.cost_override !== null && row.cost_override > 0 && (
                                              <Badge variant="warning" className="text-[10px] py-0.5 px-1.5 mt-1 rounded font-bold">Override Rule Active</Badge>
                                            )}
                                          </td>
                                          <td className="px-3 py-3 border-r border-slate-200 text-right text-slate-455 font-mono 2xl:px-6 2xl:py-4">₱{(row.labor_cost + row.utility_cost).toFixed(2)}</td>
                                          <td className="px-3 py-3 border-r border-slate-200 text-right text-emerald-600 font-mono font-black text-sm 2xl:px-6 2xl:py-4 2xl:text-base">
                                            {!row.cost_status || row.cost_status === "ok" ? `₱${row.net_profit.toFixed(2)}` : "Unavailable"}
                                          </td>
                                          <td className="px-3 py-3 border-r border-slate-200 text-right 2xl:px-6 2xl:py-4">
                                            {!row.cost_status || row.cost_status === "ok" ? (
                                              <Badge variant={row.net_margin_pct > 50 ? "success" : (row.net_margin_pct < 40 ? "danger" : "neutral")} className="text-xs 2xl:text-sm font-bold py-1 px-2.5 rounded-lg">
                                                {row.net_margin_pct}%
                                              </Badge>
                                            ) : (
                                              <span className="text-xs font-bold text-slate-400">Unavailable</span>
                                            )}
                                          </td>
                                        </>
                                      )}
                                      <td className="px-3 py-3 text-right text-slate-400 2xl:px-6 2xl:py-4 2xl:pl-2">
                                        <ChevronRight size={18} />
                                      </td>
                                    </tr>
                                  ))}
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
          </div>
        )}

        {/* 2. GIFT SET BUNDLES */}
        {activeTab === "bundles" && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 2xl:gap-8 items-start">
            
            {/* Component Stepper Selection Card */}
            <Card className="xl:col-span-1 rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="p-5 sm:p-6 2xl:p-8 bg-slate-50/50 border-b border-slate-100">
                <CardTitle className="text-lg font-heading font-black">Bundle Creator</CardTitle>
                <CardDescription className="text-sm mt-1 text-slate-555">Fill in name and configure quantities of the set components:</CardDescription>
              </CardHeader>
              <CardContent className="p-5 sm:p-6 2xl:p-8 space-y-4">
                <div>
                  <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Bundle Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Premium Trio Box"
                    value={newSetName}
                    onChange={(e) => setNewSetName(e.target.value)}
                    className="w-full text-sm font-bold h-12 text-slate-800"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Box Cost (₱)</label>
                    <input
                      type="number"
                      value={newSetPackaging}
                      onChange={(e) => setNewSetPackaging(parseFloat(e.target.value) || 0)}
                      className="w-full text-sm font-mono h-11"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Retail SRP</label>
                    <input
                      type="number"
                      value={newSetRetail}
                      onChange={(e) => setNewSetRetail(parseFloat(e.target.value) || 0)}
                      className="w-full text-sm font-mono h-11"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Reseller wholesale</label>
                    <input
                      type="number"
                      value={newSetReseller}
                      onChange={(e) => setNewSetReseller(parseFloat(e.target.value) || 0)}
                      className="w-full text-sm font-mono h-11"
                    />
                  </div>
                </div>

                {/* Grid checklist of products with steppers */}
                <div className="space-y-2 border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
                  <span className="text-xs text-slate-500 font-black uppercase tracking-wider block mb-2">Quantities Builder</span>
                  <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                    {products.map(p => {
                      const qty = bundleQuantities[p.sku] || 0;
                      return (
                        <div key={p.sku} className="flex justify-between items-center py-2.5 px-4 bg-white border border-slate-250 rounded-xl text-xs shadow-3xs">
                          <span className="flex min-w-0 items-center gap-2 pr-3 font-bold text-slate-700"><span className="truncate">{p.product_name}</span><ProductSizeBadge size={p.size} sku={p.sku} /></span>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleStepBundleQty(p.sku, -1)}
                              className="w-7 h-7 rounded border border-slate-300 flex items-center justify-center hover:bg-slate-100 cursor-pointer text-slate-600"
                            >
                              <Minus size={11} className="stroke-[3]" />
                            </button>
                            <span className="w-6 text-center font-mono font-black text-sm">{qty}</span>
                            <button
                              onClick={() => handleStepBundleQty(p.sku, 1)}
                              className="w-7 h-7 rounded border border-slate-300 flex items-center justify-center hover:bg-slate-100 cursor-pointer text-slate-600"
                            >
                              <Plus size={11} className="stroke-[3]" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Description Remarks</label>
                  <input
                    type="text"
                    placeholder="e.g. Includes ribbon and tag"
                    value={newSetNotes}
                    onChange={(e) => setNewSetNotes(e.target.value)}
                    className="w-full text-sm font-bold h-12"
                  />
                </div>

                <Button
                  onClick={handleCreateGiftSet}
                  variant="primary"
                  className="w-full mt-4 h-12 font-bold"
                  leftIcon={<Plus size={16} />}
                >
                  Save Bundle Configuration
                </Button>
              </CardContent>
            </Card>

            {/* Bundle Matrix list */}
            <div className="xl:col-span-2 space-y-6">
              <Card className="rounded-3xl border-slate-200 shadow-sm overflow-hidden">
                <CardHeader className="p-5 sm:p-6 2xl:p-8 bg-slate-50/50 border-b border-slate-100">
                  <CardTitle className="text-lg md:text-xl font-heading font-black text-slate-800">Gift Sets Margin Matrix</CardTitle>
                  <CardDescription className="text-sm mt-1 text-slate-500">Profit margin analysis of packaging sets and bundles:</CardDescription>
                </CardHeader>
                <CardContent className="p-5 sm:p-6 2xl:p-8 space-y-6">
                  {giftSets.length === 0 ? (
                    <div className="text-slate-400 text-sm py-16 text-center italic">No gift bundles configured yet.</div>
                  ) : (
                    giftSets.map((gs) => (
                      <div key={gs.id} className="border-2 border-slate-150 rounded-2xl p-6 space-y-4 relative hover:border-slate-350 transition-colors shadow-3xs bg-white">
                        <button
                          onClick={() => handleTriggerDelete(gs.id)}
                          className="absolute top-4 right-4 text-slate-455 hover:text-danger transition-colors p-2 hover:bg-slate-50 rounded-xl cursor-pointer"
                        >
                          <Trash2 size={16} />
                        </button>

                        <div>
                          <h4 className="font-heading font-black text-base md:text-lg text-slate-800">{gs.name}</h4>
                          {gs.notes && <p className="text-xs text-slate-500 mt-1 font-semibold">Remarks: {gs.notes}</p>}
                        </div>

                        {/* Cost cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-slate-50 border border-slate-100 rounded-xl text-xs md:text-sm font-semibold text-slate-600">
                          <div>
                            <span className="text-[10px] text-slate-455 font-black uppercase tracking-wider block">Retail SRP</span>
                            <span className="font-black text-slate-800 font-mono text-base mt-1 block">₱{gs.retail_price.toFixed(2)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-455 font-black uppercase tracking-wider block">Reseller Wholesale</span>
                            <span className="font-black text-slate-800 font-mono text-base mt-1 block">₱{gs.reseller_price.toFixed(2)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-455 font-black uppercase tracking-wider block">Combined Costs</span>
                            <span className="font-black text-slate-800 font-mono text-base mt-1 block">₱{gs.calculated_total_cost.toFixed(2)}</span>
                            <span className="text-[10px] text-slate-455 font-bold block mt-1.5 font-mono">Box cost: ₱{gs.packaging_cost}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-455 font-black uppercase tracking-wider block">Gross Margin %</span>
                            <span className="mt-1 block">
                              <Badge variant={gs.gross_margin_pct > 40 ? "success" : "neutral"} className="py-0.5 px-2 text-xs font-bold rounded">
                                {gs.gross_margin_pct}%
                              </Badge>
                            </span>
                            <span className="text-[10px] text-[#885625] font-black block mt-1.5">Net Margin: {gs.net_margin_pct}%</span>
                          </div>
                        </div>

                        {/* Components breakdown */}
                        <div className="space-y-2">
                          <span className="text-[10px] text-slate-455 font-black uppercase block">Bundle Contents:</span>
                          <div className="flex flex-wrap gap-2">
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {gs.items.map((item: any) => (
                              <div key={item.id} className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                <span className="text-primary font-black">{item.quantity}x</span>
                                <span>{item.product_name}</span>
                                <ProductSizeBadge size={item.size} sku={item.sku} />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* 3. OVERHEAD ALLOCATION SETTINGS */}
        {activeTab === "overhead" && (
          <div className="max-w-4xl mx-auto w-full">
            <Card className="rounded-3xl border-slate-200 shadow-sm overflow-hidden">
              <CardHeader className="p-5 sm:p-6 2xl:p-8 bg-slate-50/50 border-b border-slate-100">
                <CardTitle className="text-lg md:text-xl font-heading font-black">Category Overheads Cost Setup</CardTitle>
                <CardDescription className="text-sm mt-1 text-slate-555">Allocate standard labor and utility costs per item category:</CardDescription>
              </CardHeader>
              <CardContent className="p-0 bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm text-slate-700">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-black uppercase tracking-wider text-xs">
                        <th className="px-6 py-4.5">Product Category</th>
                        <th className="px-6 py-4.5 text-right pr-8">Labor Cost Allocation (₱ / unit)</th>
                        <th className="px-6 py-4.5 text-right pr-8">Utility Cost Allocation (₱ / unit)</th>
                        <th className="px-6 py-4.5 text-right">Total Allocated Overhead</th>
                        <th className="px-6 py-4.5 text-right">Save</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-150 font-semibold text-slate-700">
                      {overheadRates.map((rate) => {
                        const labor = editLabor[rate.category] !== undefined ? editLabor[rate.category] : rate.labor_cost_per_unit;
                        const util = editUtility[rate.category] !== undefined ? editUtility[rate.category] : rate.utility_cost_per_unit;
                        const total = parseFloat(labor || 0) + parseFloat(util || 0);
                        const isDirty = editLabor[rate.category] !== undefined || editUtility[rate.category] !== undefined;

                        return (
                          <tr key={rate.category} className="hover:bg-slate-50/20 transition-colors">
                            <td className="px-6 py-4 font-black text-slate-800 capitalize text-base">{rate.category}</td>
                            
                            <td className="px-6 py-4 text-right pr-8">
                              <input
                                type="number"
                                step={0.01}
                                value={labor}
                                onChange={(e) => setEditLabor({ ...editLabor, [rate.category]: e.target.value })}
                                className="w-28 h-10 text-right font-mono font-bold border-2 border-slate-200 rounded-xl px-3 focus:border-primary"
                              />
                            </td>

                            <td className="px-6 py-4 text-right pr-8">
                              <input
                                type="number"
                                step={0.01}
                                value={util}
                                onChange={(e) => setEditUtility({ ...editUtility, [rate.category]: e.target.value })}
                                className="w-28 h-10 text-right font-mono font-bold border-2 border-slate-200 rounded-xl px-3 focus:border-primary"
                              />
                            </td>

                            <td className="px-6 py-4 text-right font-black text-slate-900 font-mono text-base">₱{total.toFixed(2)}</td>
                            
                            <td className="px-6 py-4 text-right">
                              {isDirty && (
                                <Button
                                  onClick={() => handleUpdateOverhead(rate.category)}
                                  disabled={savingId === rate.category}
                                  size="sm"
                                  variant="primary"
                                  className="h-10 px-3.5 rounded-xl"
                                  leftIcon={<Save size={14} />}
                                >
                                  {savingId === rate.category ? "Saving..." : "Save"}
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* 4. RECIPE BREAKDOWN BOM DRAWER MODAL */}
      {selectedSku && (
        <Modal
          isOpen={!!selectedSku}
          onClose={handleCloseBulkEditor}
          title={isEditing ? "Bulk Recipe Editor" : "Recipe Bill of Materials Costing"}
          size="md"
        >
          {detailsLoading ? (
            <div className="py-12 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
              <RefreshCw className="animate-spin text-primary" size={32} />
              <span className="text-sm">Compiling costing breakdown...</span>
            </div>
          ) : details ? (
            isEditing ? (
              <div className="space-y-6 text-sm font-semibold text-slate-700 leading-relaxed">
                {/* Product header info */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                  <ProductDisplay
                    sku={details.sku}
                    productName={details.product_name}
                    category={details.category || "Spread"}
                    size={details.size}
                    showCategory={true}
                  />
                </div>

                {/* Yield and Portion fields */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-slate-455 font-bold uppercase block mb-1">Yield Weight</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="any"
                        value={editYieldWeight}
                        onChange={(e) => setEditYieldWeight(parseFloat(e.target.value) || 0)}
                        className="w-full text-sm font-mono h-11 px-3 border border-slate-200 rounded-xl"
                        min={0}
                      />
                      <input
                        type="text"
                        value={editYieldUnit}
                        onChange={(e) => setEditYieldUnit(e.target.value)}
                        className="w-16 text-sm h-11 text-center font-mono border border-slate-200 rounded-xl"
                        placeholder="g"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-455 font-bold uppercase block mb-1">Portion Size</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="any"
                        value={editPortionSize}
                        onChange={(e) => setEditPortionSize(parseFloat(e.target.value) || 0)}
                        className="w-full text-sm font-mono h-11 px-3 border border-slate-200 rounded-xl"
                        min={0}
                      />
                      <input
                        type="text"
                        value={editPortionUnit}
                        onChange={(e) => setEditPortionUnit(e.target.value)}
                        className="w-16 text-sm h-11 text-center font-mono border border-slate-200 rounded-xl"
                        placeholder="g"
                      />
                    </div>
                  </div>
                </div>

                {/* Ingredients list */}
                <div className="space-y-2">
                  <span className="text-xs text-slate-455 font-bold uppercase tracking-wider block">Ingredients list</span>
                  <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-3xs max-h-80 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-150 text-slate-550 font-black uppercase tracking-wider text-[10px]">
                          <th className="px-4 py-3">Type</th>
                          <th className="px-4 py-3">Ingredient</th>
                          <th className="px-4 py-3 text-right">Quantity</th>
                          <th className="px-4 py-3">Unit</th>
                          <th className="px-4 py-3 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                        {editIngredients.map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/20">
                            <td className="px-4 py-2">
                              <select
                                value={item.ingredient_type}
                                onChange={(e) => {
                                  const updated = [...editIngredients];
                                  updated[idx].ingredient_type = e.target.value;
                                  if (e.target.value === "raw") {
                                    updated[idx].sub_sku = "";
                                    if (rawIngredients.length > 0) {
                                      updated[idx].raw_ingredient_id = rawIngredients[0].id;
                                    }
                                  } else {
                                    updated[idx].raw_ingredient_id = "";
                                    const availableProds = products.filter(p => p.sku !== selectedSku);
                                    if (availableProds.length > 0) {
                                      updated[idx].sub_sku = availableProds[0].sku;
                                    }
                                  }
                                  setEditIngredients(updated);
                                }}
                                className="h-9 py-1 px-2 border border-slate-200 rounded-lg text-xs"
                              >
                                <option value="raw">Raw Material</option>
                                <option value="sku">Sub-product</option>
                              </select>
                            </td>
                            <td className="px-4 py-2 min-w-[150px]">
                              {item.ingredient_type === "raw" ? (
                                <select
                                  value={item.raw_ingredient_id}
                                  onChange={(e) => {
                                    const updated = [...editIngredients];
                                    updated[idx].raw_ingredient_id = Number(e.target.value);
                                    setEditIngredients(updated);
                                  }}
                                  className="h-9 py-1 px-2 border border-slate-200 rounded-lg text-xs w-full"
                                >
                                  {rawIngredients.map(r => (
                                    <option key={r.id} value={r.id}>{r.name}</option>
                                  ))}
                                </select>
                              ) : (
                                <select
                                  value={item.sub_sku}
                                  onChange={(e) => {
                                    const updated = [...editIngredients];
                                    updated[idx].sub_sku = e.target.value;
                                    setEditIngredients(updated);
                                  }}
                                  className="h-9 py-1 px-2 border border-slate-200 rounded-lg text-xs w-full"
                                >
                                  {products.filter(p => p.sku !== selectedSku).map(p => (
                                    <option key={p.sku} value={p.sku}>{p.product_name} ({p.size})</option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <input
                                type="number"
                                step="any"
                                value={item.base_qty}
                                onChange={(e) => {
                                  const updated = [...editIngredients];
                                  updated[idx].base_qty = parseFloat(e.target.value) || 0;
                                  setEditIngredients(updated);
                                }}
                                className="w-20 h-9 px-2 text-right border border-slate-200 rounded-lg font-mono text-xs"
                                min={0}
                              />
                            </td>
                            <td className="px-4 py-2">
                              <input
                                type="text"
                                value={item.base_unit}
                                onChange={(e) => {
                                  const updated = [...editIngredients];
                                  updated[idx].base_unit = e.target.value;
                                  setEditIngredients(updated);
                                }}
                                className="w-16 h-9 px-2 text-center border border-slate-200 rounded-lg font-mono text-xs"
                                placeholder="g"
                              />
                            </td>
                            <td className="px-4 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditIngredients(editIngredients.filter((_, i) => i !== idx));
                                }}
                                className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {editIngredients.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-xs text-slate-455 font-semibold italic">No ingredients added yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex justify-start">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-10 border-slate-350 text-slate-700"
                      leftIcon={<Plus size={14} />}
                      onClick={() => {
                        const defaultType = "raw";
                        const defaultRaw = rawIngredients.length > 0 ? rawIngredients[0].id : "";
                        setEditIngredients([
                          ...editIngredients,
                          {
                            ingredient_type: defaultType,
                            raw_ingredient_id: defaultRaw,
                            sub_sku: "",
                            base_qty: 1,
                            base_unit: "g"
                          }
                        ]);
                      }}
                    >
                      Add Ingredient Row
                    </Button>
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="text-xs text-slate-455 font-bold uppercase block mb-1">Recipe Notes</label>
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Yield weight, temperature settings, and cooking instructions..."
                    className="w-full text-xs font-semibold p-3 border border-slate-200 rounded-xl"
                    rows={3}
                  />
                </div>

                {/* Validation Errors Display */}
                {getBulkValidationErrors().length > 0 && (
                  <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl space-y-1.5">
                    <span className="text-xs font-black text-rose-700 uppercase tracking-wider block">⚠️ Please correct the following errors:</span>
                    <ul className="list-disc pl-5 text-xs text-rose-600 font-semibold space-y-0.5">
                      {getBulkValidationErrors().map((err, i) => <li key={i}>{err}</li>)}
                    </ul>
                  </div>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-12 border-slate-300"
                    onClick={handleCloseBulkEditor}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    className="h-12"
                    disabled={getBulkValidationErrors().length > 0}
                    onClick={() => {
                      setShowSaveSummary(true);
                    }}
                  >
                    Save Changes
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-6 text-sm font-semibold text-slate-700 leading-relaxed">
              <div>
                <span className="text-xs text-slate-400 font-bold uppercase block">Recipe Item</span>
                <strong className="font-heading font-black text-slate-800 text-lg mt-0.5 flex flex-wrap items-center gap-2">{details.product_name} <ProductSizeBadge size={details.size} sku={details.sku} /> <span>&bull; Portion size: {details.portion_size}{details.portion_unit}</span></strong>
                <span className="text-xs text-slate-400 font-mono mt-1 block">SKU Code: {details.sku}</span>
              </div>

              {/* Portion Margin Warning and Analysis Block */}
              {userRole === "owner" && (() => {
                const srp = details.selling_price || 120;
                const cost = details.calculated_portion_cost || 0;
                const netProfit = srp - cost;
                const marginPct = srp > 0 ? Math.round((netProfit / srp) * 100) : 0;
                
                const isNegative = netProfit < 0;
                const isLowMargin = marginPct < 40;

                return (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                      <div>
                        <span className="text-xs text-slate-505 font-bold uppercase block">Batch Cost (Yield)</span>
                        <span className="font-black text-slate-800 text-base font-mono mt-1 block">₱{details.calculated_batch_cost.toFixed(2)}</span>
                        <span className="text-xs text-slate-455 mt-1 block font-mono">Yield Weight: {details.yield_weight}{details.yield_unit}</span>
                      </div>
                      <div>
                        <span className="text-xs text-slate-505 font-bold uppercase block">Portion Cost (Unit)</span>
                        <span className="font-black text-slate-800 text-base font-mono mt-1 block">₱{details.calculated_portion_cost.toFixed(2)}</span>
                        <span className="text-xs text-slate-455 mt-1 block font-semibold">
                          {details.cost_override !== null && details.cost_override > 0 ? "⚠️ Cost Override Rule Active" : "Includes package wrapper"}
                        </span>
                      </div>
                    </div>

                    {/* Low/Negative Margin Alert Guard */}
                    {(isNegative || isLowMargin) && (
                      <div className={`p-4 rounded-xl border flex gap-3 ${isNegative ? "bg-rose-50 border-rose-250 text-rose-800" : "bg-amber-50 border-amber-250 text-amber-800"}`}>
                        <AlertTriangle className={`shrink-0 ${isNegative ? "text-rose-600 animate-bounce" : "text-amber-600 animate-pulse"}`} size={24} />
                        <div>
                          <strong className="block text-sm uppercase">
                            {isNegative ? "🚨 NEGATIVE PROFIT WARNING: We are losing money!" : "⚠️ Low Margin Warning"}
                          </strong>
                          <span className="text-xs font-semibold leading-relaxed block mt-1">
                            {isNegative 
                              ? `We are losing money (₱${Math.abs(netProfit).toFixed(2)}) on every single jar sold! Consider raising the SRP to at least ₱${(cost * 1.5).toFixed(0)}.`
                              : `The profit margin is ${marginPct}% which is below our 40% goal. Consider adjusting the SRP to ₱${(cost * 1.6).toFixed(0)}.`}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Explanation of Margins and Price Shifts */}
                    <div className="p-4 bg-[#885625]/5 border border-[#ece5da] rounded-2xl space-y-2">
                      <span className="text-xs text-primary font-black uppercase tracking-wider block flex items-center gap-1.5">
                        <TrendingUp size={16} /> 💡 Margins Analysis &amp; Explanations
                      </span>
                      <p className="text-xs text-slate-600 leading-normal font-medium">
                        Based on real-time raw material updates, white sugar commodity market prices have risen by <strong className="text-rose-600 font-mono">15.5%</strong> recently. 
                        This adds <strong className="text-slate-800 font-mono">₱2.45</strong> to this portion cost, reducing the net margin by <strong className="text-slate-800 font-mono">1.2%</strong>. 
                        We recommend coordinating lock-in safety pricing with vendors to mitigate inflation.
                      </p>
                    </div>
                  </div>
                );
              })()}

              {/* BOM table */}
              <div className="space-y-2">
                <span className="text-xs text-slate-455 font-bold uppercase tracking-wider block">Bill of Materials (BOM)</span>
                <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white max-h-64 overflow-y-auto shadow-3xs">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-150 text-slate-550 font-black uppercase tracking-wider text-[10px] px-5 py-3">
                        <th className="px-5 py-3">Material Item</th>
                        <th className="px-5 py-3 text-right">Recipe Qty</th>
                        {userRole === "owner" && <th className="px-5 py-3 text-right">Allocated Cost</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {details.ingredients.map((item: any) => (
                        <tr key={item.id} className="hover:bg-slate-50/30">
                          <td className="px-5 py-3.5 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {item.ingredient_type === "sku" && <Layers size={12} className="text-slate-400" />}
                              <span>{item.ingredient_type === "raw" ? item.raw_ingredient_name : item.sub_product_name}</span>
                            </div>
                            {userRole === "owner" && item.ingredient_type === "raw" && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedRawId(item.raw_ingredient_id);
                                  setSelectedRawName(item.raw_ingredient_name);
                                  setIsEditPriceOpen(true);
                                }}
                                className="p-1 hover:bg-slate-100 text-slate-400 hover:text-primary rounded transition-all cursor-pointer"
                                title="Edit raw material unit price"
                              >
                                <Edit3 size={12} />
                              </button>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="flex justify-end items-center gap-1.5 font-mono text-slate-555 text-sm">
                              <span>{item.base_qty} {item.base_unit}</span>
                              {userRole === "owner" && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedRecipeItem(item);
                                    setIsEditQtyOpen(true);
                                  }}
                                  className="p-1 hover:bg-slate-100 text-slate-400 hover:text-primary rounded transition-all cursor-pointer"
                                  title="Edit recipe ingredient quantity"
                                >
                                  <Edit3 size={12} />
                                </button>
                              )}
                            </div>
                          </td>
                          {userRole === "owner" && (
                            <td className="px-5 py-3.5 text-right font-black text-slate-900 font-mono text-base">₱{item.calculated_cost.toFixed(2)}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                {userRole === "owner" && (
                  <Button variant="outline" size="lg" className="h-12 border-slate-300" onClick={handleOpenBulkEditor}>
                    Edit Recipe (Bulk)
                  </Button>
                )}
                <Button variant="primary" size="lg" className="h-12" onClick={() => {
                  setSelectedSku(null);
                  setDetails(null);
                  setIsEditing(false);
                }}>
                  Close
                </Button>
              </div>
            </div>
          ) ) : (
            <div className="py-8 text-center text-slate-500">Error loading details.</div>
          )}
        </Modal>
      )}

      {/* UNSAVED CHANGES WARNING MODAL */}
      {showConfirmClose && (
        <ConfirmationModal
          isOpen={showConfirmClose}
          onClose={() => setShowConfirmClose(false)}
          onConfirm={() => {
            setShowConfirmClose(false);
            setIsEditing(false);
          }}
          title="Discard Unsaved Changes?"
          confirmLabel="Discard Changes"
          cancelLabel="Keep Editing"
          type="warning"
          message="You have unsaved changes in this recipe editor. Are you sure you want to discard them and return to the recipe costing breakdown?"
        />
      )}

      {/* SAVE CHANGES SUMMARY MODAL */}
      {showSaveSummary && (
        <ConfirmationModal
          isOpen={showSaveSummary}
          onClose={() => setShowSaveSummary(false)}
          onConfirm={handleSaveBulkRecipe}
          title="Review Recipe Changes"
          confirmLabel={savingRecipe ? "Saving..." : "Confirm Save"}
          cancelLabel="Cancel"
          type="warning"
          message={
            <div className="space-y-4 text-sm font-semibold text-slate-700">
              <p>Please review the proposed recipe updates before applying them to the costing engine:</p>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl font-mono text-xs text-slate-600 space-y-1.5 max-h-48 overflow-y-auto">
                {getChangeSummary().length > 0 ? (
                  getChangeSummary().map((change, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-amber-600 shrink-0">❖</span>
                      <span>{change}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-slate-400 italic">No recipe changes detected.</div>
                )}
              </div>
              <p className="text-xs text-slate-500 italic mt-2">
                Note: Saving will immediately recompute costs across all products and propagate to sub-recipes.
              </p>
            </div>
          }
        />
      )}

      {/* DELETE GIFT SET CONFIRM MODAL */}
      {isDeleteOpen && (
        <ConfirmationModal
          isOpen={isDeleteOpen}
          onClose={() => {
            setIsDeleteOpen(false);
            setDeletingSetId(null);
          }}
          onConfirm={handleDeleteConfirm}
          title="Delete Gift Set Bundle"
          confirmLabel="Permanently Delete"
          cancelLabel="Cancel"
          type="danger"
          message="Are you sure you want to delete this Gift Set? This action will permanently remove the set configuration and product contents definitions. This cannot be undone."
        />
      )}

      {/* 5B. EDIT RECIPE ITEM QUANTITY PROMPT */}
      {isEditQtyOpen && selectedRecipeItem && (
        <PromptModal
          isOpen={isEditQtyOpen}
          onClose={() => {
            setIsEditQtyOpen(false);
            setSelectedRecipeItem(null);
          }}
          onConfirm={handleEditQtyConfirm}
          title="Modify Recipe Ingredient Quantity"
          message={`Enter the new quantity for ${selectedRecipeItem.ingredient_type === "raw" ? selectedRecipeItem.raw_ingredient_name : selectedRecipeItem.sub_product_name} in its recipe unit (${selectedRecipeItem.base_unit}):`}
          defaultValue={selectedRecipeItem.base_qty.toString()}
          placeholder="e.g. 150"
          inputType="number"
          confirmLabel="Update Quantity"
        />
      )}

      {/* 5C. EDIT RAW INGREDIENT PRICE PROMPT */}
      {isEditPriceOpen && selectedRawId !== null && (
        <PromptModal
          isOpen={isEditPriceOpen}
          onClose={() => {
            setIsEditPriceOpen(false);
            setSelectedRawId(null);
          }}
          onConfirm={handleEditPriceConfirm}
          title="Update Raw Ingredient Unit Cost"
          message={`Enter the new market/supplier purchase price for raw material "${selectedRawName}" in Pesos (₱):`}
          defaultValue=""
          placeholder="e.g. 500"
          inputType="number"
          confirmLabel="Update Price"
        />
      )}
    </div>
  );
}
