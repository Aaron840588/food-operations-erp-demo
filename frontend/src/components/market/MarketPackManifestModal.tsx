"use client";

import React, { useState, useEffect } from "react";
import { Printer, CheckCircle2, AlertTriangle, Package, Calendar, MapPin, User, Check, RefreshCw } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ProductDisplay } from "@/components/ui/ProductDisplay";
import { formatDate, formatProductQuantity } from "@/lib/utils";
import { api, type WarehouseStockOut } from "@/lib/api";

interface AllocationItem {
  id: number;
  sku: string;
  product_name?: string;
  category?: string;
  size?: string;
  quantity: number;
  remaining_quantity?: number;
  unit_of_measure?: string;
}

interface MarketEventData {
  id: number;
  name: string;
  event_date: string;
  location: string;
  staff_assigned?: string;
  allocations: AllocationItem[];
}

interface MarketPackManifestModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: MarketEventData | null;
}

export function MarketPackManifestModal({
  isOpen,
  onClose,
  event,
}: MarketPackManifestModalProps) {
  const [warehouseStocks, setWarehouseStocks] = useState<WarehouseStockOut[]>([]);
  const [loadingStocks, setLoadingStocks] = useState(false);
  const [packedItems, setPackedItems] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let isMounted = true;
    if (isOpen && event) {
      api.getWarehouseStocks()
        .then((stocks) => {
          if (isMounted) {
            setWarehouseStocks(stocks || []);
          }
        })
        .catch((err) => console.error("Error fetching warehouse stock for pack manifest:", err))
        .finally(() => {
          if (isMounted) {
            setLoadingStocks(false);
          }
        });
    }
    return () => {
      isMounted = false;
    };
  }, [isOpen, event]);

  if (!event) return null;

  // Build a lookup map of WH1 / Main Facility stock by SKU
  const mainFacilityStockBySku = new Map<string, number>();
  warehouseStocks.forEach((item) => {
    if (item.sku && (item.warehouse_id === 1 || item.warehouse_name?.toLowerCase().includes("main"))) {
      mainFacilityStockBySku.set(item.sku, item.quantity);
    }
  });

  const togglePacked = (sku: string) => {
    setPackedItems((prev) => ({
      ...prev,
      [sku]: !prev[sku],
    }));
  };

  const packedCount = event.allocations.filter((a) => packedItems[a.sku]).length;
  const totalCount = event.allocations.length;
  const isAllPacked = totalCount > 0 && packedCount === totalCount;

  const handlePrint = () => {
    window.print();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Event Stock Loadout & Pack Manifest"
      size="4xl"
    >
      <div className="space-y-6 text-xs font-semibold text-slate-600 print:text-black">
        {/* Header Manifest Card */}
        <div className="flex flex-col sm:flex-row justify-between items-start border-b-2 border-slate-200 pb-4 gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Package className="text-[#885625] h-5 w-5" />
              <h2 className="text-lg font-heading font-black text-slate-900 uppercase tracking-wide">
                {event.name}
              </h2>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-1 font-bold">
              EVENT ID #{event.id} &bull; PACKING MANIFEST
            </p>
          </div>

          <div className="flex items-center gap-2 print:hidden">
            <Button
              onClick={handlePrint}
              variant="outline"
              size="sm"
              className="h-9 font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="h-4 w-4" /> Print Manifest
            </Button>
          </div>
        </div>

        {/* Event Details Ribbon */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-amber-800 shrink-0" />
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-black block">Event Date</span>
              <span className="font-mono text-sm font-black text-slate-800">{formatDate(event.event_date)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-[#885625] shrink-0" />
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-bold block">Location</span>
              <span className="text-sm font-bold text-slate-800 truncate">{event.location}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-[#885625] shrink-0" />
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-bold block">Assigned Staff</span>
              <span className="text-sm font-bold text-slate-800">{event.staff_assigned || "Unassigned"}</span>
            </div>
          </div>
        </div>

        {/* Loadout Progress Indicator */}
        <div className="bg-emerald-50/60 border border-emerald-200 p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 print:hidden">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${isAllPacked ? "bg-emerald-600 text-white" : "bg-emerald-100 text-emerald-800"}`}>
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <span className="text-sm font-black text-emerald-950 block">
                {isAllPacked ? "100% Fully Packed & Loaded!" : `Packing Progress: ${packedCount} of ${totalCount} SKUs Checked`}
              </span>
              <span className="text-xs text-emerald-700 font-semibold">
                Check off items as crates/coolers are verified and loaded into transport.
              </span>
            </div>
          </div>
          {loadingStocks && (
            <span className="text-xs text-slate-400 font-bold flex items-center gap-1">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Verifying WH1 Stock...
            </span>
          )}
        </div>

        {/* Inventory Loadout Table */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-600 font-black uppercase text-[10px]">
                <th scope="col" className="px-3 py-3 text-center w-12 print:hidden">Packed</th>
                <th scope="col" className="px-4 py-3">Product Item</th>
                <th scope="col" className="px-4 py-3 text-right">Target Allocated Qty</th>
                <th scope="col" className="px-4 py-3 text-right">Main Facility Stock</th>
                <th scope="col" className="px-4 py-3 text-center">Load Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
              {event.allocations.map((alloc) => {
                const wh1Available = mainFacilityStockBySku.get(alloc.sku) ?? 0;
                const targetQty = alloc.quantity;
                const isShortage = wh1Available < targetQty;
                const isChecked = Boolean(packedItems[alloc.sku]);

                return (
                  <tr
                    key={alloc.id}
                    className={`transition-colors hover:bg-slate-50/50 ${isChecked ? "bg-emerald-50/30" : ""}`}
                  >
                    <td className="px-3 py-3 text-center print:hidden">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => togglePacked(alloc.sku)}
                        className="h-5 w-5 accent-emerald-600 cursor-pointer rounded"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <ProductDisplay
                        sku={alloc.sku}
                        productName={alloc.product_name || alloc.sku}
                        category={alloc.category || ""}
                        size={alloc.size || ""}
                        variant="compact"
                      />
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-black text-slate-900">
                      {formatProductQuantity(alloc, targetQty)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      <span className={isShortage ? "text-amber-700 font-black" : "text-slate-600 font-bold"}>
                        {formatProductQuantity(alloc, wh1Available)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isChecked ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-100/80 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase">
                          <Check className="h-3 w-3" /> Packed
                        </span>
                      ) : isShortage ? (
                        <span className="inline-flex items-center gap-1 text-amber-800 bg-amber-100 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase">
                          <AlertTriangle className="h-3 w-3" /> Short by {targetQty - wh1Available}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase">
                          Ready to Load
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer Actions */}
        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4 print:hidden">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={onClose}
            className="h-11 px-6 font-bold cursor-pointer"
          >
            Close Manifest
          </Button>
        </div>
      </div>
    </Modal>
  );
}
