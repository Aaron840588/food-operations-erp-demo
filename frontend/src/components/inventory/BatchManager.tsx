import React, { useState } from "react";
import { Plus, AlertTriangle } from "lucide-react";
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
import { api, type IngredientBatchOut, type RawIngredientOut } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/utils";

interface BatchManagerProps {
  batches: IngredientBatchOut[];
  ingredients: RawIngredientOut[];
  onRefresh: () => void;
}

export default function BatchManager({ batches, ingredients, onRefresh }: BatchManagerProps) {
  const [intakeRawId, setIntakeRawId] = useState("");
  const [intakeBatchCode, setIntakeBatchCode] = useState("");
  const [intakeQuantity, setIntakeQuantity] = useState("");
  const [intakeExpiry, setIntakeExpiry] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleIntakeBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intakeRawId || !intakeBatchCode || !intakeQuantity) {
      alert("Please fill in all required fields.");
      return;
    }
    
    setSubmitting(true);
    try {
      const res = await api.intakeRawIngredientBatch({
        raw_ingredient_id: parseInt(intakeRawId),
        batch_code: intakeBatchCode,
        quantity: parseFloat(intakeQuantity),
        expiry_date: intakeExpiry || null
      });
      
      alert(`Batch ${res.batch_code} intaked successfully!`);
      // Reset form
      setIntakeBatchCode("");
      setIntakeQuantity("");
      setIntakeExpiry("");
      onRefresh();
    } catch (err: unknown) {
      alert(getErrorMessage(err, "Failed to intake batch"));
    } finally {
      setSubmitting(false);
    }
  };

  // Expiry alerts
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const expiringSoonCount = batches.filter(b => {
    if (!b.expiry_date || b.quantity <= 0) return false;
    const exp = new Date(b.expiry_date);
    return exp > now && exp <= soon;
  }).length;
  const ingredientUnits = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient.unit]));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      {/* Batches Directory */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex justify-between items-center gap-2">
            <div>
              <CardTitle>Active Batches Directory</CardTitle>
              <CardDescription>First-In-First-Out (FIFO) kitchen batches</CardDescription>
            </div>
            {expiringSoonCount > 0 && (
              <div className="flex items-center gap-1 text-amber-700">
                <AlertTriangle size={14} aria-hidden="true" />
                <StatusBadge status="pending" label={`${expiringSoonCount} Expiring Soon`} className="animate-pulse" />
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <DataTableScroll label="Active ingredient batches" className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-left border-collapse text-xs" aria-label="Active ingredient batches">
              <thead>
                <TableHeaderRow>
                  <TableHeaderCell>Ingredient</TableHeaderCell>
                  <TableHeaderCell>Batch Code</TableHeaderCell>
                  <TableHeaderCell align="right">Available Qty</TableHeaderCell>
                  <TableHeaderCell>Expiry Date</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </TableHeaderRow>
              </thead>
              <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                {batches.length === 0 ? (
                  <TableEmptyState colSpan={5} title="No active ingredient batches" description="Log a delivery receipt to begin FIFO tracking." />
                ) : (
                  batches.map((b) => {
                    const isExhausted = b.quantity <= 0;
                    let badgeStatus = "healthy";
                    let label = "Healthy";
                    
                    if (isExhausted) {
                      badgeStatus = "inactive";
                      label = "Exhausted";
                    } else if (b.expiry_date) {
                      const exp = new Date(b.expiry_date);
                      if (exp <= now) {
                        badgeStatus = "overdue";
                        label = "Expired";
                      } else if (exp <= soon) {
                        badgeStatus = "pending";
                        label = "Expiring";
                      }
                    }

                    return (
                      <TableRow key={b.id} className={isExhausted ? "opacity-60" : ""}>
                        <td className="px-6 py-3 font-extrabold text-slate-900">{b.ingredient_name || `Ingredient #${b.raw_ingredient_id}`}</td>
                        <td className="px-6 py-3 font-mono text-slate-450">{b.batch_code}</td>
                        <td className="px-6 py-3 text-right font-mono font-bold text-slate-900">{b.quantity} {ingredientUnits.get(b.raw_ingredient_id) || "units"}</td>
                        <td className="px-6 py-3 font-mono text-slate-500">{b.expiry_date ? formatDate(b.expiry_date) : "No expiry limit"}</td>
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

      {/* Intake Batch Form */}
      <Card>
        <CardHeader>
          <CardTitle>Log Batch Material Intake</CardTitle>
          <CardDescription>Record delivery receipt to warehouse stock</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleIntakeBatch} className="space-y-4">
            <div>
              <label htmlFor="batch-ingredient" className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">Select Raw Ingredient</label>
              <select
                id="batch-ingredient"
                value={intakeRawId}
                onChange={(e) => setIntakeRawId(e.target.value)}
                required
                className="w-full text-xs font-semibold"
              >
                <option value="">Choose Raw Ingredient...</option>
                {ingredients.map(ing => (
                  <option key={ing.id} value={ing.id}>{ing.name} ({ing.unit})</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="batch-code" className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">Batch Reference Code</label>
              <input
                id="batch-code"
                type="text"
                required
                placeholder="e.g. B-SUGAR-20260710"
                value={intakeBatchCode}
                onChange={(e) => setIntakeBatchCode(e.target.value)}
                className="w-full font-mono text-xs font-semibold"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="batch-quantity" className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">Intake Quantity</label>
                <input
                  id="batch-quantity"
                  type="number"
                  min={0.01}
                  step={0.01}
                  required
                  placeholder="e.g. 5000"
                  value={intakeQuantity}
                  onChange={(e) => setIntakeQuantity(e.target.value)}
                  className="w-full font-mono text-xs font-semibold"
                />
              </div>
              <div>
                <label htmlFor="batch-expiry" className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">Expiry Date</label>
                <input
                  id="batch-expiry"
                  type="date"
                  value={intakeExpiry}
                  onChange={(e) => setIntakeExpiry(e.target.value)}
                  className="w-full text-xs font-semibold"
                />
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full mt-2"
              isLoading={submitting}
              leftIcon={<Plus size={14} />}
            >
              Submit Batch Intake
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
