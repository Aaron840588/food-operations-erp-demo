import React, { useState } from "react";
import { Search, Check } from "lucide-react";
import {
  BUSINESS_CATEGORIES,
  formatProductQuantity,
  getProductBusinessCategory,
  isCurrentLineupProduct,
} from "@/lib/utils";
import { ProductDisplay } from "@/components/ui/ProductDisplay";
import {
  DataTableScroll,
  DataTableShell,
  TableEmptyState,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
} from "@/components/ui/DataTable";
import { NumericQuantityInput } from "@/components/ui/NumericQuantityInput";
import type { ProductSKUOut } from "@/lib/api";

interface InventoryChecklistProps {
  products: ProductSKUOut[];
  allocations: { sku: string; quantity: number }[];
  setAllocations: (a: { sku: string; quantity: number }[]) => void;
  disabled?: boolean;
}

export function InventoryChecklist({
  products,
  allocations,
  setAllocations,
  disabled,
}: InventoryChecklistProps) {
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("All");

  // Eligible products: active + warehouse_stock > 0
  const eligible = products.filter((p) => {
    if (!isCurrentLineupProduct(p)) return false;
    if (p.sku === "SKU") return false;
    if (p.is_active === false) return false;
    const stock = p.warehouse_stock ?? 0;
    return stock > 0;
  });

  const categories = [
    "All",
    ...BUSINESS_CATEGORIES.filter((category) =>
      eligible.some((product) => getProductBusinessCategory(product) === category)
    ),
  ];

  const filtered = eligible.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      p.product_name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q);
    const matchCat =
      filterCat === "All" || getProductBusinessCategory(p) === filterCat;
    return matchSearch && matchCat;
  });

  const allocMap = Object.fromEntries(allocations.map((a) => [a.sku, a.quantity]));

  const handleCheck = (sku: string, available: number) => {
    if (allocMap[sku] !== undefined) {
      // Uncheck: remove
      setAllocations(allocations.filter((a) => a.sku !== sku));
    } else {
      // Check: add with default qty = min(12, available)
      const defaultQty = Math.min(12, available > 0 ? available : 1);
      setAllocations([...allocations, { sku, quantity: defaultQty }]);
    }
  };

  const handleQtyChange = (sku: string, qty: number, available: number) => {
    const clamped = Math.min(Math.max(1, qty), available > 0 ? available : qty);
    setAllocations(
      allocations.map((a) => (a.sku === sku ? { ...a, quantity: clamped } : a))
    );
  };

  const selectedCount = allocations.length;
  const totalUnits = allocations.reduce((s, a) => s + (Number(a.quantity) || 0), 0);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            placeholder="Search product name or SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search available products by name or SKU"
            style={{ paddingLeft: "2.5rem" }}
            className="w-full pr-3 h-9 text-xs font-semibold bg-white border border-slate-200 rounded-xl outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setFilterCat(cat)}
              aria-pressed={filterCat === cat}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider whitespace-nowrap transition-all ${
                filterCat === cat
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Summary badge */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-xl text-xs font-bold text-primary animate-fade-in">
          <Check size={13} className="stroke-[3]" />
          {selectedCount} product{selectedCount !== 1 ? "s" : ""} selected · {totalUnits} total units reserved
        </div>
      )}

      {/* Checklist table */}
      <DataTableShell className="max-h-96 overflow-y-auto">
        <DataTableScroll label="Products available for allocation" className="overflow-x-auto">
        <table className="w-full min-w-[48rem] text-left border-collapse text-xs" aria-label="Products available for allocation">
          <thead className="sticky top-0 z-10">
            <TableHeaderRow>
              <TableHeaderCell className="w-12 px-3 py-2.5"><span className="sr-only">Select</span></TableHeaderCell>
              <TableHeaderCell className="px-3 py-2.5">Product</TableHeaderCell>
              <TableHeaderCell align="right" className="px-3 py-2.5">Available</TableHeaderCell>
              <TableHeaderCell align="right" className="px-3 py-2.5">Reserved by others</TableHeaderCell>
              <TableHeaderCell align="center" className="w-52 px-3 py-2.5">Qty to Allocate</TableHeaderCell>
            </TableHeaderRow>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <TableEmptyState colSpan={5} title="No matching products" description="Clear the search or choose another category." />
            ) : (
              filtered.map((p) => {
                const warehouseStock = p.warehouse_stock ?? 0;
                const reservedOther = p.reserved_stock ?? 0;
                const available =
                  p.available_stock ?? Math.max(0, warehouseStock - reservedOther);
                const isChecked = allocMap[p.sku] !== undefined;
                const isOutOfStock = available <= 0;

                return (
                  <TableRow
                    key={p.sku}
                    className={`transition-colors ${
                      isChecked
                        ? "bg-primary/5 border-l-2 border-l-primary"
                        : "hover:bg-slate-50/50"
                    } ${isOutOfStock && !isChecked ? "opacity-50" : ""}`}
                  >
                    <td className="px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={disabled || (isOutOfStock && !isChecked)}
                        onChange={() => handleCheck(p.sku, available)}
                        className="w-4 h-4 rounded accent-primary cursor-pointer disabled:cursor-not-allowed"
                        id={`alloc-check-${p.sku}`}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <label htmlFor={`alloc-check-${p.sku}`} className="cursor-pointer">
                        <ProductDisplay
                          sku={p.sku}
                          productName={p.product_name}
                          category={p.category}
                          size={p.size}
                          isActive={p.is_active}
                          variant="compact"
                          showIcon={false}
                        />
                        {isOutOfStock && (
                          <span className="mt-1 block text-[10px] font-black text-rose-500">OUT OF STOCK</span>
                        )}
                      </label>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span
                        className={`inline-block font-black font-mono text-[11px] px-2 py-0.5 rounded-lg ${
                          available > 0
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                            : "bg-rose-50 text-rose-600 border border-rose-100"
                        }`}
                      >
                        {formatProductQuantity(p, available)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {reservedOther > 0 ? (
                        <span className="text-[11px] font-black text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-lg font-mono">
                          {formatProductQuantity(p, reservedOther)} held
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-300 font-semibold">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {isChecked ? (
                        <NumericQuantityInput
                          value={Number(allocMap[p.sku]) || 1}
                          onChange={(quantity) => handleQtyChange(p.sku, quantity, available)}
                          label={`Quantity to allocate for ${p.product_name}`}
                          min={1}
                          max={available > 0 ? available : undefined}
                          disabled={disabled}
                          className="justify-center"
                        />
                      ) : (
                        <span className="block text-center text-slate-300 text-[11px] font-semibold">
                          —
                        </span>
                      )}
                    </td>
                  </TableRow>
                );
              })
            )}
          </tbody>
        </table>
        </DataTableScroll>
      </DataTableShell>
    </div>
  );
}
