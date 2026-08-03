import React, { useState } from "react";
import { Search, Check, AlertTriangle, Gift } from "lucide-react";
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
  TableCell,
  TableEmptyState,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
} from "@/components/ui/DataTable";
import { NumericQuantityInput } from "@/components/ui/NumericQuantityInput";
import { api, type ProductSKUOut } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { canDisplayMarketEventCatalogProduct } from "@/lib/marketEventForm";
import { GiftSetBuilderModal, type GiftSetCustomPayload } from "@/components/inventory/GiftSetBuilderModal";

interface InventoryChecklistProps {
  products: ProductSKUOut[];
  allocations: { sku: string; quantity: number }[];
  setAllocations: (a: { sku: string; quantity: number }[]) => void;
  mode?: "planning" | "active";
  originalAllocations?: Array<{
    sku: string;
    quantity?: number;
    remaining_quantity?: number;
    sold_quantity?: number;
  }>;
  onRefreshProducts?: () => void;
  disabled?: boolean;
}

export function InventoryChecklist({
  products,
  allocations,
  setAllocations,
  mode = "planning",
  originalAllocations = [],
  onRefreshProducts,
  disabled,
}: InventoryChecklistProps) {
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("All");
  const isActiveRestock = mode === "active";
  const [selectedOnly, setSelectedOnly] = useState(isActiveRestock);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [isGiftSetModalOpen, setIsGiftSetModalOpen] = useState(false);

  const handleSaveCustomGiftSet = async (payload: GiftSetCustomPayload) => {
    try {
      const res = await api.createGiftSet({
        name: payload.name,
        retail_price: payload.totalRetailPrice,
        reseller_price: payload.resellerPrice,
        packaging_cost: payload.packagingCost,
        notes: payload.notes,
        items: payload.items.map(i => ({ sku: i.sku, quantity: i.quantity })),
      });
      const generatedSku = `GS-${res.id}`;
      const existing = allocations.find(a => a.sku === generatedSku);
      if (existing) {
        setAllocations(allocations.map(a => a.sku === generatedSku ? { ...a, quantity: a.quantity + 5 } : a));
      } else {
        setAllocations([...allocations, { sku: generatedSku, quantity: 5 }]);
      }
      if (onRefreshProducts) {
        onRefreshProducts();
      }
    } catch (err: unknown) {
      alert(`Could not create custom gift set: ${getErrorMessage(err)}`);
    }
  };

  const allocMap = Object.fromEntries(allocations.map((a) => [a.sku, a.quantity]));
  const allocatedSkus = new Set(
    allocations.map((allocation) => allocation.sku.trim().toLowerCase()),
  );
  const originalAllocationMap = new Map(
    originalAllocations.map((allocation) => [
      allocation.sku,
      {
        remaining: Number(
          allocation.remaining_quantity ?? allocation.quantity ?? 0,
        ),
        sold: Number(allocation.sold_quantity ?? 0),
      },
    ]),
  );

  // Include all current lineup active products so staff can view and allocate any product
  const eligible = products.filter((p) => {
    if (!isCurrentLineupProduct(p)) return false;
    if (p.sku === "SKU") return false;
    if (!canDisplayMarketEventCatalogProduct(p, allocatedSkus)) return false;
    return true;
  });

  const categories = [
    "All",
    ...BUSINESS_CATEGORIES,
  ];

  const filtered = eligible.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      p.product_name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q);
    const matchCat =
      filterCat === "All" || getProductBusinessCategory(p) === filterCat;
    const matchSelected = !selectedOnly || allocMap[p.sku] !== undefined;

    const warehouseStock = p.warehouse_stock ?? 0;
    const reservedOther = p.reserved_stock ?? 0;
    const available = p.available_stock ?? Math.max(0, warehouseStock - reservedOther);
    const matchInStock = !inStockOnly || available > 0 || allocMap[p.sku] !== undefined;

    return matchSearch && matchCat && matchSelected && matchInStock;
  });

  const handleCheck = (sku: string, available: number) => {
    if (allocMap[sku] !== undefined) {
      const soldQuantity = originalAllocationMap.get(sku)?.sold ?? 0;
      if (isActiveRestock && soldQuantity > 0) {
        setAllocations(
          allocations.map((allocation) => (
            allocation.sku === sku
              ? { ...allocation, quantity: 0 }
              : allocation
          )),
        );
        return;
      }
      setAllocations(allocations.filter((a) => a.sku !== sku));
    } else {
      const defaultQty = available > 0 ? Math.min(12, available) : 1;
      setAllocations([...allocations, { sku, quantity: defaultQty }]);
    }
  };

  const handleQtyChange = (sku: string, qty: number) => {
    const clamped = Math.max(isActiveRestock ? 0 : 1, qty);
    setAllocations(
      allocations.map((a) => (a.sku === sku ? { ...a, quantity: clamped } : a))
    );
  };

  const selectedCount = allocations.length;
  const totalUnits = allocations.reduce((s, a) => s + (Number(a.quantity) || 0), 0);

  return (
    <div className="space-y-3">
      {isActiveRestock ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          <p className="font-black">Update what is physically at the booth now</p>
          <p className="mt-1 text-xs font-semibold leading-relaxed text-blue-800">
            Enter the remaining units counted at the booth. Increases send stock from the
            Main Facility; decreases return stock. Products with sales stay in the event
            history even when their remaining count is zero.
          </p>
        </div>
      ) : null}

      {/* Toolbar Row 1: Search & Action Buttons */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 min-w-0">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            placeholder="Search product name or SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search available products by name or SKU"
            style={{ paddingLeft: "2.25rem" }}
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pr-3 text-xs font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setInStockOnly((current) => !current)}
            aria-pressed={inStockOnly}
            className={`h-10 rounded-xl border px-3 text-[11px] sm:text-xs font-black uppercase tracking-wide transition-colors cursor-pointer ${
              inStockOnly
                ? "border-emerald-700 bg-emerald-700 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            In-Stock Only
          </button>

          <button
            type="button"
            onClick={() => setSelectedOnly((current) => !current)}
            aria-pressed={selectedOnly}
            className={`h-10 rounded-xl border px-3 text-[11px] sm:text-xs font-black uppercase tracking-wide transition-colors cursor-pointer ${
              selectedOnly
                ? "border-primary bg-primary text-white"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            Selected only
          </button>

          <button
            type="button"
            onClick={() => setIsGiftSetModalOpen(true)}
            className="h-10 rounded-xl border border-amber-300 bg-amber-50 px-3 text-[11px] sm:text-xs font-black uppercase tracking-wider text-amber-950 hover:bg-amber-100 transition-all cursor-pointer flex items-center gap-1.5"
          >
            <Gift size={14} className="text-amber-800 shrink-0" />
            <span>Build Gift Set</span>
          </button>
        </div>
      </div>

      {/* Toolbar Row 2: Category Filter Pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 max-w-full">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setFilterCat(cat)}
            aria-pressed={filterCat === cat}
            className={`h-10 whitespace-nowrap rounded-xl px-3 py-1 text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer ${
              filterCat === cat
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Summary badge */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-xl text-xs font-bold text-primary animate-fade-in">
          <Check size={13} className="stroke-[3]" />
          {selectedCount} product{selectedCount !== 1 ? "s" : ""} {isActiveRestock ? "tracked" : "selected"}
          {" · "}
          {totalUnits} {isActiveRestock ? "units at booth" : "planned units"}
        </div>
      )}

      {/* Phone-first cards avoid forcing cashiers through a wide planning table. */}
      <div className="space-y-2 md:hidden" aria-label="Products available for allocation">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
            <p className="font-bold text-slate-800">No matching products</p>
            <p className="mt-1 text-sm text-slate-500">Clear the search or choose another category.</p>
          </div>
        ) : (
          filtered.map((product) => {
            const warehouseStock = product.warehouse_stock ?? 0;
            const reservedOther = product.reserved_stock ?? 0;
            const available = product.available_stock
              ?? Math.max(0, warehouseStock - reservedOther);
            const isChecked = allocMap[product.sku] !== undefined;
            const isOutOfStock = available <= 0;
            const original = originalAllocationMap.get(product.sku);
            const soldQuantity = original?.sold ?? 0;
            const originalRemaining = original?.remaining ?? 0;
            const desiredRemaining = Number(allocMap[product.sku] ?? 0);
            const stockDelta = desiredRemaining - originalRemaining;
            const soldHistoryLocked = isActiveRestock && soldQuantity > 0;
            const inactiveAllocationLocked = product.is_active === false && isChecked;

            return (
              <section
                key={product.sku}
                className={`rounded-2xl border p-3 ${
                  isChecked
                    ? "border-primary/40 bg-primary/5"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    id={`alloc-mobile-${product.sku}`}
                    type="checkbox"
                    checked={isChecked}
                    disabled={
                      disabled
                      || soldHistoryLocked
                      || (isActiveRestock && isOutOfStock && !isChecked)
                    }
                    onChange={() => handleCheck(product.sku, available)}
                    aria-label={`Select ${product.product_name}`}
                    className="mt-2 h-6 w-6 shrink-0 rounded accent-primary cursor-pointer disabled:cursor-not-allowed"
                  />
                  <label htmlFor={`alloc-mobile-${product.sku}`} className="min-w-0 flex-1 cursor-pointer">
                    <ProductDisplay
                      sku={product.sku}
                      productName={product.product_name}
                      category={product.category}
                      size={product.size}
                      isActive={product.is_active}
                      variant="compact"
                      showIcon={false}
                    />
                  </label>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    <span className="block text-[10px] font-black uppercase tracking-wide text-slate-500">
                      Warehouse available
                    </span>
                    <span className={`font-mono font-black tabular-nums ${available <= 0 ? "text-rose-600" : "text-slate-900"}`}>
                      {formatProductQuantity(product, available)}
                    </span>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    <span className="block text-[10px] font-black uppercase tracking-wide text-slate-500">
                      {isActiveRestock ? "Sold at event" : "Held elsewhere"}
                    </span>
                    <span className="font-mono font-black tabular-nums text-slate-900">
                      {formatProductQuantity(
                        product,
                        isActiveRestock ? soldQuantity : reservedOther,
                      )}
                    </span>
                  </div>
                </div>

                {isOutOfStock && !isChecked ? (
                  <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                    <AlertTriangle size={16} aria-hidden="true" className="shrink-0" />
                    Currently 0 in warehouse. Select to include in event allocation.
                  </div>
                ) : null}

                {isChecked ? (
                  <div className="mt-3 flex flex-col gap-2 border-t border-slate-200/80 pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-black uppercase tracking-wide text-slate-600">
                        {isActiveRestock ? "Remaining at booth now" : "Quantity to bring"}
                      </span>
                      {isActiveRestock ? (
                        <span
                          className={`rounded-full px-2 py-1 text-[10px] font-black ${
                            stockDelta > 0
                              ? "bg-blue-100 text-blue-800"
                              : stockDelta < 0
                                ? "bg-amber-100 text-amber-800"
                                : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {stockDelta > 0
                            ? `Send +${stockDelta}`
                            : stockDelta < 0
                              ? `Return ${Math.abs(stockDelta)}`
                              : "No stock change"}
                        </span>
                      ) : null}
                    </div>
                    <NumericQuantityInput
                      value={Number(allocMap[product.sku] ?? 0)}
                      onChange={(quantity) => handleQtyChange(product.sku, quantity)}
                      label={`${isActiveRestock ? "Remaining booth quantity" : "Quantity to allocate"} for ${product.product_name}`}
                      min={isActiveRestock ? 0 : 1}
                      max={inactiveAllocationLocked
                        ? originalRemaining
                        : isActiveRestock
                          ? originalRemaining + available
                          : available}
                      disabled={disabled}
                      className="w-full justify-between"
                    />
                    {soldHistoryLocked ? (
                      <p className="text-[11px] font-semibold text-slate-500">
                        Kept in this event because {formatProductQuantity(product, soldQuantity)} sold.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </section>
            );
          })
        )}
      </div>

      {/* Checklist table */}
      <DataTableShell className="hidden md:block">
        <DataTableScroll label="Products available for allocation">
          <table className="w-full min-w-[44rem] text-left border-collapse text-xs" aria-label="Products available for allocation">
            <thead>
              <TableHeaderRow>
                <TableHeaderCell className="w-10 px-2 py-1.5"><span className="sr-only">Select</span></TableHeaderCell>
                <TableHeaderCell className="px-2.5 py-1.5">Product</TableHeaderCell>
                <TableHeaderCell align="center" className="px-2.5 py-1.5">Warehouse Available</TableHeaderCell>
                <TableHeaderCell align="center" className="px-2.5 py-1.5">
                  {isActiveRestock ? "Sold at Event" : "Held Elsewhere"}
                </TableHeaderCell>
                <TableHeaderCell align="center" className="w-44 px-2.5 py-1.5">
                  {isActiveRestock ? "Remaining at Booth" : "Qty to Allocate"}
                </TableHeaderCell>
              </TableHeaderRow>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <TableEmptyState colSpan={5} title="No matching products" description="Clear search or filter." />
              ) : (
                filtered.map((p) => {
                  const warehouseStock = p.warehouse_stock ?? 0;
                  const reservedOther = p.reserved_stock ?? 0;
                  const available = p.available_stock
                    ?? Math.max(0, warehouseStock - reservedOther);
                  const isChecked = allocMap[p.sku] !== undefined;
                  const original = originalAllocationMap.get(p.sku);
                  const soldQuantity = original?.sold ?? 0;
                  const originalRemaining = original?.remaining ?? 0;
                  const desiredRemaining = Number(allocMap[p.sku] ?? 0);
                  const stockDelta = desiredRemaining - originalRemaining;
                  const soldHistoryLocked = isActiveRestock && soldQuantity > 0;
                  const inactiveAllocationLocked = p.is_active === false && isChecked;

                  return (
                    <TableRow
                      key={p.sku}
                      className={`transition-colors ${
                        isChecked ? "bg-primary/5 font-semibold" : "hover:bg-slate-50/60"
                      }`}
                    >
                      <TableCell className="w-10 px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={
                            disabled
                            || soldHistoryLocked
                            || (isActiveRestock && available <= 0 && !isChecked)
                          }
                          onChange={() => handleCheck(p.sku, available)}
                          aria-label={`Select ${p.product_name}`}
                          className="h-6 w-6 rounded accent-primary cursor-pointer align-middle disabled:cursor-not-allowed"
                        />
                      </TableCell>
                      <TableCell className="px-2.5 py-1.5">
                        <ProductDisplay
                          sku={p.sku}
                          productName={p.product_name}
                          category={p.category}
                          size={p.size}
                          isActive={p.is_active}
                          variant="compact"
                          showIcon={false}
                        />
                      </TableCell>
                      <TableCell align="center" className="px-2.5 py-1.5 font-mono text-xs tabular-nums">
                        <span className={`font-bold ${available <= 0 ? "text-rose-600 font-extrabold" : "text-slate-700"}`}>
                          {formatProductQuantity(p, available)}
                        </span>
                      </TableCell>
                      <TableCell align="center" className="px-2.5 py-1.5 font-mono text-xs tabular-nums">
                        {(isActiveRestock ? soldQuantity : reservedOther) > 0 ? (
                          <span className="text-[11px] font-black text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-lg font-mono">
                            {formatProductQuantity(
                              p,
                              isActiveRestock ? soldQuantity : reservedOther,
                            )} {isActiveRestock ? "sold" : "held"}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-300 font-semibold">—</span>
                        )}
                      </TableCell>
                      <TableCell align="center" className="px-2.5 py-1.5">
                        {isChecked ? (
                          <div className="flex flex-col items-center gap-1.5">
                            <NumericQuantityInput
                              value={Number(allocMap[p.sku] ?? 0)}
                              onChange={(quantity) => handleQtyChange(p.sku, quantity)}
                              label={`${isActiveRestock ? "Remaining booth quantity" : "Quantity to allocate"} for ${p.product_name}`}
                              min={isActiveRestock ? 0 : 1}
                              max={inactiveAllocationLocked
                                ? originalRemaining
                                : isActiveRestock
                                  ? originalRemaining + available
                                  : available}
                              disabled={disabled}
                              size="sm"
                              className="justify-center"
                            />
                            {isActiveRestock ? (
                              <span
                                className={`text-[10px] font-black ${
                                  stockDelta > 0
                                    ? "text-blue-700"
                                    : stockDelta < 0
                                      ? "text-amber-700"
                                      : "text-slate-400"
                                }`}
                              >
                                {stockDelta > 0
                                  ? `Send +${stockDelta}`
                                  : stockDelta < 0
                                    ? `Return ${Math.abs(stockDelta)}`
                                    : soldHistoryLocked
                                      ? "History retained"
                                      : "No change"}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="block text-center text-slate-300 text-[11px] font-semibold">
                            —
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </tbody>
          </table>
        </DataTableScroll>
      </DataTableShell>

      <GiftSetBuilderModal
        isOpen={isGiftSetModalOpen}
        onClose={() => setIsGiftSetModalOpen(false)}
        products={products}
        onSaveGiftSet={handleSaveCustomGiftSet}
        title="Build Custom Gift Set for Market Event"
      />
    </div>
  );
}
