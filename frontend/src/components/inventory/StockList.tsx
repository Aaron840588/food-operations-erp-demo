import React, { useState } from "react";
import { Search, Edit3, Save, AlertCircle, ChevronDown, ChevronRight, Package } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import {
  BUSINESS_CATEGORIES,
  formatCurrency,
  formatProductQuantity,
  getProductBusinessCategory,
  getProductSizeGroup,
  isCurrentLineupProduct,
} from "@/lib/utils";
import { DataTableScroll } from "@/components/ui/DataTable";
import { NumericQuantityInput } from "@/components/ui/NumericQuantityInput";
import { ProductDisplay } from "@/components/ui/ProductDisplay";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { api, type ProductSKUOut, type RawIngredientOut } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

interface StockListProps {
  products: ProductSKUOut[];
  ingredients: RawIngredientOut[];
  isOwner: boolean;
  onRefresh: () => void;
  onEditProduct: (product: ProductSKUOut) => void;
  onEditIngredient: (ingredient: RawIngredientOut) => void;
}

// -- Helper: group ingredients by product name --
function groupIngredientsByProduct(ingredients: RawIngredientOut[]): {
  groups: { productName: string; skus: string[]; items: RawIngredientOut[] }[];
  ungrouped: RawIngredientOut[];
} {
  // Build a map: productName -> ingredients
  const productMap: Record<string, RawIngredientOut[]> = {};
  const ungrouped: RawIngredientOut[] = [];

  ingredients.forEach((ing) => {
    const products: string[] = ing.used_in_products || [];
    if (products.length === 0) {
      ungrouped.push(ing);
    } else {
      // An ingredient can be in multiple products — put it in each group
      products.forEach((pName) => {
        if (!productMap[pName]) productMap[pName] = [];
        productMap[pName].push(ing);
      });
    }
  });

  // Sort product groups alphabetically
  const groups = Object.entries(productMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([productName, items]) => ({
      productName,
      skus: [], // placeholder — we don't need SKU codes in the display
      items: items.sort((a, b) => a.name.localeCompare(b.name)),
    }));

  return { groups, ungrouped: ungrouped.sort((a, b) => a.name.localeCompare(b.name)) };
}

export default function StockList({
  products,
  ingredients,
  isOwner,
  onRefresh,
  onEditProduct,
  onEditIngredient,
}: StockListProps) {
  const [stockType, setStockType] = useState<"finished" | "raw">("finished");
  const [rawViewMode, setRawViewMode] = useState<"grouped" | "flat">("grouped");
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [adjustQty, setAdjustQty] = useState<{ [key: string]: number }>({});
  const [actionLoading, setActionLoading] = useState<string | number | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  // Track which product groups are expanded (default: all expanded)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (groupName: string) => {
    setExpandedGroups((prev) => ({ ...prev, [groupName]: prev[groupName] === false ? true : false }));
  };

  const isGroupExpanded = (groupName: string) =>
    expandedGroups[groupName] !== false; // default open

  const handleApplyAdjustment = async (id: string | number, currentStock: number, isProduct: boolean) => {
    const qtyInput = adjustQty[id] !== undefined ? adjustQty[id] : currentStock;
    setActionLoading(id);
    try {
      if (isProduct) {
        await api.updateProduct(id as string, { warehouse_stock: qtyInput });
      } else {
        await api.updateRawIngredient(id as number, { available_stock: qtyInput });
      }
      setAdjustQty((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      onRefresh();
    } catch (err: unknown) {
      alert(`Error adjusting stock: ${getErrorMessage(err)}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkSave = async () => {
    setBulkSaving(true);
    try {
      const promises = Object.entries(adjustQty).map(async ([id, qtyInput]) => {
        const isProduct = products.some((p) => p.sku === id);
        if (isProduct) {
          await api.updateProduct(id, { warehouse_stock: qtyInput });
        } else {
          await api.updateRawIngredient(parseInt(id), { available_stock: qtyInput });
        }
      });
      await Promise.all(promises);
      setAdjustQty({});
      onRefresh();
    } catch (err: unknown) {
      alert(`Error saving adjustments: ${getErrorMessage(err)}`);
    } finally {
      setBulkSaving(false);
    }
  };

  const filteredProducts = products
    .filter(isCurrentLineupProduct)
    .filter((p) => p.sku !== "SKU")
    .filter((p) => {
      const matchSearch =
        p.product_name.toLowerCase().includes(search.toLowerCase()) ||
        p.sku.toLowerCase().includes(search.toLowerCase());
      if (selectedCategory === "All") return matchSearch;
      return getProductBusinessCategory(p) === selectedCategory && matchSearch;
    });

  const filteredIngredients = ingredients.filter((ing) => {
    const matchSearch =
      ing.name.toLowerCase().includes(search.toLowerCase()) ||
      (ing.brand && ing.brand.toLowerCase().includes(search.toLowerCase()));
    if (selectedCategory === "All") return matchSearch;
    return (ing.category || "Food").toLowerCase() === selectedCategory.toLowerCase() && matchSearch;
  });

  const groupProductsByCategoryAndSize = (productsList: ProductSKUOut[]) => {
    const groups: Record<string, Array<{ key: string; label: string; order: number; items: ProductSKUOut[] }>> =
      Object.fromEntries(BUSINESS_CATEGORIES.map((category) => [category, []]));

    productsList.forEach((item) => {
      const bizCat = getProductBusinessCategory(item);
      if (!groups[bizCat]) return;
      const sizeGroup = getProductSizeGroup(item);
      let bucket = groups[bizCat].find((candidate) => candidate.key === sizeGroup.key);
      if (!bucket) {
        bucket = { ...sizeGroup, items: [] };
        groups[bizCat].push(bucket);
      }
      bucket.items.push(item);
    });

    Object.values(groups).forEach((buckets) => buckets.sort((a, b) => a.order - b.order));
    return groups;
  };

  const groupedProducts = groupProductsByCategoryAndSize(filteredProducts);
  const { groups: ingredientGroups, ungrouped: ungroupedIngredients } =
    groupIngredientsByProduct(filteredIngredients);

  // -- Ingredient row renderer (shared between grouped & flat view) --

  const renderIngredientRow = (ing: RawIngredientOut) => {
    const isLow = (ing.available_stock ?? 0) <= (ing.reorder_level ?? 100);
    const currentVal = adjustQty[ing.id] !== undefined ? adjustQty[ing.id] : ing.available_stock;

    return (
      <tr
        key={ing.id}
        className={`hover:bg-slate-50/20 transition-colors ${isLow ? "bg-rose-50/10" : ""}`}
      >
        <td className="px-4 py-3 border-r border-slate-200 2xl:px-6 2xl:py-3.5">
          <span className="font-black text-slate-900 text-sm 2xl:text-base block">{ing.name}</span>
          {ing.brand && (
            <span className="text-xs text-slate-400 font-bold block mt-0.5">{ing.brand}</span>
          )}
        </td>
        <td className="px-4 py-3 border-r border-slate-200 text-slate-500 capitalize text-sm 2xl:px-6 2xl:py-3.5">{ing.category || "Food"}</td>
        <td className="px-4 py-3 border-r border-slate-200 text-slate-400 font-bold text-sm 2xl:px-6 2xl:py-3.5">
          {ing.supplier?.name || ing.shop || "Generic Vendor"}
        </td>
        <td className="px-4 py-3 border-r border-slate-200 text-right font-black text-slate-900 text-sm 2xl:px-6 2xl:py-3.5 2xl:text-base">
          {ing.available_stock} {ing.unit}
        </td>

        {/* Stepper */}
        <td className="px-4 py-3 border-r border-slate-200 2xl:px-6 2xl:py-3.5">
          <div className="flex justify-center items-center gap-2">
            <NumericQuantityInput
              value={currentVal}
              onChange={(quantity) => setAdjustQty({ ...adjustQty, [ing.id]: quantity })}
              label={`Stock level for ${ing.name}`}
              min={0}
              step={100}
            />
            <button
              type="button"
              onClick={() => handleApplyAdjustment(ing.id, ing.available_stock, false)}
              disabled={
                actionLoading === ing.id ||
                adjustQty[ing.id] === undefined ||
                adjustQty[ing.id] === ing.available_stock
              }
              aria-label={`Save stock level for ${ing.name}`}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-150 cursor-pointer ${
                adjustQty[ing.id] !== undefined && adjustQty[ing.id] !== ing.available_stock
                  ? "bg-primary hover:bg-primary-hover text-white opacity-100 scale-100 shadow-3xs"
                  : "bg-slate-100 text-slate-300 opacity-0 scale-95 pointer-events-none"
              }`}
              title="Save Stock Level"
            >
              <Save size={13} />
            </button>
          </div>
        </td>

        {isOwner && (
          <td className="px-4 py-3 border-r border-slate-200 text-right text-slate-500 font-mono font-bold text-xs 2xl:px-6 2xl:py-3.5">
            {formatCurrency((ing.price ?? 0) / (ing.net_weight || 1))} / {ing.unit}
          </td>
        )}
        <td className={`px-4 py-3 text-center 2xl:px-6 2xl:py-3.5 ${isOwner ? "border-r border-slate-200" : ""}`}>
          {isLow ? (
            <StatusBadge status="low stock" label="Low Stock" />
          ) : (
            <StatusBadge status="healthy" />
          )}
        </td>
        {isOwner && (
          <td className="px-4 py-3 text-right 2xl:px-6 2xl:py-3.5">
            <Button
              onClick={() => onEditIngredient(ing)}
              size="sm"
              variant="outline"
              className="h-9 px-3 hover:bg-slate-100"
              leftIcon={<Edit3 size={13} />}
            >
              Edit Cost
            </Button>
          </td>
        )}
      </tr>
    );
  };

  return (
    <div className="space-y-5 2xl:space-y-6">
      {/* Search and Filters Controls */}
      <div className="flex flex-col md:flex-row gap-3 2xl:gap-4 justify-between items-center bg-white p-4 2xl:p-5 border border-slate-200 rounded-2xl shadow-xs">
        <div className="flex gap-2 w-full md:w-auto">
          <Button
            variant={stockType === "finished" ? "primary" : "outline"}
            size="md"
            className="flex-1 md:flex-none h-11 2xl:h-12 text-sm font-bold rounded-xl"
            onClick={() => {
              setStockType("finished");
              setSelectedCategory("All");
            }}
            aria-pressed={stockType === "finished"}
          >
            Finished SKUs
          </Button>
          <Button
            variant={stockType === "raw" ? "primary" : "outline"}
            size="md"
            className="flex-1 md:flex-none h-11 2xl:h-12 text-sm font-bold rounded-xl"
            onClick={() => {
              setStockType("raw");
              setSelectedCategory("All");
            }}
            aria-pressed={stockType === "raw"}
          >
            Raw Materials
          </Button>
        </div>

        <div className="flex items-center gap-3 flex-1 max-w-lg">
          <div className="relative flex-1">
            <span className="absolute inset-y-0 left-4 flex items-center text-slate-400">
              <Search size={18} />
            </span>
            <input
              type="text"
              placeholder={
                stockType === "finished" ? "Search SKU code or name..." : "Search ingredients..."
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={stockType === "finished" ? "Search finished products" : "Search raw materials"}
              style={{ paddingLeft: "3rem" }}
              className="w-full pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:ring-primary/20 bg-slate-50 font-semibold h-11 2xl:h-12"
            />
          </div>

          {/* Toggle grouped / flat for raw materials */}
          {stockType === "raw" && (
            <div className="flex bg-slate-100 rounded-xl p-1 gap-1 shrink-0">
              <button
                onClick={() => setRawViewMode("grouped")}
                type="button"
                aria-pressed={rawViewMode === "grouped"}
                className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                  rawViewMode === "grouped"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-400 hover:text-slate-600"
                }`}
              >
                By Product
              </button>
              <button
                onClick={() => setRawViewMode("flat")}
                type="button"
                aria-pressed={rawViewMode === "flat"}
                className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                  rawViewMode === "flat"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-400 hover:text-slate-600"
                }`}
              >
                All Flat
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bulk Save Banner */}
      {Object.keys(adjustQty).length > 0 && (
        <div className="flex items-center justify-between bg-primary/10 border border-primary/20 text-[#2d1f0e] px-5 py-4 rounded-2xl animate-fade-in shadow-3xs">
          <div className="flex items-center gap-2.5">
            <AlertCircle size={20} className="text-primary animate-pulse shrink-0" />
            <span className="text-sm font-bold">
              You have {Object.keys(adjustQty).length} unsaved stock adjustments.
            </span>
          </div>
          <div className="flex gap-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAdjustQty({})}
              className="bg-white hover:bg-slate-50 border-slate-200 h-10 px-4 text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              isLoading={bulkSaving}
              onClick={handleBulkSave}
              className="h-10 px-4 text-xs"
            >
              Save All
            </Button>
          </div>
        </div>
      )}

      {/* Category Pills for finished goods */}
      {stockType === "finished" && (
        <div className="flex flex-wrap gap-2 pb-2">
          {["All", ...BUSINESS_CATEGORIES].map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              type="button"
              aria-pressed={selectedCategory === cat}
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
      )}

      {/* ─── STOCK LEDGER LIST ─── */}
      <Card className="rounded-3xl border-slate-200 shadow-sm overflow-hidden">
        <CardContent className="p-0 bg-white">
          {/* ═══ FINISHED GOODS ═══ */}
          {stockType === "finished" ? (
            filteredProducts.length === 0 ? (
              <div className="py-16 text-center">
                <Package size={28} className="mx-auto mb-3 text-slate-300" />
                <p className="text-sm font-bold text-slate-700">No finished goods match</p>
                <p className="mt-1 text-xs font-medium text-slate-400">Clear the search or choose another category.</p>
              </div>
            ) : (
              <>
                {/* Desktop */}
                <DataTableScroll label="Finished product stock levels" className="hidden overflow-x-auto xl:block">
                  <table className="w-full min-w-[64rem] text-left border-collapse border border-slate-200 text-sm text-slate-700" aria-label="Finished product stock levels">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-black uppercase tracking-wider text-xs">
                        <th scope="col" className="px-4 py-3 border-r border-slate-200 2xl:px-6 2xl:py-4.5">Product SKU</th>
                        <th scope="col" className="px-4 py-3 border-r border-slate-200 2xl:px-6 2xl:py-4.5">Category</th>
                        <th scope="col" className="px-4 py-3 border-r border-slate-200 text-right 2xl:px-6 2xl:py-4.5">In Warehouse</th>
                        <th scope="col" className="px-4 py-3 border-r border-slate-200 text-center 2xl:px-6 2xl:py-4.5">Set Stock Level</th>
                        {isOwner && (
                          <>
                            <th scope="col" className="px-4 py-3 border-r border-slate-200 text-right 2xl:px-6 2xl:py-4.5">Retail SRP</th>
                            <th scope="col" className="px-4 py-3 text-right 2xl:px-6 2xl:py-4.5">Edit</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-155 font-semibold text-slate-700">
                      {Object.entries(groupedProducts).map(([categoryName, sizeGroups]) => {
                        const hasItems = sizeGroups.some((group) => group.items.length > 0);
                        if (!hasItems) return null;

                        return (
                          <React.Fragment key={categoryName}>
                            <tr className="bg-[#885625]/5 select-none border-t-2 border-slate-200">
                              <td colSpan={isOwner ? 6 : 4} className="px-4 py-3 2xl:px-6 2xl:py-4">
                                <span className="text-sm font-heading font-black text-[#885625] uppercase tracking-wider flex items-center gap-1.5">
                                  🚀 {categoryName}
                                </span>
                              </td>
                            </tr>

                            {sizeGroups.map(({ key, label: sizeGroupName, items }) => {
                              if (items.length === 0) return null;
                              return (
                                <React.Fragment key={key}>
                                  <tr className="bg-slate-50/50 select-none border-t border-b border-slate-100">
                                    <td colSpan={isOwner ? 6 : 4} className="px-4 py-2.5 2xl:px-8 2xl:py-3">
                                      <span className="text-xs font-black text-slate-500 uppercase tracking-wider">
                                        📦 {sizeGroupName}
                                      </span>
                                    </td>
                                  </tr>

                                  {items.map((p) => {
                                    const currentVal =
                                      adjustQty[p.sku] !== undefined
                                        ? adjustQty[p.sku]
                                        : p.warehouse_stock;
                                    return (
                                      <tr
                                        key={p.sku}
                                        className="hover:bg-slate-50/20 transition-colors"
                                      >
                                        <td className="px-4 py-3 border-r border-slate-200 2xl:px-8 2xl:py-4">
                                          <ProductDisplay
                                            sku={p.sku}
                                            productName={p.product_name}
                                            category={p.category}
                                            size={p.size}
                                            isActive={p.is_active}
                                          />
                                        </td>
                                        <td className="px-4 py-3 border-r border-slate-200 text-slate-505 capitalize 2xl:px-6 2xl:py-4">
                                          {p.category}
                                        </td>
                                        <td className="px-4 py-3 border-r border-slate-200 text-right font-black text-slate-900 text-sm 2xl:px-6 2xl:py-4 2xl:text-base">
                                          {formatProductQuantity(p, p.warehouse_stock)}
                                        </td>
                                        <td className="px-4 py-3 border-r border-slate-200 2xl:px-6 2xl:py-4">
                                          <div className="flex justify-center items-center gap-2 2xl:gap-3">
                                            <NumericQuantityInput
                                              value={currentVal}
                                              onChange={(quantity) => setAdjustQty({ ...adjustQty, [p.sku]: quantity })}
                                              label={`Stock level for ${p.product_name}`}
                                              min={0}
                                            />
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleApplyAdjustment(p.sku, p.warehouse_stock, true)
                                              }
                                              disabled={
                                                actionLoading === p.sku ||
                                                adjustQty[p.sku] === undefined ||
                                                adjustQty[p.sku] === p.warehouse_stock
                                              }
                                              aria-label={`Save stock level for ${p.product_name}`}
                                              className={`ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-150 cursor-pointer ${
                                                adjustQty[p.sku] !== undefined &&
                                                adjustQty[p.sku] !== p.warehouse_stock
                                                  ? "bg-primary hover:bg-primary-hover text-white opacity-100 scale-100 shadow-3xs"
                                                  : "bg-slate-100 text-slate-300 opacity-0 scale-95 pointer-events-none"
                                              }`}
                                              title="Save Stock Level"
                                            >
                                              <Save size={14} />
                                            </button>
                                          </div>
                                        </td>
                                        {isOwner && (
                                          <>
                                            <td className="px-4 py-3 border-r border-slate-200 text-right font-mono font-black text-slate-900 text-sm 2xl:px-6 2xl:py-4 2xl:text-base">
                                              {formatCurrency(p.retail_price)}
                                            </td>
                                            <td className="px-4 py-3 text-right 2xl:px-6 2xl:py-4">
                                              <Button
                                                onClick={() => onEditProduct(p)}
                                                size="sm"
                                                variant="outline"
                                                className="h-9 px-3 hover:bg-slate-100 2xl:h-10"
                                                leftIcon={<Edit3 size={14} />}
                                              >
                                                Edit Settings
                                              </Button>
                                            </td>
                                          </>
                                        )}
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
                </DataTableScroll>

                {/* Mobile */}
                <div className="xl:hidden grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
                  {filteredProducts.map((p) => {
                    const currentVal =
                      adjustQty[p.sku] !== undefined ? adjustQty[p.sku] : p.warehouse_stock;
                    return (
                      <div
                        key={p.sku}
                        className="bg-white border-2 border-slate-150 rounded-2xl p-5 space-y-4 shadow-3xs"
                      >
                        <div className="flex justify-between items-start">
                          <ProductDisplay
                            sku={p.sku}
                            productName={p.product_name}
                            category={p.category}
                            size={p.size}
                            isActive={p.is_active}
                          />
                          <div className="flex flex-col items-end gap-1 font-bold">
                            <span className="text-xs font-bold text-slate-500 capitalize bg-slate-100 px-2.5 py-1 rounded-xl">
                              {p.category}
                            </span>
                            {isOwner && (
                              <span className="text-xs text-slate-500 font-extrabold mt-1.5">
                                SRP: {formatCurrency(p.retail_price)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col gap-3 bg-[#faf8f5] p-3 rounded-xl border border-[#ece5da] sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-xs text-[#2d1f0e] font-bold">
                            Current:{" "}
                            <span className="font-black text-slate-900 text-sm block md:inline">
                              {formatProductQuantity(p, p.warehouse_stock)}
                            </span>
                          </div>
                          <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
                            <NumericQuantityInput
                              value={currentVal}
                              onChange={(quantity) => setAdjustQty({ ...adjustQty, [p.sku]: quantity })}
                              label={`Stock level for ${p.product_name}`}
                              min={0}
                            />
                            <button
                              type="button"
                              onClick={() => handleApplyAdjustment(p.sku, p.warehouse_stock, true)}
                              disabled={
                                actionLoading === p.sku ||
                                adjustQty[p.sku] === undefined ||
                                adjustQty[p.sku] === p.warehouse_stock
                              }
                              aria-label={`Save stock level for ${p.product_name}`}
                              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-all duration-150 active:scale-95 ${
                                adjustQty[p.sku] !== undefined &&
                                adjustQty[p.sku] !== p.warehouse_stock
                                  ? "bg-primary hover:bg-primary-hover text-white opacity-100 scale-100"
                                  : "bg-slate-100 text-slate-300 opacity-0 scale-95 pointer-events-none"
                              }`}
                            >
                              <Save size={12} />
                            </button>
                          </div>
                        </div>
                        <div className="flex justify-between items-center text-xs text-slate-400 pt-2 border-t border-slate-100 font-bold">
                          <span>
                            Pack: {p.pack_qty || 1} • Shelf Life: {p.storage_life || "-"}
                          </span>
                          {isOwner && (
                            <button
                              type="button"
                              onClick={() => onEditProduct(p)}
                              className="flex min-h-10 items-center gap-1 text-[#885625] hover:underline"
                            >
                              Edit SKU Settings <Edit3 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )
          ) : (
            /* ═══ RAW MATERIALS ═══ */
            filteredIngredients.length === 0 ? (
              <div className="py-16 text-center">
                <Package size={28} className="mx-auto mb-3 text-slate-300" />
                <p className="text-sm font-bold text-slate-700">No raw materials match</p>
                <p className="mt-1 text-xs font-medium text-slate-400">Clear the search or change the grouping.</p>
              </div>
            ) : rawViewMode === "flat" ? (
              /* ── FLAT VIEW (original) ── */
              <>
                <DataTableScroll label="Raw material stock levels" className="hidden overflow-x-auto xl:block">
                  <table className="w-full min-w-[70rem] text-left border-collapse border border-slate-200 text-sm text-slate-700" aria-label="Raw material stock levels">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-black uppercase tracking-wider text-xs">
                        <th scope="col" className="px-6 py-4 border-r border-slate-200">Ingredient Name</th>
                        <th scope="col" className="px-6 py-4 border-r border-slate-200">Category</th>
                        <th scope="col" className="px-6 py-4 border-r border-slate-200">Assigned Supplier</th>
                        <th scope="col" className="px-6 py-4 border-r border-slate-200 text-right">Available Stock</th>
                        <th scope="col" className="px-6 py-4 border-r border-slate-200 text-center">Set Stock Level</th>
                        {isOwner && <th scope="col" className="px-6 py-4 border-r border-slate-200 text-right">Unit Cost</th>}
                        <th scope="col" className={`px-6 py-4 text-center ${isOwner ? "border-r border-slate-200" : ""}`}>Status</th>
                        {isOwner && <th scope="col" className="px-6 py-4 text-right">Edit</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-150 font-semibold text-slate-700">
                      {filteredIngredients.map((ing) => renderIngredientRow(ing))}
                    </tbody>
                  </table>
                </DataTableScroll>

                {/* Mobile flat */}
                <div className="xl:hidden grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
                  {filteredIngredients.map((ing) => {
                    const isLow = (ing.available_stock ?? 0) <= (ing.reorder_level ?? 100);
                    const currentVal =
                      adjustQty[ing.id] !== undefined ? adjustQty[ing.id] : ing.available_stock;
                    return (
                      <div
                        key={ing.id}
                        className={`bg-white border-2 border-slate-155 rounded-2xl p-5 space-y-4 shadow-3xs ${isLow ? "border-l-4 border-l-rose-500" : ""}`}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-black text-slate-900 block leading-tight text-base">
                              {ing.name}
                            </span>
                            <span className="text-xs text-slate-400 mt-1 block">
                              Supplier: {ing.supplier?.name || ing.shop || "Generic"}
                            </span>
                          </div>
                          <div className="flex flex-col items-end gap-1.5">
                            {isLow ? (
                              <StatusBadge status="low stock" label="Low Stock" />
                            ) : (
                              <StatusBadge status="healthy" />
                            )}
                            {isOwner && (
                              <span className="text-xs text-slate-500 font-mono font-bold mt-1">
                                {formatCurrency((ing.price ?? 0) / (ing.net_weight || 1))}/{ing.unit}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col gap-3 bg-[#faf8f5] p-3 rounded-xl border border-[#ece5da] sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-xs text-[#2d1f0e] font-bold">
                            Stock:{" "}
                            <span className="font-black text-slate-900 text-sm block md:inline">
                              {ing.available_stock} {ing.unit}
                            </span>
                          </div>
                          <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
                            <NumericQuantityInput
                              value={currentVal}
                              onChange={(quantity) => setAdjustQty({ ...adjustQty, [ing.id]: quantity })}
                              label={`Stock level for ${ing.name}`}
                              min={0}
                              step={100}
                            />
                            <button
                              type="button"
                              onClick={() =>
                                handleApplyAdjustment(ing.id, ing.available_stock, false)
                              }
                              disabled={
                                actionLoading === ing.id ||
                                adjustQty[ing.id] === undefined ||
                                adjustQty[ing.id] === ing.available_stock
                              }
                              aria-label={`Save stock level for ${ing.name}`}
                              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-all duration-150 active:scale-95 ${
                                adjustQty[ing.id] !== undefined &&
                                adjustQty[ing.id] !== ing.available_stock
                                  ? "bg-primary hover:bg-primary-hover text-white opacity-100 scale-100"
                                  : "bg-slate-100 text-slate-300 opacity-0 scale-95 pointer-events-none"
                              }`}
                            >
                              <Save size={12} />
                            </button>
                          </div>
                        </div>
                        <div className="flex justify-between items-center text-xs text-slate-400 pt-2 border-t border-slate-100 font-bold">
                          <span>
                            Category: {ing.category || "Food"} • Brand: {ing.brand || "-"}
                          </span>
                          {isOwner && (
                            <button
                              type="button"
                              onClick={() => onEditIngredient(ing)}
                              className="flex min-h-10 items-center gap-1 text-[#885625] hover:underline"
                            >
                              Edit Ingredient <Edit3 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              /* ── GROUPED BY PRODUCT VIEW ── */
              <div className="divide-y divide-slate-150">
                {ingredientGroups.map((group) => {
                  const expanded = isGroupExpanded(group.productName);
                  const lowCount = group.items.filter(
                    (ing) => (ing.available_stock ?? 0) <= (ing.reorder_level ?? 100)
                  ).length;
                  const groupId = `ingredient-group-${group.productName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

                  return (
                    <div key={group.productName}>
                      {/* Product Group Header — clickable to collapse */}
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.productName)}
                        aria-expanded={expanded}
                        aria-controls={groupId}
                        className="w-full flex items-center justify-between px-6 py-4 bg-gradient-to-r from-[#faf7f3] to-white hover:from-[#f5ede0] transition-all cursor-pointer group"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`p-2 rounded-xl transition-colors ${
                              expanded
                                ? "bg-primary/10 text-primary"
                                : "bg-slate-100 text-slate-400 group-hover:bg-primary/10 group-hover:text-primary"
                            }`}
                          >
                            <Package size={16} />
                          </div>
                          <div className="text-left">
                            <span className="text-sm font-heading font-black text-slate-800 uppercase tracking-wider block">
                              {group.productName}
                            </span>
                            <span className="text-xs text-slate-400 font-bold mt-0.5 block">
                              {group.items.length} ingredient{group.items.length !== 1 ? "s" : ""}
                              {lowCount > 0 && (
                                <span className="ml-2 text-rose-500 font-black">
                                  • {lowCount} low stock
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {lowCount > 0 && (
                            <span className="hidden md:flex items-center gap-1.5 text-xs font-black text-rose-500 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl">
                              ⚠ {lowCount} Low
                            </span>
                          )}
                          {expanded ? (
                            <ChevronDown size={18} className="text-slate-400" />
                          ) : (
                            <ChevronRight size={18} className="text-slate-400" />
                          )}
                        </div>
                      </button>

                      {/* Ingredients Table — collapsible */}
                      {expanded && (
                        <DataTableScroll id={groupId} label={`${group.productName} ingredients`} className="border-t border-slate-100 overflow-x-auto">
                          <table className="w-full min-w-[70rem] text-left border-collapse border border-slate-200 text-sm text-slate-700" aria-label={`${group.productName} ingredients`}>
                            <thead>
                              <tr className="bg-slate-50/70 text-slate-400 font-black uppercase tracking-wider text-[10px]">
                                <th scope="col" className="pl-16 pr-6 py-3 border-r border-slate-200">Ingredient Name</th>
                                <th scope="col" className="px-6 py-3 border-r border-slate-200">Category</th>
                                <th scope="col" className="px-6 py-3 border-r border-slate-200">Supplier</th>
                                <th scope="col" className="px-6 py-3 border-r border-slate-200 text-right">Stock</th>
                                <th scope="col" className="px-6 py-3 border-r border-slate-200 text-center">Adjust</th>
                                {isOwner && (
                                  <th scope="col" className="px-6 py-3 border-r border-slate-200 text-right">Unit Cost</th>
                                )}
                                <th scope="col" className={`px-6 py-3 text-center ${isOwner ? "border-r border-slate-200" : ""}`}>Status</th>
                                {isOwner && (
                                  <th scope="col" className="px-6 py-3 text-right">Edit</th>
                                )}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                              {group.items.map((ing) => {
                                const isLow = (ing.available_stock ?? 0) <= (ing.reorder_level ?? 100);
                                const currentVal =
                                  adjustQty[ing.id] !== undefined
                                    ? adjustQty[ing.id]
                                    : ing.available_stock;
                                return (
                                  <tr
                                    key={ing.id}
                                    className={`hover:bg-slate-50/40 transition-colors ${
                                      isLow ? "bg-rose-50/20" : ""
                                    }`}
                                  >
                                    <td className="pl-16 pr-6 py-3.5 border-r border-slate-200">
                                      <span className="font-black text-slate-800 text-sm block">
                                        {ing.name}
                                      </span>
                                      {ing.brand && (
                                        <span className="text-xs text-slate-400 font-bold mt-0.5 block">
                                          {ing.brand}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-6 py-3.5 border-r border-slate-200 text-slate-400 capitalize text-xs font-bold">
                                      {ing.category || "Food"}
                                    </td>
                                    <td className="px-6 py-3.5 border-r border-slate-200 text-slate-400 font-bold text-xs">
                                      {ing.supplier?.name || ing.shop || "Generic Vendor"}
                                    </td>
                                    <td className="px-6 py-3.5 border-r border-slate-200 text-right font-black text-slate-900 text-sm">
                                      {ing.available_stock} {ing.unit}
                                    </td>
                                    <td className="px-6 py-3.5 border-r border-slate-200">
                                      <div className="flex justify-center items-center gap-2">
                                        <NumericQuantityInput
                                          value={currentVal}
                                          onChange={(quantity) => setAdjustQty({ ...adjustQty, [ing.id]: quantity })}
                                          label={`Stock level for ${ing.name}`}
                                          min={0}
                                          step={100}
                                        />
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleApplyAdjustment(
                                              ing.id,
                                              ing.available_stock,
                                              false
                                            )
                                          }
                                          disabled={
                                            actionLoading === ing.id ||
                                            adjustQty[ing.id] === undefined ||
                                            adjustQty[ing.id] === ing.available_stock
                                          }
                                          aria-label={`Save stock level for ${ing.name}`}
                                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-all duration-150 cursor-pointer ${
                                            adjustQty[ing.id] !== undefined &&
                                            adjustQty[ing.id] !== ing.available_stock
                                              ? "bg-primary hover:bg-primary-hover text-white opacity-100 scale-100"
                                              : "bg-slate-100 text-slate-300 opacity-0 scale-95 pointer-events-none"
                                          }`}
                                        >
                                          <Save size={12} />
                                        </button>
                                      </div>
                                    </td>
                                    {isOwner && (
                                      <td className="px-6 py-3.5 border-r border-slate-200 text-right text-slate-400 font-mono font-bold text-xs">
                                        {formatCurrency((ing.price ?? 0) / (ing.net_weight || 1))} / {ing.unit}
                                      </td>
                                    )}
                                    <td className={`px-6 py-3.5 text-center ${isOwner ? "border-r border-slate-200" : ""}`}>
                                      {isLow ? (
                                        <StatusBadge status="low stock" label="Low Stock" />
                                      ) : (
                                        <StatusBadge status="healthy" />
                                      )}
                                    </td>
                                    {isOwner && (
                                      <td className="px-6 py-3.5 text-right">
                                        <Button
                                          onClick={() => onEditIngredient(ing)}
                                          size="sm"
                                          variant="outline"
                                          className="h-8 px-2.5 hover:bg-slate-100 text-xs"
                                          leftIcon={<Edit3 size={12} />}
                                        >
                                          Edit
                                        </Button>
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </DataTableScroll>
                      )}
                    </div>
                  );
                })}

                {/* Ungrouped ingredients (not tied to any product recipe) */}
                {ungroupedIngredients.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => toggleGroup("__ungrouped__")}
                      aria-expanded={isGroupExpanded("__ungrouped__")}
                      aria-controls="ingredient-group-unassigned"
                      className="w-full flex items-center justify-between px-6 py-4 bg-gradient-to-r from-slate-50 to-white hover:from-slate-100 transition-all cursor-pointer group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-slate-100 text-slate-400 group-hover:bg-slate-200 transition-colors">
                          <Package size={16} />
                        </div>
                        <div className="text-left">
                          <span className="text-sm font-heading font-black text-slate-500 uppercase tracking-wider block">
                            Other / Unassigned
                          </span>
                          <span className="text-xs text-slate-400 font-bold mt-0.5 block">
                            {ungroupedIngredients.length} ingredient
                            {ungroupedIngredients.length !== 1 ? "s" : ""} not linked to a recipe
                          </span>
                        </div>
                      </div>
                      {isGroupExpanded("__ungrouped__") ? (
                        <ChevronDown size={18} className="text-slate-400" />
                      ) : (
                        <ChevronRight size={18} className="text-slate-400" />
                      )}
                    </button>

                    {isGroupExpanded("__ungrouped__") && (
                      <DataTableScroll id="ingredient-group-unassigned" label="Unassigned ingredients" className="border-t border-slate-100 overflow-x-auto">
                        <table className="w-full min-w-[70rem] text-left border-collapse text-sm text-slate-700" aria-label="Unassigned ingredients">
                          <thead>
                            <tr className="bg-slate-50/70 text-slate-400 font-black uppercase tracking-wider text-[10px]">
                              <th scope="col" className="pl-16 pr-6 py-3">Ingredient Name</th>
                              <th scope="col" className="px-6 py-3">Category</th>
                              <th scope="col" className="px-6 py-3">Supplier</th>
                              <th scope="col" className="px-6 py-3 text-right">Stock</th>
                              <th scope="col" className="px-6 py-3 text-center">Adjust</th>
                              {isOwner && (
                                <th scope="col" className="px-6 py-3 text-right">Unit Cost</th>
                              )}
                              <th scope="col" className="px-6 py-3 text-center">Status</th>
                              {isOwner && (
                                <th scope="col" className="px-6 py-3 text-right">Edit</th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                            {ungroupedIngredients.map((ing) => {
                              const isLow =
                                (ing.available_stock ?? 0) <= (ing.reorder_level ?? 100);
                              const currentVal =
                                adjustQty[ing.id] !== undefined
                                  ? adjustQty[ing.id]
                                  : ing.available_stock;
                              return (
                                <tr
                                  key={ing.id}
                                  className={`hover:bg-slate-50/40 transition-colors ${
                                    isLow ? "bg-rose-50/20" : ""
                                  }`}
                                >
                                  <td className="pl-16 pr-6 py-3.5">
                                    <span className="font-black text-slate-800 text-sm block">
                                      {ing.name}
                                    </span>
                                    {ing.brand && (
                                      <span className="text-xs text-slate-400 font-bold mt-0.5 block">
                                        {ing.brand}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-6 py-3.5 text-slate-400 capitalize text-xs font-bold">
                                    {ing.category || "Food"}
                                  </td>
                                  <td className="px-6 py-3.5 text-slate-400 font-bold text-xs">
                                    {ing.supplier?.name || ing.shop || "Generic Vendor"}
                                  </td>
                                  <td className="px-6 py-3.5 text-right font-black text-slate-900 text-sm">
                                    {ing.available_stock} {ing.unit}
                                  </td>
                                  <td className="px-6 py-3.5">
                                    <div className="flex justify-center items-center gap-2">
                                      <NumericQuantityInput
                                        value={currentVal}
                                        onChange={(quantity) => setAdjustQty({ ...adjustQty, [ing.id]: quantity })}
                                        label={`Stock level for ${ing.name}`}
                                        min={0}
                                        step={100}
                                      />
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleApplyAdjustment(ing.id, ing.available_stock, false)
                                        }
                                        disabled={
                                          actionLoading === ing.id ||
                                          adjustQty[ing.id] === undefined ||
                                          adjustQty[ing.id] === ing.available_stock
                                        }
                                        aria-label={`Save stock level for ${ing.name}`}
                                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-all duration-150 cursor-pointer ${
                                          adjustQty[ing.id] !== undefined &&
                                          adjustQty[ing.id] !== ing.available_stock
                                            ? "bg-primary hover:bg-primary-hover text-white opacity-100 scale-100"
                                            : "bg-slate-100 text-slate-300 opacity-0 scale-95 pointer-events-none"
                                        }`}
                                      >
                                        <Save size={12} />
                                      </button>
                                    </div>
                                  </td>
                                  {isOwner && (
                                    <td className="px-6 py-3.5 text-right text-slate-400 font-mono font-bold text-xs">
                                      {formatCurrency((ing.price ?? 0) / (ing.net_weight || 1))} / {ing.unit}
                                    </td>
                                  )}
                                  <td className="px-6 py-3.5 text-center">
                                    {isLow ? (
                                      <StatusBadge status="low stock" label="Low Stock" />
                                    ) : (
                                      <StatusBadge status="healthy" />
                                    )}
                                  </td>
                                  {isOwner && (
                                    <td className="px-6 py-3.5 text-right">
                                      <Button
                                        onClick={() => onEditIngredient(ing)}
                                        size="sm"
                                        variant="outline"
                                        className="h-8 px-2.5 hover:bg-slate-100 text-xs"
                                        leftIcon={<Edit3 size={12} />}
                                      >
                                        Edit
                                      </Button>
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </DataTableScroll>
                    )}
                  </div>
                )}
              </div>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
