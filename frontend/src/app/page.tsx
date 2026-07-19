"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  api,
  type ConsignmentDeliveryOut,
  type CostAnalysisOut,
  type DashboardAnalyticsOut,
  type DashboardCategoryAverageOut,
  type DashboardCleaningSummaryOut,
  type DashboardExpiringBatchOut,
  type DashboardLowStockOut,
  type DashboardMarginSummaryOut,
  type DraftPurchaseOrderOut,
  type ProductionPlanOut,
} from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import {
  Package, AlertTriangle, RefreshCw, Coins,
  ClipboardCheck, Download, TrendingDown,
  ChefHat, Store, BarChart2, Bell, CircleDot, Clock
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from "recharts";
import { Button } from "@/components/ui/Button";
import { ConfirmationModal, PromptModal } from "@/components/ui/Modal";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";

// ─── Progress Ring Component ──────────────────────────────────────────────────
function ProgressRing({ pct, size = 52, stroke = 5, color = "#10b981" }: { pct: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.7s ease" }} />
    </svg>
  );
}

// ─── Section Header Label ─────────────────────────────────────────────────────
function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-slate-400">{icon}</span>
      <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-405">{label}</span>
      <div className="flex-1 h-px bg-[#dfd5c6]/40 ml-2" />
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  
  // States
  const [analytics, setAnalytics] = useState<DashboardAnalyticsOut | null>(null);
  const [ingredients, setIngredients] = useState<DashboardLowStockOut[]>([]);
  const [unpaidDeliveries, setUnpaidDeliveries] = useState<ConsignmentDeliveryOut[]>([]);
  const [costAnalysis, setCostAnalysis] = useState<CostAnalysisOut[]>([]);
  const [todayPlan, setTodayPlan] = useState<ProductionPlanOut | null>(null);
  const [cleaningSummary, setCleaningSummary] = useState<DashboardCleaningSummaryOut>({ total_tasks: 0, completed_tasks: 0 });
  const [batches, setBatches] = useState<DashboardExpiringBatchOut[]>([]);
  const [totalUnpaidAR, setTotalUnpaidAR] = useState(0);
  const [topMargins, setTopMargins] = useState<DashboardMarginSummaryOut[]>([]);
  const [lowMargins, setLowMargins] = useState<DashboardMarginSummaryOut[]>([]);
  const [categoryAverages, setCategoryAverages] = useState<DashboardCategoryAverageOut[]>([]);
  const [userRole, setUserRole] = useState<string>("staff");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isTourOpen, setIsTourOpen] = useState(true);

  // Modal / PO States
  const [isSettleOpen, setIsSettleOpen] = useState(false);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<number | null>(null);
  const [isPOOpen, setIsPOOpen] = useState(false);
  const [selectedIngredient, setSelectedIngredient] = useState<DashboardLowStockOut | null>(null);
  const [draftPo, setDraftPo] = useState<DraftPurchaseOrderOut | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    setError(null);
    try {
      const summary = await api.getDashboardSummary();
      const isOwnerUser = summary.viewer_role === "owner";
      
      let allCostAnalysis: CostAnalysisOut[] = [];
      if (isOwnerUser) {
        try {
          allCostAnalysis = await api.getCostAnalysis();
        } catch (costErr) {
          console.error("Error loading cost analysis:", costErr);
        }
      }
      
      setUserRole(isOwnerUser ? "owner" : "staff");
      setAnalytics(summary.analytics);
      setIngredients(summary.low_stock || []);
      setCleaningSummary(summary.cleaning_summary || { total_tasks: 0, completed_tasks: 0 });
      setUnpaidDeliveries(summary.unpaid_deliveries || []);
      setCostAnalysis(allCostAnalysis);
      setBatches(summary.expiring_batches || []);
      setTotalUnpaidAR(summary.total_unpaid_ar || 0);
      setTodayPlan(summary.today_plan);
      setTopMargins(summary.top_margins || []);
      setLowMargins(summary.low_margins || []);
      setCategoryAverages(summary.category_averages || []);
    } catch (err: unknown) {
      console.error(err);
      if (!isBackground) setError("Unable to connect to servers. Please retry.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    try {
      localStorage.removeItem("hh_cache_dashboard_summary");
    } catch {}
    const request = window.setTimeout(() => { void fetchData(false); }, 0);
    return () => window.clearTimeout(request);
  }, []);

  const handleSettleConfirm = async (paymentDate: string) => {
    if (!selectedDeliveryId) return;
    setActionLoading(true);
    try {
      await api.payDelivery(selectedDeliveryId, paymentDate);
      setIsSettleOpen(false);
      setSelectedDeliveryId(null);
      await fetchData(true);
    } catch (err: unknown) {
      alert(`Error: ${getErrorMessage(err)}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleTriggerDraftPO = async (ing: DashboardLowStockOut) => {
    setSelectedIngredient(ing);
    if (ing.item_type !== "raw_ingredient" || !ing.supplier_id) {
      alert(`No supplier assigned to ${ing.name}.`);
      return;
    }
    setActionLoading(true);
    try {
      const replenishQty = Math.max(ing.reorder_level * 2, 5000);
      const po = await api.generateDraftPo({
        supplier_id: ing.supplier_id,
        items: [{ ingredient_id: ing.id, quantity: replenishQty }]
      });
      setDraftPo(po);
      setIsPOOpen(true);
    } catch (err: unknown) {
      alert(`Error: ${getErrorMessage(err)}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDownloadBackup = async () => {
    setActionLoading(true);
    try {
      const blob = await api.getBackupBlob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `hh-backup-${new Date().toISOString().split("T")[0]}.json`;
      link.click();
    } catch (err: unknown) {
      alert(`Backup failed: ${getErrorMessage(err)}`);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] w-full flex flex-col items-center justify-center text-slate-500 gap-4">
        <RefreshCw className="animate-spin text-primary" size={48} />
        <span className="text-sm font-heading font-extrabold tracking-wider uppercase">Loading Executive Dashboard...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[70vh] w-full flex flex-col items-center justify-center text-slate-500 gap-4">
        <AlertTriangle className="text-rose-500" size={48} />
        <span className="text-base font-bold text-slate-700">{error}</span>
        <Button onClick={() => fetchData(false)} variant="primary">Retry Connection</Button>
      </div>
    );
  }

  // Derived Variables
  const todayDateStr = new Date().toLocaleDateString("en-PH", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
  const { total_tasks: totalTasks = 0, completed_tasks: completedTasks = 0 } = cleaningSummary;
  const sanitationPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const combinedSales = analytics?.combined_sales ?? 0;
  const combinedNetProfit = analytics?.combined_net_profit ?? 0;
  const overallNetMargin = combinedSales > 0
    ? ((combinedNetProfit / combinedSales) * 100).toFixed(1)
    : "0.0";

  // Recharts structured datasets
  const channelShareData = [
    { name: "Consignment", value: analytics?.consignment_sales || 0, fill: "#7b3e19" },
    { name: "Wholesale", value: analytics?.reseller_sales || 0, fill: "#cfaf45" },
    { name: "Pop-Up Markets", value: analytics?.market_sales || 0, fill: "#10b981" },
  ];

  const cogsProfitShareData = [
    { name: "Net Profit", value: Math.max(0, analytics?.combined_net_profit || 0), fill: "#10b981" },
    { name: "COGS (Material Costs)", value: analytics?.combined_cogs || 0, fill: "#ef4444" },
  ];

  const categoryCostData = categoryAverages.map(cat => ({
    category: cat.category,
    "Food Cost": Number.parseFloat(String(cat.avg_food_cost)) || 0,
    "Labor": Number.parseFloat(String(cat.avg_labor_cost)) || 0,
    "Utility": Number.parseFloat(String(cat.avg_utility_cost)) || 0,
    "Net Profit": Number.parseFloat(String(cat.avg_net_profit)) || 0,
  }));

  // Margin Guard list
  const marginGuardAlerts = costAnalysis
    .filter(row => row.cost_status === "ok" && (row.net_margin_pct < 50.0 || row.gross_margin_pct < 50.0))
    .sort((a, b) => a.net_margin_pct - b.net_margin_pct);

  const missingCostWarnings = costAnalysis.filter(row => row.cost_status !== "ok");

  // Determine main cost reason helper
  const getMainCostReason = (row: CostAnalysisOut) => {
    if (row.food_cost > (row.labor_cost + row.utility_cost)) {
      return "High raw ingredients and packaging cost";
    }
    return "High operational overhead and labor allocated";
  };

  return (
    <div className="space-y-6 flex flex-col pb-20">

      {/* HEADER SECTION */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-heading font-black text-slate-900 uppercase tracking-wide">
            H+H HUB
          </h1>
          <p className="text-sm text-slate-400 font-bold mt-0.5">{todayDateStr} · Executive Overview</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={() => fetchData(true)} variant="outline" size="sm" className="h-10 bg-white text-xs" leftIcon={<RefreshCw size={14} />}>
            Refresh
          </Button>
          {userRole === "owner" && (
            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  setActionLoading(true);
                  try {
                    await api.recalculateAllCosts();
                    await fetchData(true);
                  } catch (err: unknown) {
                    alert(getErrorMessage(err));
                  } finally {
                    setActionLoading(false);
                  }
                }}
                disabled={actionLoading}
                variant="outline"
                size="sm"
                className="h-10 bg-white text-xs font-bold"
              >
                {actionLoading ? "Recalculating..." : "Recalculate Costing"}
              </Button>
              <Button onClick={handleDownloadBackup} disabled={actionLoading} variant="outline" size="sm" className="h-10 bg-white text-xs" leftIcon={<Download size={13} />}>
                Backup
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* GUIDED PORTFOLIO TOUR CARD */}
      <Card className="border-2 border-[#dfd5c6] bg-amber-50/50 rounded-3xl overflow-hidden shadow-xs">
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap sm:flex-nowrap">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-[#bc9037] animate-pulse"></div>
                <h2 className="text-base font-heading font-black text-[#2d1f0e] uppercase tracking-wide flex items-center gap-1.5">
                  Guided Portfolio Tour
                </h2>
              </div>
              <p className="text-xs text-[#8a7560] font-medium max-w-4xl">
                Welcome to the sanitized public demonstration copy of H+H Hub. This application has been configured with entirely synthetic business data and separate sandbox credentials to showcase operational workflows safely. Explore the core system features below.
              </p>
            </div>
            <Button
              onClick={() => setIsTourOpen(!isTourOpen)}
              variant="outline"
              size="sm"
              className="h-8 border-[#dfd5c6] bg-white text-xs font-bold text-[#8a7560] cursor-pointer"
            >
              {isTourOpen ? "Hide Tour" : "Show Tour"}
            </Button>
          </div>

          {isTourOpen && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6 pt-5 border-t border-[#dfd5c6]/40 text-xs">
              
              <div className="space-y-2 p-4 bg-white border border-[#dfd5c6] rounded-2xl flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 font-heading font-black text-[#2d1f0e]">
                    <span className="w-5 h-5 rounded-lg bg-primary/10 flex items-center justify-center text-[10px] text-primary">1</span>
                    Inventory &amp; FIFO
                  </div>
                  <p className="text-slate-500 leading-relaxed font-semibold">
                    Tracks raw ingredient stocks per batch with explicit expiration dates. When plans are finalized, stocks are automatically deducted in strict FIFO order (soonest expiring first).
                  </p>
                </div>
                <div className="pt-2">
                  <Link href="/inventory" className="text-primary hover:underline font-black text-[11px] uppercase tracking-wide">
                    Go to Stocks &rarr;
                  </Link>
                </div>
              </div>

              <div className="space-y-2 p-4 bg-white border border-[#dfd5c6] rounded-2xl flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 font-heading font-black text-[#2d1f0e]">
                    <span className="w-5 h-5 rounded-lg bg-primary/10 flex items-center justify-center text-[10px] text-primary">2</span>
                    Production Planning
                  </div>
                  <p className="text-slate-500 leading-relaxed font-semibold">
                    Kitchen operators define targets. Clicking &quot;Forecast&quot; triggers a recursive Bill of Materials (BOM) explosion, calculating exactly what raw ingredients are required and flagging deficits.
                  </p>
                </div>
                <div className="pt-2">
                  <Link href="/planner" className="text-primary hover:underline font-black text-[11px] uppercase tracking-wide">
                    Go to Planner &rarr;
                  </Link>
                </div>
              </div>

              <div className="space-y-2 p-4 bg-white border border-[#dfd5c6] rounded-2xl flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 font-heading font-black text-[#2d1f0e]">
                    <span className="w-5 h-5 rounded-lg bg-primary/10 flex items-center justify-center text-[10px] text-primary">3</span>
                    Recipe Costing
                  </div>
                  <p className="text-slate-500 leading-relaxed font-semibold">
                    Compiles granular raw ingredient costs and packaging weights recursively via DFS with memoized caches. Incorporates exact product labor/utility costs to calculate net/gross margins.
                  </p>
                </div>
                <div className="pt-2">
                  {userRole === "owner" ? (
                    <Link href="/recipes" className="text-primary hover:underline font-black text-[11px] uppercase tracking-wide">
                      Go to Recipes &rarr;
                    </Link>
                  ) : (
                    <span className="text-slate-400 font-bold text-[10px] uppercase tracking-wide">Owner Mode Only</span>
                  )}
                </div>
              </div>

              <div className="space-y-2 p-4 bg-white border border-[#dfd5c6] rounded-2xl flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 font-heading font-black text-[#2d1f0e]">
                    <span className="w-5 h-5 rounded-lg bg-primary/10 flex items-center justify-center text-[10px] text-primary">4</span>
                    Wholesale POS
                  </div>
                  <p className="text-slate-500 leading-relaxed font-semibold">
                    A split-pane order panel with keyword searches and automatic wholesale discount volume tiers. Submits invoice states atomically to protect against duplicate checkout submissions.
                  </p>
                </div>
                <div className="pt-2">
                  <Link href="/resellers" className="text-primary hover:underline font-black text-[11px] uppercase tracking-wide">
                    Go to Wholesale &rarr;
                  </Link>
                </div>
              </div>

              <div className="space-y-2 p-4 bg-white border border-[#dfd5c6] rounded-2xl flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 font-heading font-black text-[#2d1f0e]">
                    <span className="w-5 h-5 rounded-lg bg-primary/10 flex items-center justify-center text-[10px] text-primary">5</span>
                    B2B Consignment
                  </div>
                  <p className="text-slate-500 leading-relaxed font-semibold">
                    Coordinates shipment sheets sent to retail partner stores. Weekly audits capture real sales quantities and log any pulled-out expired jars directly as waste write-offs.
                  </p>
                </div>
                <div className="pt-2">
                  <Link href="/consignment" className="text-primary hover:underline font-black text-[11px] uppercase tracking-wide">
                    Go to Consignment &rarr;
                  </Link>
                </div>
              </div>

              <div className="space-y-2 p-4 bg-white border border-[#dfd5c6] rounded-2xl flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 font-heading font-black text-[#2d1f0e]">
                    <span className="w-5 h-5 rounded-lg bg-primary/10 flex items-center justify-center text-[10px] text-primary">6</span>
                    Pop-Up Market POS
                  </div>
                  <p className="text-slate-500 leading-relaxed font-semibold">
                    A tablet-optimized cashier panel with tap-to-add items, payment gateway selectors, optimistic offline cart queueing, and automatic reconciliation when closing booths.
                  </p>
                </div>
                <div className="pt-2">
                  <Link href="/market-events" className="text-primary hover:underline font-black text-[11px] uppercase tracking-wide">
                    Go to Markets &rarr;
                  </Link>
                </div>
              </div>

              <div className="space-y-2 p-4 bg-white border border-[#dfd5c6] rounded-2xl flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 font-heading font-black text-[#2d1f0e]">
                    <span className="w-5 h-5 rounded-lg bg-primary/10 flex items-center justify-center text-[10px] text-primary">7</span>
                    RBAC Controls
                  </div>
                  <p className="text-slate-500 leading-relaxed font-semibold">
                    Owner role accesses all financial margins, revenues, settings, and backups. Standard kitchen staff have a focused operations view that redacts sensitive costs automatically.
                  </p>
                </div>
                <div className="pt-2">
                  <span className="text-slate-400 font-bold text-[10px] uppercase tracking-wide">Toggle roles in login</span>
                </div>
              </div>

              <div className="space-y-2 p-4 bg-white border border-[#dfd5c6] rounded-2xl flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 font-heading font-black text-[#2d1f0e]">
                    <span className="w-5 h-5 rounded-lg bg-primary/10 flex items-center justify-center text-[10px] text-primary">8</span>
                    Offline Resilience
                  </div>
                  <p className="text-slate-500 leading-relaxed font-semibold">
                    Disconnect your internet! The system detects connection drops, stores POS checkout queues inside local IndexedDB optimistically, and replays them automatically on reconnect.
                  </p>
                </div>
                <div className="pt-2">
                  <span className="text-slate-400 font-bold text-[10px] uppercase tracking-wide">Supported on POS grids</span>
                </div>
              </div>

            </div>
          )}
        </CardContent>
      </Card>

      {/* SECTION 1 — BUSINESS HEALTH */}
      {userRole === "owner" ? (
        <div className="space-y-4">
          <SectionLabel icon={<Coins size={14} />} label="Section 1 — Business Health Portfolio (Synthetic Demo Data)" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            
            {/* Sales Revenue */}
            <div className="bg-white rounded-3xl p-5 border-2 border-[#dfd5c6] border-l-8 border-l-primary flex flex-col justify-between hover:scale-[1.01] transition-transform duration-150">
              <span className="text-[10px] text-slate-400 uppercase font-black tracking-wider block">Combined Sales</span>
              <span className="text-xl xl:text-2xl font-black text-slate-900 font-mono mt-2 leading-none">
                ₱{(analytics?.combined_sales || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <span className="text-[10px] text-slate-400 block mt-2 font-semibold">Total across all channels</span>
            </div>

            {/* COGS */}
            <div className="bg-white rounded-3xl p-5 border-2 border-[#dfd5c6] border-l-8 border-l-rose-500 flex flex-col justify-between hover:scale-[1.01] transition-transform duration-150">
              <span className="text-[10px] text-slate-400 uppercase font-black tracking-wider block">Cost of Goods (COGS)</span>
              <span className="text-xl xl:text-2xl font-black text-rose-600 font-mono mt-2 leading-none">
                ₱{(analytics?.combined_cogs || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <span className="text-[10px] text-slate-400 block mt-2 font-semibold">Total material costs</span>
            </div>

            {/* Net Profit */}
            <div className="bg-white rounded-3xl p-5 border-2 border-[#dfd5c6] border-l-8 border-l-emerald-500 flex flex-col justify-between hover:scale-[1.01] transition-transform duration-150">
              <span className="text-[10px] text-slate-400 uppercase font-black tracking-wider block">Net Profit</span>
              <span className="text-xl xl:text-2xl font-black text-emerald-600 font-mono mt-2 leading-none">
                ₱{(analytics?.combined_net_profit || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <span className="text-[10px] text-slate-400 block mt-2 font-semibold">Sales minus material COGS</span>
            </div>

            {/* Margin */}
            <div className="bg-white rounded-3xl p-5 border-2 border-[#dfd5c6] border-l-8 border-l-purple-500 flex flex-col justify-between hover:scale-[1.01] transition-transform duration-150">
              <span className="text-[10px] text-slate-400 uppercase font-black tracking-wider block">Profit Margin</span>
              <span className="text-xl xl:text-2xl font-black text-purple-700 font-mono mt-2 leading-none">
                {overallNetMargin}%
              </span>
              <span className="text-[10px] text-slate-400 block mt-2 font-semibold">Overall profit efficiency</span>
            </div>

            {/* Inventory Valuation */}
            <div className="bg-white rounded-3xl p-5 border-2 border-[#dfd5c6] border-l-8 border-l-amber-500 flex flex-col justify-between hover:scale-[1.01] transition-transform duration-150">
              <span className="text-[10px] text-slate-400 uppercase font-black tracking-wider block">Raw Inventory Value</span>
              <span className="text-xl xl:text-2xl font-black text-amber-600 font-mono mt-2 leading-none">
                ₱{(analytics?.raw_inventory_value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <span className="text-[10px] text-slate-400 block mt-2 font-semibold">{analytics?.raw_items_count || 0} ingredients in vault</span>
            </div>

            {/* Collections A/R */}
            <div className="bg-white rounded-3xl p-5 border-2 border-[#dfd5c6] border-l-8 border-l-blue-500 flex flex-col justify-between hover:scale-[1.01] transition-transform duration-150">
              <span className="text-[10px] text-slate-400 uppercase font-black tracking-wider block">Outstanding Collections</span>
              <span className="text-xl xl:text-2xl font-black text-blue-600 font-mono mt-2 leading-none">
                ₱{totalUnpaidAR.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <span className="text-[10px] text-slate-400 block mt-2 font-semibold">Unsettled consignment billing</span>
            </div>

          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <SectionLabel icon={<Coins size={14} />} label="Section 1 — Operational Health Statistics (Synthetic Demo Data)" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-3xl p-5 border-2 border-[#dfd5c6] border-l-8 border-l-primary hover:scale-[1.01] transition-transform">
              <span className="text-[10px] text-slate-400 uppercase font-black tracking-wider block">Total Active Partners</span>
              <span className="text-xl xl:text-2xl font-black text-slate-800 font-mono block mt-2">{analytics?.consignment_partners_count || 0} Store Outlets</span>
            </div>
            <div className="bg-white rounded-3xl p-5 border-2 border-[#dfd5c6] border-l-8 border-l-emerald-500 hover:scale-[1.01] transition-transform">
              <span className="text-[10px] text-slate-400 uppercase font-black tracking-wider block">Consignment Sell-Thru</span>
              <span className="text-xl xl:text-2xl font-black text-emerald-600 font-mono block mt-2">{analytics?.consignment_efficiency_rate || 0.0}%</span>
            </div>
            <div className="bg-white rounded-3xl p-5 border-2 border-[#dfd5c6] border-l-8 border-l-rose-500 hover:scale-[1.01] transition-transform">
              <span className="text-[10px] text-slate-400 uppercase font-black tracking-wider block">Consignment Waste Pull-outs</span>
              <span className="text-xl xl:text-2xl font-black text-rose-600 font-mono block mt-2">{analytics?.consignment_waste_percentage || 0.0}%</span>
            </div>
            <div className="bg-white rounded-3xl p-5 border-2 border-[#dfd5c6] border-l-8 border-l-blue-500 hover:scale-[1.01] transition-transform">
              <span className="text-[10px] text-slate-400 uppercase font-black tracking-wider block">Active Ingredients Catalog</span>
              <span className="text-xl xl:text-2xl font-black text-blue-600 font-mono block mt-2">{analytics?.raw_items_count || 0} materials</span>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2 — URGENT OWNER ALERTS */}
      <div className="space-y-4">
        <SectionLabel icon={<Bell size={14} />} label="Section 2 — Urgent Owner Alerts &amp; Actions" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Alarms Left Panel */}
          <div className="space-y-4">
            
            {/* 1. MARGIN GUARD ALERTS */}
            {userRole === "owner" && (
              <Card className="rounded-3xl border-slate-200 overflow-hidden shadow-xs">
                <CardHeader className="p-5 bg-rose-50/50 border-b border-slate-100">
                  <CardTitle className="text-xs uppercase tracking-wider font-black text-rose-800 flex items-center gap-1.5">
                    <TrendingDown size={14} /> Margin Guard Alerts (Profit Margins below 50%)
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-5 space-y-3.5">
                  {marginGuardAlerts.length === 0 ? (
                    <div className="text-center text-xs text-slate-455 font-bold italic py-4">All calculated unit profit margins are healthy (above 50%). ✓</div>
                  ) : (
                    marginGuardAlerts.slice(0, 3).map((item) => (
                      <div key={item.sku} className="p-4 rounded-2xl bg-rose-50/30 border border-rose-100 space-y-2">
                        <div className="flex justify-between items-start flex-wrap gap-2">
                          <div>
                            <span className="font-black text-slate-800 text-sm block">{item.product_name}</span>
                            <span className="text-[10px] font-mono text-slate-400 block mt-0.5">{item.sku} &bull; Size: {item.size}</span>
                          </div>
                          <span className="text-xs font-black text-rose-600 bg-rose-50 border border-rose-200 py-1 px-2.5 rounded-lg font-mono">
                            {item.net_margin_pct}% Margin
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[11px] font-bold text-slate-500 pt-1 border-t border-dashed border-rose-100">
                          <div>Unit Price: <strong className="font-mono text-slate-700">₱{item.selling_price}</strong></div>
                          <div>Calculated Cost: <strong className="font-mono text-slate-700">₱{item.total_cost}</strong></div>
                          <div className="col-span-2 text-rose-700 mt-1 italic font-semibold">⚠️ Cost driver: {getMainCostReason(item)}</div>
                        </div>
                      </div>
                    ))
                  )}

                  {/* Missing cost warnings separate block */}
                  {missingCostWarnings.length > 0 && (
                    <div className="space-y-2 pt-3 border-t border-slate-100">
                      <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider block">Cost Configuration Review Required ({missingCostWarnings.length})</span>
                      <div className="max-h-24 overflow-y-auto space-y-1.5 pr-1">
                        {missingCostWarnings.slice(0, 3).map(row => (
                          <div key={row.sku} className="p-2.5 rounded-xl bg-amber-50/30 border border-amber-100 text-xs font-bold text-amber-800 flex justify-between items-center">
                            <span>{row.product_name} ({row.sku})</span>
                            <span className="text-[10px] font-black bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg">{row.cost_status_message}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* 2. LOW-STOCK PRODUCTS OR INGREDIENTS */}
            <Card className="rounded-3xl border-slate-200 overflow-hidden shadow-xs">
              <CardHeader className="p-5 bg-slate-50/50 border-b border-slate-100 flex justify-between items-center">
                <CardTitle className="text-xs uppercase tracking-wider font-black text-slate-550 flex items-center gap-1.5">
                  <Package size={14} className="text-amber-500" /> Critical Low-Stock Dispatches ({ingredients.length} items)
                </CardTitle>
                <button onClick={() => router.push("/inventory")} className="text-[10px] font-black text-primary hover:underline uppercase tracking-wider">View All</button>
              </CardHeader>
              <CardContent className="p-5 space-y-3">
                {ingredients.length === 0 ? (
                  <div className="text-center text-xs text-slate-455 font-bold italic py-4">All raw ingredients and finished SKU warehouse dispatches are healthy. ✓</div>
                ) : (
                  ingredients.slice(0, 3).map((item) => (
                    <div key={item.id} className="p-3.5 rounded-2xl bg-amber-50/20 border border-amber-100 flex justify-between items-center gap-4 hover:bg-amber-50/40 transition-all">
                      <div>
                        <span className="font-black text-slate-800 block text-xs">{item.name}</span>
                        <span className="text-[10px] font-mono text-slate-400 mt-0.5 block uppercase tracking-wide">{item.item_type.replace("_", " ")}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-black text-rose-600 bg-rose-50 border border-rose-150 px-2.5 py-1 rounded-lg font-mono">
                          {item.available_stock} {item.unit} left
                        </span>
                        <span className="text-[9px] text-slate-400 block mt-1">Reorder: {item.reorder_level} {item.unit}</span>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

          </div>

          {/* Alarms Right Panel */}
          <div className="space-y-4">
            
            {/* 3. UNPAID CONSIGNMENT OUTSTANDING SETTLEMENTS */}
            {userRole === "owner" && (
              <Card className="rounded-3xl border-slate-200 overflow-hidden shadow-xs">
                <CardHeader className="p-5 bg-blue-50/30 border-b border-slate-100">
                  <CardTitle className="text-xs uppercase tracking-wider font-black text-blue-800 flex items-center gap-1.5">
                    <Store size={14} /> Unpaid B2B Shipments &amp; Outstanding Receipts
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-5 space-y-3.5 max-h-80 overflow-y-auto pr-1">
                  {unpaidDeliveries.length === 0 ? (
                    <div className="text-center text-xs text-slate-455 font-bold italic py-4">All consignment deliveries have been settled. ✓</div>
                  ) : (
                    unpaidDeliveries.slice(0, 3).map((del) => {
                      const totalVal = del.items.reduce((sum, item) => sum + (item.units_sold * item.reseller_price_snapshot), 0);
                      return (
                        <div key={del.id} className="p-3.5 rounded-2xl bg-white border border-slate-200 flex justify-between items-center gap-4 hover:border-slate-350 transition-all">
                          <div>
                            <span className="font-black text-slate-800 text-sm block">{del.partner_name}</span>
                            <span className="text-[10px] font-mono text-slate-400 block mt-0.5">DR: {del.dr_number || "Draft DR"} &bull; Dispatched: {del.delivery_date}</span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="font-mono text-slate-800 font-black text-sm">₱{totalVal.toLocaleString()}</span>
                            <Button size="sm" variant="primary" className="h-8 text-[11px] font-bold shrink-0 bg-blue-600 hover:bg-blue-750 border-blue-500 rounded-lg px-2.5"
                              onClick={() => { setSelectedDeliveryId(del.id); setIsSettleOpen(true); }}>
                              Settle
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            )}

            {/* 4. EXPIRING INGREDIENT BATCHES */}
            <Card className="rounded-3xl border-slate-200 overflow-hidden shadow-xs">
              <CardHeader className="p-5 bg-orange-50/20 border-b border-slate-100">
                <CardTitle className="text-xs uppercase tracking-wider font-black text-orange-800 flex items-center gap-1.5">
                  <Clock size={14} className="text-orange-500" /> Expiring Ingredient Batches (Within 15 days)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5 space-y-3">
                {batches.length === 0 ? (
                  <div className="text-center text-xs text-slate-455 font-bold italic py-4">No ingredient batches expiring soon. ✓</div>
                ) : (
                  batches.slice(0, 3).map((item) => (
                    <div key={item.id} className="p-3 bg-white border border-slate-200 rounded-2xl flex justify-between items-center">
                      <div>
                        <span className="font-black text-slate-800 text-xs block">{item.ingredient_name}</span>
                        <span className="text-[10px] font-mono text-rose-500 block mt-0.5">Expires: {item.expiry_date}</span>
                      </div>
                      <span className="text-xs font-mono font-black text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-lg">{item.qty || item.quantity || 0} units</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

          </div>

        </div>
      </div>

      {/* SECTION 3 — FINANCIAL ANALYTICS */}
      {userRole === "owner" && (
        <div className="space-y-4">
          <SectionLabel icon={<BarChart2 size={14} />} label="Section 3 — Financial Profitability Analytics" />
          
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            
            {/* Stacked Cost Allocation Breakdown */}
            <div className="lg:col-span-8 bg-white border-2 border-[#dfd5c6] rounded-3xl p-6 shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-xs font-black uppercase text-slate-500 block tracking-wider">Unit Cost Allocation &amp; Profits by Category</span>
                <span className="text-xs text-slate-400 font-semibold block mt-1 leading-normal">Direct edible food costs, labor, overhead allocation, and net profit per product category (₱)</span>
              </div>
              <div className="h-64 mt-4">
                {categoryCostData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categoryCostData} layout="vertical" margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                      <XAxis type="number" stroke="#94a3b8" fontSize={10} tickLine={false} tickFormatter={v => `₱${v}`} />
                      <YAxis dataKey="category" type="category" stroke="#94a3b8" fontSize={10} tickLine={false} width={100} />
                      <Tooltip formatter={(val) => [`₱${Number(val).toFixed(2)}`]} />
                      <Legend wrapperStyle={{ fontSize: "10px", fontWeight: "700" }} />
                      <Bar dataKey="Food Cost" stackId="a" fill="#ef4444" />
                      <Bar dataKey="Labor" stackId="a" fill="#7b3e19" />
                      <Bar dataKey="Utility" stackId="a" fill="#cfaf45" />
                      <Bar dataKey="Net Profit" stackId="a" fill="#10b981" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-slate-400 italic">No cost breakdown averages available.</div>
                )}
              </div>
            </div>

            {/* Sales Channel Share Donut */}
            <div className="lg:col-span-4 bg-white border-2 border-[#dfd5c6] rounded-3xl p-6 shadow-sm flex flex-col justify-between">
              <span className="text-xs font-black uppercase text-slate-400 block tracking-wider">Sales Channel Revenue Share</span>
              <div className="h-44 w-full relative flex items-center justify-center mt-3">
                {combinedSales > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={channelShareData} cx="50%" cy="50%" innerRadius={50} outerRadius={68} paddingAngle={4} dataKey="value">
                        {channelShareData.map((ch, idx) => <Cell key={idx} fill={ch.fill} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <CircleDot size={28} className="text-slate-200" />
                )}
                {combinedSales > 0 && (
                  <div className="absolute text-center pointer-events-none">
                    <span className="text-[9px] text-slate-400 uppercase font-bold block">Total Sales</span>
                    <span className="text-xs font-black text-slate-800 font-mono">₱{analytics?.combined_sales?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                )}
              </div>
              <div className="w-full space-y-1.5 text-[11px] font-bold border-t border-slate-100 pt-3 mt-3">
                {channelShareData.map((ch, i) => (
                  <div key={i} className="flex justify-between items-center">
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: ch.fill }} />{ch.name}</span>
                    <span className="font-mono text-slate-700">₱{ch.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Margin Performance Comparison */}
            <div className="bg-white border-2 border-[#dfd5c6] rounded-3xl p-6 shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-xs font-black uppercase text-slate-500 block tracking-wider">Top vs Lowest Profit Margin SKUs</span>
                <span className="text-xs text-slate-400 font-semibold mt-0.5 block">Net margin percentages (%) compared across performance leaders</span>
              </div>
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <span className="text-[10px] text-emerald-600 uppercase font-black tracking-wide block">🏆 Top Margin Leaders</span>
                  {topMargins.slice(0, 3).map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center p-2.5 bg-emerald-50/20 border border-emerald-100 rounded-xl text-xs font-bold text-slate-700">
                      <span>{item.product_name}</span>
                      <span className="font-mono font-black text-emerald-600">{item.net_margin_pct}%</span>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <span className="text-[10px] text-rose-500 uppercase font-black tracking-wide block">⚠️ Bottom Margin SKUs</span>
                  {lowMargins.slice(0, 3).map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center p-2.5 bg-rose-50/10 border border-rose-100 rounded-xl text-xs font-bold text-slate-700">
                      <span>{item.product_name}</span>
                      <span className="font-mono font-black text-rose-600">{item.net_margin_pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Profit vs material Cost (COGS) Donut */}
            <div className="bg-white border-2 border-[#dfd5c6] rounded-3xl p-6 shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-xs font-black uppercase text-slate-500 block tracking-wider">Cumulative Net Profit vs COGS Share</span>
                <span className="text-xs text-slate-400 font-semibold mt-0.5 block">Ratio of total profit vs raw material and portion packaging expenses</span>
              </div>
              <div className="h-40 w-full relative flex items-center justify-center mt-3">
                {combinedSales > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={cogsProfitShareData} cx="50%" cy="50%" innerRadius={48} outerRadius={64} paddingAngle={4} dataKey="value">
                        {cogsProfitShareData.map((ch, idx) => <Cell key={idx} fill={ch.fill} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <CircleDot size={28} className="text-slate-200" />
                )}
                {combinedSales > 0 && (
                  <div className="absolute text-center pointer-events-none">
                    <span className="text-[9px] text-slate-400 uppercase font-bold block">Margin</span>
                    <span className="text-xs font-black text-slate-800 font-mono">{overallNetMargin}%</span>
                  </div>
                )}
              </div>
              <div className="w-full space-y-1.5 text-[11px] font-bold border-t border-slate-100 pt-3 mt-3">
                <div className="flex justify-between items-center">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" />Net Profit</span>
                  <span className="font-mono text-emerald-700">₱{(analytics?.combined_net_profit || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500" />Cost of Goods (COGS)</span>
                  <span className="font-mono text-rose-600">₱{(analytics?.combined_cogs || 0).toLocaleString()}</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* SECTION 4 — INVENTORY OVERVIEW */}
      <div className="space-y-4">
        <SectionLabel icon={<Package size={14} />} label="Section 4 — Inventory Asset Summary" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Quick Indicators Stats */}
          <div className="md:col-span-1 bg-white border-2 border-[#dfd5c6] rounded-3xl p-6 shadow-sm space-y-4 flex flex-col justify-between">
            <span className="text-xs font-black uppercase text-slate-500 block tracking-wider">Indicators</span>
            <div className="space-y-3.5 text-xs font-bold text-slate-600">
              <div className="flex justify-between items-center py-2 border-b border-slate-100">
                <span>Available Materials Stock:</span>
                <span className="font-mono text-slate-800 font-black">{analytics?.raw_items_count || 0} active rows</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-100">
                <span>Low-Stock Warnings:</span>
                <span className={`font-mono font-black ${ingredients.length > 0 ? "text-amber-600" : "text-emerald-600"}`}>{ingredients.length} items</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-100">
                <span>Expiring Batches (15d):</span>
                <span className={`font-mono font-black ${batches.length > 0 ? "text-rose-600" : "text-emerald-600"}`}>{batches.length} batches</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-100">
                <span>Hidden / Inactive Products:</span>
                <span className="font-mono text-slate-500">None mapped</span>
              </div>
            </div>
          </div>

          {/* Top 3 Low stock items with quick link */}
          <div className="md:col-span-2 bg-white border-2 border-[#dfd5c6] rounded-3xl p-6 shadow-sm flex flex-col justify-between">
            <div className="flex justify-between items-center">
              <span className="text-xs font-black uppercase text-slate-500 block tracking-wider">Top Low-Stock Dispatches</span>
              <button onClick={() => router.push("/inventory")} className="text-[10px] font-black text-primary hover:underline uppercase tracking-wider">View All</button>
            </div>
            <div className="space-y-2.5 mt-4">
              {ingredients.length === 0 ? (
                <div className="text-center text-xs text-slate-400 italic py-6">All stocks are completely healthy.</div>
              ) : (
                ingredients.slice(0, 3).map((item) => (
                  <div key={item.id} className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex justify-between items-center text-xs font-bold">
                    <span>{item.name} ({item.unit})</span>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-rose-600">Stock: {item.available_stock}</span>
                      <Button size="sm" variant="outline" className="h-8 text-[10px] border-slate-350" onClick={() => handleTriggerDraftPO(item)}>Replenish</Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>

      {/* SECTION 5 — OPERATIONS AND EVENTS */}
      <div className="space-y-4">
        <SectionLabel icon={<ClipboardCheck size={14} />} label="Section 5 — Operations Schedule &amp; Facility Tasks" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          
          {/* Unfinished Production Plans & targets */}
          <Card className="rounded-3xl border-slate-200 overflow-hidden shadow-sm flex flex-col justify-between">
            <CardHeader className="p-5 bg-slate-50/50 border-b border-slate-100 flex justify-between items-center">
              <div>
                <CardTitle className="text-xs uppercase tracking-wider font-black text-slate-550 flex items-center gap-1.5">
                  <ChefHat size={14} className="text-primary" /> Unfinished Production Schedules
                </CardTitle>
              </div>
              <button onClick={() => router.push("/planner")} className="text-[10px] font-black text-primary hover:underline uppercase tracking-wider">Open Planner</button>
            </CardHeader>
            <CardContent className="p-5 flex-1 flex flex-col justify-center">
              {todayPlan ? (
                <div className="space-y-3.5">
                  <div className="flex justify-between items-center p-3 bg-primary/5 border border-primary/20 rounded-2xl">
                    <div>
                      <span className="text-xs text-slate-500 font-bold block">Production Date</span>
                      <strong className="text-base text-slate-800 font-mono block mt-1">{todayPlan.plan_date}</strong>
                    </div>
                    <span className={`px-2.5 py-1 text-xs font-black rounded-lg uppercase tracking-wider border ${
                      todayPlan.status === "completed" 
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                        : "bg-amber-50 text-amber-700 border-amber-200 animate-pulse"
                    }`}>
                      {todayPlan.status}
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {todayPlan.targets?.slice(0, 3).map((t) => (
                      <div key={t.id} className="flex justify-between text-xs font-bold text-slate-600 py-1.5 border-b border-slate-100">
                        <span>{t.product_name} <span className="font-mono text-[9px] text-slate-400 font-semibold">({t.size})</span></span>
                        <span className="font-mono font-black">{t.target_qty} jars</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center text-xs text-slate-400 italic py-6">No pending schedules found.</div>
              )}
            </CardContent>
          </Card>

          {/* Kitchen Checklist progress ring */}
          <Card className="rounded-3xl border-slate-200 overflow-hidden shadow-sm flex flex-col justify-between">
            <CardHeader className="p-5 bg-slate-50/50 border-b border-slate-100">
              <CardTitle className="text-xs uppercase tracking-wider font-black text-slate-550 flex items-center gap-1.5">
                <ClipboardCheck size={14} className="text-emerald-500" /> Daily Kitchen Sanitation Checklists
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 flex-1 flex items-center justify-between gap-6">
              <div className="relative shrink-0">
                <ProgressRing pct={sanitationPct} size={72} stroke={6} color={sanitationPct === 100 ? "#10b981" : sanitationPct > 50 ? "#f59e0b" : "#ef4444"} />
                <span className="absolute inset-0 flex items-center justify-center text-sm font-black text-slate-800">{sanitationPct}%</span>
              </div>
              <div className="flex-1 min-w-0 space-y-1.5 text-xs font-bold text-slate-500">
                <span className="text-sm font-black text-slate-800 block">Sanitation Score today</span>
                <p className="font-semibold leading-relaxed">
                  {completedTasks} out of {totalTasks} standard facility sanitation checklists completed. Ensure all station tables are sanitized before lockup.
                </p>
                <button onClick={() => router.push("/tasks")} className="text-primary font-black hover:underline mt-1 text-[11px] uppercase tracking-wide block">Complete Checklist</button>
              </div>
            </CardContent>
          </Card>

        </div>
      </div>

      {/* MODALS */}
      <PromptModal
        isOpen={isSettleOpen}
        onClose={() => { setIsSettleOpen(false); setSelectedDeliveryId(null); }}
        onConfirm={handleSettleConfirm}
        title="Settle Consignment Payment"
        message="Select the date payment was received (Cash, GCash, or Bank Deposit)."
        defaultValue={new Date().toISOString().split("T")[0]}
        inputType="date"
        confirmLabel="Mark Paid"
        isLoading={actionLoading}
      />

      {selectedIngredient && draftPo && (
        <ConfirmationModal
          isOpen={isPOOpen}
          onClose={() => { setIsPOOpen(false); setDraftPo(null); setSelectedIngredient(null); }}
          onConfirm={async () => {
            alert(`Draft PO ${draftPo.po_number} registered! Send to ${draftPo.supplier_name}.`);
            setIsPOOpen(false); setDraftPo(null); setSelectedIngredient(null);
          }}
          title="Replenish Safety Supply"
          confirmLabel="Approve PO"
          cancelLabel="Close"
          type="info"
          message={
            <div className="font-sans text-sm space-y-4 text-slate-700 leading-relaxed">
              <div className="border-b border-slate-150 pb-3">
                <span className="font-bold text-xs uppercase text-slate-400">Draft PO Number:</span>
                <p className="font-mono font-black text-slate-900 text-lg mt-0.5">{draftPo.po_number}</p>
              </div>
              <div>
                <span className="font-bold text-xs uppercase text-slate-400 block">Supplier:</span>
                <strong className="text-slate-850 text-base">{draftPo.supplier_name}</strong>
              </div>
              <div className="border-y border-slate-150 py-3 space-y-2">
                <span className="font-bold text-xs uppercase text-slate-400 block">Items:</span>
                {draftPo.items.map((it, i) => (
                  <p key={i} className="font-mono font-semibold text-slate-800">
                    {it.ingredient_name} × {it.quantity} {it.unit} — ₱{it.subtotal.toLocaleString()}
                  </p>
                ))}
              </div>
              <div className="flex justify-between items-center text-slate-900 font-extrabold text-base pt-1">
                <span>Estimated Pay:</span>
                <span className="text-lg font-mono text-primary font-black">₱{draftPo.grand_total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          }
        />
      )}

      <div className="text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-6">
        * All financial figures, margins, recipes, and histories are synthetic sandbox data.
      </div>

    </div>
  );
}
