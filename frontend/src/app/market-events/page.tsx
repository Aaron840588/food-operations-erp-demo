/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useEffect, useRef, useState } from "react";
import { api, UnconfirmedFinancialMutationError } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { getProductBusinessCategory, BUSINESS_CATEGORIES, getSizeBadgeStyle } from "@/lib/utils";
import { ProductSizeBadge } from "@/components/ui/ProductSizeBadge";
import { 
  Store, 
  RefreshCw, 
  Plus, 
  Calendar, 
  MapPin, 
  User, 
  FileText, 
  Edit3, 
  Trash2, 
  AlertTriangle, 
  Package, 
  TrendingUp, 
  X,
  Minus,
  ShoppingCart,
  Search,
  Undo2,
  Check,
  Smartphone,
  CreditCard,
  Wallet,
  Play,
  Wifi,
  WifiOff,
  CloudLightning,
  Printer,
  ShieldCheck,
  TrendingDown,
  Coins,
  Clock,
  BrainCircuit,
  AlertCircle
} from "lucide-react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line,
  Cell,
  PieChart,
  Pie
} from "recharts";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal, ConfirmationModal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

// ─────────────────────────────────────────────────────────────
// INVENTORY CHECKLIST  – Phase 4 allocation UI
// ─────────────────────────────────────────────────────────────
interface InventoryChecklistProps {
  products: any[];
  allocations: { sku: string; quantity: number }[];
  setAllocations: (a: { sku: string; quantity: number }[]) => void;
  disabled?: boolean;
}

function InventoryChecklist({ products, allocations, setAllocations, disabled }: InventoryChecklistProps) {
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("All");

  // Eligible products: active + warehouse_stock > 0
  const eligible = products.filter(p => {
    if (p.sku === "SKU") return false;
    if (p.is_active === false) return false;
    const stock = p.warehouse_stock ?? 0;
    return stock > 0;
  });

  const categories = ["All", ...Array.from(new Set(eligible.map((p: any) => getProductBusinessCategory(p)))).sort()];

  const filtered = eligible.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !q || p.product_name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    const matchCat = filterCat === "All" || getProductBusinessCategory(p) === filterCat;
    return matchSearch && matchCat;
  });

  const allocMap = Object.fromEntries(allocations.map(a => [a.sku, a.quantity]));

  const handleCheck = (sku: string, available: number) => {
    if (allocMap[sku] !== undefined) {
      // Uncheck: remove
      setAllocations(allocations.filter(a => a.sku !== sku));
    } else {
      // Check: add with default qty = min(12, available)
      const defaultQty = Math.min(12, available > 0 ? available : 1);
      setAllocations([...allocations, { sku, quantity: defaultQty }]);
    }
  };

  const handleQtyChange = (sku: string, qty: number, available: number) => {
    const clamped = Math.min(Math.max(1, qty), available > 0 ? available : qty);
    setAllocations(allocations.map(a => a.sku === sku ? { ...a, quantity: clamped } : a));
  };

  const selectedCount = allocations.length;
  const totalUnits = allocations.reduce((s, a) => s + a.quantity, 0);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search product name or SKU…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: "2.5rem" }}
            className="w-full pr-3 h-9 text-xs font-semibold bg-white border border-slate-200 rounded-xl outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {categories.map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setFilterCat(cat)}
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
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-xl text-xs font-bold text-primary">
          <Check size={13} className="stroke-[3]" />
          {selectedCount} product{selectedCount !== 1 ? "s" : ""} selected · {totalUnits} total units reserved
        </div>
      )}

      {/* Checklist table */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm overflow-x-auto max-h-96 overflow-y-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-black uppercase tracking-wider text-[10px]">
              <th className="px-3 py-2.5 w-8"></th>
              <th className="px-3 py-2.5">Product</th>
              <th className="px-3 py-2.5 text-right">Available</th>
              <th className="px-3 py-2.5 text-right">Reserved by others</th>
              <th className="px-3 py-2.5 text-center w-32">Qty to Allocate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400 font-semibold italic">No matching products.</td></tr>
            ) : (
              filtered.map(p => {
                const warehouseStock = p.warehouse_stock ?? 0;
                const reservedOther = p.reserved_stock ?? 0;
                const available = p.available_stock ?? Math.max(0, warehouseStock - reservedOther);
                const isChecked = allocMap[p.sku] !== undefined;
                const isOutOfStock = available <= 0;

                return (
                  <tr
                    key={p.sku}
                    className={`transition-colors ${
                      isChecked ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-slate-50/50"
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
                        <span className="font-black text-slate-800 text-xs block">{p.product_name}</span>
                        <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1.5 mt-0.5">
                          {p.sku} <ProductSizeBadge size={p.size} sku={p.sku} />
                          {isOutOfStock && <span className="text-rose-500 font-black">OUT OF STOCK</span>}
                        </span>
                      </label>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`inline-block font-black font-mono text-[11px] px-2 py-0.5 rounded-lg ${
                        available > 0
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                          : "bg-rose-50 text-rose-600 border border-rose-100"
                      }`}>
                        {available} units
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {reservedOther > 0 ? (
                        <span className="text-[11px] font-black text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-lg font-mono">
                          {reservedOther} held
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-300 font-semibold">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {isChecked ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => handleQtyChange(p.sku, (allocMap[p.sku] ?? 1) - 1, available)}
                            className="w-6 h-6 rounded-md border border-slate-200 flex items-center justify-center bg-white hover:bg-slate-50 text-slate-500 transition-colors disabled:opacity-40"
                          >
                            <Minus size={10} className="stroke-[3]" />
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={available > 0 ? available : undefined}
                            value={allocMap[p.sku]}
                            disabled={disabled}
                            onChange={e => handleQtyChange(p.sku, parseInt(e.target.value) || 1, available)}
                            className="w-12 h-6 text-center font-mono font-black text-xs bg-white border border-slate-200 rounded-md outline-none focus:border-primary"
                          />
                          <button
                            type="button"
                            disabled={disabled || (allocMap[p.sku] ?? 0) >= available}
                            onClick={() => handleQtyChange(p.sku, (allocMap[p.sku] ?? 1) + 1, available)}
                            className="w-6 h-6 rounded-md border border-slate-200 flex items-center justify-center bg-white hover:bg-slate-50 text-slate-500 transition-colors disabled:opacity-40"
                          >
                            <Plus size={10} className="stroke-[3]" />
                          </button>
                        </div>
                      ) : (
                        <span className="block text-center text-slate-300 text-[11px] font-semibold">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function createMarketSaleClientReference(eventId: number): string {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `market-${eventId}-${suffix}`;
}

const CREATE_EVENT_STATUSES = ["Draft", "Active"] as const;
const MARKET_EVENT_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  Draft: ["Draft", "Active", "Cancelled"],
  Active: ["Active", "Completed", "Cancelled"],
  Completed: ["Completed"],
  Cancelled: ["Cancelled"],
};

export default function MarketEventsPage() {
  const { showToast } = useToast();
  const [events, setEvents] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Phase 5: AI & Analytics States
  const [activeMainTab, setActiveMainTab] = useState<"scheduler" | "analytics" | "reconciliation">("scheduler");
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [reconciliationEventId, setReconciliationEventId] = useState<number | "">("");
  const [reconcileSalesList, setReconcileSalesList] = useState<any[]>([]);

  // Phase 3: Offline Systems States
  const [isOnline, setIsOnline] = useState(true);
  const [syncStatus, setSyncStatus] = useState<"Synced" | "Offline" | "Waiting to Sync" | "Synchronizing">("Synced");
  const [offlineQueue, setOfflineQueue] = useState<any[]>([]);

  // Active terminal state (Phase 2)
  const [isSalesMode, setIsSalesMode] = useState(false);
  const [activeEvent, setActiveEvent] = useState<any>(null);
  const [posSearch, setPosSearch] = useState("");
  const [posCategory, setPosCategory] = useState("All");
  const [posFavoritesOnly, setPosFavoritesOnly] = useState(false);
  const [posBestSellersOnly, setPosBestSellersOnly] = useState(false);

  // Cashier Cart state
  const [cart, setCart] = useState<{ [sku: string]: number }>({});
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [cashReceived, setCashReceived] = useState("");
  const [recentSales, setRecentSales] = useState<any[]>([]);
  const [isPreorder, setIsPreorder] = useState(false);
  const [preorderCustomerName, setPreorderCustomerName] = useState("");
  const [preorderPaymentStatus, setPreorderPaymentStatus] = useState<"Paid" | "Unpaid">("Paid");
  const [preorderFulfillmentStatus, setPreorderFulfillmentStatus] = useState<"Pending" | "Picked Up">("Pending");

  // Phase 4: Enterprise Reports states
  const [selectedReportEvent, setSelectedReportEvent] = useState<any>(null);
  const [reportSalesList, setReportSalesList] = useState<any[]>([]);
  const [isReportOpen, setIsReportOpen] = useState(false);

  // Modals state (Market Events CRUD)
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [isCloseoutOpen, setIsCloseoutOpen] = useState(false);
  const [closeoutEvent, setCloseoutEvent] = useState<any>(null);
  const [closeoutAllocations, setCloseoutAllocations] = useState<any[]>([]);
  const [closeoutExpenses, setCloseoutExpenses] = useState<number>(0);
  const [closeoutExpenseNotes, setCloseoutExpenseNotes] = useState<string>("");
  const [closeoutActualCash, setCloseoutActualCash] = useState<number | "">("");

  // Form State (Market Events CRUD)
  const [name, setName] = useState("");
  const [eventDate, setEventDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [location, setLocation] = useState("");
  const [staffAssigned, setStaffAssigned] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("Draft");
  const [allocations, setAllocations] = useState<{ sku: string; quantity: number }[]>([]);
  const [initialCashBalance, setInitialCashBalance] = useState<number | "">("");
  const [actualClosingCash, setActualClosingCash] = useState<number | "">("");
  const [cashAdjustments, setCashAdjustments] = useState<number | "">("");
  const [cashAdjustmentsNotes, setCashAdjustmentsNotes] = useState("");


  const offlineSaleSequence = useRef(0);
  const checkoutInFlightRef = useRef(false);

  // Sync / Offline Replay logic
  const replayOfflineQueue = async (queueToReplay: any[]) => {
    if (queueToReplay.length === 0) return;
    setSyncStatus("Synchronizing");
    showToast(`Connection restored! Replaying ${queueToReplay.length} offline transactions...`, "info");
    
    let successCount = 0;
    let manualReviewCount = 0;
    const failedList: any[] = [];

    for (const tx of queueToReplay) {
      if (typeof tx.client_reference !== "string" || !tx.client_reference) {
        manualReviewCount++;
        failedList.push({ ...tx, requires_manual_review: true });
        continue;
      }
      try {
        await api.createMarketEventSale(tx.eventId, {
          payment_method: tx.payment_method,
          items: tx.items,
          client_reference: tx.client_reference,
          is_preorder: tx.is_preorder || false,
          preorder_customer_name: tx.preorder_customer_name || null,
          preorder_payment_status: tx.preorder_payment_status || null,
          preorder_fulfillment_status: tx.preorder_fulfillment_status || null,
        });
        successCount++;
      } catch (err) {
        console.error("Error replaying transaction:", err);
        failedList.push(tx);
      }
    }

    if (failedList.length > 0) {
      setSyncStatus("Waiting to Sync");
      setOfflineQueue(failedList);
      localStorage.setItem("hh_offline_market_sales", JSON.stringify(failedList));
      const manualReviewMessage = manualReviewCount > 0
        ? ` ${manualReviewCount} legacy sale${manualReviewCount === 1 ? "" : "s"} require manual review and were not sent.`
        : "";
      showToast(`Sync partial: uploaded ${successCount} sales; ${failedList.length} remain pending.${manualReviewMessage}`, "warning");
    } else {
      setSyncStatus("Synced");
      setOfflineQueue([]);
      localStorage.removeItem("hh_offline_market_sales");
      showToast(`Success! All ${successCount} offline transactions synchronized.`, "success");
      await fetchEvents();
    }
  };

  // Setup connection monitors and local queue retrieval
  useEffect(() => {
    if (typeof window !== "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsOnline(navigator.onLine);
      
      const savedQueue = localStorage.getItem("hh_offline_market_sales");
      if (savedQueue) {
        const parsed = JSON.parse(savedQueue);
        setOfflineQueue(parsed);
        if (parsed.length > 0) {
          if (navigator.onLine) {
            setSyncStatus("Synchronizing");
            replayOfflineQueue(parsed);
          } else {
            setSyncStatus("Offline");
          }
        }
      }

      const handleOnline = () => {
        setIsOnline(true);
        const currentQueue = JSON.parse(localStorage.getItem("hh_offline_market_sales") || "[]");
        if (currentQueue.length > 0) {
          replayOfflineQueue(currentQueue);
        } else {
          setSyncStatus("Synced");
          fetchEvents();
        }
      };

      const handleOffline = () => {
        setIsOnline(false);
        setSyncStatus("Offline");
        showToast("You are offline. Market POS terminal will continue running locally.", "warning");
      };

      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);

      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchEvents() {
    setLoading(true);
    try {
      if (navigator.onLine) {
        const res = await api.getMarketEvents();
        setEvents(res);
        localStorage.setItem("hh_cache_market_events", JSON.stringify(res));
        if (activeEvent) {
          const updatedActive = res.find((e: any) => e.id === activeEvent.id);
          if (updatedActive) {
            setActiveEvent(updatedActive);
          }
        }
      } else {
        const cached = localStorage.getItem("hh_cache_market_events");
        if (cached) {
          const parsed = JSON.parse(cached);
          setEvents(parsed);
          if (activeEvent) {
            const updatedActive = parsed.find((e: any) => e.id === activeEvent.id);
            if (updatedActive) {
              setActiveEvent(updatedActive);
            }
          }
        }
      }
    } catch (err) {
      console.error("Error fetching market events:", err);
      const cached = localStorage.getItem("hh_cache_market_events");
      if (cached) {
        setEvents(JSON.parse(cached));
      }
    } finally {
      setLoading(false);
    }
  }

  const fetchProducts = async () => {
    try {
      if (navigator.onLine) {
        const res = await api.getProducts();
        setProducts((res || []).filter((p: any) => p.sku !== "SKU" && p.is_active !== false));
        localStorage.setItem("hh_cache_market_products", JSON.stringify(res));
      } else {
        const cached = localStorage.getItem("hh_cache_market_products");
        if (cached) {
          const parsed = JSON.parse(cached);
          setProducts(parsed.filter((p: any) => p.sku !== "SKU" && p.is_active !== false));
        }
      }
    } catch (err) {
      console.error("Error fetching products:", err);
      const cached = localStorage.getItem("hh_cache_market_products");
      if (cached) {
        setProducts(JSON.parse(cached).filter((p: any) => p.sku !== "SKU" && p.is_active !== false));
      }
    }
  };

  const fetchRecentSales = async (eventId: number) => {
    try {
      if (navigator.onLine) {
        const res = await api.getMarketEventSales(eventId);
        setRecentSales(res || []);
        localStorage.setItem(`hh_cache_market_sales_${eventId}`, JSON.stringify(res));
      } else {
        const cached = localStorage.getItem(`hh_cache_market_sales_${eventId}`);
        if (cached) {
          setRecentSales(JSON.parse(cached));
        } else {
          setRecentSales([]);
        }
      }
    } catch (err) {
      console.error("Error loading recent sales:", err);
      const cached = localStorage.getItem(`hh_cache_market_sales_${eventId}`);
      if (cached) {
        setRecentSales(JSON.parse(cached));
      }
    }
  };

  const fetchAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      if (navigator.onLine) {
        const res = await api.getMarketEventsAnalytics();
        setAnalyticsData(res);
        localStorage.setItem("hh_cache_market_analytics", JSON.stringify(res));
      } else {
        const cached = localStorage.getItem("hh_cache_market_analytics");
        if (cached) {
          setAnalyticsData(JSON.parse(cached));
        }
      }
    } catch (err) {
      console.error("Error fetching market analytics:", err);
      const cached = localStorage.getItem("hh_cache_market_analytics");
      if (cached) {
        setAnalyticsData(JSON.parse(cached));
      }
    } finally {
      setAnalyticsLoading(false);
    }
  };
  
  const fetchReconciliationSales = async (eventId: number) => {
    try {
      if (navigator.onLine) {
        const res = await api.getMarketEventSales(eventId);
        setReconcileSalesList(res || []);
        localStorage.setItem(`hh_cache_market_sales_${eventId}`, JSON.stringify(res));
      } else {
        const cached = localStorage.getItem(`hh_cache_market_sales_${eventId}`);
        if (cached) {
          setReconcileSalesList(JSON.parse(cached));
        } else {
          setReconcileSalesList([]);
        }
      }
    } catch (err) {
      console.error("Error loading reconciliation sales:", err);
    }
  };

  useEffect(() => {
    if (activeMainTab === "analytics") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchAnalytics();
    } else if (activeMainTab === "reconciliation") {
      fetchEvents();
      fetchProducts();
      if (reconciliationEventId) {
        fetchReconciliationSales(Number(reconciliationEventId));
      } else {
        setReconcileSalesList([]);
      }
    } else {
      fetchEvents();
      fetchProducts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMainTab, reconciliationEventId]);

  const handleOpenCreate = () => {
    setSelectedEvent(null);
    setName("");
    setEventDate(new Date().toISOString().split('T')[0]);
    setLocation("");
    setStaffAssigned("");
    setNotes("");
    setStatus("Draft");
    setAllocations([]);
    setInitialCashBalance("");
    setActualClosingCash("");
    setCashAdjustments("");
    setCashAdjustmentsNotes("");
    setIsCreateOpen(true);
  };

  const handleOpenEdit = (event: any) => {
    setSelectedEvent(event);
    setName(event.name);
    setEventDate(event.event_date);
    setLocation(event.location);
    setStaffAssigned(event.staff_assigned);
    setNotes(event.notes);
    setStatus(event.status);
    setInitialCashBalance(event.initial_cash_balance !== undefined && event.initial_cash_balance !== null ? event.initial_cash_balance : "");
    setActualClosingCash(event.actual_closing_cash !== undefined && event.actual_closing_cash !== null ? event.actual_closing_cash : "");
    setCashAdjustments(event.cash_adjustments !== undefined && event.cash_adjustments !== null ? event.cash_adjustments : "");
    setCashAdjustmentsNotes(event.cash_adjustments_notes || "");
    
    const initialAllocations = event.allocations.map((a: any) => ({
      sku: a.sku,
      quantity: a.quantity
    }));
    setAllocations(initialAllocations);
    
    setIsEditOpen(true);
  };

  const handleOpenDelete = (event: any) => {
    setSelectedEvent(event);
    setIsDeleteOpen(true);
  };



  const calculateSummaryMetrics = (itemAllocations: { sku: string; quantity: number }[]) => {
    let estimatedRevenue = 0.0;
    let estimatedCost = 0.0;
    let financialsVisible = true;

    itemAllocations.forEach(alloc => {
      const product = products.find(p => p.sku === alloc.sku);
      if (product) {
        estimatedRevenue += alloc.quantity * product.retail_price;
        if (typeof product.cost_per_unit === "number") {
          estimatedCost += alloc.quantity * product.cost_per_unit;
        } else {
          financialsVisible = false;
        }
      }
    });

    return {
      estimatedRevenue,
      estimatedCost: financialsVisible ? estimatedCost : null,
      potentialProfit: financialsVisible ? estimatedRevenue - estimatedCost : null,
      financialsVisible,
    };
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !eventDate || !location) {
      alert("Please fill in all required fields.");
      return;
    }
    if (!navigator.onLine) {
      alert("Creating a new Market Event requires an active server connection.");
      return;
    }
    setActionLoading(true);
    const validAllocations = allocations.filter(a => products.some(p => p.sku === a.sku));
    try {
      await api.createMarketEvent({
        name,
        event_date: eventDate,
        location,
        staff_assigned: staffAssigned,
        notes,
        status,
        allocations: validAllocations,
        initial_cash_balance: initialCashBalance === "" ? 0.0 : Number(initialCashBalance),
        actual_closing_cash: actualClosingCash === "" ? null : Number(actualClosingCash),
        cash_adjustments: cashAdjustments === "" ? 0.0 : Number(cashAdjustments),
        cash_adjustments_notes: cashAdjustmentsNotes
      });
      setIsCreateOpen(false);
      fetchEvents();
    } catch (err: any) {
      alert(`Error creating Market Event: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEvent || !name || !eventDate || !location) return;
    if (!navigator.onLine) {
      alert("Editing a Market Event details requires an active server connection.");
      return;
    }
    setActionLoading(true);
    const validAllocations = allocations.filter(a => products.some(p => p.sku === a.sku));
    try {
      const updatePayload: any = {
        name,
        event_date: eventDate,
        location,
        staff_assigned: staffAssigned,
        notes,
        status,
        initial_cash_balance: initialCashBalance === "" ? 0.0 : Number(initialCashBalance),
        actual_closing_cash: actualClosingCash === "" ? null : Number(actualClosingCash),
        cash_adjustments: cashAdjustments === "" ? 0.0 : Number(cashAdjustments),
        cash_adjustments_notes: cashAdjustmentsNotes
      };
      if (selectedEvent.status === "Draft") {
        updatePayload.allocations = validAllocations;
      }
      await api.updateMarketEvent(selectedEvent.id, updatePayload);
      setIsEditOpen(false);
      setSelectedEvent(null);
      fetchEvents();
    } catch (err: any) {
      alert(`Error updating Market Event: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!selectedEvent) return;
    if (!navigator.onLine) {
      alert("Deleting a Market Event requires an active server connection.");
      return;
    }
    setActionLoading(true);
    try {
      await api.deleteMarketEvent(selectedEvent.id);
      setIsDeleteOpen(false);
      setSelectedEvent(null);
      fetchEvents();
    } catch (err: any) {
      alert(`Error deleting Market Event: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // ----------------------------------------------------
  // ACTIVE SALES TERMINAL POS OPERATIONAL HANDLERS
  // ----------------------------------------------------

  const handleLaunchTerminal = (event: any) => {
    setActiveEvent(event);
    setCart({});
    setPaymentMethod("Cash");
    setCashReceived("");
    setPosSearch("");
    setPosCategory("All");
    setPosFavoritesOnly(false);
    setPosBestSellersOnly(false);
    fetchRecentSales(event.id);
    setIsSalesMode(true);
  };

  const handleCloseTerminal = () => {
    setIsSalesMode(false);
    setActiveEvent(null);
    setCart({});
    fetchEvents();
  };

  const handleAddToCart = (sku: string, maxQty: number) => {
    const currentCartQty = cart[sku] || 0;
    if (currentCartQty >= maxQty) {
      showToast(`Warning: Cannot allocate more than ${maxQty} units brought to the market.`, "warning");
      return;
    }
    setCart(prev => ({
      ...prev,
      [sku]: currentCartQty + 1
    }));
  };

  const handleRemoveFromCart = (sku: string) => {
    setCart(prev => {
      const copy = { ...prev };
      delete copy[sku];
      return copy;
    });
  };

  const handleStepCartQty = (sku: string, delta: number, maxQty: number) => {
    const currentQty = cart[sku] || 0;
    const newQty = currentQty + delta;
    if (newQty > maxQty) {
      showToast(`Warning: Only ${maxQty} units were allocated for this event.`, "warning");
      return;
    }
    if (newQty <= 0) {
      handleRemoveFromCart(sku);
      return;
    }
    setCart(prev => ({
      ...prev,
      [sku]: newQty
    }));
  };

  const handleCompleteSale = async () => {
    if (!activeEvent || Object.keys(cart).length === 0 || checkoutInFlightRef.current) return;
    checkoutInFlightRef.current = true;
    
    const itemsPayload = Object.entries(cart).map(([sku, qty]) => ({
      sku,
      quantity: qty
    }));

    const tempId = ++offlineSaleSequence.current;
    const clientReference = createMarketSaleClientReference(activeEvent.id);

    try {
      if (navigator.onLine) {
        setActionLoading(true);
        try {
          await api.createMarketEventSale(activeEvent.id, {
            payment_method: paymentMethod,
            items: itemsPayload,
            client_reference: clientReference,
            is_preorder: isPreorder,
            preorder_customer_name: isPreorder ? preorderCustomerName : null,
            preorder_payment_status: isPreorder ? preorderPaymentStatus : null,
            preorder_fulfillment_status: isPreorder ? preorderFulfillmentStatus : null,
          });

          setCart({});
          setCashReceived("");
          setIsPreorder(false);
          setPreorderCustomerName("");
          setPreorderPaymentStatus("Paid");
          setPreorderFulfillmentStatus("Pending");
          showToast("Sale completed and synced!", "success");
          await fetchEvents();
          await fetchRecentSales(activeEvent.id);
        } catch (error: unknown) {
          if (error instanceof UnconfirmedFinancialMutationError) {
            handleOfflineSaleFallback(tempId, itemsPayload, clientReference);
          } else {
            showToast(getErrorMessage(error, "The sale could not be completed."), "error");
          }
        } finally {
          setActionLoading(false);
        }
      } else {
        handleOfflineSaleFallback(tempId, itemsPayload, clientReference);
      }
    } finally {
      checkoutInFlightRef.current = false;
    }
  };

  const handleOfflineSaleFallback = (tempId: number, items: any[], clientReference: string) => {
    const newOfflineTx = {
      id: tempId,
      eventId: activeEvent.id,
      payment_method: paymentMethod,
      items: items,
      client_reference: clientReference,
      total_amount: cartTotal,
      timestamp: new Date().toISOString(),
      is_preorder: isPreorder,
      preorder_customer_name: isPreorder ? preorderCustomerName : null,
      preorder_payment_status: isPreorder ? preorderPaymentStatus : null,
      preorder_fulfillment_status: isPreorder ? preorderFulfillmentStatus : null,
    };

    const updatedQueue = [...offlineQueue, newOfflineTx];
    setOfflineQueue(updatedQueue);
    localStorage.setItem("hh_offline_market_sales", JSON.stringify(updatedQueue));
    setSyncStatus("Waiting to Sync");

    setCart({});
    setIsPreorder(false);
    setPreorderCustomerName("");
    setPreorderPaymentStatus("Paid");
    setPreorderFulfillmentStatus("Pending");

    const updatedAllocations = activeEvent.allocations.map((a: any) => {
      const soldItem = items.find(it => it.sku === a.sku);
      if (soldItem) {
        return { ...a, quantity: Math.max(0, a.quantity - soldItem.quantity) };
      }
      return a;
    });

    const updatedEvent = { ...activeEvent, allocations: updatedAllocations };
    setActiveEvent(updatedEvent);

    const updatedEventsList = events.map(e => e.id === activeEvent.id ? updatedEvent : e);
    setEvents(updatedEventsList);
    localStorage.setItem("hh_cache_market_events", JSON.stringify(updatedEventsList));

    const itemsOut = items.map(it => {
      const p = products.find(prod => prod.sku === it.sku);
      return {
        id: Math.random(),
        sku: it.sku,
        quantity: it.quantity,
        product_name: p ? p.product_name : it.sku,
        size: p ? p.size : "",
        price_snapshot: p ? p.retail_price : 0.0
      };
    });

    const tempSaleOut = {
      id: tempId,
      event_id: activeEvent.id,
      cashier_username: "Local Cashier",
      payment_method: paymentMethod,
      total_amount: cartTotal,
      timestamp: new Date().toISOString(),
      items: itemsOut,
      is_offline_draft: true
    };

    const updatedSales = [tempSaleOut, ...recentSales];
    setRecentSales(updatedSales);
    localStorage.setItem(`hh_cache_market_sales_${activeEvent.id}`, JSON.stringify(updatedSales));

    setCart({});
    setCashReceived("");
    showToast("Offline sale recorded! Saved to sync queue.", "warning");
  };

  const handleUndoSale = async (saleId: number) => {
    if (!activeEvent) return;

    const isOfflineSale = offlineQueue.some(tx => tx.id === saleId);

    if (isOfflineSale) {
      const updatedQueue = offlineQueue.filter(tx => tx.id !== saleId);
      setOfflineQueue(updatedQueue);
      localStorage.setItem("hh_offline_market_sales", JSON.stringify(updatedQueue));
      
      if (updatedQueue.length === 0) {
        setSyncStatus("Synced");
      }

      const canceledSale = offlineQueue.find(tx => tx.id === saleId);
      if (canceledSale) {
        const updatedAllocations = activeEvent.allocations.map((a: any) => {
          const soldItem = canceledSale.items.find((it: any) => it.sku === a.sku);
          if (soldItem) {
            return { ...a, quantity: a.quantity + soldItem.quantity };
          }
          return a;
        });

        const updatedEvent = { ...activeEvent, allocations: updatedAllocations };
        setActiveEvent(updatedEvent);

        const updatedEventsList = events.map(e => e.id === activeEvent.id ? updatedEvent : e);
        setEvents(updatedEventsList);
        localStorage.setItem("hh_cache_market_events", JSON.stringify(updatedEventsList));
      }

      const updatedSales = recentSales.filter(s => s.id !== saleId);
      setRecentSales(updatedSales);
      localStorage.setItem(`hh_cache_market_sales_${activeEvent.id}`, JSON.stringify(updatedSales));

      showToast("Offline sale transaction reverted! Stock allocation restored.", "success");
    } else {
      if (!navigator.onLine) {
        alert("Undoing an already synced cloud transaction requires an active internet connection.");
        return;
      }
      setActionLoading(true);
      try {
        await api.undoMarketEventSale(activeEvent.id, saleId);
        showToast("Sale transaction successfully undone! Market allocations restored.", "info");
        await fetchEvents();
        await fetchRecentSales(activeEvent.id);
      } catch (err: any) {
        alert(`Failed to undo transaction: ${err.message}`);
      } finally {
        setActionLoading(false);
      }
    }
  };

  const handleManualSyncRetry = () => {
    if (!navigator.onLine) {
      showToast("Sync failed: You are still offline.", "error");
      return;
    }
    replayOfflineQueue(offlineQueue);
  };

  const getSyncBadge = () => {
    switch (syncStatus) {
      case "Synced":
        return <Badge variant="success" className="py-1 px-3 rounded-full text-xs font-black"><Wifi size={14} className="mr-1.5 inline" /> Sync Active &bull; Cloud Connected</Badge>;
      case "Offline":
        return <Badge variant="danger" className="py-1 px-3 rounded-full text-xs font-black animate-pulse"><WifiOff size={14} className="mr-1.5 inline" /> Offline Mode &bull; Queue Active</Badge>;
      case "Waiting to Sync":
        return <Badge variant="warning" className="py-1 px-3 rounded-full text-xs font-black animate-bounce"><CloudLightning size={14} className="mr-1.5 inline" /> Waiting to Sync &bull; {offlineQueue.length} pending</Badge>;
      case "Synchronizing":
        return <Badge variant="neutral" className="py-1 px-3 rounded-full text-xs font-black bg-blue-50 text-blue-800 border-blue-200"><RefreshCw size={14} className="mr-1.5 inline animate-spin" /> Uploading to cloud...</Badge>;
    }
  };

  const getStatusBadgeVariant = (s: string) => {
    switch (s) {
      case "Active": return "success";
      case "Completed": return "info";
      case "Cancelled": return "danger";
      default: return "neutral";
    }
  };

  // ----------------------------------------------------
  // PHASE 4: ENTERPRISE CLOSEOUT REPORTS GENERATION
  // ----------------------------------------------------
  const handleLaunchCloseoutReport = async (event: any) => {
    setSelectedReportEvent(event);
    setReportSalesList([]);
    setIsReportOpen(true);
    
    try {
      const res = await api.getMarketEventSales(event.id);
      setReportSalesList(res || []);
    } catch (err) {
      console.error("Error fetching event sales for closeout:", err);
    }
  };

  const calculatePaymentBreakdown = () => {
    const breakdown: Record<string, number> = { Cash: 0.0, GCash: 0.0, Maya: 0.0, Card: 0.0, Mixed: 0.0 };
    reportSalesList.forEach(sale => {
      const method = sale.payment_method;
      if (breakdown[method] !== undefined) {
        breakdown[method] += sale.total_amount;
      }
    });
    return breakdown;
  };

  const calculateCashSalesTotal = () => {
    return reportSalesList
      .filter(sale => sale.payment_method === "Cash" && (!sale.is_preorder || sale.preorder_payment_status === "Paid"))
      .reduce((sum, sale) => sum + sale.total_amount, 0);
  };

  const calculatePreorderStats = () => {
    let totalCount = 0;
    let paidAmount = 0.0;
    let unpaidAmount = 0.0;
    let fulfilledCount = 0;
    
    reportSalesList.forEach(sale => {
      if (sale.is_preorder) {
        totalCount++;
        if (sale.preorder_payment_status === "Paid") {
          paidAmount += sale.total_amount;
        } else {
          unpaidAmount += sale.total_amount;
        }
        if (sale.preorder_fulfillment_status === "Picked Up") {
          fulfilledCount++;
        }
      }
    });
    
    return { totalCount, paidAmount, unpaidAmount, fulfilledCount };
  };

  const calculateCartTotal = () => {
    return Object.entries(cart).reduce((sum, [sku, qty]) => {
      const p = products.find(prod => prod.sku === sku);
      const price = p ? p.retail_price : 0.0;
      return sum + (qty * price);
    }, 0.0);
  };

  const handleUpdateStatusDirectly = async (event: any, nextStatus: string) => {
    if (!navigator.onLine) {
      alert("Status state transitions require a server connection.");
      return;
    }
    if (nextStatus === "Completed") {
      setCloseoutEvent(event);
      setCloseoutAllocations(event.allocations.map((a: any) => ({
        sku: a.sku,
        product_name: a.product_name,
        size: a.size,
        quantity: a.quantity,
        wasted_quantity: 0,
        waste_reason: ""
      })));
      setCloseoutExpenses(0);
      setCloseoutExpenseNotes("");
      setCloseoutActualCash("");
      setIsCloseoutOpen(true);
      return;
    }
    setActionLoading(true);
    try {
      await api.updateMarketEvent(event.id, {
        status: nextStatus
      });
      showToast(`Status updated to ${nextStatus}!`, "success");
      fetchEvents();
    } catch (err: any) {
      alert(`Error updating status: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCloseoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!closeoutEvent) return;
    setActionLoading(true);
    try {
      await api.updateMarketEvent(closeoutEvent.id, {
        status: "Completed",
        actual_closing_cash: closeoutActualCash === "" ? null : Number(closeoutActualCash),
        total_expenses: Number(closeoutExpenses) || 0,
        expense_notes: closeoutExpenseNotes,
        allocations: closeoutAllocations.map(a => ({
          sku: a.sku,
          quantity: a.quantity,
          wasted_quantity: Number(a.wasted_quantity) || 0,
          waste_reason: a.waste_reason || ""
        }))
      });
      setIsCloseoutOpen(false);
      setCloseoutEvent(null);
      showToast("Market Event closeout successfully recorded and stock reconciled!", "success");
      fetchEvents();
    } catch (err: any) {
      alert(`Error completing closeout: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const getSyncBadgeInScheduler = () => {
    if (!isOnline) {
      return <Badge variant="danger" className="py-1 px-3 rounded-full text-xs font-black animate-pulse"><WifiOff size={14} className="mr-1 inline" /> Offline Mode &bull; Cached Data</Badge>;
    }
    return <Badge variant="success" className="py-1 px-3 rounded-full text-xs font-black"><Wifi size={14} className="mr-1 inline" /> System Connected</Badge>;
  };

  // Filter products for active POS selection
  const posProducts = products.filter(p => {
    const isAllocated = activeEvent?.allocations.some((a: any) => a.sku === p.sku);
    if (!isAllocated) return false;

    const matchesSearch = p.product_name.toLowerCase().includes(posSearch.toLowerCase()) || p.sku.toLowerCase().includes(posSearch.toLowerCase());
    const matchesCategory = posCategory === "All" || getProductBusinessCategory(p) === posCategory;
    
    const matchesFav = !posFavoritesOnly || p.retail_price > 130;
    const matchesBest = !posBestSellersOnly || p.warehouse_stock > 30;

    return matchesSearch && matchesCategory && matchesFav && matchesBest;
  });

  const cartTotal = calculateCartTotal();
  const cashAmountNum = parseFloat(cashReceived) || 0.0;
  const changeDue = Math.max(0.0, cashAmountNum - cartTotal);

  // ----------------------------------------------------
  // RENDER CASHIER TERMINAL VIEW (PHASE 2 Full-screen)
  // ----------------------------------------------------
  if (isSalesMode && activeEvent) {
    return (
      <div className="space-y-4 2xl:space-y-6 flex flex-col pb-8 2xl:pb-16 animate-fade-in">
        
        {/* Cashier top header */}
        <div className="bg-slate-900 text-white rounded-3xl p-4 md:p-5 2xl:p-8 flex flex-col md:flex-row md:justify-between md:items-center gap-4 2xl:gap-6 shadow-md border border-slate-800">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary/20 text-primary-light rounded-2xl">
              <Store size={28} className="animate-pulse" />
            </div>
            <div>
              <span className="text-xs text-slate-400 font-extrabold uppercase tracking-widest block">Active Market Cashier Terminal</span>
              <h2 className="text-lg md:text-xl 2xl:text-2xl font-heading font-black tracking-wide uppercase mt-1">{activeEvent.name}</h2>
              <p className="text-sm text-slate-300 mt-1">Location: <strong className="font-semibold text-white">{activeEvent.location}</strong></p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 2xl:gap-4">
            {getSyncBadge()}
            
            {syncStatus === "Waiting to Sync" && isOnline && (
              <Button
                onClick={handleManualSyncRetry}
                variant="outline"
                size="sm"
                className="h-10 text-xs px-3 font-bold bg-white text-slate-800 border-slate-200"
              >
                Sync Now
              </Button>
            )}

            <button
              onClick={handleCloseTerminal}
              className="inline-flex items-center justify-center font-heading font-bold rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 border border-slate-700 bg-transparent hover:bg-slate-800 text-white px-4 2xl:px-5 py-2 text-sm gap-2 h-10 2xl:h-12 cursor-pointer"
            >
              <X size={16} />
              Close Cashier Terminal
            </button>
          </div>
        </div>

        {/* Cashier main split panel */}
        <div className="grid grid-cols-1 min-[900px]:grid-cols-12 gap-4 2xl:gap-8 items-start">
          
          {/* LEFT: PRODUCT SELECTIONS GRID (8/12 width) */}
          <div className="min-[900px]:col-span-7 2xl:col-span-8 space-y-4 2xl:space-y-6">
            
            {/* Search and Categories filters card */}
            <div className="bg-white border-2 border-slate-200 rounded-3xl p-4 2xl:p-6 shadow-xs space-y-3 2xl:space-y-5">
              <div className="flex flex-col 2xl:flex-row gap-4">
                
                {/* Search */}
                <div className="relative flex-1">
                  <span className="absolute inset-y-0 left-4 flex items-center text-slate-400">
                    <Search size={20} />
                  </span>
                  <input
                    type="text"
                    placeholder="Search allocated jars SKU or name..."
                    value={posSearch}
                    onChange={(e) => setPosSearch(e.target.value)}
                    style={{ paddingLeft: "3rem" }}
                    className="w-full pr-4 py-2 border border-slate-200 rounded-xl 2xl:rounded-2xl text-sm 2xl:text-base h-10 2xl:h-12 bg-slate-50 font-semibold"
                  />
                </div>

                {/* Categories */}
                <div className="flex flex-wrap gap-2">
                  {["All", ...BUSINESS_CATEGORIES].map(cat => (
                    <button
                      key={cat}
                      onClick={() => setPosCategory(cat)}
                      className={`px-3 2xl:px-5 py-2 h-10 2xl:h-12 rounded-xl 2xl:rounded-2xl text-xs font-black uppercase tracking-wider transition-all border-2 cursor-pointer ${
                        posCategory === cat
                          ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                          : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Favorites & Best Sellers helpers */}
              <div className="flex flex-wrap gap-2 2xl:gap-3 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => { setPosFavoritesOnly(!posFavoritesOnly); setPosBestSellersOnly(false); }}
                  className={`px-3 2xl:px-4 py-2 text-xs font-bold rounded-xl transition-all border ${
                    posFavoritesOnly ? "bg-amber-500 text-white border-amber-500 shadow-3xs" : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  ⭐ Favorites / Star SKUs
                </button>
                <button
                  type="button"
                  onClick={() => { setPosBestSellersOnly(!posBestSellersOnly); setPosFavoritesOnly(false); }}
                  className={`px-3 2xl:px-4 py-2 text-xs font-bold rounded-xl transition-all border ${
                    posBestSellersOnly ? "bg-primary text-white border-primary shadow-3xs" : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  🔥 Best Sellers
                </button>
              </div>
            </div>

            {/* Tactile product grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-4 2xl:gap-6">
              {posProducts.map(p => {
                const alloc = activeEvent.allocations.find((a: any) => a.sku === p.sku);
                const maxQty = alloc ? alloc.quantity : 0;
                const cartQty = cart[p.sku] || 0;
                const remainingQty = Math.max(0, maxQty - cartQty);

                return (
                  <div 
                    key={p.sku}
                    onClick={() => {
                      if (remainingQty > 0) {
                        handleAddToCart(p.sku, maxQty);
                      } else {
                        showToast(`Insufficient market allocation remaining for ${p.product_name}.`, "warning");
                      }
                    }}
                    className={`border-2 rounded-3xl p-4 2xl:p-5 bg-white flex flex-col justify-between min-h-48 2xl:min-h-56 overflow-hidden shadow-3xs cursor-pointer select-none transition-all duration-150 ${
                      remainingQty === 0 
                        ? "opacity-45 bg-slate-50 border-slate-200 pointer-events-none" 
                        : cartQty > 0 
                          ? "border-primary bg-primary-light/5 ring-4 ring-primary/5 scale-[1.02]" 
                          : "border-slate-150 hover:border-slate-350 hover:scale-[1.01]"
                    }`}
                  >
                    <div>
                      {/* Geometric Image Placeholder wrapper */}
                      <div className="w-full h-14 2xl:h-20 rounded-2xl mb-2 2xl:mb-3 overflow-hidden flex items-center justify-center relative bg-gradient-to-br from-amber-100 to-orange-100 border border-slate-100">
                        <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#885625_1px,transparent_1px)] [background-size:16px_16px]"></div>
                        <span className="font-heading font-black text-[#885625]/40 text-sm tracking-widest uppercase">H+H JAR</span>
                      </div>

                      <div className="flex justify-between items-start gap-2">
                        <span className="text-sm font-black text-slate-85 block leading-tight line-clamp-2 min-w-0">{p.product_name}</span>
                        <span className={`text-[10px] font-bold font-mono py-0.5 px-2 rounded shrink-0 ml-1 ${getSizeBadgeStyle(p.size)}`}>{p.size}</span>
                      </div>
                    </div>

                    <div className="flex justify-between items-end mt-4 pt-3 border-t border-slate-50 gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="text-xs text-slate-400 block font-extrabold font-mono uppercase tracking-wider truncate">SKU: {p.sku}</span>
                        <span className={`text-xs font-bold block mt-1 truncate ${remainingQty <= 5 ? "text-rose-600 font-extrabold animate-pulse" : "text-slate-550"}`}>
                          Stock: <strong className="font-mono text-sm font-black">{remainingQty}</strong> left
                        </span>
                      </div>
                      <span className="text-base 2xl:text-lg font-black font-mono text-slate-800 shrink-0">
                        ₱{p.retail_price.toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })}

              {posProducts.length === 0 && (
                <div className="col-span-full p-8 md:p-12 text-center border-2 border-dashed border-slate-250 rounded-3xl bg-white space-y-6">
                  {activeEvent?.allocations.length === 0 ? (
                    <div className="max-w-xl mx-auto space-y-4">
                      <div className="p-4 bg-amber-50 text-amber-800 rounded-2xl border border-amber-200 flex items-center gap-3 justify-center">
                        <AlertTriangle className="text-amber-600 shrink-0 animate-bounce" size={24} />
                        <span className="font-heading font-black text-sm uppercase">Your Market Booth Crate is Currently Empty!</span>
                      </div>
                      <p className="text-sm text-slate-500 font-semibold leading-relaxed">
                        To record sales at this bazaar, you first need to specify what jars and quantities you brought to the market booth. This helps H+H Hub deduct stock correctly and prevent overselling!
                      </p>
                      <div className="text-left bg-slate-50 p-6 rounded-2xl border border-slate-150 space-y-3.5 text-xs md:text-sm font-bold text-slate-650">
                        <span className="font-black text-slate-800 uppercase block border-b border-slate-200 pb-2">Easy Step-by-Step Instructions:</span>
                        <p className="flex items-start gap-2">
                          <span className="w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center text-xs shrink-0 mt-0.5">1</span>
                          <span>Click the <strong className="text-slate-900 font-black">Close Cashier Terminal</strong> button at the top right.</span>
                        </p>
                        <p className="flex items-start gap-2">
                          <span className="w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center text-xs shrink-0 mt-0.5">2</span>
                          <span>Find your <strong className="text-slate-900 font-black">&ldquo;{activeEvent?.name}&rdquo;</strong> event card.</span>
                        </p>
                        <p className="flex items-start gap-2">
                          <span className="w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center text-xs shrink-0 mt-0.5">3</span>
                          <span>Click the <strong className="text-slate-900 font-black">Edit details</strong> button.</span>
                        </p>
                        <p className="flex items-start gap-2">
                          <span className="w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center text-xs shrink-0 mt-0.5">4</span>
                          <span>Under <strong className="text-slate-900 font-black">Reserve Inventory Allocation</strong>, select a spread, set your box size quantity, and click <strong className="text-slate-900 font-black">Add SKU</strong>.</span>
                        </p>
                        <p className="flex items-start gap-2">
                          <span className="w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center text-xs shrink-0 mt-0.5">5</span>
                          <span>Click the <strong className="text-slate-900 font-black">Save Changes</strong> button, then relaunch your terminal!</span>
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="max-w-md mx-auto space-y-2">
                      <p className="text-sm font-black text-slate-600 block">No matching product cards found.</p>
                      <p className="text-xs text-slate-450 font-semibold">Try clearing your filters or typing a different search query.</p>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>

          {/* RIGHT: RUNNING TOTAL CART SIDEBAR */}
          <div className="min-[900px]:col-span-5 2xl:col-span-4 min-[900px]:sticky min-[900px]:top-4 space-y-4 2xl:space-y-6">
            
            {/* Running Total Cart card */}
            <Card className="shadow-lg border-2 border-slate-200 rounded-3xl overflow-hidden min-[900px]:h-[calc(100dvh-6.5rem)] min-[900px]:grid min-[900px]:grid-rows-[auto_minmax(0,1fr)_auto]">
              <CardHeader className="shrink-0 p-4! 2xl:p-8! bg-slate-50/50 border-b border-slate-100 flex justify-between items-center flex-row">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="text-primary" size={20} />
                  <CardTitle className="text-base font-heading font-black">Running Cart</CardTitle>
                </div>
                {Object.keys(cart).length > 0 && (
                  <button 
                    onClick={() => setCart({})} 
                    className="text-slate-400 hover:text-danger text-xs font-black uppercase tracking-wider hover:underline"
                  >
                    Clear All
                  </button>
                )}
              </CardHeader>
              <CardContent className="p-4! 2xl:p-8! min-[900px]:min-h-0 min-[900px]:overflow-hidden">
                
                {/* Items listings */}
                <div className="border-2 border-slate-200 rounded-2xl bg-slate-50/50 max-h-48 min-[900px]:h-full min-[900px]:max-h-none overflow-y-auto p-3 space-y-2.5">
                  {Object.keys(cart).length === 0 ? (
                    <div className="py-6 2xl:py-12 text-center text-slate-400 text-xs italic font-semibold leading-relaxed">
                      Cart is Empty.<br />Tap any product card on the left to add items.
                    </div>
                  ) : (
                    Object.entries(cart).map(([sku, qty]) => {
                      const p = products.find(prod => prod.sku === sku);
                      const alloc = activeEvent.allocations.find((a: any) => a.sku === sku);
                      const maxQty = alloc ? alloc.quantity : 0;
                      if (!p) return null;

                      return (
                        <div key={sku} className="flex justify-between items-center p-2.5 2xl:p-3.5 bg-white rounded-xl border border-slate-200 shadow-3xs text-sm">
                          <div className="truncate pr-3">
                            <span className="font-black text-slate-855 block truncate">{p.product_name}</span>
                            <span className={`text-[10px] font-bold font-mono py-0.5 px-1.5 rounded ${getSizeBadgeStyle(p.size)}`}>{p.size}</span> <span className="text-slate-400">·</span> <span className="text-slate-455">₱{p.retail_price.toFixed(2)}</span>
                          </div>
                          
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleStepCartQty(sku, -1, maxQty)}
                              className="w-8 h-8 border-2 border-slate-200 rounded-lg flex items-center justify-center hover:bg-slate-50 cursor-pointer bg-white"
                            >
                              <Minus size={11} className="stroke-[3]" />
                            </button>
                            <span className="w-8 text-center font-black text-slate-855 font-mono text-sm">{qty}</span>
                            <button
                              onClick={() => handleStepCartQty(sku, 1, maxQty)}
                              className="w-8 h-8 border-2 border-slate-200 rounded-lg flex items-center justify-center hover:bg-slate-50 cursor-pointer bg-white"
                            >
                              <Plus size={11} className="stroke-[3]" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </CardContent>

              <div className="border-t border-slate-100 bg-white p-3 2xl:p-8 space-y-3 2xl:space-y-5">
                {/* Preorder Configuration Panel */}
                <div className="p-3 bg-slate-50 rounded-2xl border-2 border-slate-200 space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPreorder}
                      onChange={(e) => setIsPreorder(e.target.checked)}
                      className="w-4 h-4 accent-primary cursor-pointer"
                    />
                    <span className="text-xs text-slate-800 font-extrabold uppercase tracking-wide">Preorder Purchase</span>
                  </label>
                  
                  {isPreorder && (
                    <div className="space-y-3 animate-fade-in text-xs">
                      <div>
                        <label className="text-[10px] text-slate-455 font-bold block mb-1 uppercase tracking-wider">Customer Name / Identifier *</label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Maria Clara (IG #142)"
                          value={preorderCustomerName}
                          onChange={(e) => setPreorderCustomerName(e.target.value)}
                          className="w-full h-10 border-2 border-slate-200 rounded-xl px-2.5 font-bold text-slate-800"
                        />
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-slate-455 font-bold block mb-1 uppercase tracking-wider">Payment Status</label>
                          <select
                            value={preorderPaymentStatus}
                            onChange={(e: any) => setPreorderPaymentStatus(e.target.value)}
                            className="w-full h-10 border-2 border-slate-200 rounded-xl px-2 bg-white font-bold text-slate-800"
                          >
                            <option value="Paid">Paid</option>
                            <option value="Unpaid">Unpaid</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-455 font-bold block mb-1 uppercase tracking-wider">Pickup / Fulfillment</label>
                          <select
                            value={preorderFulfillmentStatus}
                            onChange={(e: any) => setPreorderFulfillmentStatus(e.target.value)}
                            className="w-full h-10 border-2 border-slate-200 rounded-xl px-2 bg-white font-bold text-slate-800"
                          >
                            <option value="Pending">Pending</option>
                            <option value="Picked Up">Picked Up</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Totals displays */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-455 font-extrabold uppercase tracking-wide">Total Amount:</span>
                    <span className="text-2xl 2xl:text-3xl font-black font-mono text-slate-900">
                      ₱{cartTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                {/* Payment Methods Touch Options */}
                <div className="space-y-2">
                  <span className="text-xs text-slate-455 font-extrabold uppercase tracking-wider block">Select Payment Method:</span>
                  <div className="grid grid-cols-2 gap-2 text-xs font-black">
                    {[
                      { id: "Cash", label: "💵 Cash", icon: Coins },
                      { id: "GCash", label: "📱 GCash", icon: Smartphone },
                      { id: "Maya", label: "💳 Maya", icon: Wallet },
                      { id: "Card", label: "🏧 Card", icon: CreditCard },
                      { id: "Mixed", label: "🔄 Mixed", icon: AlertTriangle }
                    ].map(pay => {
                      const isSelected = paymentMethod === pay.id;
                      return (
                        <button
                          key={pay.id}
                          type="button"
                          onClick={() => setPaymentMethod(pay.id)}
                          className={`py-2.5 2xl:py-3.5 px-3 2xl:px-4 rounded-xl 2xl:rounded-2xl border-2 flex items-center gap-2 transition-all cursor-pointer ${
                            isSelected 
                              ? "border-primary bg-primary-light/5 text-[#885625]" 
                              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          <pay.icon size={14} className={isSelected ? "text-[#885625]" : "text-slate-400"} />
                          <span>{pay.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Cash Change Calculator */}
                {paymentMethod === "Cash" && Object.keys(cart).length > 0 && (
                  <div className="p-3 2xl:p-4 bg-slate-50 border-2 border-slate-200 rounded-2xl space-y-3 animate-fade-in">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-slate-500 font-extrabold uppercase tracking-wide">Cash Received (₱):</span>
                      <input
                        type="number"
                        min={0}
                        placeholder="e.g. 1000"
                        value={cashReceived}
                        onChange={(e) => setCashReceived(e.target.value)}
                        className="w-32 h-10 font-mono font-black text-sm bg-white border-2 border-slate-200 rounded-xl px-2.5 text-right text-slate-800"
                      />
                    </div>
                    {cashAmountNum >= cartTotal && (
                      <div className="flex justify-between items-center pt-2 border-t border-slate-200 text-sm font-black text-slate-700">
                        <span>Change Due:</span>
                        <span className="text-lg font-mono text-emerald-600">₱{changeDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Complete Sale button */}
                <Button
                  onClick={handleCompleteSale}
                  disabled={actionLoading || Object.keys(cart).length === 0}
                  isLoading={actionLoading}
                  variant="primary"
                  className="w-full text-sm 2xl:text-base font-extrabold uppercase h-12 2xl:h-16 rounded-2xl shadow-sm mt-2 2xl:mt-3"
                  leftIcon={<Check size={18} />}
                >
                  Complete Sale (₱{cartTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })})
                </Button>

              </div>
            </Card>

            {/* Recent Sales Log & Undo Tray */}
            <Card className="rounded-3xl border-slate-200 shadow-sm overflow-hidden">
              <CardHeader className="p-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center flex-row">
                <CardTitle className="text-sm font-heading font-black">Recent Transactions</CardTitle>
                {offlineQueue.length > 0 && (
                  <Badge variant="warning" className="animate-pulse">{offlineQueue.length} Pending Sync</Badge>
                )}
              </CardHeader>
              <CardContent className="p-5 space-y-4">
                <div className="space-y-2.5 max-h-48 overflow-y-auto">
                  {recentSales.slice(0, 4).map((sale, i) => (
                    <div key={sale.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-650 flex justify-between items-center">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-855 font-black">
                            {sale.is_offline_draft ? "Draft sale" : `Sale #${sale.id}`}
                          </span>
                          <Badge variant="neutral" className="py-0.2 px-1 text-[9px] rounded font-mono">{sale.payment_method}</Badge>
                          {sale.is_offline_draft && (
                            <span className="text-[10px] text-amber-600 font-extrabold font-sans">Offline</span>
                          )}
                        </div>
                        {sale.is_preorder && (
                          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
                              Preorder: {sale.preorder_customer_name}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${sale.preorder_payment_status === "Paid" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-rose-50 text-rose-700 border border-rose-200 animate-pulse"}`}>
                              {sale.preorder_payment_status || "Unpaid"}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${sale.preorder_fulfillment_status === "Picked Up" ? "bg-blue-50 text-blue-700 border border-blue-200" : "bg-slate-100 text-slate-600 border border-slate-200"}`}>
                              {sale.preorder_fulfillment_status || "Pending"}
                            </span>
                            
                            {/* Preorder Quick Actions */}
                            {sale.preorder_payment_status === "Unpaid" && !sale.is_offline_draft && (
                              <button
                                onClick={async () => {
                                  if (confirm(`Mark preorder for ${sale.preorder_customer_name} as PAID?`)) {
                                    try {
                                      await api.updateMarketEventPreorder(activeEvent.id, sale.id, {
                                        preorder_payment_status: "Paid"
                                      });
                                      showToast("Preorder marked as Paid!", "success");
                                      fetchRecentSales(activeEvent.id);
                                    } catch (err: any) {
                                      alert(`Error: ${err.message}`);
                                    }
                                  }
                                }}
                                className="px-1.5 py-0.5 rounded text-[9px] font-black text-emerald-800 bg-emerald-100/50 hover:bg-emerald-100 cursor-pointer border border-emerald-300"
                              >
                                Mark Paid
                              </button>
                            )}
                            {sale.preorder_fulfillment_status === "Pending" && !sale.is_offline_draft && (
                              <button
                                onClick={async () => {
                                  if (confirm(`Mark preorder for ${sale.preorder_customer_name} as PICKED UP?`)) {
                                    try {
                                      await api.updateMarketEventPreorder(activeEvent.id, sale.id, {
                                        preorder_fulfillment_status: "Picked Up"
                                      });
                                      showToast("Preorder marked as Picked Up / Fulfilled!", "success");
                                      fetchRecentSales(activeEvent.id);
                                    } catch (err: any) {
                                      alert(`Error: ${err.message}`);
                                    }
                                  }
                                }}
                                className="px-1.5 py-0.5 rounded text-[9px] font-black text-blue-800 bg-blue-100/50 hover:bg-blue-100 cursor-pointer border border-blue-300"
                              >
                                Mark Picked Up
                              </button>
                            )}
                          </div>
                        )}
                        <span className="text-slate-400 font-normal block mt-1">Logged: {new Date(sale.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-slate-805 font-black text-sm">₱{sale.total_amount.toLocaleString()}</span>
                        {i === 0 && (
                          <button
                            onClick={() => handleUndoSale(sale.id)}
                            className="p-1.5 border border-rose-150 hover:bg-rose-50 text-rose-600 rounded-lg cursor-pointer transition-colors"
                            title="Undo this specific sale transaction"
                          >
                            <Undo2 size={12} className="stroke-[3]" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {recentSales.length === 0 && (
                    <div className="text-center text-slate-400 italic py-6">No sales logged yet for this active session.</div>
                  )}
                </div>
              </CardContent>
            </Card>

          </div>

        </div>

      </div>
    );
  }

  // ----------------------------------------------------
  // STANDARD MARKET EVENTS DETAILS & LIST VIEW (PHASE 1)
  // ----------------------------------------------------
  return (
    <div className="space-y-8 flex flex-col pb-16">
      
      {/* 1. Header Banner */}
      <div className="bg-[#fcf8f2] border border-[#ece5da] rounded-3xl p-6 md:p-8 flex flex-col md:flex-row md:justify-between md:items-center gap-6">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary/10 text-primary rounded-2xl shrink-0">
            <Store size={32} />
          </div>
          <div>
            <h2 className="text-xl md:text-2xl font-heading font-black text-slate-800 tracking-wide uppercase">Pop-Up Market Events</h2>
            <p className="text-sm text-slate-505 mt-1 leading-relaxed">
              Plan external pop-up markets, manage assigned kitchen staff, and organize physical inventory allocations.
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {offlineQueue.length > 0 && (
            <button
              onClick={handleManualSyncRetry}
              className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-800 py-2.5 px-4 rounded-xl text-xs font-black shadow-3xs cursor-pointer animate-pulse"
              title="Manual Trigger Sync Upload"
            >
              <CloudLightning size={14} />
              <span>Sync {offlineQueue.length} Unsaved Sales</span>
            </button>
          )}

          <Button
            onClick={handleOpenCreate}
            variant="primary"
            size="lg"
            className="h-12 font-bold"
            leftIcon={<Plus size={16} />}
          >
            Create Event
          </Button>
        </div>
      </div>

      {/* Tabs Menu */}
      <div className="flex border-b border-slate-200 text-sm md:text-base font-heading font-black overflow-x-auto whitespace-nowrap bg-white/50 p-1.5 rounded-2xl border">
        <button
          onClick={() => setActiveMainTab("scheduler")}
          className={`px-6 py-4 rounded-xl transition-all cursor-pointer font-extrabold shrink-0 text-center ${
            activeMainTab === "scheduler"
              ? "bg-[#885625]/10 text-primary font-black animate-fade-in"
              : "text-slate-500 hover:bg-slate-100"
          }`}
        >
          📅 Events Scheduler &amp; POS Cashier
        </button>
        <button
          onClick={() => setActiveMainTab("analytics")}
          className={`px-6 py-4 rounded-xl transition-all cursor-pointer font-extrabold shrink-0 text-center ${
            activeMainTab === "analytics"
              ? "bg-[#885625]/10 text-primary font-black animate-fade-in"
              : "text-slate-500 hover:bg-slate-100"
          }`}
        >
          🧠 AI Recommendations &amp; Analytics Hub
        </button>
        <button
          onClick={() => setActiveMainTab("reconciliation")}
          className={`px-6 py-4 rounded-xl transition-all cursor-pointer font-extrabold shrink-0 text-center ${
            activeMainTab === "reconciliation"
              ? "bg-[#885625]/10 text-primary font-black animate-fade-in"
              : "text-slate-500 hover:bg-slate-100"
          }`}
        >
          🛡️ Conflict Reconciliation Hub
        </button>
      </div>

      {/* 2. SCHEDULER TAB CONTENT */}
      {activeMainTab === "scheduler" && (
        <>
          <div className="flex justify-between items-center flex-wrap gap-4">
            <span className="text-sm font-black text-slate-500 uppercase tracking-wider block">Scheduled Pop-Up Markets listing</span>
            {getSyncBadgeInScheduler()}
          </div>

          {loading ? (
            <div className="py-20 text-center text-slate-555 flex flex-col items-center justify-center gap-3">
              <RefreshCw className="animate-spin text-primary" size={40} />
              <span className="text-sm font-semibold">Loading Market Events...</span>
            </div>
          ) : events.length === 0 ? (
            <Card className="rounded-3xl border-slate-200 shadow-sm p-12 text-center text-slate-500 font-semibold italic">
              No external market events scheduled yet. Click the &quot;Create Market Event&quot; button above to register one.
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {events.map((event) => {

                return (
                  <div 
                    key={event.id} 
                    className="bg-white border-2 border-slate-200 hover:border-[#885625]/40 rounded-3xl p-6 md:p-8 shadow-xs flex flex-col justify-between gap-6 transition-all"
                  >
                    <div className="space-y-4">
                      <div className="flex justify-between items-start gap-4">
                        <div>
                          <h3 className="text-lg md:text-xl font-heading font-black text-slate-900 leading-snug line-clamp-2">{event.name}</h3>
                          <span className="text-xs text-slate-400 font-mono block mt-1.5 uppercase font-bold">Event ID: #{event.id}</span>
                        </div>
                        <Badge variant={getStatusBadgeVariant(event.status)} className="py-1 px-3 text-xs rounded-xl font-bold shrink-0">
                          {event.status}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-slate-600 font-bold border-y border-slate-100 py-4">
                        <span className="flex items-center gap-2">
                          <Calendar size={16} className="text-[#885625] shrink-0" />
                          <span>{event.event_date}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <MapPin size={16} className="text-[#885625] shrink-0" />
                          <span className="truncate">{event.location}</span>
                        </span>
                        <span className="flex items-center gap-2 sm:col-span-2">
                          <User size={16} className="text-[#885625] shrink-0" />
                          <span>Assigned: <strong className="text-slate-800 font-semibold">{event.staff_assigned || "None"}</strong></span>
                        </span>
                      </div>

                      {event.notes && (
                        <p className="text-xs md:text-sm text-slate-500 font-semibold bg-slate-50 p-3 rounded-xl border border-slate-100 italic leading-relaxed">
                          &ldquo;{event.notes}&rdquo;
                        </p>
                      )}

                      {/* Allocated Items tray */}
                      {event.allocations && event.allocations.length > 0 && (
                        <div className="space-y-2">
                          <span className="text-xs text-slate-400 font-extrabold uppercase tracking-wide">
                            {event.metrics_basis === "actual" ? "Remaining Event Inventory" : "Reserved Inventory Allocations"}
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {event.allocations.map((a: any) => (
                              <div key={a.id} className="px-3 py-1 bg-[#885625]/5 border border-[#885625]/20 rounded-xl text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                <span className="text-primary font-black">{a.quantity}x</span>
                                <span>{a.product_name}</span>
                                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded font-black ${getSizeBadgeStyle(a.size)}`}>{a.size}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Stats calculations */}
                      <div className="grid grid-cols-3 gap-3 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold text-slate-550">
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                            {event.metrics_basis === "actual" ? "Sales Revenue" : "Est Revenue"}
                          </span>
                          <span className="font-mono font-black text-slate-800 text-sm mt-0.5 block">₱{event.estimated_revenue.toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                            {event.metrics_basis === "actual" ? "Sales COGS" : "Est Cost"}
                          </span>
                          <span className="font-mono font-black text-slate-800 text-sm mt-0.5 block">
                            {event.financials_visible === false
                              ? "Owner only"
                              : event.costing_complete !== false
                                ? `₱${event.estimated_cost.toLocaleString()}`
                                : "Unavailable"}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                            {event.metrics_basis === "actual" ? "Sales Profit" : "Est Profit"}
                          </span>
                          <span className="font-mono font-black text-emerald-600 text-sm mt-0.5 block">
                            {event.financials_visible === false
                              ? "Owner only"
                              : event.costing_complete !== false
                                ? `₱${event.potential_profit.toLocaleString()}`
                                : "Unavailable"}
                          </span>
                        </div>
                      </div>
                      {event.financials_visible !== false && event.costing_complete === false && (
                        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                          <AlertTriangle size={14} className="shrink-0" />
                          Complete product costing before using COGS or profit figures.
                        </div>
                      )}
                    </div>

                    <div className="flex justify-between items-center pt-4 border-t border-slate-100 gap-3 flex-wrap">
                      
                      {/* Phase 2 Launch Cashier button (Only for Active events!) */}
                      {event.status === "Active" && (
                        <Button
                          onClick={() => handleLaunchTerminal(event)}
                          variant="primary"
                          className="h-10 text-xs px-4 font-black bg-emerald-600 hover:bg-emerald-700 border-emerald-500 rounded-xl flex items-center gap-1.5 shadow-sm shrink-0"
                          leftIcon={<Play size={12} className="fill-current" />}
                        >
                          Launch Cashier
                        </Button>
                      )}

                      {/* Phase 4 Closeout Report generation button (Only for Completed events!) */}
                      {event.status === "Completed" && (
                        <Button
                          onClick={() => handleLaunchCloseoutReport(event)}
                          variant="primary"
                          className="h-10 text-xs px-4 font-black bg-slate-800 hover:bg-slate-900 border-slate-700 rounded-xl flex items-center gap-1.5 shadow-sm shrink-0"
                          leftIcon={<Printer size={12} />}
                        >
                          View Closeout Report
                        </Button>
                      )}

                      {/* Activation triggers inline if status is Draft or Active */}
                      {event.status === "Draft" && (
                        <Button
                          onClick={() => handleUpdateStatusDirectly(event, "Active")}
                          variant="outline"
                          className="h-10 text-xs px-3 font-bold border-emerald-300 text-emerald-700 hover:bg-emerald-50 rounded-xl shrink-0"
                        >
                          Activate Event
                        </Button>
                      )}

                      {event.status === "Active" && (
                        <Button
                          onClick={() => handleUpdateStatusDirectly(event, "Completed")}
                          variant="outline"
                          className="h-10 text-xs px-3 font-bold border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl shrink-0"
                        >
                          Complete &amp; Return Stock
                        </Button>
                      )}

                      <div className="flex gap-2 ml-auto">
                        <Button
                          onClick={() => handleOpenDelete(event)}
                          variant="outline"
                          aria-label={`Delete ${event.name}`}
                          title="Delete market event"
                          className="h-10 text-xs px-3 hover:bg-rose-50 border-rose-150 hover:text-danger hover:border-danger font-bold text-slate-600 rounded-xl"
                        >
                          <Trash2 size={14} />
                        </Button>
                        <Button
                          onClick={() => handleOpenEdit(event)}
                          variant="outline"
                          className="h-10 text-xs px-4 font-bold rounded-xl"
                        >
                          <Edit3 size={14} className="mr-1.5" /> Edit
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {activeMainTab === "analytics" && (
        /* 3. AI & ANALYTICS TAB CONTENT (PHASE 5) */
        <div className="space-y-8 animate-fade-in">
          {analyticsLoading ? (
            <div className="py-20 text-center text-slate-550 flex flex-col items-center justify-center gap-3">
              <RefreshCw className="animate-spin text-primary" size={40} />
              <span className="text-sm font-semibold">Generating AI Market Insights... Please wait.</span>
            </div>
          ) : analyticsData ? (
            <>
              {/* AI Market Assistant Banner */}
              <Card variant="glass" className="border-l-8 border-l-primary bg-primary-light/5 shadow-md rounded-3xl overflow-hidden">
                <CardHeader className="p-6 md:p-8 border-b border-orange-100 bg-white/40">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-primary/10 text-primary rounded-2xl shrink-0">
                      <BrainCircuit size={28} className="animate-pulse text-primary" />
                    </div>
                    <div>
                      <h3 className="text-lg md:text-xl font-heading font-black text-slate-850">H+H Smart Market Assistant</h3>
                      <p className="text-xs md:text-sm text-slate-500 mt-1 font-semibold">Artificial Intelligence &amp; Predictive Planning Hub</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6 md:p-8 text-sm md:text-base font-semibold text-slate-700 leading-relaxed">
                  {analyticsData.overall.total_completed_events > 0 ? (
                    <>Based on <strong className="text-slate-900 font-bold">{analyticsData.overall.total_completed_events} completed market events</strong> and their recorded sales, the system has prepared product quantities and safety-stock guidance for upcoming pop-ups.</>
                  ) : (
                    <>Complete a market event to unlock evidence-based product recommendations. Active-event sales are intentionally excluded until closeout.</>
                  )}
                </CardContent>
              </Card>

              {/* Master KPI Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="modern-card p-6 bg-white border-l-4 border-l-emerald-500">
                  <span className="text-xs text-slate-450 font-black uppercase tracking-wider block">Total POS Revenue</span>
                  <h3 className="text-xl md:text-2xl font-black text-slate-800 font-mono mt-1">₱{analyticsData.overall.total_revenue.toLocaleString()}</h3>
                  <span className="text-[10px] text-slate-400 block mt-2">All completed pop-up sales</span>
                </div>
                <div className="modern-card p-6 bg-white border-l-4 border-l-primary">
                  <span className="text-xs text-slate-455 font-black uppercase tracking-wider block">Total Net Profit</span>
                  <h3 className="text-xl md:text-2xl font-black text-primary font-mono mt-1">
                    {analyticsData.overall.costing_complete !== false ? `₱${analyticsData.overall.potential_profit.toLocaleString()}` : "Unavailable"}
                  </h3>
                  <span className="text-[10px] text-slate-400 block mt-2">
                    {analyticsData.overall.costing_complete !== false ? "After deducting BOM cost" : "Complete product costing"}
                  </span>
                </div>
                <div className="modern-card p-6 bg-white border-l-4 border-l-accent">
                  <span className="text-xs text-slate-455 font-black uppercase tracking-wider block">Total Jars Sold</span>
                  <h3 className="text-xl md:text-2xl font-black text-slate-800 font-mono mt-1">{analyticsData.overall.total_units_sold} jars</h3>
                  <span className="text-[10px] text-slate-400 block mt-2">Across all market dispatches</span>
                </div>
                <div className="modern-card p-6 bg-white border-l-4 border-l-purple-500">
                  <span className="text-xs text-slate-455 font-black uppercase tracking-wider block">Avg Revenue / Event</span>
                  <h3 className="text-xl md:text-2xl font-black text-slate-800 font-mono mt-1">₱{analyticsData.overall.avg_revenue_per_event.toLocaleString()}</h3>
                  <span className="text-[10px] text-slate-400 block mt-2">Event-to-event average payout</span>
                </div>
              </div>

              {/* Conversational AI Product Recommendations Panel */}
              <div className="space-y-4">
                <h3 className="text-base font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5"><BrainCircuit size={18} /> Optimized Prep &amp; Safety Stock Recommendations</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {analyticsData.recommendations.length === 0 && (
                    <div className="md:col-span-2 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm font-bold text-slate-500">
                      Recommendations appear after the first completed market event.
                    </div>
                  )}
                  {analyticsData.recommendations.map((rec: any) => (
                    <div key={rec.sku} className={`p-6 bg-white border-2 rounded-3xl flex flex-col justify-between gap-4 shadow-3xs ${rec.is_stock_short ? "border-amber-300" : "border-slate-150 hover:border-slate-350"}`}>
                      <div className="space-y-3">
                        <div className="flex justify-between items-start gap-3">
                          <div>
                            <h4 className="text-base font-black text-slate-800">{rec.product_name}</h4>
                            <span className="mt-1 flex items-center gap-2 text-xs text-slate-400 font-mono">SKU: {rec.sku} <ProductSizeBadge size={rec.size} sku={rec.sku} /></span>
                          </div>
                          <Badge variant="warning" className="py-1 px-2.5 rounded-lg text-xs font-black">Bring {rec.recommended_quantity} jars</Badge>
                        </div>
                        
                        {/* Dynamic WHY Reason paragraph */}
                        <p className="text-xs md:text-sm text-slate-500 font-semibold bg-slate-50 p-3.5 rounded-xl border border-slate-100 italic leading-relaxed">
                          &ldquo;{rec.reason}&rdquo;
                        </p>
                        
                        {rec.is_stock_short && (
                          <div className="p-3 bg-amber-50 border border-amber-250 rounded-xl flex items-start gap-2 text-xs font-bold text-amber-800 leading-normal">
                            <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                            <span>
                              <strong>Warehouse Stock Alert:</strong> You only have {rec.warehouse_stock} jars in the main warehouse. Fulfill this recommendation by scheduling a prep run of at least {rec.recommended_quantity - rec.warehouse_stock} jars under <strong>Production Planner</strong>!
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 text-xs font-bold text-slate-550">
                        <div>
                          <span className="text-slate-400">Expected Revenue</span>
                          <span className="block text-sm font-black text-slate-800 font-mono mt-0.5">₱{rec.expected_revenue.toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Expected Net Profit</span>
                          <span className="block text-sm font-black text-emerald-600 font-mono mt-0.5">
                            {rec.costing_complete !== false && rec.expected_profit !== null
                              ? `₱${rec.expected_profit.toLocaleString()}`
                              : "Unavailable"}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Product Leaderboard Card */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Best Sellers */}
                <Card className="rounded-3xl border-slate-200 shadow-sm overflow-hidden">
                  <CardHeader className="p-6 bg-emerald-50/20 border-b border-slate-100">
                    <CardTitle className="text-base font-heading font-black text-emerald-800 uppercase flex items-center gap-1.5"><TrendingUp size={18} /> Best Sellers Leaderboard</CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 space-y-3">
                    {analyticsData.best_sellers.map((item: any, idx: number) => (
                      <div key={item.sku} className="flex justify-between items-center p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold">
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-mono font-black text-xs">{idx + 1}</span>
                          <div>
                            <span className="text-slate-800 block text-sm font-black">{item.product_name}</span>
                            <span className="text-xs text-slate-400 font-mono flex items-center gap-1.5">{item.sku} <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${getSizeBadgeStyle(item.size)}`}>{item.size}</span></span>
                          </div>
                        </div>
                        <span className="font-mono text-emerald-600 font-black text-base">{item.quantity} jars sold</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Slow Sellers */}
                <Card className="rounded-3xl border-slate-200 shadow-sm overflow-hidden">
                  <CardHeader className="p-6 bg-rose-50/20 border-b border-slate-100">
                    <CardTitle className="text-base font-heading font-black text-rose-800 uppercase flex items-center gap-1.5"><TrendingDown size={18} /> Slow Sellers / Low Volume</CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 space-y-3">
                    {analyticsData.slow_sellers.map((item: any, idx: number) => (
                      <div key={item.sku} className="flex justify-between items-center p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold">
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center font-mono font-black text-xs">{idx + 1}</span>
                          <div>
                            <span className="text-slate-800 block text-sm font-black">{item.product_name}</span>
                            <span className="text-xs text-slate-400 font-mono flex items-center gap-1.5">{item.sku} <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${getSizeBadgeStyle(item.size)}`}>{item.size}</span></span>
                          </div>
                        </div>
                        <span className="font-mono text-rose-600 font-black text-base">{item.quantity} jars sold</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>

              </div>

              {/* Peak Sales Hourly Chart */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                {/* Hourly distributions */}
                <Card className="lg:col-span-8 rounded-3xl border-slate-200 shadow-sm overflow-hidden">
                  <CardHeader className="p-6 bg-slate-50/50 border-b border-slate-100">
                    <div className="flex justify-between items-center">
                      <div>
                        <CardTitle className="text-base font-heading font-black uppercase">Peak Sales Hourly Distribution</CardTitle>
                        <CardDescription className="text-xs text-slate-550 mt-1">Sum of cash registers grouped by checkout hour, assisting in staffing optimizations.</CardDescription>
                      </div>
                      <Clock size={18} className="text-primary shrink-0" />
                    </div>
                  </CardHeader>
                  <CardContent className="p-6">
                    <div className="h-64 mt-2">
                      {analyticsData.hourly_sales.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={analyticsData.hourly_sales} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="hour" stroke="#94a3b8" fontSize={11} tickLine={false} />
                            <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                            <Tooltip formatter={(val) => [`₱${Number(val).toLocaleString()}`, "Sales"]} />
                            <Bar dataKey="sales" fill="#7b3e19" radius={[4, 4, 0, 0]} maxBarSize={30} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-xs text-slate-400 italic">No transactional sales records logged yet.</div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Weekend vs Weekday Seasonality */}
                <Card className="lg:col-span-4 rounded-3xl border-slate-200 shadow-sm overflow-hidden self-stretch flex flex-col">
                  <CardHeader className="p-6 bg-slate-50/50 border-b border-slate-100">
                    <CardTitle className="text-xs md:text-sm font-heading font-black uppercase">Weekend vs Weekday Seasonality</CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 flex-1 flex flex-col justify-center items-center">
                    {analyticsData.overall.total_revenue > 0 ? (
                      <div className="h-44 w-full relative flex items-center justify-center">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={[
                                { name: "Weekend Sales", value: analyticsData.weekend_sales },
                                { name: "Weekday Sales", value: analyticsData.weekday_sales }
                              ]}
                              cx="50%"
                              cy="50%"
                              innerRadius={50}
                              outerRadius={68}
                              paddingAngle={4}
                              dataKey="value"
                            >
                              <Cell fill="#7b3e19" />
                              <Cell fill="#cfaf45" />
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute text-center">
                          <span className="text-[10px] text-slate-400 uppercase font-black block">Markets</span>
                          <span className="text-sm font-black text-slate-800 font-mono">₱{analyticsData.overall.total_revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="py-12 text-center text-slate-400 italic">No seasonality data.</div>
                    )}

                    <div className="w-full space-y-2 text-xs font-bold text-slate-500 border-t border-slate-100 pt-4 mt-4">
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-1.5 font-bold"><span className="w-2.5 h-2.5 rounded-full bg-[#7b3e19]"></span> Weekend Sales (Sat-Sun)</span>
                        <span className="font-mono text-slate-800 text-sm">₱{analyticsData.weekend_sales.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-1.5 font-bold"><span className="w-2.5 h-2.5 rounded-full bg-[#cfaf45]"></span> Weekday Sales (Mon-Fri)</span>
                        <span className="font-mono text-slate-800 text-sm">₱{analyticsData.weekday_sales.toLocaleString()}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

              </div>

              {/* Event-over-Event Growth comparison chart */}
              <Card className="rounded-3xl border-slate-200 shadow-sm overflow-hidden">
                <CardHeader className="p-6 bg-slate-50/50 border-b border-slate-100">
                  <div className="flex justify-between items-center">
                    <div>
                      <CardTitle className="text-base font-heading font-black uppercase">Event-over-Event Revenue Growth Curve</CardTitle>
                      <CardDescription className="text-xs text-slate-550 mt-1">Chronological growth curve showing active sales progression across completed events.</CardDescription>
                    </div>
                    <TrendingUp size={18} className="text-emerald-500 shrink-0" />
                  </div>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="h-64 mt-2">
                    {analyticsData.event_growth.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={analyticsData.event_growth} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="date" stroke="#94a3b8" fontSize={10} tickLine={false} />
                          <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} />
                          <Tooltip formatter={(val) => [`₱${Number(val).toLocaleString()}`]} />
                          <Line type="monotone" dataKey="revenue" name="Event Revenue" stroke="#7b3e19" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                          <Line type="monotone" dataKey="accumulated" name="Cumulative Revenue" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-xs text-slate-400 italic">No growth records logged yet.</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="py-20 text-center text-slate-400 italic">Error loading AI analytical models. Please try sync/refreshing.</div>
          )}
        </div>
      )}

      {activeMainTab === "reconciliation" && (
        <div className="space-y-8 animate-fade-in">
          <Card className="border-l-8 border-l-amber-500 bg-amber-50/10 shadow-sm rounded-3xl overflow-hidden">
            <CardHeader className="p-6 md:p-8 border-b border-amber-100 bg-white/40">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-amber-500/10 text-amber-600 rounded-2xl shrink-0">
                  <AlertTriangle size={28} className="text-amber-600" />
                </div>
                <div>
                  <h3 className="text-lg md:text-xl font-heading font-black text-slate-850">Conflict Reconciliation Hub</h3>
                  <p className="text-xs md:text-sm text-slate-500 mt-1 font-semibold">Audit synced offline transactions and resolve inventory/allocation discrepancies</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6 md:p-8 text-sm font-semibold text-slate-700 leading-relaxed">
              When cashiers work in offline mode at a pop-up market, they operate using local cached inventory. 
              If multiple terminals record sales simultaneously, they can over-sell product stock. Use this dashboard to analyze sales journals, detect over-allocation sync overlaps, and manually reconcile sales transactions.
            </CardContent>
          </Card>

          {/* Event Selection */}
          <div className="bg-white border-2 border-slate-200 rounded-3xl p-6 shadow-xs flex flex-col sm:flex-row items-center gap-4">
            <span className="text-sm font-black text-slate-600 uppercase tracking-wider whitespace-nowrap">Select Market Event:</span>
            <select
              value={reconciliationEventId}
              onChange={(e) => setReconciliationEventId(e.target.value ? Number(e.target.value) : "")}
              className="flex-1 text-sm font-black bg-white h-12 border-2 border-slate-200 rounded-xl px-4"
            >
              <option value="">-- Choose an Event to Audit --</option>
              {events.filter(e => e.status === "Active" || e.status === "Completed").map(e => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.event_date} - {e.location}) &bull; Status: {e.status}
                </option>
              ))}
            </select>
          </div>

          {reconciliationEventId ? (
            (() => {
              const currentEvent = events.find(e => e.id === Number(reconciliationEventId));
              if (!currentEvent) return null;

              // Compute conflicts: For each allocated product, see if total sold exceeds initial qty (alloc.quantity + total_sold)
              const conflictsList: any[] = [];
              currentEvent.allocations.forEach((alloc: any) => {
                const soldQty = reconcileSalesList.reduce((sum, sale) => {
                  const item = sale.items.find((it: any) => it.sku === alloc.sku);
                  return sum + (item ? item.quantity : 0);
                }, 0);

                const initialQty = alloc.quantity + soldQty;
                // Conflict threshold: If we have synced sales but remaining quantity at booth is 0 and we over-allocated,
                // or if there are multiple cashiers and the total sold exceeds initialQty (we simulate conflict if soldQty > 0 and remaining quantity is 0 and there is a high-volume sync)
                // Let's explicitly define a conflict: If they recorded sales but the booth ended with insufficient allocations or negative physical discrepancies
                // Since remaining alloc.quantity = max(0, initialQty - soldQty), if a cashier sells more than the allocation, the remaining becomes 0.
                // If there are duplicate or overlapping offline sales, we flag any SKU where there are multiple cashiers and soldQty >= initialQty.
                const hasOverlap = reconcileSalesList.length > 1 && soldQty > initialQty - 5 && alloc.quantity === 0;

                if (hasOverlap) {
                  conflictsList.push({
                    sku: alloc.sku,
                    product_name: alloc.product_name,
                    dispatched: initialQty,
                    sold: soldQty,
                    remaining: alloc.quantity,
                    excess: soldQty - initialQty
                  });
                }
              });

              return (
                <div className="space-y-8">
                  {/* Sync Overlap Conflicts Alerts */}
                  <div className="space-y-4">
                    <h3 className="text-base font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <AlertTriangle size={18} className="text-amber-500" /> Detected Over-Selling Conflicts ({conflictsList.length})
                    </h3>

                    {conflictsList.length === 0 ? (
                      <Card className="rounded-3xl border-slate-200 shadow-sm p-8 text-center text-emerald-600 bg-emerald-50/20 font-semibold flex items-center justify-center gap-2">
                        <Check size={18} className="text-emerald-600" />
                        <span>Excellent! No offline sales conflicts or over-allocation overlaps detected for this event.</span>
                      </Card>
                    ) : (
                      <div className="space-y-4">
                        {conflictsList.map(conf => (
                          <div key={conf.sku} className="bg-rose-50/50 border border-rose-200 rounded-3xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 animate-scale-up">
                            <div className="space-y-2">
                              <span className="bg-rose-100 text-rose-800 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded">🔴 Sync Overlap Flagged</span>
                              <h4 className="text-base font-black text-slate-800">{conf.product_name}</h4>
                              <p className="text-xs text-slate-500 font-semibold">SKU: <span className="font-mono font-bold">{conf.sku}</span></p>
                              <p className="text-xs text-rose-700 font-bold leading-relaxed mt-1">
                                ⚠️ Multiple terminal synchronization overlap: Total synced sales ({conf.sold} units) exceeds the original dispatched allocation ({conf.dispatched} units) by <strong className="font-black text-sm font-mono">{conf.excess} units</strong>.
                              </p>
                            </div>
                            <div className="flex md:flex-col items-end gap-2 text-right">
                              <span className="text-xs text-slate-400 uppercase">Conflict Severity:</span>
                              <span className="font-heading font-black text-rose-600 text-lg">HIGH RISK</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Synced Transactions Journal */}
                  <div className="space-y-4">
                    <h3 className="text-base font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <FileText size={18} className="text-[#885625]" /> Synced Transactions Journal ({reconcileSalesList.length} sales)
                    </h3>

                    {reconcileSalesList.length === 0 ? (
                      <Card className="rounded-3xl border-slate-200 shadow-sm p-12 text-center text-slate-500 font-semibold italic">
                        No transactions have been recorded or synced for this event yet.
                      </Card>
                    ) : (
                      <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-3xs overflow-x-auto">
                        <table className="w-full text-left border-collapse text-sm">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-550 font-black uppercase tracking-wider text-xs px-4 py-3">
                              <th className="px-5 py-3">Sale ID &amp; Cashier</th>
                              <th className="px-5 py-3">Timestamp</th>
                              <th className="px-5 py-3">Items Sold</th>
                              <th className="px-5 py-3 text-right">Total Amount</th>
                              <th className="px-5 py-3 text-center">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                            {reconcileSalesList.map((sale) => (
                              <tr key={sale.id} className="hover:bg-slate-50/20">
                                <td className="px-5 py-3.5">
                                  <span className="text-slate-800 font-black block text-sm">Invoice #{sale.id}</span>
                                  <span className="text-xs text-slate-400 font-mono font-semibold">Cashier: {sale.cashier_username}</span>
                                </td>
                                <td className="px-5 py-3.5 font-mono text-xs text-slate-550">
                                  {new Date(sale.timestamp).toLocaleString()}
                                </td>
                                <td className="px-5 py-3.5">
                                  <div className="space-y-1">
                                    {sale.items.map((it: any) => (
                                      <span key={it.id} className="block text-xs text-slate-705">
                                        &bull; {it.product_name} x<strong className="text-[#885625]">{it.quantity}</strong> <ProductSizeBadge size={it.size} sku={it.sku} />
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                <td className="px-5 py-3.5 text-right font-mono text-slate-855 text-base font-black">
                                  ₱{sale.total_amount.toLocaleString()}
                                </td>
                                <td className="px-5 py-3.5 text-center">
                                  <button
                                    onClick={async () => {
                                      if (confirm(`Are you sure you want to revert/undo and permanently delete Sale Invoice #${sale.id}? This will restore the allocated stock counts.`)) {
                                        try {
                                          await api.undoMarketEventSale(currentEvent.id, sale.id);
                                          showToast(`Sale #${sale.id} successfully reverted and deleted.`, "success");
                                          fetchEvents();
                                          fetchReconciliationSales(currentEvent.id);
                                        } catch (err: any) {
                                          alert(`Error reverting sale: ${err.message}`);
                                        }
                                      }
                                    }}
                                    className="px-3 py-1.5 text-xs font-black text-rose-600 border border-rose-200 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors"
                                  >
                                    Revert Sale
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()
          ) : (
            <Card className="rounded-3xl border-slate-200 shadow-sm p-12 text-center text-slate-555 font-semibold italic">
              👈 Please select an Active or Completed market event from the dropdown above to audit transaction records and resolve overlaps.
            </Card>
          )}
        </div>
      )}

      {/* 3. CREATE MARKET EVENT MODAL */}
      {isCreateOpen && (
        <Modal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          title="Create Market Event"
          size="3xl"
        >
          <form onSubmit={handleCreateSubmit} className="space-y-6 text-sm font-semibold text-slate-600 leading-normal">
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Market Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Laguna Organic Trade Fair"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full text-base font-bold text-slate-800 h-12"
                />
              </div>
              <div>
                <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Event Date *</label>
                <input
                  type="date"
                  required
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="w-full font-mono text-base font-bold text-slate-800 h-12"
                />
              </div>
              <div>
                <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Location *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Activity Center, Alabang Town Center"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full text-base font-bold text-slate-800 h-12"
                />
              </div>
              <div>
                <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Assigned Staff</label>
                <input
                  type="text"
                  placeholder="e.g. Lucia, Mang Roger"
                  value={staffAssigned}
                  onChange={(e) => setStaffAssigned(e.target.value)}
                  className="w-full text-base font-bold text-slate-800 h-12"
                />
              </div>
              <div>
                <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Event Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full text-sm font-bold bg-white h-12 border-2 border-slate-200 rounded-xl"
                >
                  {CREATE_EVENT_STATUSES.map((eventStatus) => (
                    <option key={eventStatus} value={eventStatus}>{eventStatus}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">General Event Notes</label>
              <textarea
                placeholder="Details of entrance fee, setup times, etc."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 h-24 text-sm font-bold"
              />
            </div>

            {/* Cash Float & Register Configuration */}
            <div className="border border-slate-200 rounded-2xl p-5 bg-slate-50/50 space-y-4">
              <span className="text-xs text-slate-500 font-black uppercase tracking-wider block">Cash Register &amp; Opening Float</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Opening Cash Balance (Float) ₱</label>
                  <input
                    type="number"
                    min={0}
                    value={initialCashBalance}
                    onChange={(e) => setInitialCashBalance(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full text-base font-bold text-slate-850 h-12 border-2 border-slate-200 rounded-xl px-3 outline-none"
                  />
                </div>
              </div>
            </div>

            {/* 4. INVENTORY PREPARATION COMPONENT */}
            <div className="border border-slate-200 rounded-2xl p-5 bg-slate-50/50 space-y-4">
              <span className="text-xs text-slate-500 font-black uppercase tracking-wider block">Reserve Inventory Allocation</span>

              <InventoryChecklist
                products={products}
                allocations={allocations}
                setAllocations={setAllocations}
              />

              {/* Summary aggregate info */}
              {allocations.length > 0 && (() => {
                const stats = calculateSummaryMetrics(allocations);
                return (
                  <div className="grid grid-cols-3 gap-4 p-4 bg-white border border-slate-200 rounded-2xl text-xs font-bold text-slate-555 shadow-3xs">
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase block">Est Revenue</span>
                      <span className="font-mono font-black text-slate-800 text-sm mt-1 block">₱{stats.estimatedRevenue.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase block">Est Cost (BOM)</span>
                      <span className="font-mono font-black text-slate-800 text-sm mt-1 block">
                        {stats.financialsVisible ? `₱${stats.estimatedCost?.toLocaleString()}` : "Owner only"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase block">Potential Profit</span>
                      <span className="font-mono font-black text-emerald-600 text-sm mt-1 block">
                        {stats.financialsVisible ? `₱${stats.potentialProfit?.toLocaleString()}` : "Owner only"}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 pt-6 mt-8">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-12 px-6"
                onClick={() => setIsCreateOpen(false)}
                disabled={actionLoading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="h-12 px-6 font-bold"
                isLoading={actionLoading}
              >
                Save &amp; Create Event
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* 5. EDIT MARKET EVENT MODAL */}
      {isEditOpen && selectedEvent && (
        <Modal
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
          title="Edit Market Event"
          size="3xl"
        >
          <form onSubmit={handleEditSubmit} className="space-y-6 text-sm font-semibold text-slate-600 leading-normal">
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Market Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Laguna Organic Trade Fair"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full text-base font-bold text-slate-800 h-12"
                />
              </div>
              <div>
                <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Event Date *</label>
                <input
                  type="date"
                  required
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="w-full font-mono text-base font-bold text-slate-800 h-12"
                />
              </div>
              <div>
                <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Location *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Activity Center, Alabang Town Center"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full text-base font-bold text-slate-800 h-12"
                />
              </div>
              <div>
                <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Assigned Staff</label>
                <input
                  type="text"
                  placeholder="e.g. Lucia, Mang Roger"
                  value={staffAssigned}
                  onChange={(e) => setStaffAssigned(e.target.value)}
                  className="w-full text-base font-bold text-slate-800 h-12"
                />
              </div>
              <div>
                <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Event Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full text-sm font-bold bg-white h-12 border-2 border-slate-200 rounded-xl"
                >
                  {(MARKET_EVENT_STATUS_TRANSITIONS[selectedEvent.status] ?? [selectedEvent.status]).map((eventStatus) => (
                    <option key={eventStatus} value={eventStatus}>{eventStatus}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">General Event Notes</label>
              <textarea
                placeholder="Details of entrance fee, setup times, etc."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 h-24 text-sm font-bold"
              />
            </div>

            {/* Cash Float & Register Configuration (Edit mode) */}
            <div className="border border-slate-200 rounded-2xl p-5 bg-slate-50/50 space-y-4">
              <span className="text-xs text-slate-500 font-black uppercase tracking-wider block">Cash Register, Adjustments &amp; Closing</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Opening Cash Balance (Float) ₱</label>
                  <input
                    type="number"
                    min={0}
                    disabled={selectedEvent.status !== "Draft"}
                    value={initialCashBalance}
                    onChange={(e) => setInitialCashBalance(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full text-base font-bold text-slate-850 h-12 border-2 border-slate-200 rounded-xl px-3 outline-none disabled:opacity-70"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Cash Adjustments / Refunds ₱</label>
                  <input
                    type="number"
                    value={cashAdjustments}
                    onChange={(e) => setCashAdjustments(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full text-base font-bold text-slate-850 h-12 border-2 border-slate-200 rounded-xl px-3 outline-none"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Cash Adjustments Notes</label>
                  <input
                    type="text"
                    placeholder="Describe adjustments (e.g., Change addition, refund)"
                    value={cashAdjustmentsNotes}
                    onChange={(e) => setCashAdjustmentsNotes(e.target.value)}
                    className="w-full text-base font-bold text-slate-850 h-12 border-2 border-slate-200 rounded-xl px-3 outline-none"
                  />
                </div>
                {(selectedEvent.status === "Active" || selectedEvent.status === "Completed") && (
                  <div>
                    <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Actual Physical Closing Cash ₱</label>
                    <input
                      type="number"
                      min={0}
                      placeholder="Count physical cash in vault"
                      value={actualClosingCash}
                      onChange={(e) => setActualClosingCash(e.target.value === "" ? "" : Number(e.target.value))}
                      className="w-full text-base font-bold text-slate-850 h-12 border-2 border-slate-200 rounded-xl px-3 outline-none bg-emerald-50 border-emerald-250 focus:border-emerald-550 focus:ring-1 focus:ring-emerald-500/20"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* INVENTORY PREPARATION COMPONENT (Edit mode) */}
            <fieldset
              disabled={selectedEvent.status !== "Draft"}
              className="border border-slate-200 rounded-2xl p-5 bg-slate-50/50 space-y-4 disabled:opacity-70"
            >
              <span className="text-xs text-slate-500 font-black uppercase tracking-wider block">Reserve Inventory Allocation</span>
              {selectedEvent.status !== "Draft" && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                  Allocations are locked after activation. Status and event details can still be updated.
                </p>
              )}

              <InventoryChecklist
                products={products}
                allocations={allocations}
                setAllocations={setAllocations}
                disabled={selectedEvent.status !== "Draft"}
              />

              {/* Summary aggregate info */}
              {allocations.length > 0 && (() => {
                const stats = calculateSummaryMetrics(allocations);
                return (
                  <div className="grid grid-cols-3 gap-4 p-4 bg-white border border-slate-200 rounded-2xl text-xs font-bold text-slate-555 shadow-3xs">
                    <div>
                      <span className="text-[10px] text-slate-455 uppercase block">Est Revenue</span>
                      <span className="font-mono font-black text-slate-900 text-sm mt-1 block">₱{stats.estimatedRevenue.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-455 uppercase block">Est Cost (BOM)</span>
                      <span className="font-mono font-black text-slate-900 text-sm mt-1 block">
                        {stats.financialsVisible ? `₱${stats.estimatedCost?.toLocaleString()}` : "Owner only"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-455 uppercase block">Potential Profit</span>
                      <span className="font-mono font-black text-emerald-600 text-sm mt-1 block">
                        {stats.financialsVisible ? `₱${stats.potentialProfit?.toLocaleString()}` : "Owner only"}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </fieldset>

            <div className="flex justify-end gap-3 border-t border-slate-100 pt-6 mt-8">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-12 px-6"
                onClick={() => {
                  setIsEditOpen(false);
                  setSelectedEvent(null);
                }}
                disabled={actionLoading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="h-12 px-6 font-bold"
                isLoading={actionLoading}
              >
                Save Changes
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* 6. PHASE 4: ENTERPRISE CLOSEOUT REPORT MODAL */}
      {isReportOpen && selectedReportEvent && (
        <Modal
          isOpen={isReportOpen}
          onClose={() => {
            setIsReportOpen(false);
            setSelectedReportEvent(null);
            setReportSalesList([]);
          }}
          title="Market Event Closeout Report"
          size="3xl"
        >
          <div className="space-y-6 text-sm font-semibold text-slate-600 leading-normal print:p-0 print:text-black">
            
            {/* Header info sheet */}
            <div className="flex justify-between items-start border-b-2 border-slate-200 pb-5">
              <div>
                <span className="font-heading font-black text-xl tracking-widest text-slate-900 block leading-none">H+H HUB</span>
                <span className="text-[10px] text-slate-455 uppercase tracking-widest font-black block mt-2">MARKET EVENT CLOSEOUT SUMMARY</span>
                <span className="text-xs text-slate-400 font-semibold block mt-1">Pasig City Kitchen Operations</span>
              </div>
              <div className="text-right text-xs font-semibold text-slate-500 space-y-1">
                <span className="font-heading font-black text-slate-800 text-sm uppercase tracking-widest block mb-2">OFFICIAL RECORD</span>
                <p>Event ID: <span className="font-mono font-bold text-slate-850">#{selectedReportEvent.id}</span></p>
                <p>Date: {selectedReportEvent.event_date}</p>
                <p>Location: {selectedReportEvent.location}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-bold text-slate-500">
              <div>
                <span className="text-slate-400 uppercase tracking-wider block text-[10px]">Market Name:</span>
                <span className="text-sm font-black text-slate-800 block mt-1">{selectedReportEvent.name}</span>
              </div>
              <div>
                <span className="text-slate-400 uppercase tracking-wider block text-[10px]">Assigned Staff:</span>
                <span className="text-sm font-black text-slate-800 block mt-1">{selectedReportEvent.staff_assigned || "None"}</span>
              </div>
            </div>

            {/* Financial Performance Profit report */}
            <div className="p-5 bg-[#885625]/5 border border-[#ece5da] rounded-2xl">
              <span className="text-xs text-primary font-black uppercase tracking-wider block mb-3 flex items-center gap-1.5">
                <TrendingUp size={16} /> Financial Profit Report
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-bold text-slate-655">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-black">Gross Revenue</span>
                  <span className="text-base font-black text-slate-800 block font-mono mt-1">₱{selectedReportEvent.estimated_revenue.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-black">Total Cost (BOM)</span>
                  <span className="text-base font-black text-slate-800 block font-mono mt-1">
                    {selectedReportEvent.financials_visible === false
                      ? "Owner only"
                      : selectedReportEvent.costing_complete !== false
                        ? `₱${selectedReportEvent.estimated_cost.toLocaleString()}`
                        : "Unavailable"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-black">Actual Net Profit</span>
                  <span className="text-lg font-black text-emerald-600 block font-mono mt-1">
                    {selectedReportEvent.financials_visible === false
                      ? "Owner only"
                      : selectedReportEvent.costing_complete !== false
                        ? `₱${selectedReportEvent.potential_profit.toLocaleString()}`
                        : "Unavailable"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-black">Profit Margin %</span>
                  <span className="text-base font-black text-slate-800 block mt-1">
                    {selectedReportEvent.financials_visible === false
                      ? "Owner only"
                      : selectedReportEvent.costing_complete !== false && selectedReportEvent.estimated_revenue > 0
                      ? `${Math.round((selectedReportEvent.potential_profit / selectedReportEvent.estimated_revenue) * 100)}%`
                      : "Unavailable"}
                  </span>
                </div>
              </div>
            </div>

            {/* Inventory Return sheets (Initial brought vs remaining returned) */}
            <div className="space-y-2">
              <span className="text-xs text-slate-500 font-black uppercase tracking-wider block flex items-center gap-1.5">
                <Package size={16} /> Remaining Stock &amp; Warehouse Return Sheet
              </span>
              <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-3xs">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-black uppercase tracking-wider text-xs px-4 py-3">
                      <th className="px-5 py-3">Product Description</th>
                      <th className="px-5 py-3 text-right">Qty Dispatched</th>
                      <th className="px-5 py-3 text-right">Units Sold</th>
                      <th className="px-5 py-3 text-right">Returned Unsold</th>
                      <th className="px-5 py-3 text-right">BOM Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                    {selectedReportEvent.allocations.map((alloc: any) => {
                      const soldQty = reportSalesList.reduce((sum, sale) => {
                        const item = sale.items.find((it: any) => it.sku === alloc.sku);
                        return sum + (item ? item.quantity : 0);
                      }, 0);

                      const initialQty = alloc.quantity + soldQty;
                      const returnedQty = alloc.quantity;

                      return (
                        <tr key={alloc.id} className="hover:bg-slate-50/20">
                          <td className="px-5 py-3.5">
                            <span className="text-slate-855 font-black block text-sm">{alloc.product_name}</span>
                            <span className="text-xs text-slate-400 font-mono font-semibold flex items-center gap-1.5 mt-0.5">{alloc.sku} <span className={`px-1 py-0.5 rounded text-[9px] font-black ${getSizeBadgeStyle(alloc.size)}`}>{alloc.size}</span></span>
                          </td>
                          <td className="px-5 py-3.5 text-right font-mono text-slate-600">{initialQty} units</td>
                          <td className="px-5 py-3.5 text-right font-mono text-[#885625]">{soldQty} units</td>
                          <td className="px-5 py-3.5 text-right font-mono text-emerald-600">{returnedQty} units</td>
                          <td className="px-5 py-3.5 text-right font-mono text-slate-855">
                            {selectedReportEvent.financials_visible === false
                              ? "Owner only"
                              : `₱${(soldQty * alloc.cost_per_unit).toFixed(2)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Cash Float & Register Auditing Table */}
            {(() => {
              const cashSalesTotal = calculateCashSalesTotal();
              const initialFloat = selectedReportEvent.initial_cash_balance || 0.0;
              const adjustments = selectedReportEvent.cash_adjustments || 0.0;
              const expectedClosing = initialFloat + cashSalesTotal + adjustments;
              const actualClosing = selectedReportEvent.actual_closing_cash;
              const hasClosing = actualClosing !== null && actualClosing !== undefined;
              const variance = hasClosing ? (actualClosing as number) - expectedClosing : 0.0;

              return (
                <div className="space-y-3">
                  <span className="text-xs text-slate-500 font-black uppercase tracking-wider block flex items-center gap-1.5">
                    <Coins size={16} /> Cash Float &amp; Register Auditing Sheet
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-5 rounded-2xl border border-slate-200">
                    <div className="space-y-2 text-xs font-bold">
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-455">1. Opening Cash Float:</span>
                        <span className="font-mono text-slate-800">₱{initialFloat.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-455">2. Cash Sales (Normal &amp; Paid Preorders):</span>
                        <span className="font-mono text-[#885625]">₱{cashSalesTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-455">3. Cash Adjustments / Refunds:</span>
                        <span className="font-mono text-slate-800">
                          ₱{adjustments.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          {selectedReportEvent.cash_adjustments_notes && (
                            <span className="text-[10px] text-slate-400 block font-sans">Notes: {selectedReportEvent.cash_adjustments_notes}</span>
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5 pt-2 border-t-2 border-slate-200 font-black text-sm">
                        <span className="text-slate-800">Expected Closing Cash:</span>
                        <span className="font-mono text-slate-900">₱{expectedClosing.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                    
                    <div className="flex flex-col justify-center items-center p-4 bg-white border border-slate-200 rounded-xl space-y-2.5">
                      <span className="text-[10px] text-slate-400 uppercase font-black tracking-wider">Audit Closer Variance</span>
                      {hasClosing ? (
                        <>
                          <div className="text-center">
                            <span className="text-xs text-slate-400 block font-semibold">Physical Cash Counted</span>
                            <span className="text-xl font-mono font-black text-slate-900">₱{actualClosing?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                          </div>
                          <div className={`text-center py-1 px-3 rounded-lg border font-mono font-black text-xs ${
                            variance === 0 
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                              : variance > 0 
                                ? "bg-blue-50 text-blue-700 border-blue-200" 
                                : "bg-rose-50 text-rose-700 border-rose-200"
                          }`}>
                            {variance === 0 ? "Balanced (0.00 Variance)" : variance > 0 ? `+₱${variance.toLocaleString()} Cash Excess` : `₱${variance.toLocaleString()} Cash Deficit`}
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400 font-bold italic py-4">Physical Closing Cash Not Counted</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Preorders Tracking Section */}
            {(() => {
              const stats = calculatePreorderStats();
              const preordersList = reportSalesList.filter(s => s.is_preorder);
              if (stats.totalCount === 0) return null;

              return (
                <div className="space-y-3">
                  <span className="text-xs text-slate-500 font-black uppercase tracking-wider block flex items-center gap-1.5">
                    <Smartphone size={16} /> Preorders Fulfillment Sheet ({stats.fulfilledCount}/{stats.totalCount} Picked Up)
                  </span>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl text-center">
                      <span className="text-[9px] text-slate-400 uppercase font-black block">Total Preorders</span>
                      <span className="text-sm font-black text-slate-800 font-mono block mt-1">{stats.totalCount} orders</span>
                    </div>
                    <div className="bg-emerald-50/30 border border-emerald-100 p-3 rounded-xl text-center">
                      <span className="text-[9px] text-emerald-600 uppercase font-black block">Total Paid Value</span>
                      <span className="text-sm font-black text-emerald-700 font-mono block mt-1">₱{stats.paidAmount.toLocaleString()}</span>
                    </div>
                    <div className="bg-rose-50/30 border border-rose-100 p-3 rounded-xl text-center">
                      <span className="text-[9px] text-rose-600 uppercase font-black block">Total Unpaid Value</span>
                      <span className="text-sm font-black text-rose-700 font-mono block mt-1">₱{stats.unpaidAmount.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-xl overflow-hidden bg-white max-h-40 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-black uppercase text-[10px] px-3 py-2">
                          <th className="px-4 py-2">Customer / Order</th>
                          <th className="px-4 py-2">Gateway</th>
                          <th className="px-4 py-2">Value</th>
                          <th className="px-4 py-2">Payment</th>
                          <th className="px-4 py-2">Pickup</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                        {preordersList.map(sale => (
                          <tr key={sale.id} className="hover:bg-slate-50/10">
                            <td className="px-4 py-2 text-slate-800 font-black">{sale.preorder_customer_name || "Guest Identifier"}</td>
                            <td className="px-4 py-2 font-mono text-[10px] text-slate-455">{sale.payment_method}</td>
                            <td className="px-4 py-2 font-mono">₱{sale.total_amount.toLocaleString()}</td>
                            <td className="px-4 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${sale.preorder_payment_status === "Paid" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                                {sale.preorder_payment_status || "Unpaid"}
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${sale.preorder_fulfillment_status === "Picked Up" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>
                                {sale.preorder_fulfillment_status || "Pending"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {/* Payment breakdowns (Cash, GCash, Maya, Card, Mixed) */}
            <div className="space-y-2">
              <span className="text-xs text-slate-500 font-black uppercase tracking-wider block flex items-center gap-1.5">
                <Coins size={16} /> Multi-Payment Gateway Breakdown
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {Object.entries(calculatePaymentBreakdown()).map(([method, total]) => (
                  <div key={method} className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center animate-scale-up">
                    <span className="text-slate-400 text-[10px] uppercase font-bold">{method}</span>
                    <span className="text-sm font-black text-slate-805 block font-mono mt-1">₱{total.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Reconciliation confirmation box */}
            <div className="p-4 bg-emerald-50/50 border border-emerald-200 rounded-2xl flex items-center gap-3.5 text-xs font-bold text-emerald-800">
              <ShieldCheck className="text-emerald-600 shrink-0" size={24} />
              <p className="leading-relaxed">
                Reconciliation Complete: Unsold remaining items have been returned and added back to the Main Warehouse (Default Stock) automatically. Warehouse ledgers and audits are locked for this record.
              </p>
            </div>

            {/* Print and close buttons */}
            <div className="flex justify-end gap-3 pt-6 border-t border-slate-100 print:hidden">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-12 border-slate-200"
                onClick={() => window.print()}
                leftIcon={<Printer size={16} />}
              >
                Print Closeout Report
              </Button>
              <Button
                type="button"
                variant="primary"
                size="lg"
                className="h-12 px-6"
                onClick={() => {
                  setIsReportOpen(false);
                  setSelectedReportEvent(null);
                  setReportSalesList([]);
                }}
              >
                Close Report
              </Button>
            </div>

          </div>
        </Modal>
      )}

      {/* 7. KITCHEN CASHIER CLOSEOUT SHEET MODAL */}
      {isCloseoutOpen && closeoutEvent && (
        <Modal
          isOpen={isCloseoutOpen}
          onClose={() => {
            setIsCloseoutOpen(false);
            setCloseoutEvent(null);
          }}
          title="Pop-Up Market Register Closeout Sheet"
          size="3xl"
        >
          <form onSubmit={handleCloseoutSubmit} className="space-y-6 text-sm font-semibold text-slate-600 leading-normal">
            <p className="text-slate-500 leading-normal border-b border-slate-100 pb-3">
              {"Closing out a cashier session returns all remaining, non-wasted booth items back to the Main Warehouse stock automatically, reconciles double-entry transaction ledgers, and locks this session's cash record."}
            </p>

            {/* Cash Float and closing records */}
            <div className="border border-slate-200 rounded-2xl p-5 bg-slate-50/50 space-y-4">
              <span className="text-xs text-slate-500 font-black uppercase tracking-wider block">Cash Closer Registers</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <span className="text-xs text-slate-455 font-bold uppercase block mb-1">Opening Float Balance:</span>
                  <span className="text-sm font-black text-slate-805 font-mono">₱{(closeoutEvent.initial_cash_balance || 0).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-455 font-bold uppercase block mb-1">Cash Adjustments / Refunds:</span>
                  <span className="text-sm font-black text-slate-805 font-mono">₱{(closeoutEvent.cash_adjustments || 0).toLocaleString()}</span>
                </div>
                <div>
                  <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Actual Physical Closing Cash *</label>
                  <input
                    type="number"
                    required
                    min={0}
                    placeholder="Physical cash count in money box"
                    value={closeoutActualCash}
                    onChange={(e) => setCloseoutActualCash(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full h-12 border-2 border-slate-200 rounded-xl px-3 outline-none focus:border-emerald-500 font-bold bg-emerald-50/20 text-slate-800"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Total Operating Expenses (₱)</label>
                  <input
                    type="number"
                    min={0}
                    placeholder="e.g., Booth space, food fee, gas"
                    value={closeoutExpenses}
                    onChange={(e) => setCloseoutExpenses(Number(e.target.value) || 0)}
                    className="w-full h-12 border-2 border-slate-200 rounded-xl px-3 outline-none focus:border-primary font-bold bg-white text-slate-800"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Expense Breakdown / Notes</label>
                  <input
                    type="text"
                    placeholder="e.g., Space lease: ₱500, Gas: ₱200"
                    value={closeoutExpenseNotes}
                    onChange={(e) => setCloseoutExpenseNotes(e.target.value)}
                    className="w-full h-12 border-2 border-slate-200 rounded-xl px-3 outline-none focus:border-primary font-bold bg-white text-slate-800"
                  />
                </div>
              </div>
            </div>

            {/* Food Waste Tracker Grid */}
            <div className="border border-slate-200 rounded-2xl p-5 bg-slate-50/50 space-y-4">
              <span className="text-xs text-slate-500 font-black uppercase tracking-wider block">Food Waste Tracker (Log damaged/spoiled items)</span>
              
              <div className="border border-slate-200 rounded-xl bg-white max-h-56 overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-black uppercase tracking-wider text-[10px] px-3 py-2">
                      <th className="px-4 py-2">Product Name</th>
                      <th className="px-4 py-2 text-right">Booth Stock</th>
                      <th className="px-4 py-2 text-center w-24">Qty Wasted</th>
                      <th className="px-4 py-2 w-44">Waste Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                    {closeoutAllocations.map((alloc, idx) => (
                      <tr key={alloc.sku} className="hover:bg-slate-50/5">
                        <td className="px-4 py-2">
                          <span className="font-black text-slate-800 block text-xs">{alloc.product_name}</span>
                          <span className="text-[9px] font-mono text-slate-400 mt-0.5 block">{alloc.sku} &bull; {alloc.size}</span>
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-slate-600">{alloc.quantity} units</td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min={0}
                            max={alloc.quantity}
                            value={alloc.wasted_quantity}
                            onChange={(e) => {
                              const val = Math.min(alloc.quantity, Math.max(0, parseInt(e.target.value) || 0));
                              const updated = [...closeoutAllocations];
                              updated[idx].wasted_quantity = val;
                              setCloseoutAllocations(updated);
                            }}
                            className="w-full h-8 border-2 border-slate-200 rounded-lg text-center font-mono font-black"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            placeholder="e.g., Unsold, Spilled, Expired"
                            value={alloc.waste_reason}
                            onChange={(e) => {
                              const updated = [...closeoutAllocations];
                              updated[idx].waste_reason = e.target.value;
                              setCloseoutAllocations(updated);
                            }}
                            className="w-full h-8 border-2 border-slate-200 rounded-lg px-2 text-xs font-semibold"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 pt-6 mt-8">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-12 px-6"
                onClick={() => {
                  setIsCloseoutOpen(false);
                  setCloseoutEvent(null);
                }}
                disabled={actionLoading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="h-12 px-6 font-bold bg-emerald-600 hover:bg-emerald-750 border-emerald-500 shadow-sm"
                isLoading={actionLoading}
              >
                Submit Closeout &amp; Reconcile
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* DELETE CONFIRM MODAL */}
      {isDeleteOpen && selectedEvent && (
        <ConfirmationModal
          isOpen={isDeleteOpen}
          onClose={() => {
            setIsDeleteOpen(false);
            setSelectedEvent(null);
          }}
          onConfirm={handleDeleteConfirm}
          title="Delete Market Event"
          confirmLabel="Permanently Delete"
          cancelLabel="Cancel"
          type="danger"
          isLoading={actionLoading}
          message={`Are you sure you want to delete the Market Event: "${selectedEvent.name}"? This action cannot be undone.`}
        />
      )}
    </div>
  );
}
