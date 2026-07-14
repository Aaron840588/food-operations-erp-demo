import React, { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Loader2, Search, Filter } from "lucide-react";
import type { InventoryTransactionOut } from "@/lib/api";

interface AuditLedgerProps {
  transactions: InventoryTransactionOut[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

export default function AuditLedger({
  transactions,
  hasMore,
  loadingMore,
  onLoadMore
}: AuditLedgerProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedType, setSelectedType] = useState("All");

  const transactionTypes = [
    "All",
    "receive",
    "consume",
    "production_add",
    "consignment_deduct",
    "waste",
    "manual_adjustment",
    "sales_deduct"
  ];

  const filteredTransactions = transactions.filter(tx => {
    const matchesSearch = 
      (tx.item_name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (tx.user_username || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (tx.notes || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (tx.batch_reference || "").toLowerCase().includes(searchTerm.toLowerCase());
      
    const matchesType = 
      selectedType === "All" || 
      tx.transaction_type.toLowerCase() === selectedType.toLowerCase();
      
    return matchesSearch && matchesType;
  });

  return (
    <Card className="rounded-3xl border-slate-200 shadow-sm overflow-hidden">
      <CardHeader className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 p-6 md:p-8 border-b border-slate-155 bg-slate-50/50">
        <div>
          <CardTitle className="text-lg md:text-xl font-heading font-black">Inventory Audit Ledger</CardTitle>
          <CardDescription className="text-sm mt-1 text-slate-500">Consolidated double-entry transactions log:</CardDescription>
        </div>
        
        {/* Filter Controls inline in Header */}
        <div className="flex flex-col sm:flex-row gap-4 w-full lg:w-auto">
          {/* Search filter */}
          <div className="relative w-full sm:w-80">
            <span className="absolute inset-y-0 left-4 flex items-center text-slate-400">
              <Search size={16} />
            </span>
            <input
              type="text"
              placeholder="Search logs, operator, or notes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ paddingLeft: "3rem" }}
              className="w-full pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:ring-primary/20 bg-white font-semibold text-slate-700 h-12"
            />
          </div>

          {/* Type filter */}
          <div className="relative w-full sm:w-56 flex items-center">
            <span className="absolute left-4 text-slate-400">
              <Filter size={16} />
            </span>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:ring-primary/20 bg-white font-semibold text-slate-655 h-12"
            >
              {transactionTypes.map(t => (
                <option key={t} value={t}>
                  {t === "All" ? "All Types" : t.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-black uppercase tracking-wider text-xs">
                <th className="px-6 py-4.5">Timestamp</th>
                <th className="px-6 py-4.5">Log Operator</th>
                <th className="px-6 py-4.5">Warehouse Location</th>
                <th className="px-6 py-4.5">Target Item</th>
                <th className="px-6 py-4.5">Transaction Type</th>
                <th className="px-6 py-4.5 text-right">Adjustment Qty</th>
                <th className="px-6 py-4.5">Ref Batch</th>
                <th className="px-6 py-4.5">Log Note / Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-155 font-semibold text-slate-700">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center text-slate-450 font-bold italic text-base">
                    No matching transaction logs found in database ledger.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => {
                  const isPositive = tx.qty > 0;
                  return (
                    <tr key={tx.id} className="hover:bg-slate-50/20 transition-colors">
                      <td className="px-6 py-4 font-mono text-xs text-slate-500 font-bold">
                        {tx.created_at ? new Date(tx.created_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-6 py-4 font-black text-slate-850 text-base">{tx.user_username}</td>
                      <td className="px-6 py-4 text-slate-500">{tx.warehouse_name || "Main Facility"}</td>
                      <td className="px-6 py-4 font-black text-slate-900 text-base">{tx.item_name}</td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs uppercase border font-black ${
                          tx.transaction_type.includes("add") || tx.transaction_type.includes("receive") || isPositive
                             ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                             : "bg-rose-50 text-rose-700 border-rose-200"
                        }`}>
                          {tx.transaction_type.replace("_", " ")}
                        </span>
                      </td>
                      <td className={`px-6 py-4 text-right font-mono font-black text-base ${isPositive ? "text-emerald-600" : "text-rose-600"}`}>
                        {isPositive ? "+" : ""}{tx.qty}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-slate-450 font-bold">{tx.batch_reference || "-"}</td>
                      <td className="px-6 py-4 text-slate-600 font-semibold max-w-xs truncate text-base" title={tx.notes ?? undefined}>
                        {tx.notes || "-"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        
        {hasMore && (
          <div className="p-5 border-t border-slate-100 flex justify-center bg-slate-50/30">
            <button
              onClick={onLoadMore}
              disabled={loadingMore}
              className="px-8 py-3.5 rounded-2xl bg-white border-2 border-slate-250 hover:border-[#885625] hover:bg-slate-50 font-heading text-sm font-black uppercase tracking-wider text-slate-700 flex items-center gap-2.5 cursor-pointer shadow-sm transition-all disabled:opacity-50 touch-optimize"
            >
              {loadingMore ? (
                <>
                  <Loader2 className="animate-spin text-slate-500" size={16} />
                  <span>Loading Logs...</span>
                </>
              ) : (
                <span>Load More Logs</span>
              )}
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
