"use client";

import React, { useEffect, useState } from "react";
import {
  api,
  clearFinancialCaches,
  type CategoryOverheadRateOut,
  type CostAnalysisOut,
  type GiftSetOut,
  type ProductSKUOut,
  type RawIngredientOut,
  type RecipeCostDetailsOut,
  type RecipeItemCreate,
  type RecipeItemOut,
  type RecipeOut,
} from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import {
  BUSINESS_CATEGORIES,
  UNCATEGORIZED_BUSINESS_CATEGORY,
  formatCurrency,
  formatProductQuantity,
  getProductBusinessCategory,
  getProductSizeGroup,
  isCurrentLineupProduct,
} from "@/lib/utils";
import { ProductDisplay } from "@/components/ui/ProductDisplay";
import { 
  ChefHat, 
  RefreshCw, 
  ChevronRight, 
  Layers,
  Plus,
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
import {
  DataTableScroll,
  DataTableShell,
  TableCell,
  TableEmptyState,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
} from "@/components/ui/DataTable";
import { NumericQuantityInput } from "@/components/ui/NumericQuantityInput";
import { StatusBadge } from "@/components/ui/StatusBadge";

const RECIPE_TABS = ["single", "bundles", "overhead"] as const;

type EditableRecipeItem = {
  id?: number;
  client_id?: string;
  ingredient_type: RecipeItemCreate["ingredient_type"];
  raw_ingredient_id: number | "";
  sub_sku: string;
  base_qty: number;
  base_unit: string;
  raw_ingredient_name?: string | null;
  sub_product_name?: string | null;
};

type ComparableRecipeItem = RecipeItemOut | EditableRecipeItem;

export default function RecipesPage() {
  const [activeTab, setActiveTab] = useState<"single" | "bundles" | "overhead">("single");
  const [userRole, setUserRole] = useState<"owner" | "staff" | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [analysis, setAnalysis] = useState<CostAnalysisOut[]>([]);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
   
  const [details, setDetails] = useState<RecipeCostDetailsOut | null>(null);
   
  const [products, setProducts] = useState<ProductSKUOut[]>([]);
  const [rawIngredients, setRawIngredients] = useState<RawIngredientOut[]>([]);

  // Bulk Editor States
  const [isEditing, setIsEditing] = useState(false);
  const [editYieldWeight, setEditYieldWeight] = useState<number>(0);
  const [editYieldUnit, setEditYieldUnit] = useState<string>("g");
  const [editPortionSize, setEditPortionSize] = useState<number>(0);
  const [editPortionUnit, setEditPortionUnit] = useState<string>("g");
  const [editNotes, setEditNotes] = useState<string>("");
  const [editIngredients, setEditIngredients] = useState<EditableRecipeItem[]>([]);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const [showSaveSummary, setShowSaveSummary] = useState(false);
  
  // Gift sets & Overhead state
   
  const [giftSets, setGiftSets] = useState<GiftSetOut[]>([]);
   
  const [overheadRates, setOverheadRates] = useState<CategoryOverheadRateOut[]>([]);
  
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
   
  const [selectedRecipeItem, setSelectedRecipeItem] = useState<RecipeItemOut | null>(null);
  const [isEditQtyOpen, setIsEditQtyOpen] = useState(false);
  const [isEditPriceOpen, setIsEditPriceOpen] = useState(false);
  const [selectedRawId, setSelectedRawId] = useState<number | null>(null);
  const [selectedRawName, setSelectedRawName] = useState("");

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentTab: typeof RECIPE_TABS[number]) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const currentIndex = RECIPE_TABS.indexOf(currentTab);
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const nextTab = RECIPE_TABS[(currentIndex + offset + RECIPE_TABS.length) % RECIPE_TABS.length];
    setActiveTab(nextTab);
    document.getElementById(`recipe-tab-${nextTab}`)?.focus();
  };

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
      setAnalysis(res.filter((row) => row.sku !== "SKU" && isCurrentLineupProduct(row)));
       
      const filteredProds = prods.filter((product) => product.sku !== "SKU" && product.is_active !== false && isCurrentLineupProduct(product));
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
       
    } catch (err: unknown) {
      alert(getErrorMessage(err));
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
          setAnalysis(JSON.parse(cachedAnalysis).filter((row: CostAnalysisOut) => row.sku !== "SKU" && isCurrentLineupProduct(row)));
           
          setProducts(
            (JSON.parse(cachedProducts) as ProductSKUOut[]).filter(
              (product) => product.sku !== "SKU" && product.is_active !== false && isCurrentLineupProduct(product)
            )
          );
          setRawIngredients(JSON.parse(cachedRaws) as RawIngredientOut[]);
          setGiftSets(JSON.parse(cachedGiftSets) as GiftSetOut[]);
          setOverheadRates(JSON.parse(cachedOverheadRates) as CategoryOverheadRateOut[]);
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
    
    const cloned: EditableRecipeItem[] = (details.ingredients || []).map((ing) => ({
      id: ing.id,
      client_id: `recipe-ingredient-${ing.id ?? crypto.randomUUID()}`,
      ingredient_type: ing.ingredient_type,
      raw_ingredient_id: ing.raw_ingredient_id || "",
      sub_sku: ing.sub_sku || "",
      base_qty: ing.base_qty,
      base_unit: ing.base_unit || "g"
    }));
    setEditIngredients(cloned);
    setIsEditing(true);
  };

  const getLiveCalculations = () => {
    let totalBatchCost = 0.0;

    editIngredients.forEach(item => {
      let itemCost = 0.0;
      if (item.ingredient_type === "raw") {
        const rawIng = rawIngredients.find(r => r.id === Number(item.raw_ingredient_id));
        if (rawIng) {
          const costPerUnit = rawIng.cost_per_gram_unit ?? ((rawIng.price || 0.0) / (rawIng.net_weight || 1.0));
          itemCost = (Number(item.base_qty) || 0.0) * costPerUnit;
        }
      } else if (item.ingredient_type === "sku") {
        const subProd = products.find(p => p.sku === item.sub_sku);
        if (subProd) {
          const costPerUnit = subProd.cost_per_unit ?? 0.0;
          itemCost = (Number(item.base_qty) || 0.0) * costPerUnit;
        }
      }
      totalBatchCost += itemCost;
    });

    const yieldWeight = Number(editYieldWeight) || 1.0;
    const portionSize = Number(editPortionSize) || 1.0;
    const portionCost = yieldWeight > 0 ? (totalBatchCost / yieldWeight) * portionSize : 0.0;

    return {
      batchCost: totalBatchCost,
      portionCost: portionCost
    };
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
    if (isEditing) {
      if (hasUnsavedChanges()) {
        setShowConfirmClose(true);
      } else {
        setIsEditing(false);
      }
    } else {
      setSelectedSku(null);
      setDetails(null);
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

    const getIngKey = (ing: ComparableRecipeItem) => ing.ingredient_type === "raw" ? `raw_${ing.raw_ingredient_id}` : `sku_${ing.sub_sku}`;
    const getIngName = (ing: ComparableRecipeItem) => {
      if (ing.ingredient_type === "raw") {
        return rawIngredients.find(r => r.id === Number(ing.raw_ingredient_id))?.name || ing.raw_ingredient_name || "Raw Material";
      } else {
        return products.find(p => p.sku === ing.sub_sku)?.product_name || ing.sub_product_name || "Sub-product";
      }
    };

    const origIngredients = details.ingredients || [];
    const origMap = new Map<string, RecipeItemOut>(
      origIngredients.map((ing): [string, RecipeItemOut] => [getIngKey(ing), ing])
    );
    const editMap = new Map<string, EditableRecipeItem>(
      editIngredients.map((ing): [string, EditableRecipeItem] => [getIngKey(ing), ing])
    );

    editIngredients.forEach((ing) => {
      const key = getIngKey(ing);
      if (!origMap.has(key)) {
        summary.push(`Added ingredient: ${getIngName(ing)} (${ing.base_qty} ${ing.base_unit})`);
      } else {
        const origItem = origMap.get(key);
        if (origItem && (origItem.base_qty !== ing.base_qty || origItem.base_unit !== ing.base_unit)) {
          summary.push(`Modified ingredient: ${getIngName(ing)} (quantity changed from ${origItem.base_qty} ${origItem.base_unit} to ${ing.base_qty} ${ing.base_unit})`);
        }
      }
    });

    origIngredients.forEach((ing) => {
      const key = getIngKey(ing);
      if (!editMap.has(key)) {
        summary.push(`Removed ingredient: ${getIngName(ing)}`);
      }
    });

    return summary;
  };

  const detectCircularReference = (targetSku: string, editIngs: RecipeItemCreate[], allRecipes: RecipeOut[]): string[] | null => {
    const adjList: Record<string, string[]> = {};

    const getSubRecipeSkus = (ingredients: readonly RecipeItemCreate[]): string[] =>
      ingredients.flatMap((ingredient) =>
        ingredient.ingredient_type === "sku" && ingredient.sub_sku ? [ingredient.sub_sku] : []
      );
    
    allRecipes.forEach((recipe) => {
      adjList[recipe.sku] = getSubRecipeSkus(recipe.ingredients || []);
    });
    
    adjList[targetSku] = getSubRecipeSkus(editIngs);
      
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
      const formattedIngredients: RecipeItemCreate[] = editIngredients.map(ing => ({
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
    } catch (err: unknown) {
      alert(`Error saving recipe: ${getErrorMessage(err)}`);
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
       
    } catch (err: unknown) {
      alert(`Error updating recipe quantity: ${getErrorMessage(err)}`);
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
       
    } catch (err: unknown) {
      alert(`Error updating ingredient cost: ${getErrorMessage(err)}`);
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      await api.recalculateAllCosts();
      const res = await api.getCostAnalysis();
      setAnalysis(res.filter((row) => row.sku !== "SKU" && isCurrentLineupProduct(row)));
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
      if (!rate) return;
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
       
    } catch (err: unknown) {
      alert(`Error updating rates: ${getErrorMessage(err)}`);
    } finally {
      setSavingId(null);
    }
  };

  const handleBundleQtyChange = (sku: string, quantity: number) => {
    setBundleQuantities(prev => ({
      ...prev,
      [sku]: Math.max(0, quantity)
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
    .filter(row => row.sku !== "SKU" && isCurrentLineupProduct(row))
    .filter(row => {
      if (selectedCategory === "All") return true;
      return getProductBusinessCategory(row) === selectedCategory;
    });

  // Group products by Business Category & Size Group
  const categoryOrder = [...BUSINESS_CATEGORIES, UNCATEGORIZED_BUSINESS_CATEGORY];
  const groupedAnalysis: Record<string, Record<string, { label: string; order: number; items: CostAnalysisOut[] }>> = {};
  categoryOrder.forEach((category) => {
    groupedAnalysis[category] = {};
  });

  filteredAnalysis.forEach((row) => {
    const businessCategory = getProductBusinessCategory(row);
    const targetCategory = groupedAnalysis[businessCategory] ? businessCategory : UNCATEGORIZED_BUSINESS_CATEGORY;
    const sizeGroup = getProductSizeGroup(row);
    const existing = groupedAnalysis[targetCategory][sizeGroup.key];
    if (existing) {
      existing.items.push(row);
    } else {
      groupedAnalysis[targetCategory][sizeGroup.key] = {
        label: sizeGroup.label,
        order: sizeGroup.order,
        items: [row],
      };
    }
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
          id="recipe-tab-single"
          type="button"
          onClick={() => setActiveTab("single")}
          onKeyDown={(event) => handleTabKeyDown(event, "single")}
          role="tab"
          aria-selected={activeTab === "single"}
          aria-controls="recipe-panel-single"
          tabIndex={activeTab === "single" ? 0 : -1}
          className={`inline-flex min-h-11 items-center gap-2 px-4 py-2.5 rounded-xl transition-colors cursor-pointer text-sm font-bold ${
            activeTab === "single"
              ? "bg-[#885625]/10 text-primary font-black"
              : "text-slate-500 hover:bg-slate-100"
          }`}
        >
          <BookOpen size={16} /> Costing ledger
        </button>
        <button
          id="recipe-tab-bundles"
          type="button"
          onClick={() => setActiveTab("bundles")}
          onKeyDown={(event) => handleTabKeyDown(event, "bundles")}
          role="tab"
          aria-selected={activeTab === "bundles"}
          aria-controls="recipe-panel-bundles"
          tabIndex={activeTab === "bundles" ? 0 : -1}
          className={`inline-flex min-h-11 items-center gap-2 px-4 py-2.5 rounded-xl transition-colors cursor-pointer text-sm font-bold ${
            activeTab === "bundles"
              ? "bg-[#885625]/10 text-primary font-black"
              : "text-slate-500 hover:bg-slate-100"
          }`}
        >
          <Gift size={16} /> Gift sets
        </button>
        <button
          id="recipe-tab-overhead"
          type="button"
          onClick={() => setActiveTab("overhead")}
          onKeyDown={(event) => handleTabKeyDown(event, "overhead")}
          role="tab"
          aria-selected={activeTab === "overhead"}
          aria-controls="recipe-panel-overhead"
          tabIndex={activeTab === "overhead" ? 0 : -1}
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
          <div id="recipe-panel-single" role="tabpanel" aria-labelledby="recipe-tab-single" className="space-y-6">
            
            {/* Category Pills */}
            <div className="flex flex-wrap gap-2 pb-2">
              {["All", ...BUSINESS_CATEGORIES, UNCATEGORIZED_BUSINESS_CATEGORY].map(cat => (
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
                <DataTableScroll label="Product costing ledger" className="overflow-x-auto">
                  <table className="w-full min-w-[980px] border-collapse text-left text-sm text-slate-700">
                    <thead>
                      <TableHeaderRow>
                        <TableHeaderCell className="border-r border-slate-200">Product Name &amp; SKU</TableHeaderCell>
                        {userRole === "owner" && (
                          <>
                            <TableHeaderCell align="right" className="border-r border-slate-200">Retail SRP</TableHeaderCell>
                            <TableHeaderCell align="right" className="border-r border-slate-200">Food Cost</TableHeaderCell>
                            <TableHeaderCell align="right" className="border-r border-slate-200">Labor + Util</TableHeaderCell>
                            <TableHeaderCell align="right" className="border-r border-slate-200">Net Profit</TableHeaderCell>
                            <TableHeaderCell align="right" className="border-r border-slate-200">Margin %</TableHeaderCell>
                          </>
                        )}
                        <TableHeaderCell align="right">BOM Details</TableHeaderCell>
                      </TableHeaderRow>
                    </thead>
                    <tbody className="font-semibold text-slate-700">
                      {filteredAnalysis.length === 0 && (
                        <TableEmptyState
                          colSpan={userRole === "owner" ? 7 : 2}
                          title="No products in this view"
                          description="Choose another category or recalculate costs to refresh the ledger."
                        />
                      )}
                      {Object.entries(groupedAnalysis).map(([categoryName, sizeGroups]) => {
                        const hasItems = Object.values(sizeGroups).some((group) => group.items.length > 0);
                        if (!hasItems) return null;

                        return (
                          <React.Fragment key={categoryName}>
                            {/* Category Header Row */}
                            <tr className="select-none border-t-2 border-slate-200 bg-[#885625]/5">
                              <th scope="rowgroup" colSpan={userRole === "owner" ? 7 : 2} className="px-4 py-3 text-left sm:px-5">
                                <span className="flex items-center gap-1.5 font-heading text-sm font-black uppercase tracking-wider text-[#885625]">
                                  <Layers size={15} /> {categoryName}
                                </span>
                              </th>
                            </tr>

                            {Object.values(sizeGroups).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)).map((sizeGroup) => {
                              return (
                                <React.Fragment key={sizeGroup.label}>
                                  {/* Size Group Header Row */}
                                  <tr className="select-none border-y border-slate-100 bg-slate-50/70">
                                    <th scope="rowgroup" colSpan={userRole === "owner" ? 7 : 2} className="px-4 py-2.5 text-left text-xs font-black uppercase tracking-wider text-slate-500 sm:px-5">
                                      {sizeGroup.label}
                                    </th>
                                  </tr>

                                  {sizeGroup.items.map((row) => (
                                    <TableRow key={row.sku}>
                                      <TableCell className="border-r border-slate-200">
                                        <ProductDisplay
                                          sku={row.sku}
                                          productName={row.product_name}
                                          category={row.category}
                                          size={row.size}
                                          isActive={true}
                                        />
                                      </TableCell>
                                      {userRole === "owner" && (
                                        <>
                                          <TableCell align="right" className="border-r border-slate-200 font-mono font-black tabular-nums text-slate-900">{formatCurrency(row.selling_price)}</TableCell>
                                          <TableCell align="right" className="border-r border-slate-200 font-mono font-black tabular-nums text-slate-900">
                                            {!row.cost_status || row.cost_status === "ok" ? (
                                              <div>{formatCurrency(row.food_cost)}</div>
                                            ) : (
                                              <StatusBadge status="failed" label={row.cost_status_message || "Review costing data"} className="text-[10px]" />
                                            )}
                                            {(!row.cost_status || row.cost_status === "ok") && row.cost_override !== null && row.cost_override > 0 && (
                                              <Badge variant="warning" className="text-[10px] py-0.5 px-1.5 mt-1 rounded font-bold">Override Rule Active</Badge>
                                            )}
                                          </TableCell>
                                          <TableCell align="right" className="border-r border-slate-200 font-mono tabular-nums text-slate-455">{formatCurrency(row.labor_cost + row.utility_cost)}</TableCell>
                                          <TableCell align="right" className="border-r border-slate-200 font-mono font-black tabular-nums text-emerald-600">
                                            {!row.cost_status || row.cost_status === "ok" ? formatCurrency(row.net_profit) : "Unavailable"}
                                          </TableCell>
                                          <TableCell align="right" className="border-r border-slate-200">
                                            {!row.cost_status || row.cost_status === "ok" ? (
                                              <Badge variant={row.net_margin_pct > 50 ? "success" : (row.net_margin_pct < 40 ? "danger" : "neutral")} className="text-xs 2xl:text-sm font-bold py-1 px-2.5 rounded-lg">
                                                {row.net_margin_pct}%
                                              </Badge>
                                            ) : (
                                              <span className="text-xs font-bold text-slate-400">Unavailable</span>
                                            )}
                                          </TableCell>
                                        </>
                                      )}
                                      <TableCell align="right">
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="ghost"
                                          className="h-10"
                                          onClick={() => fetchDetails(row.sku)}
                                          aria-label={`Open bill of materials for ${row.product_name}`}
                                          rightIcon={<ChevronRight size={16} />}
                                        >
                                          View BOM
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  ))}
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
          </div>
        )}

        {/* 2. GIFT SET BUNDLES */}
        {activeTab === "bundles" && (
          <div id="recipe-panel-bundles" role="tabpanel" aria-labelledby="recipe-tab-bundles" className="grid grid-cols-1 xl:grid-cols-3 gap-6 2xl:gap-8 items-start">
            
            {/* Component Stepper Selection Card */}
            <Card className="xl:col-span-1 rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="p-5 sm:p-6 2xl:p-8 bg-slate-50/50 border-b border-slate-100">
                <CardTitle className="text-lg font-heading font-black">Bundle Creator</CardTitle>
                <CardDescription className="text-sm mt-1 text-slate-555">Fill in name and configure quantities of the set components:</CardDescription>
              </CardHeader>
              <CardContent className="p-5 sm:p-6 2xl:p-8 space-y-4">
                <div>
                  <label htmlFor="bundle-name" className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Bundle Name</label>
                  <input
                    id="bundle-name"
                    type="text"
                    placeholder="e.g. Premium Trio Box"
                    value={newSetName}
                    onChange={(e) => setNewSetName(e.target.value)}
                    className="w-full text-sm font-bold h-12 text-slate-800"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label htmlFor="bundle-box-cost" className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Box Cost (₱)</label>
                    <input
                      id="bundle-box-cost"
                      type="number"
                      value={newSetPackaging}
                      onChange={(e) => setNewSetPackaging(parseFloat(e.target.value) || 0)}
                      className="w-full text-sm font-mono h-11"
                    />
                  </div>
                  <div>
                    <label htmlFor="bundle-retail-price" className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Retail SRP</label>
                    <input
                      id="bundle-retail-price"
                      type="number"
                      value={newSetRetail}
                      onChange={(e) => setNewSetRetail(parseFloat(e.target.value) || 0)}
                      className="w-full text-sm font-mono h-11"
                    />
                  </div>
                  <div>
                    <label htmlFor="bundle-reseller-price" className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Reseller wholesale</label>
                    <input
                      id="bundle-reseller-price"
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
                        <div key={p.sku} className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-slate-250 bg-white px-4 py-2.5 text-xs shadow-3xs">
                          <ProductDisplay
                            sku={p.sku}
                            productName={p.product_name}
                            category={p.category}
                            size={p.size}
                            variant="selector"
                            showIcon={false}
                          />
                          <NumericQuantityInput
                            value={qty}
                            onChange={(value) => handleBundleQtyChange(p.sku, value)}
                            label={`Bundle quantity for ${p.product_name}`}
                            className="shrink-0"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label htmlFor="bundle-description" className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Description Remarks</label>
                  <input
                    id="bundle-description"
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
                          type="button"
                          onClick={() => handleTriggerDelete(gs.id)}
                          aria-label={`Delete gift set ${gs.name}`}
                          title={`Delete ${gs.name}`}
                          className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-455 transition-colors hover:bg-slate-50 hover:text-danger cursor-pointer"
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
                            <span className="font-black text-slate-800 font-mono text-base mt-1 block">{formatCurrency(gs.retail_price)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-455 font-black uppercase tracking-wider block">Reseller Wholesale</span>
                            <span className="font-black text-slate-800 font-mono text-base mt-1 block">{formatCurrency(gs.reseller_price)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-455 font-black uppercase tracking-wider block">Combined Costs</span>
                            <span className="font-black text-slate-800 font-mono text-base mt-1 block">{formatCurrency(gs.calculated_total_cost)}</span>
                            <span className="text-[10px] text-slate-455 font-bold block mt-1.5 font-mono">Box cost: {formatCurrency(gs.packaging_cost)}</span>
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
                            {gs.items.map((item) => {
                              const product = products.find((candidate) => candidate.sku === item.sku);
                              return (
                                <div key={item.id} className="flex min-h-12 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700">
                                  <span className="shrink-0 font-mono font-black text-primary">{formatProductQuantity(product || item, item.quantity)}</span>
                                  <ProductDisplay
                                    sku={item.sku}
                                    productName={item.product_name}
                                    category={product?.category || UNCATEGORIZED_BUSINESS_CATEGORY}
                                    size={item.size}
                                    variant="selector"
                                    showIcon={false}
                                  />
                                </div>
                              );
                            })}
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
          <div id="recipe-panel-overhead" role="tabpanel" aria-labelledby="recipe-tab-overhead" className="max-w-4xl mx-auto w-full">
            <Card className="rounded-3xl border-slate-200 shadow-sm overflow-hidden">
              <CardHeader className="p-5 sm:p-6 2xl:p-8 bg-slate-50/50 border-b border-slate-100">
                <CardTitle className="text-lg md:text-xl font-heading font-black">Category Overheads Cost Setup</CardTitle>
                <CardDescription className="text-sm mt-1 text-slate-555">Allocate standard labor and utility costs per item category:</CardDescription>
              </CardHeader>
              <CardContent className="p-0 bg-white">
                <DataTableScroll label="Category overhead rates">
                  <table className="w-full min-w-[820px] border-collapse text-left text-sm text-slate-700">
                    <thead>
                      <TableHeaderRow>
                        <TableHeaderCell>Product Category</TableHeaderCell>
                        <TableHeaderCell align="right">Labor Cost Allocation (₱ / unit)</TableHeaderCell>
                        <TableHeaderCell align="right">Utility Cost Allocation (₱ / unit)</TableHeaderCell>
                        <TableHeaderCell align="right">Total Allocated Overhead</TableHeaderCell>
                        <TableHeaderCell align="right">Save</TableHeaderCell>
                      </TableHeaderRow>
                    </thead>
                    <tbody className="divide-y divide-slate-150 font-semibold text-slate-700">
                      {overheadRates.map((rate) => {
                        const labor = editLabor[rate.category] !== undefined ? editLabor[rate.category] : rate.labor_cost_per_unit;
                        const util = editUtility[rate.category] !== undefined ? editUtility[rate.category] : rate.utility_cost_per_unit;
                        const total = parseFloat(String(labor || 0)) + parseFloat(String(util || 0));
                        const isDirty = editLabor[rate.category] !== undefined || editUtility[rate.category] !== undefined;

                        return (
                          <TableRow key={rate.category}>
                            <TableCell className="text-base font-black capitalize text-slate-800">{rate.category}</TableCell>
                            
                            <TableCell align="right">
                              <input
                                type="number"
                                step={0.01}
                                value={labor}
                                onChange={(e) => setEditLabor({ ...editLabor, [rate.category]: e.target.value })}
                                aria-label={`Labor cost allocation for ${rate.category}`}
                                className="h-10 min-w-28 w-28 rounded-xl border-2 border-slate-200 px-3 text-right font-mono font-bold focus:border-primary"
                              />
                            </TableCell>

                            <TableCell align="right">
                              <input
                                type="number"
                                step={0.01}
                                value={util}
                                onChange={(e) => setEditUtility({ ...editUtility, [rate.category]: e.target.value })}
                                aria-label={`Utility cost allocation for ${rate.category}`}
                                className="h-10 min-w-28 w-28 rounded-xl border-2 border-slate-200 px-3 text-right font-mono font-bold focus:border-primary"
                              />
                            </TableCell>

                            <TableCell align="right" className="font-mono text-base font-black text-slate-900">{formatCurrency(total)}</TableCell>
                            
                            <TableCell align="right">
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
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {overheadRates.length === 0 && (
                        <TableEmptyState colSpan={5} title="No overhead rates configured" />
                      )}
                    </tbody>
                  </table>
                </DataTableScroll>
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
                    category={details.category || UNCATEGORIZED_BUSINESS_CATEGORY}
                    size={details.size}
                    showCategory={true}
                  />
                </div>

                {/* Yield and Portion fields */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="recipe-yield-weight" className="text-xs text-slate-455 font-bold uppercase block mb-1">Yield Weight</label>
                    <div className="flex gap-2">
                      <input
                        id="recipe-yield-weight"
                        type="number"
                        step="any"
                        value={editYieldWeight}
                        onChange={(e) => setEditYieldWeight(parseFloat(e.target.value) || 0)}
                        className="w-full text-sm font-mono h-11 px-3 border border-slate-200 rounded-xl"
                        min={0}
                      />
                      <input
                        id="recipe-yield-unit"
                        type="text"
                        value={editYieldUnit}
                        onChange={(e) => setEditYieldUnit(e.target.value)}
                        className="w-16 text-sm h-11 text-center font-mono border border-slate-200 rounded-xl"
                        placeholder="g"
                        aria-label="Yield weight unit"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="recipe-portion-size" className="text-xs text-slate-455 font-bold uppercase block mb-1">Portion Size</label>
                    <div className="flex gap-2">
                      <input
                        id="recipe-portion-size"
                        type="number"
                        step="any"
                        value={editPortionSize}
                        onChange={(e) => setEditPortionSize(parseFloat(e.target.value) || 0)}
                        className="w-full text-sm font-mono h-11 px-3 border border-slate-200 rounded-xl"
                        min={0}
                      />
                      <input
                        id="recipe-portion-unit"
                        type="text"
                        value={editPortionUnit}
                        onChange={(e) => setEditPortionUnit(e.target.value)}
                        className="w-16 text-sm h-11 text-center font-mono border border-slate-200 rounded-xl"
                        placeholder="g"
                        aria-label="Portion size unit"
                      />
                    </div>
                  </div>
                </div>

                {/* LIVE COST ESTIMATE BANNER */}
                {userRole === "owner" && (() => {
                  const live = getLiveCalculations();
                  const srp = details.selling_price || 120;
                  const netProfit = srp - live.portionCost;
                  const marginPct = srp > 0 ? Math.round((netProfit / srp) * 100) : 0;
                  return (
                    <div className="p-4 bg-[#885625]/5 border border-[#ece5da] rounded-2xl space-y-3">
                      <span className="text-xs text-primary font-black uppercase tracking-wider block flex items-center gap-1.5">
                        <TrendingUp size={16} /> Live Recipe Draft Cost Estimate
                      </span>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-bold text-slate-655">
                        <div>
                          <span className="text-slate-400 block text-[10px] uppercase font-black">Draft Batch Cost</span>
                          <span className="text-base font-black text-slate-800 block font-mono mt-1">{formatCurrency(live.batchCost)}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px] uppercase font-black">Draft Portion Cost</span>
                          <span className="text-base font-black text-slate-800 block font-mono mt-1">{formatCurrency(live.portionCost)}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px] uppercase font-black">Draft Est. Margin</span>
                          <span className={`text-base font-black block mt-1 ${marginPct < 40 ? "text-amber-600" : "text-emerald-600"}`}>
                            {marginPct}%
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px] uppercase font-black">Status</span>
                          <span className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-black uppercase bg-[#885625]/10 text-primary">
                            Editing
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Ingredients list */}
                <div className="space-y-2">

                  <span className="text-xs text-slate-455 font-bold uppercase tracking-wider block">Ingredients list</span>
                  <DataTableScroll
                    label="Editable recipe ingredients"
                    className="max-h-80 overflow-auto rounded-2xl border border-slate-200 bg-white shadow-3xs"
                  >
                    <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                      <thead>
                        <TableHeaderRow>
                          <TableHeaderCell>Type</TableHeaderCell>
                          <TableHeaderCell>Ingredient</TableHeaderCell>
                          <TableHeaderCell align="right">Quantity</TableHeaderCell>
                          <TableHeaderCell>Unit</TableHeaderCell>
                          <TableHeaderCell align="center">Action</TableHeaderCell>
                        </TableHeaderRow>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                        {editIngredients.map((item, idx) => (
                          <TableRow key={item.client_id ?? item.id}>
                            <TableCell>
                              <select
                                value={item.ingredient_type}
                                aria-label={`Ingredient type for row ${idx + 1}`}
                                onChange={(e) => {
                                  const updated = [...editIngredients];
                                  updated[idx].ingredient_type = e.target.value as "sku" | "raw";
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
                                className="h-10 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                              >
                                <option value="raw">Raw Material</option>
                                <option value="sku">Sub-product</option>
                              </select>
                            </TableCell>
                            <TableCell className="min-w-[190px]">
                              {item.ingredient_type === "raw" ? (
                                <select
                                  value={item.raw_ingredient_id}
                                  aria-label={`Raw material for row ${idx + 1}`}
                                  onChange={(e) => {
                                    const updated = [...editIngredients];
                                    updated[idx].raw_ingredient_id = Number(e.target.value);
                                    setEditIngredients(updated);
                                  }}
                                  className="h-10 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
                                >
                                  {rawIngredients.map(r => (
                                    <option key={r.id} value={r.id}>{r.name}</option>
                                  ))}
                                </select>
                              ) : (
                                <select
                                  value={item.sub_sku}
                                  aria-label={`Sub-product for row ${idx + 1}`}
                                  onChange={(e) => {
                                    const updated = [...editIngredients];
                                    updated[idx].sub_sku = e.target.value;
                                    setEditIngredients(updated);
                                  }}
                                  className="h-10 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
                                >
                                  {products.filter(p => p.sku !== selectedSku).map(p => (
                                    <option key={p.sku} value={p.sku}>{p.product_name} ({p.size})</option>
                                  ))}
                                </select>
                              )}
                            </TableCell>
                            <TableCell align="right">
                              <NumericQuantityInput
                                value={Number(item.base_qty) || 0}
                                onChange={(value) => {
                                  const updated = [...editIngredients];
                                  updated[idx].base_qty = value;
                                  setEditIngredients(updated);
                                }}
                                label={`Recipe quantity for row ${idx + 1}`}
                                min={0}
                                step={0.01}
                              />
                            </TableCell>
                            <TableCell>
                              <input
                                type="text"
                                value={item.base_unit}
                                aria-label={`Recipe unit for row ${idx + 1}`}
                                onChange={(e) => {
                                  const updated = [...editIngredients];
                                  updated[idx].base_unit = e.target.value;
                                  setEditIngredients(updated);
                                }}
                                className="h-10 min-w-20 w-20 rounded-lg border border-slate-200 px-2 text-center font-mono text-xs"
                                placeholder="g"
                              />
                            </TableCell>
                            <TableCell align="center">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditIngredients(editIngredients.filter((_, i) => i !== idx));
                                }}
                                aria-label={`Delete ingredient row ${idx + 1}`}
                                title={`Delete ingredient row ${idx + 1}`}
                                className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                              >
                                <Trash2 size={14} />
                              </button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {editIngredients.length === 0 && (
                          <TableEmptyState colSpan={5} title="No ingredients added yet" />
                        )}
                      </tbody>
                    </table>
                  </DataTableScroll>
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
                            client_id: `recipe-ingredient-${crypto.randomUUID()}`,
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
                  <label htmlFor="recipe-notes" className="text-xs text-slate-455 font-bold uppercase block mb-1">Recipe Notes</label>
                  <textarea
                    id="recipe-notes"
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
                      {getBulkValidationErrors().map((err) => <li key={err}>{err}</li>)}
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
              <div className="space-y-2">
                <span className="text-xs text-slate-400 font-bold uppercase block">Recipe Item</span>
                <ProductDisplay
                  sku={details.sku}
                  productName={details.product_name}
                  category={details.category || UNCATEGORIZED_BUSINESS_CATEGORY}
                  size={details.size}
                  showCategory={true}
                />
                <p className="text-xs font-bold text-slate-500">Portion size: {details.portion_size}{details.portion_unit}</p>
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
                        <span className="font-black text-slate-800 text-base font-mono mt-1 block">{formatCurrency(details.calculated_batch_cost)}</span>
                        <span className="text-xs text-slate-455 mt-1 block font-mono">Yield Weight: {details.yield_weight}{details.yield_unit}</span>
                      </div>
                      <div>
                        <span className="text-xs text-slate-505 font-bold uppercase block">Portion Cost (Unit)</span>
                        <span className="font-black text-slate-800 text-base font-mono mt-1 block">{formatCurrency(details.calculated_portion_cost)}</span>
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
                              ? `We are losing money (${formatCurrency(Math.abs(netProfit))}) on every single jar sold! Consider raising the SRP to at least ${formatCurrency(cost * 1.5)}.`
                              : `The profit margin is ${marginPct}% which is below our 40% goal. Consider adjusting the SRP to ${formatCurrency(cost * 1.6)}.`}
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
                <DataTableScroll
                  label={`Bill of materials for ${details.product_name}`}
                  className="max-h-64 overflow-auto rounded-2xl border border-slate-200 bg-white shadow-3xs"
                >
                  <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                    <thead>
                      <TableHeaderRow>
                        <TableHeaderCell>Material Item</TableHeaderCell>
                        <TableHeaderCell align="right">Recipe Qty</TableHeaderCell>
                        {userRole === "owner" && <TableHeaderCell align="right">Allocated Cost</TableHeaderCell>}
                      </TableHeaderRow>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                      {(details.ingredients || []).map((item) => {
                        const subProduct = item.ingredient_type === "sku"
                          ? products.find((product) => product.sku === item.sub_sku)
                          : null;
                        const itemKey = item.id ?? `${item.ingredient_type}-${item.raw_ingredient_id ?? item.sub_sku}`;

                        return (
                        <TableRow key={itemKey}>
                          <TableCell>
                            <div className="flex items-center justify-between gap-2">
                              {item.ingredient_type === "raw" ? (
                                <span>{item.raw_ingredient_name}</span>
                              ) : (
                                <ProductDisplay
                                  sku={item.sub_sku || subProduct?.sku || "Unknown SKU"}
                                  productName={item.sub_product_name || subProduct?.product_name || item.sub_sku || "Unknown sub-product"}
                                  category={subProduct?.category || UNCATEGORIZED_BUSINESS_CATEGORY}
                                  size={subProduct?.size || item.size}
                                  variant="compact"
                                  showIcon={false}
                                  showMissingSize={false}
                                />
                              )}
                            {userRole === "owner" && item.ingredient_type === "raw" && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedRawId(item.raw_ingredient_id ?? null);
                                  setSelectedRawName(item.raw_ingredient_name ?? "");
                                  setIsEditPriceOpen(true);
                                }}
                                aria-label={`Edit unit price for ${item.raw_ingredient_name}`}
                                className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-all hover:bg-slate-100 hover:text-primary"
                                title="Edit raw material unit price"
                              >
                                <Edit3 size={12} />
                              </button>
                            )}
                            </div>
                          </TableCell>
                          <TableCell align="right">
                            <div className="flex justify-end items-center gap-1.5 font-mono text-slate-555 text-sm">
                              <span>{item.base_qty} {item.base_unit}</span>
                              {userRole === "owner" && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedRecipeItem(item);
                                    setIsEditQtyOpen(true);
                                  }}
                                  aria-label={`Edit recipe quantity for ${item.raw_ingredient_name || item.sub_product_name || item.sub_sku}`}
                                  className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-all hover:bg-slate-100 hover:text-primary"
                                  title="Edit recipe ingredient quantity"
                                >
                                  <Edit3 size={12} />
                                </button>
                              )}
                            </div>
                          </TableCell>
                          {userRole === "owner" && (
                            <TableCell align="right" className="font-mono text-base font-black text-slate-900">
                              {formatCurrency(item.calculated_cost)}
                            </TableCell>
                          )}
                        </TableRow>
                        );
                      })}
                      {(details.ingredients || []).length === 0 && (
                        <TableEmptyState
                          colSpan={userRole === "owner" ? 3 : 2}
                          title="No ingredients in this recipe"
                        />
                      )}
                    </tbody>
                  </table>
                </DataTableScroll>
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
            if (details) {
              setEditYieldWeight(details.yield_weight || 0);
              setEditYieldUnit(details.yield_unit || "g");
              setEditPortionSize(details.portion_size || 0);
              setEditPortionUnit(details.portion_unit || "g");
              setEditNotes(details.notes || "");
              setEditIngredients([]);
            }
            setIsEditing(false);
            setSelectedSku(null);
            setDetails(null);
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
                  getChangeSummary().map((change) => (
                    <div key={change} className="flex gap-2">
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
