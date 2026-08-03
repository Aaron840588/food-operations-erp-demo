import React, { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import {
  DataTableScroll,
  TableEmptyState,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
} from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { api, type DraftPurchaseOrderOut, type MrpProjectionOut, type SupplierOut } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { formatCurrency } from "@/lib/utils";

interface MrpForecastProps {
  mrpProjections: MrpProjectionOut[];
  suppliers: SupplierOut[];
  onRefresh: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function MrpForecast({ mrpProjections, suppliers, onRefresh: _onRefresh }: MrpForecastProps) {
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [draftPo, setDraftPo] = useState<DraftPurchaseOrderOut | null>(null);
  const [generating, setGenerating] = useState(false);

  const handleGeneratePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplierId) {
      alert("Please select a supplier.");
      return;
    }
    
    const items = mrpProjections
      .filter(p => p.supplier_id === parseInt(selectedSupplierId) && p.suggested_replenishment > 0)
      .map(p => ({
        ingredient_id: p.ingredient_id,
        quantity: p.suggested_replenishment
      }));
      
    if (items.length === 0) {
      alert("No items require replenishment for this supplier.");
      return;
    }
    
    setGenerating(true);
    try {
      const res = await api.generateDraftPo({
        supplier_id: parseInt(selectedSupplierId),
        items
      });
      setDraftPo(res);
    } catch (err: unknown) {
      alert(getErrorMessage(err, "Failed to generate Purchase Order"));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      {/* Depletion table */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Material Burn Analysis (30-Day Projections)</CardTitle>
          <CardDescription>Forecasts stock exhaustion date based on actual kitchen usages</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <DataTableScroll label="Material depletion forecast" className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-left border-collapse text-xs" aria-label="Material depletion forecast">
              <thead>
                <TableHeaderRow>
                  <TableHeaderCell>Ingredient</TableHeaderCell>
                  <TableHeaderCell align="right">Available Stock</TableHeaderCell>
                  <TableHeaderCell align="right">Daily Burn</TableHeaderCell>
                  <TableHeaderCell align="right">Days left</TableHeaderCell>
                  <TableHeaderCell>Risk Status</TableHeaderCell>
                </TableHeaderRow>
              </thead>
              <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                {mrpProjections.length === 0 ? (
                  <TableEmptyState colSpan={5} title="No forecast data" description="Consumption history is needed before burn rates can be projected." />
                ) : (
                  mrpProjections.map((p, idx) => {
                    let badgeStatus = "healthy";
                    let label = "Adequate";
                    
                    if (p.status === "danger") {
                      badgeStatus = "out of stock";
                      label = "Critical (<3d)";
                    } else if (p.status === "warning") {
                      badgeStatus = "low stock";
                      label = "Low (<14d)";
                    }

                    return (
                      <TableRow key={`${p.ingredient_id}-${idx}`}>
                        <td className="px-6 py-3 font-extrabold text-slate-900">{p.ingredient_name}</td>
                        <td className="px-6 py-3 text-right font-mono font-bold text-slate-800">{p.available_stock} {p.unit}</td>
                        <td className="px-6 py-3 text-right font-mono text-slate-450">{p.daily_burn_rate} {p.unit}/day</td>
                        <td className={`px-6 py-3 text-right font-mono font-bold ${
                          p.status === "danger" ? "text-danger" : p.status === "warning" ? "text-warning" : "text-slate-750"
                        }`}>
                          {p.days_to_depletion === "Infinite" ? "Infinite" : `${p.days_to_depletion} days`}
                        </td>
                        <td className="px-6 py-3">
                          <StatusBadge status={badgeStatus} label={label} />
                        </td>
                      </TableRow>
                    );
                  })
                )}
              </tbody>
            </table>
          </DataTableScroll>
        </CardContent>
      </Card>

      {/* PO Card */}
      <Card>
        <CardHeader>
          <CardTitle>Draft Purchase Order</CardTitle>
          <CardDescription>Auto-build PO targets for low stock materials</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleGeneratePo} className="space-y-4">
            <div>
              <label htmlFor="mrp-supplier" className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">Supplier / Vendor</label>
              <select
                id="mrp-supplier"
                value={selectedSupplierId}
                onChange={(e) => { setSelectedSupplierId(e.target.value); setDraftPo(null); }}
                required
                className="w-full text-xs font-semibold"
              >
                <option value="">Choose Supplier...</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              isLoading={generating}
              leftIcon={<Plus size={14} />}
            >
              Draft Replenishment PO
            </Button>
          </form>

          {draftPo && (
            <div className="p-4 border border-dashed border-slate-300 rounded-xl bg-slate-50 font-mono text-[10px] text-slate-800 space-y-3 leading-relaxed shadow-inner">
              <div className="flex justify-between items-start border-b border-slate-200 pb-2">
                <div>
                  <span className="font-extrabold text-slate-900 block">H+H FOODS</span>
                  <span className="text-[9px] text-slate-400 block mt-0.5">DRAFT PURCHASE ORDER</span>
                </div>
                <span className="font-bold text-slate-550">{draftPo.po_number}</span>
              </div>
              
              <div>
                <span className="font-bold text-slate-400 block uppercase tracking-wider text-[8px]">To Vendor:</span>
                <span className="font-bold text-slate-900 block">{draftPo.supplier_name}</span>
                <span className="text-slate-500 block">{draftPo.supplier_contact}</span>
              </div>

              <div className="border-y border-slate-200/50 py-2">
                <span className="font-bold text-slate-400 block uppercase tracking-wider text-[8px] mb-1">Items To Replenish:</span>
                <div className="space-y-1">
                  {draftPo.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center">
                      <span>{item.ingredient_name} × {item.quantity} {item.unit}</span>
                      <span className="font-bold">{formatCurrency(item.subtotal)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-between items-center text-[11px] font-black border-t border-slate-200 pt-2 text-slate-900">
                <span>ESTIMATED COST:</span>
                <span>{formatCurrency(draftPo.grand_total)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
