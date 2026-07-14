import React, { useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { api, type DraftPurchaseOrderOut, type MrpProjectionOut, type SupplierOut } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

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
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                  <th className="px-6 py-3">Ingredient</th>
                  <th className="px-6 py-3 text-right">Available Stock</th>
                  <th className="px-6 py-3 text-right">Daily Burn</th>
                  <th className="px-6 py-3 text-right">Days left</th>
                  <th className="px-6 py-3">Risk Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                {mrpProjections.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-slate-400 italic">
                      No historical consumption logs found to forecast burn rate.
                    </td>
                  </tr>
                ) : (
                  mrpProjections.map((p, idx) => {
                    let badgeType: "success" | "warning" | "danger" = "success";
                    let label = "Adequate";
                    
                    if (p.status === "danger") {
                      badgeType = "danger";
                      label = "Critical (<3d)";
                    } else if (p.status === "warning") {
                      badgeType = "warning";
                      label = "Low (<14d)";
                    }

                    return (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-3 font-extrabold text-slate-900">{p.ingredient_name}</td>
                        <td className="px-6 py-3 text-right font-mono font-bold text-slate-800">{p.available_stock}{p.unit}</td>
                        <td className="px-6 py-3 text-right font-mono text-slate-450">{p.daily_burn_rate}{p.unit}/day</td>
                        <td className={`px-6 py-3 text-right font-mono font-bold ${
                          p.status === "danger" ? "text-danger" : p.status === "warning" ? "text-warning" : "text-slate-750"
                        }`}>
                          {p.days_to_depletion === "Infinite" ? "Infinite" : `${p.days_to_depletion} days`}
                        </td>
                        <td className="px-6 py-3">
                          <Badge variant={badgeType}>{label}</Badge>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
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
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">Supplier / Vendor</label>
              <select
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
                      <span>{item.ingredient_name} x {item.quantity}{item.unit}</span>
                      <span className="font-bold">₱{item.subtotal}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-between items-center text-[11px] font-black border-t border-slate-200 pt-2 text-slate-900">
                <span>ESTIMATED COST:</span>
                <span>₱{draftPo.grand_total}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
