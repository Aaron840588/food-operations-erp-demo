/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";

import { api, UnconfirmedFinancialMutationError } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import {
  canDisplayMarketEventCatalogProduct,
  getMarketEventChecklistKey,
} from "@/lib/marketEventForm";
import {
  MARKET_EVENT_OFFLINE_SCHEMA_VERSION,
  MARKET_EVENT_PAYMENT_METHODS,
  centavosToAmount,
  createMarketEventSaleClientReference,
  marketEventOfflineDb,
  pendingMarketSaleToApiPayload,
  type CachedMarketEventStockV1,
  type MarketEventOfflinePackageV1,
  type MarketEventPaymentMethod,
  type MarketEventSyncMetadataV1,
  type PendingMarketSaleV1,
} from "@/lib/marketEventOfflineDb";
import {
  getProductBusinessCategory,
  BUSINESS_CATEGORIES,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatProductQuantity,
  isCurrentLineupProduct,
} from "@/lib/utils";
import { ProductDisplay, PRODUCT_IMAGE_MAP } from "@/components/ui/ProductDisplay";
import { NumericQuantityInput } from "@/components/ui/NumericQuantityInput";
import { StatusBadge } from "@/components/ui/StatusBadge";
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
  Heart,
  TrendingDown,
  Coins,
  Clock,
  Gift,
  BrainCircuit,
  RotateCw,
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
import { InventoryChecklist } from "@/components/inventory/InventoryChecklist";
import { MarketPackManifestModal } from "@/components/market/MarketPackManifestModal";
const CREATE_EVENT_STATUSES = ["Draft", "Active"] as const;
const MARKET_EVENT_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  Draft: ["Draft", "Active", "Cancelled"],
  Active: ["Active", "Completed", "Cancelled"],
  Completed: ["Completed"],
  Cancelled: ["Cancelled"],
};

const LEGACY_MARKET_SALES_KEY = "hh_offline_market_sales";
const MARKET_DEAL_PRICES = {
  CLASSIC_DUO: 165,
  SIGNATURE_DUO: 245,
  COMBO_DUO: 210,
} as const;

function applyCachedMarketStock(event: any, stock: CachedMarketEventStockV1[]): any {
  if (!event || stock.length === 0) return event;
  const stockBySku = new Map(stock.map((item) => [item.sku, item.available_quantity]));
  return {
    ...event,
    allocations: (event.allocations || []).map((allocation: any) => {
      if (!stockBySku.has(allocation.sku)) return allocation;
      const cachedRemaining = stockBySku.get(allocation.sku)!;
      return {
        ...allocation,
        remaining_quantity: cachedRemaining,
      };
    }),
  };
}

function offlineSaleToRecentSale(sale: PendingMarketSaleV1): any {
  return {
    id: sale.client_reference,
    event_id: sale.event_id,
    client_reference: sale.client_reference,
    cashier_username: sale.cashier_username,
    payment_method: sale.payment_method,
    subtotal_amount: centavosToAmount(
      sale.subtotal_amount_centavos
        ?? sale.items.reduce((sum, item) => sum + item.line_total_centavos, 0),
    ),
    discount_amount: centavosToAmount(sale.discount_amount_centavos ?? 0),
    total_amount: centavosToAmount(sale.total_amount_centavos),
    tip_amount: centavosToAmount(sale.tip_amount_centavos ?? 0),
    cash_received: sale.cash_received_centavos == null
      ? null
      : centavosToAmount(sale.cash_received_centavos),
    change_given: centavosToAmount(sale.change_given_centavos),
    payment_reference: sale.payment_reference,
    customer_name: sale.customer_name ?? null,
    is_collected: sale.is_collected ?? true,
    promotion_code: sale.promotion_code ?? null,
    timestamp: sale.created_at,
    items: sale.items.map((item) => ({
      id: `${sale.client_reference}:${item.sku}`,
      sku: item.sku,
      quantity: item.quantity,
      product_name: item.product_name,
      size: item.size ?? "",
      price_snapshot: centavosToAmount(item.price_snapshot_centavos),
    })),
    is_preorder: sale.is_preorder,
    preorder_customer_name: sale.preorder_customer_name,
    preorder_payment_status: sale.preorder_payment_status,
    preorder_fulfillment_status: sale.preorder_fulfillment_status,
    is_offline_draft: true,
    offline_status: sale.status,
    sync_attempt_count: sale.sync_attempt_count,
    delivery_uncertain: sale.delivery_uncertain,
  };
}

function isOfflinePackageReady(
  packageRecord: MarketEventOfflinePackageV1 | null,
  eventId: number | null,
  cashierUsername: string,
  deviceId: string | null,
): boolean {
  return Boolean(
    packageRecord
      && eventId
      && packageRecord.event.id === eventId
      && packageRecord.event.status.toLowerCase() === "active"
      && new Date(packageRecord.expires_at).getTime() > Date.now()
      && packageRecord.cashier.username === cashierUsername
      && packageRecord.device_id === deviceId,
  );
}

export default function MarketEventsPage() {
  const { showToast } = useToast();
  const [events, setEvents] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Phase 5: AI & Analytics States
  const [activeMainTab, setActiveMainTab] = useState<"scheduler" | "analytics" | "reconciliation">("scheduler");
  const [schedulerFilter, setSchedulerFilter] = useState<"active" | "completed">("active");
  const [groupBySeries, setGroupBySeries] = useState(true);
  const [expandedSeriesMap, setExpandedSeriesMap] = useState<{ [seriesName: string]: boolean }>({});
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [reconciliationEventId, setReconciliationEventId] = useState<number | "">("");
  const [reconcileSalesList, setReconcileSalesList] = useState<any[]>([]);

  // Phase 3: Offline Systems States
  const [isOnline, setIsOnline] = useState(true);
  const [syncStatus, setSyncStatus] = useState<"Synced" | "Offline" | "Waiting to Sync" | "Synchronizing">("Synced");
  const [offlineQueue, setOfflineQueue] = useState<PendingMarketSaleV1[]>([]);
  const [offlinePackage, setOfflinePackage] = useState<MarketEventOfflinePackageV1 | null>(null);
  const [offlineStock, setOfflineStock] = useState<CachedMarketEventStockV1[]>([]);
  const [offlineMetadata, setOfflineMetadata] = useState<MarketEventSyncMetadataV1 | null>(null);
  const [offlineDeviceId, setOfflineDeviceId] = useState<string | null>(null);
  const [offlinePreparing, setOfflinePreparing] = useState(false);
  const [legacyReviewCount, setLegacyReviewCount] = useState(0);

  // Active terminal state (Phase 2)
  const [isSalesMode, setIsSalesMode] = useState(false);
  const [activeEvent, setActiveEvent] = useState<any>(null);
  const [manifestEvent, setManifestEvent] = useState<any | null>(null);
  const [isManifestOpen, setIsManifestOpen] = useState(false);
  const [posSearch, setPosSearch] = useState("");
  const [posCategory, setPosCategory] = useState("All");
  const [posShowOutOfStock, setPosShowOutOfStock] = useState(true);

  // Cashier Cart state
  const [cart, setCart] = useState<{ [sku: string]: number }>({});
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [cashReceived, setCashReceived] = useState("");
  const [keepChangeAsTip, setKeepChangeAsTip] = useState(false);
  const [tipAmountInput, setTipAmountInput] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [recentSales, setRecentSales] = useState<any[]>([]);
  const [isPreorder, setIsPreorder] = useState(false);
  const [preorderCustomerName, setPreorderCustomerName] = useState("");
  const [preorderPaymentStatus, setPreorderPaymentStatus] = useState<"Paid" | "Unpaid">("Paid");
  const [preorderFulfillmentStatus, setPreorderFulfillmentStatus] = useState<"Pending" | "Picked Up">("Pending");
  const [posDiscountType, setPosDiscountType] = useState<"PERCENTAGE" | "FIXED">("PERCENTAGE");
  const [posDiscountValue, setPosDiscountValue] = useState("");
  const [activeDealPreset, setActiveDealPreset] = useState<"CLASSIC_DUO" | "SIGNATURE_DUO" | "COMBO_DUO" | "B1T1" | null>(null);
  const [isPreorderLookupOpen, setIsPreorderLookupOpen] = useState(false);
  const [preorderLookupList, setPreorderLookupList] = useState<any[]>([]);
  const [preorderLookupQuery, setPreorderLookupQuery] = useState("");
  const [userRole, setUserRole] = useState("staff");
  const [cashierName, setCashierName] = useState("Cashier");

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
  const [closeoutCashExpenses, setCloseoutCashExpenses] = useState<number>(0);
  const [closeoutCashRefunds, setCloseoutCashRefunds] = useState<number>(0);
  const [closeoutGcashSales, setCloseoutGcashSales] = useState<number>(0);
  const [closeoutBpiSales, setCloseoutBpiSales] = useState<number>(0);
  const [closeoutExpenseNotes, setCloseoutExpenseNotes] = useState<string>("");
  const [closeoutOpeningFloatInput, setCloseoutOpeningFloatInput] = useState<number | "">("");
  const [closeoutActualCash, setCloseoutActualCash] = useState<number | "">("");

  // Form State (Market Events CRUD)
  const [name, setName] = useState("");
  const [eventDate, setEventDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [location, setLocation] = useState("");
  const [staffAssigned, setStaffAssigned] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("Draft");
  const [allocations, setAllocations] = useState<{
    sku: string;
    quantity: number;
    wasted_quantity?: number;
    waste_reason?: string;
  }[]>([]);
  const [initialCashBalance, setInitialCashBalance] = useState<number | "">("");
  const [actualClosingCash, setActualClosingCash] = useState<number | "">("");

  // Recurrence Form States
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState("weekly");
  const [recurrenceCount, setRecurrenceCount] = useState(4);


  const checkoutInFlightRef = useRef(false);
  const replayInFlightRef = useRef(false);
  const cartPanelRef = useRef<HTMLDivElement>(null);

  function readLegacyMarketSales(): any[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(LEGACY_MARKET_SALES_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function refreshLegacyReviewCount(): void {
    setLegacyReviewCount(readLegacyMarketSales().length);
  }

  async function refreshOfflineState(eventId?: number): Promise<void> {
    const unresolved = await marketEventOfflineDb.listUnresolvedSales();
    setOfflineQueue(unresolved);

    if (!replayInFlightRef.current) {
      setSyncStatus(navigator.onLine
        ? (unresolved.length > 0 ? "Waiting to Sync" : "Synced")
        : "Offline");
    }

    if (!eventId) return;
    const [packageRecord, stock, metadata, eventSales] = await Promise.all([
      marketEventOfflineDb.getEventPackage(eventId),
      marketEventOfflineDb.getCachedStock(eventId),
      marketEventOfflineDb.getSyncMetadata(eventId),
      marketEventOfflineDb.listUnresolvedSales(eventId),
    ]);
    setOfflinePackage(packageRecord);
    setOfflineStock(stock);
    setOfflineMetadata(metadata);
    if (packageRecord?.products?.length) {
      setProducts((current) => current.length === 0 ? packageRecord.products : current);
    }
    if (packageRecord && !navigator.onLine) {
      setActiveEvent((current: any) => (
        current?.id === eventId ? applyCachedMarketStock(current, stock) : current
      ));
    }
    setRecentSales((current) => [
      ...eventSales.map(offlineSaleToRecentSale),
      ...current.filter((sale) => !sale.is_offline_draft),
    ]);
  }

  async function replayOfflineQueue(eventId?: number): Promise<void> {
    if (!navigator.onLine || replayInFlightRef.current) return;
    replayInFlightRef.current = true;
    setSyncStatus("Synchronizing");

    let successCount = 0;
    let failedCount = 0;
    let rejectedCount = 0;
    let lastRejectedMessage = "";
    let manualReviewCount = 0;
    const terminalEventId = eventId ?? activeEvent?.id;

    try {
      const [cashier, device, queueToReplay] = await Promise.all([
        api.getCurrentUser(),
        marketEventOfflineDb.getOrCreateDeviceIdentity(),
        marketEventOfflineDb.listReplayableSales(eventId),
      ]);
      setCashierName(cashier.username);
      setUserRole(cashier.role);
      setOfflineDeviceId(device.device_id);

      if (queueToReplay.length > 0) {
        showToast(`Synchronizing ${queueToReplay.length} saved market sale${queueToReplay.length === 1 ? "" : "s"}...`, "info");
      }

      for (const queuedSale of queueToReplay) {
        try {
          await marketEventOfflineDb.markSaleSyncing(
            queuedSale.client_reference,
            cashier.username,
            device.device_id,
          );
        } catch (error) {
          manualReviewCount++;
          await marketEventOfflineDb.markSaleRequiresReview(queuedSale.client_reference, {
            code: "cashier_or_device_mismatch",
            message: getErrorMessage(error),
          });
          continue;
        }

        let serverSale: any;
        try {
          serverSale = await api.createMarketEventSale(
            queuedSale.event_id,
            pendingMarketSaleToApiPayload(queuedSale),
          );
        } catch (error) {
          if (error instanceof UnconfirmedFinancialMutationError) {
            manualReviewCount++;
            await marketEventOfflineDb.markSaleRequiresReview(queuedSale.client_reference, {
              code: "unconfirmed_delivery",
              message: "The server response could not be confirmed. Check the server journal before retrying.",
            });
          } else {
            const rejectionMessage = getErrorMessage(error);
            lastRejectedMessage = rejectionMessage;
            try {
              await marketEventOfflineDb.voidLocalSale(
                queuedSale.client_reference,
                {
                  definitive_server_rejection: true,
                  error_code: "server_rejected_sale",
                  error_message: rejectionMessage,
                },
              );
              rejectedCount++;
            } catch (restoreError) {
              manualReviewCount++;
              await marketEventOfflineDb.markSaleRequiresReview(queuedSale.client_reference, {
                code: "server_rejection_restore_failed",
                message: `${rejectionMessage} Local stock recovery also failed: ${getErrorMessage(restoreError)}`,
              });
            }
          }
          continue;
        }

        try {
          await marketEventOfflineDb.acknowledgeSyncedSale(queuedSale.client_reference, {
            server_sale_id: Number(serverSale.id),
            event_id: Number(serverSale.event_id),
            cashier_username: String(serverSale.cashier_username ?? ""),
            payment_method: serverSale.payment_method as MarketEventPaymentMethod,
            items: (serverSale.items || []).map((item: any) => ({
              sku: String(item.sku ?? ""),
              quantity: Number(item.quantity),
              price_snapshot: Number(item.price_snapshot),
            })),
            subtotal_amount: Number(serverSale.subtotal_amount),
            promotion_code: serverSale.promotion_code ?? null,
            promotion_discount_amount: Number(serverSale.promotion_discount_amount ?? 0),
            discount_type: serverSale.discount_type ?? null,
            discount_value: serverSale.discount_value == null
              ? null
              : Number(serverSale.discount_value),
            manual_discount_amount: Number(serverSale.manual_discount_amount ?? 0),
            discount_amount: Number(serverSale.discount_amount ?? 0),
            total_amount: Number(serverSale.total_amount),
            tip_amount: Number(serverSale.tip_amount ?? 0),
            cash_received: serverSale.cash_received == null
              ? null
              : Number(serverSale.cash_received),
            change_given: Number(serverSale.change_given ?? 0),
            payment_reference: serverSale.payment_reference ?? null,
            customer_name: serverSale.customer_name ?? null,
            is_collected: Boolean(serverSale.is_collected),
            is_preorder: serverSale.is_preorder,
            preorder_customer_name: serverSale.preorder_customer_name ?? null,
            preorder_payment_status: serverSale.preorder_payment_status ?? null,
            preorder_fulfillment_status: serverSale.preorder_fulfillment_status ?? null,
            server_timestamp: String(serverSale.timestamp ?? ""),
          });
          successCount++;
        } catch (error) {
          manualReviewCount++;
          await marketEventOfflineDb.markSaleRequiresReview(queuedSale.client_reference, {
            code: "server_receipt_mismatch",
            message: getErrorMessage(error),
          });
        }
      }
    } catch (error) {
      failedCount++;
      showToast(getErrorMessage(error, "Saved sales could not be synchronized."), "error");
    } finally {
      replayInFlightRef.current = false;
      await refreshOfflineState(terminalEventId);
    }

    if (successCount > 0) {
      showToast(`${successCount} saved sale${successCount === 1 ? "" : "s"} synchronized and verified.`, "success");
      await fetchEvents();
      if (terminalEventId) {
        await fetchRecentSales(terminalEventId);
        await refreshOfflineState(terminalEventId);
      }
    }
    if (rejectedCount > 0) {
      showToast(
        `${rejectedCount} sale${rejectedCount === 1 ? " was" : "s were"} rejected; local stock was restored safely. ${lastRejectedMessage}`,
        "warning",
      );
    }
    if (failedCount > 0 || manualReviewCount > 0) {
      showToast(
        `${failedCount} sale${failedCount === 1 ? "" : "s"} remain retryable; ${manualReviewCount} require manual review.`,
        "warning",
      );
    }
  }

  // Setup connection monitors and restore the isolated IndexedDB queue.
  useEffect(() => {
    let disposed = false;
    const initializeOfflineState = async () => {
      const savedRole = localStorage.getItem("hh_user_role") || "staff";
      const savedCashier = localStorage.getItem("hh_user_name") || "Cashier";
      // Browser role/connectivity are external state and must be read after hydration.
      setUserRole(savedRole);
      setCashierName(savedCashier);
      setIsOnline(navigator.onLine);
      refreshLegacyReviewCount();
      try {
        const device = await marketEventOfflineDb.getOrCreateDeviceIdentity();
        if (disposed) return;
        setOfflineDeviceId(device.device_id);
        const interruptedSales = await marketEventOfflineDb.listUnresolvedSales();
        for (const sale of interruptedSales) {
          if (sale.delivery_uncertain && sale.status !== "requires_review") {
            await marketEventOfflineDb.markSaleRequiresReview(sale.client_reference, {
              code: "interrupted_unconfirmed_delivery",
              message: "The app closed before this server delivery could be confirmed.",
            });
          }
        }
        await refreshOfflineState();
        if (navigator.onLine) void replayOfflineQueue();
      } catch (error) {
        console.error("Unable to initialize Market Events offline storage:", error);
        setSyncStatus(navigator.onLine ? "Synced" : "Offline");
      }
    };
    void initializeOfflineState();

    const handleOnline = () => {
      setIsOnline(true);
      void replayOfflineQueue();
      void fetchEvents();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setSyncStatus("Offline");
      showToast("You are offline. Only prepared Market POS events can continue selling.", "warning");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      disposed = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeEvent?.id) return;
    const interval = setInterval(() => {
      if (navigator.onLine) {
        fetchEvents();
      }
    }, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEvent?.id]);

  async function fetchEvents() {
    setLoading(true);
    try {
      const res = await api.getMarketEvents();
      setEvents(res);
      try { localStorage.setItem("hh_cache_market_events", JSON.stringify(res)); } catch {}
      if (activeEvent) {
        const updatedActive = res.find((e: any) => e.id === activeEvent.id);
        if (updatedActive) {
          const pendingSales = await marketEventOfflineDb.listUnresolvedSales(activeEvent.id).catch(() => []);
          if (pendingSales.length === 0) {
            setActiveEvent(updatedActive);
          } else {
            const stock = await marketEventOfflineDb.getCachedStock(activeEvent.id).catch(() => []);
            setActiveEvent(applyCachedMarketStock(updatedActive, stock));
          }
        }
      }
    } catch (err) {
      console.warn("Network fetch market events failed, using cached events:", err);
      const cached = localStorage.getItem("hh_cache_market_events");
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          setEvents(parsed);
          if (activeEvent) {
            const updatedActive = parsed.find((e: any) => e.id === activeEvent.id);
            if (updatedActive) {
              const pendingSales = await marketEventOfflineDb.listUnresolvedSales(activeEvent.id).catch(() => []);
              if (pendingSales.length === 0) {
                setActiveEvent(updatedActive);
              } else {
                const stock = await marketEventOfflineDb.getCachedStock(activeEvent.id).catch(() => []);
                setActiveEvent(applyCachedMarketStock(updatedActive, stock));
              }
            }
          }
        } catch {}
      }
    } finally {
      setLoading(false);
    }
  }

  const fetchProducts = async () => {
    try {
      const res = await api.getProducts();
      const catalogProducts = (res || []).filter((p: any) => p.sku !== "SKU" && isCurrentLineupProduct(p));
      setProducts(catalogProducts);
      try { localStorage.setItem("hh_cache_market_products", JSON.stringify(catalogProducts)); } catch {}
    } catch (err) {
      console.warn("Network fetch products failed, loading cached products:", err);
      const cached = localStorage.getItem("hh_cache_market_products");
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          setProducts(parsed.filter((p: any) => p.sku !== "SKU" && isCurrentLineupProduct(p)));
          return;
        } catch {}
      }
      if (offlinePackage?.products?.length) {
        setProducts(offlinePackage.products);
      }
    }
  };

  const fetchRecentSales = async (eventId: number) => {
    try {
      if (navigator.onLine) {
        const res = await api.getMarketEventSales(eventId);
        const pending = await marketEventOfflineDb.listUnresolvedSales(eventId);
        setRecentSales([
          ...pending.map(offlineSaleToRecentSale),
          ...(res || []).filter((sale: any) => !sale.is_offline_draft),
        ]);
        localStorage.setItem(`hh_cache_market_sales_${eventId}`, JSON.stringify(res));
      } else {
        const cached = localStorage.getItem(`hh_cache_market_sales_${eventId}`);
        const pending = await marketEventOfflineDb.listUnresolvedSales(eventId);
        const cachedSales = cached ? JSON.parse(cached) : [];
        setRecentSales([
          ...pending.map(offlineSaleToRecentSale),
          ...cachedSales.filter((sale: any) => !sale.is_offline_draft),
        ]);
      }
    } catch (err) {
      console.error("Error loading recent sales:", err);
      const cached = localStorage.getItem(`hh_cache_market_sales_${eventId}`);
      const pending = await marketEventOfflineDb.listUnresolvedSales(eventId).catch(() => []);
      const cachedSales = cached ? JSON.parse(cached) : [];
      setRecentSales([
        ...pending.map(offlineSaleToRecentSale),
        ...cachedSales.filter((sale: any) => !sale.is_offline_draft),
      ]);
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
    setIsRecurring(false);
    setRecurrenceFrequency("weekly");
    setRecurrenceCount(4);
    if (products.length === 0) {
      void fetchProducts();
    }
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
    
    const initialAllocations = (event.allocations || []).map((a: any) => ({
      sku: a.sku,
      // Active-event edits represent the physical units still at the booth.
      // Sold units are immutable history and must never be added back to this field.
      quantity: a.remaining_quantity ?? a.quantity ?? 0,
      wasted_quantity: a.wasted_quantity || 0,
      waste_reason: a.waste_reason || "",
    }));
    setAllocations(initialAllocations);
    
    if (products.length === 0) {
      void fetchProducts();
    }
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
    setActionLoading(true);
    const validAllocations = allocations.filter(a =>
      a.quantity >= 0 &&
      (a.sku || "").trim().length > 0 &&
      (products.length === 0 || products.some(p => (p.sku || "").trim().toLowerCase() === (a.sku || "").trim().toLowerCase()) || a.sku.startsWith("GS-"))
    );
    try {
      await api.createMarketEvent({
        name,
        event_date: eventDate,
        location,
        staff_assigned: staffAssigned,
        notes,
        status,
        allocations: validAllocations,
        opening_float: initialCashBalance === "" ? 0.0 : Number(initialCashBalance),
        actual_closing_cash: actualClosingCash === "" ? null : Number(actualClosingCash),
        recurrence: isRecurring ? recurrenceFrequency : "none",
        recurrence_count: isRecurring ? Number(recurrenceCount) : 1
      });
      setIsCreateOpen(false);
      fetchEvents();
    } catch (err: unknown) {
      alert(`Error creating Market Event: ${getErrorMessage(err)}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEvent || !name || !eventDate || !location) return;
    if (selectedEvent.status === "Active" && status === "Completed") {
      setActionLoading(true);
      try {
        const updatedEvent = await api.updateMarketEvent(selectedEvent.id, {
          name,
          event_date: eventDate,
          location,
          staff_assigned: staffAssigned,
          notes,
          status: "Active",
          opening_float: initialCashBalance === "" ? 0.0 : Number(initialCashBalance),
          actual_closing_cash: actualClosingCash === "" ? null : Number(actualClosingCash),
        });
        setIsEditOpen(false);
        handleUpdateStatusDirectly(updatedEvent, "Completed");
      } catch (err: unknown) {
        alert(`Error updating Market Event: ${getErrorMessage(err)}`);
      } finally {
        setActionLoading(false);
      }
      return;
    }
    setActionLoading(true);
    const validAllocations = allocations.filter(a =>
      a.quantity >= 0 &&
      (a.sku || "").trim().length > 0 &&
      (products.length === 0 || products.some(p => (p.sku || "").trim().toLowerCase() === (a.sku || "").trim().toLowerCase()) || a.sku.startsWith("GS-"))
    );
    try {
      const updatePayload: any = {
        name,
        event_date: eventDate,
        location,
        staff_assigned: staffAssigned,
        notes,
        status,
        opening_float: initialCashBalance === "" ? 0.0 : Number(initialCashBalance),
        actual_closing_cash: actualClosingCash === "" ? null : Number(actualClosingCash)
      };
      if (selectedEvent.status === "Draft") {
        updatePayload.allocations = validAllocations;
      } else if (selectedEvent.status === "Active") {
        updatePayload.allocations = validAllocations.map((allocation) => ({
          sku: allocation.sku,
          remaining_quantity: allocation.quantity,
          wasted_quantity: allocation.wasted_quantity ?? 0,
          waste_reason: allocation.waste_reason ?? "",
        }));
      }
      const updatedEvent = await api.updateMarketEvent(selectedEvent.id, updatePayload);
      setIsEditOpen(false);
      setSelectedEvent(null);
      if (activeEvent?.id === selectedEvent.id) {
        setActiveEvent(updatedEvent);
      }
      if (navigator.onLine && updatedEvent.status === "Active") {
        try {
          const unresolved = await marketEventOfflineDb.listUnresolvedSales(selectedEvent.id).catch(() => []);
          if (unresolved.length === 0) {
            await handlePrepareOfflinePackage(updatedEvent);
          }
        } catch (e) {
          console.warn("Auto-sync offline package after edit failed:", e);
        }
      }
      await fetchEvents();
    } catch (err: unknown) {
      alert(`Error updating Market Event: ${getErrorMessage(err)}`);
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

  async function migrateLegacySalesForEvent(eventId: number): Promise<void> {
    const legacySales = readLegacyMarketSales();
    if (legacySales.length === 0) return;
    const cachedStock = await marketEventOfflineDb.getCachedStock(eventId);
    const unitPriceBySku = new Map(
      cachedStock.map((item) => [item.sku, centavosToAmount(item.unit_price_centavos)]),
    );

    const remaining: any[] = [];
    let migratedCount = 0;
    let newlyFlaggedCount = 0;

    for (const legacySale of legacySales) {
      if (legacySale.requires_manual_review) {
        remaining.push(legacySale);
        continue;
      }
      const legacyEventId = Number(legacySale.eventId ?? legacySale.event_id);
      if (!Number.isSafeInteger(legacyEventId) || legacyEventId <= 0) {
        newlyFlaggedCount++;
        remaining.push({
          ...legacySale,
          requires_manual_review: true,
          migration_error: "Missing or invalid event identifier.",
        });
        continue;
      }
      if (legacyEventId !== eventId) {
        remaining.push(legacySale);
        continue;
      }

      try {
        const clientReference = typeof legacySale.client_reference === "string"
          ? legacySale.client_reference.trim()
          : "";
        if (
          clientReference.length < 8
          || clientReference.length > 64
          || !/^[A-Za-z0-9:_-]+$/.test(clientReference)
        ) {
          throw new Error("Missing or unsafe idempotency reference.");
        }
        if (!MARKET_EVENT_PAYMENT_METHODS.includes(legacySale.payment_method)) {
          throw new Error("Unsupported payment method.");
        }
        if (!Array.isArray(legacySale.items) || legacySale.items.length === 0) {
          throw new Error("No sale items were saved.");
        }
        const normalizedItems = legacySale.items.map((item: any) => ({
          sku: String(item.sku ?? ""),
          quantity: Number(item.quantity),
        }));
        const expectedSubtotal = normalizedItems.reduce((sum: number, item: any) => {
          const unitPrice = unitPriceBySku.get(item.sku);
          if (unitPrice == null) {
            throw new Error(`No cached catalog price exists for ${item.sku}.`);
          }
          return sum + (unitPrice * item.quantity);
        }, 0);

        const result = await marketEventOfflineDb.recordLocalSale({
          event_id: eventId,
          client_reference: clientReference,
          payment_method: legacySale.payment_method,
          items: normalizedItems,
          expected_subtotal: expectedSubtotal,
          cash_received: legacySale.cash_received == null
            ? null
            : Number(legacySale.cash_received),
          payment_reference: legacySale.payment_reference ?? null,
          is_preorder: Boolean(legacySale.is_preorder),
          preorder_customer_name: legacySale.preorder_customer_name ?? null,
          preorder_payment_status: legacySale.preorder_payment_status ?? null,
          preorder_fulfillment_status: legacySale.preorder_fulfillment_status ?? null,
          // The former queue did not distinguish a true offline capture from a
          // request whose response was lost. Preserve stock, but never auto-replay it.
          delivery_uncertain: true,
        });
        if (result.sale.status !== "synced" && result.sale.status !== "voided") {
          await marketEventOfflineDb.markSaleRequiresReview(clientReference, {
            code: "legacy_delivery_ambiguous",
            message: "Legacy sale origin is ambiguous; verify the server journal before replaying.",
          });
        }
        migratedCount++;
      } catch (error) {
        newlyFlaggedCount++;
        remaining.push({
          ...legacySale,
          requires_manual_review: true,
          migration_error: getErrorMessage(error),
        });
      }
    }

    if (remaining.length > 0) {
      localStorage.setItem(LEGACY_MARKET_SALES_KEY, JSON.stringify(remaining));
    } else {
      localStorage.removeItem(LEGACY_MARKET_SALES_KEY);
    }
    refreshLegacyReviewCount();
    if (migratedCount > 0 || newlyFlaggedCount > 0) {
      showToast(
        `${migratedCount} legacy sale${migratedCount === 1 ? "" : "s"} moved to protected review; ${newlyFlaggedCount} could not be migrated.`,
        "warning",
      );
    }
  }

  const handlePrepareOfflinePackage = async (targetEvent?: any) => {
    const eventToPrepare = targetEvent || activeEvent;
    if (!eventToPrepare) return;

    if (!navigator.onLine) {
      if (!targetEvent) {
        showToast("Reconnect before preparing or refreshing an offline event package.", "error");
      }
      return;
    }
    const unresolvedSales = await marketEventOfflineDb.listUnresolvedSales(eventToPrepare.id).catch(() => []);
    if (unresolvedSales.length > 0) {
      if (!targetEvent) {
        showToast("Resolve every saved sale for this event before replacing its offline package.", "warning");
      }
      return;
    }

    setOfflinePreparing(true);
    try {
      const [freshEvents, allProducts, currentUser, device] = await Promise.all([
        api.getMarketEvents(),
        api.getProducts(),
        api.getCurrentUser(),
        marketEventOfflineDb.getOrCreateDeviceIdentity(),
      ]);
      const freshEvent = freshEvents.find((event: any) => event.id === eventToPrepare.id);
      if (!freshEvent || freshEvent.status !== "Active") {
        if (targetEvent) return;
        throw new Error("Only a server-verified active event can be prepared for offline sales.");
      }
      if (currentUser.role !== "owner" && currentUser.role !== "staff") {
        throw new Error("The current user cannot be bound as a Market POS cashier.");
      }

      const allocatedSkus = new Set<string>(
        (freshEvent.allocations || []).map((allocation: any) => (
          String(allocation.sku || "").trim().toLowerCase()
        )),
      );
      const catalogProducts = (allProducts || []).filter((product: any) => (
        product.sku !== "SKU"
        && isCurrentLineupProduct(product)
      ));
      const packageProducts = catalogProducts.filter((product: any) => (
        canDisplayMarketEventCatalogProduct(product, allocatedSkus)
      ));
      const productBySku = new Map(packageProducts.map((product: any) => [product.sku, product]));
      const stockBySku = new Map<string, number>();
      for (const allocation of freshEvent.allocations || []) {
        if (!productBySku.has(allocation.sku)) continue;
        // Use remaining_quantity (quantity minus wasted) for accurate POS stock
        const quantity = Number(allocation.remaining_quantity ?? allocation.quantity);
        if (!Number.isSafeInteger(quantity) || quantity < 0) {
          throw new Error(`Allocation for ${allocation.sku} is not a whole-unit quantity.`);
        }
        stockBySku.set(allocation.sku, (stockBySku.get(allocation.sku) || 0) + quantity);
      }

      const generatedAt = new Date();
      const packageRecord: MarketEventOfflinePackageV1 = {
        schema_version: MARKET_EVENT_OFFLINE_SCHEMA_VERSION,
        source_revision: `event:${freshEvent.id}:${generatedAt.toISOString()}`,
        generated_at: generatedAt.toISOString(),
        expires_at: new Date(generatedAt.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
        device_id: device.device_id,
        cashier: {
          username: currentUser.username,
          role: currentUser.role,
        },
        event: {
          id: freshEvent.id,
          name: freshEvent.name,
          event_date: freshEvent.event_date,
          location: freshEvent.location,
          status: freshEvent.status,
          staff_assigned: freshEvent.staff_assigned ?? null,
          notes: freshEvent.notes ?? null,
        },
        products: packageProducts.map((product: any) => ({
          sku: product.sku,
          product_name: product.product_name,
          category: product.category ?? null,
          size: product.size ?? null,
          retail_price: Number(product.retail_price || 0),
        })),
        stock: [...stockBySku.entries()].map(([sku, quantity]) => ({ sku, quantity })),
      };

      await marketEventOfflineDb.cacheEventPackage(packageRecord, {
        last_synced_at: generatedAt.toISOString(),
        server_cursor: packageRecord.source_revision,
      });
      setEvents(freshEvents);
      setProducts(catalogProducts);
      if (activeEvent?.id === freshEvent.id) {
        setActiveEvent(freshEvent);
      }
      setCashierName(currentUser.username);
      setUserRole(currentUser.role);
      setOfflineDeviceId(device.device_id);
      localStorage.setItem("hh_user_name", currentUser.username);
      localStorage.setItem("hh_user_role", currentUser.role);
      localStorage.setItem("hh_cache_market_events", JSON.stringify(freshEvents));
      localStorage.setItem("hh_cache_market_products", JSON.stringify(catalogProducts));

      await migrateLegacySalesForEvent(freshEvent.id);
      await refreshOfflineState(freshEvent.id);
      if (!targetEvent) {
        showToast("Offline package prepared and bound to this cashier and device for 24 hours.", "success");
      }
    } catch (error) {
      if (!targetEvent) {
        showToast(getErrorMessage(error, "Offline preparation failed."), "error");
      }
    } finally {
      setOfflinePreparing(false);
    }
  };

  const handleLaunchTerminal = async (event: any) => {
    let freshEvent = event;
    if (navigator.onLine) {
      try {
        freshEvent = await api.getMarketEvent(event.id);
      } catch {
        freshEvent = event;
      }
    }
    setActiveEvent(freshEvent);
    setCart({});
    setPaymentMethod("Cash");
    setCashReceived("");
    setPosSearch("");
    setPosCategory("All");
    // Keep sold-out products visible by default so staff can see the complete
    // event lineup (including Pesto with Pili at zero) instead of assuming a
    // missing card means the product was never allocated.
    setPosShowOutOfStock(true);
    setOfflinePackage(null);
    setOfflineStock([]);
    setOfflineMetadata(null);
    setIsSalesMode(true);
    await Promise.all([
      fetchRecentSales(freshEvent.id),
      refreshOfflineState(freshEvent.id),
    ]);
  };

  const handleCloseTerminal = () => {
    setIsSalesMode(false);
    setActiveEvent(null);
    setOfflinePackage(null);
    setOfflineStock([]);
    setOfflineMetadata(null);
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
    const isComplimentary = paymentMethod === "Complimentary / Gift";
    const isPautang = paymentMethod === "Pautang";
    const isCollectedCashSale = paymentMethod === "Cash" && (!isPreorder || preorderPaymentStatus === "Paid");
    if (isCollectedCashSale && cashAmountNum < (cartTotal + effectiveTip)) {
      showToast(`Cash received must cover ${formatCurrency(cartTotal + effectiveTip)} including the tip.`, "warning");
      return;
    }
    if (isPreorder && !preorderCustomerName.trim()) {
      showToast("Enter the preorder customer name or identifier.", "warning");
      return;
    }
    if (isPautang && !preorderCustomerName.trim()) {
      showToast("Enter the customer name for this Pautang sale.", "warning");
      return;
    }
    if (
      posDiscountType === "PERCENTAGE"
      && Number(posDiscountValue || 0) > 100
      && !isComplimentary
    ) {
      showToast("Percentage discount cannot exceed 100%.", "warning");
      return;
    }
    checkoutInFlightRef.current = true;
    setActionLoading(true);

    const itemsPayload = Object.entries(cart).map(([sku, qty]) => ({
      sku,
      quantity: qty
    }));

    try {
      const [storedPackage, device] = await Promise.all([
        marketEventOfflineDb.getEventPackage(activeEvent.id),
        marketEventOfflineDb.getOrCreateDeviceIdentity(),
      ]);
      if (!isOfflinePackageReady(
        storedPackage,
        activeEvent.id,
        cashierName,
        device.device_id,
      )) {
        showToast("Prepare or refresh this event for offline use before completing sales.", "warning");
        return;
      }

      const clientReference = createMarketEventSaleClientReference(activeEvent.id);
      const result = await marketEventOfflineDb.recordLocalSale({
        event_id: activeEvent.id,
        client_reference: clientReference,
        payment_method: paymentMethod as MarketEventPaymentMethod,
        items: itemsPayload,
        cash_received: isCollectedCashSale ? cashAmountNum : null,
        tip_amount: !isComplimentary && !isPautang && effectiveTip > 0 ? effectiveTip : null,
        payment_reference: paymentReference.trim() || null,
        is_preorder: isPreorder,
        preorder_customer_name: isPreorder ? preorderCustomerName.trim() : null,
        preorder_payment_status: isPreorder ? preorderPaymentStatus : null,
        preorder_fulfillment_status: isPreorder ? preorderFulfillmentStatus : null,
        customer_name: isPautang ? preorderCustomerName.trim() : null,
        expected_subtotal: calculateCartSubtotal(),
        promotion_code: isComplimentary ? null : activeDealPreset,
        discount_type: !isComplimentary && posDiscountValue ? posDiscountType : null,
        discount_value: !isComplimentary && posDiscountValue ? parseFloat(posDiscountValue) : null,
      });

      setActiveEvent((current: any) => applyCachedMarketStock(current, result.stock));
      setCart({});
      setCashReceived("");
      setKeepChangeAsTip(false);
      setTipAmountInput("");
      setPaymentReference("");
      setPosDiscountType("PERCENTAGE");
      setPosDiscountValue("");
      setActiveDealPreset(null);
      setIsPreorder(false);
      setPreorderCustomerName("");
      setPreorderPaymentStatus("Paid");
      setPreorderFulfillmentStatus("Pending");
      await refreshOfflineState(activeEvent.id);
      showToast(
        navigator.onLine
          ? "Sale saved atomically on this device. Verifying it with the server..."
          : "Offline sale saved. Stock and sync state will survive a refresh.",
        navigator.onLine ? "info" : "warning",
      );
      if (navigator.onLine) await replayOfflineQueue(activeEvent.id);
    } catch (error) {
      showToast(getErrorMessage(error, "The sale could not be saved safely."), "error");
    } finally {
      setActionLoading(false);
      checkoutInFlightRef.current = false;
    }
  };

  const handleUndoSale = async (saleId: number | string) => {
    if (!activeEvent) return;

    const offlineSale = offlineQueue.find((sale) => sale.client_reference === saleId);

    if (offlineSale) {
      try {
        const result = await marketEventOfflineDb.voidLocalSale(offlineSale.client_reference);
        setActiveEvent((current: any) => applyCachedMarketStock(current, result.stock));
        await refreshOfflineState(activeEvent.id);
        showToast("Local sale safely voided and cached stock restored atomically.", "success");
      } catch (error) {
        showToast(getErrorMessage(error, "This sale cannot be safely voided locally."), "error");
      }
    } else {
      if (!navigator.onLine) {
        alert("Undoing an already synced cloud transaction requires an active internet connection.");
        return;
      }
      if (typeof saleId !== "number") return;
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
    void replayOfflineQueue();
  };

  const replayableOfflineCount = offlineQueue.filter((sale) => (
    sale.status !== "requires_review" && !sale.delivery_uncertain
  )).length;
  const manualReviewOfflineCount = offlineQueue.filter((sale) => (
    sale.status === "requires_review" || sale.delivery_uncertain
  )).length
    + legacyReviewCount;

  const getSyncBadge = () => {
    if (syncStatus === "Synchronizing") {
      return <Badge variant="neutral" className="py-1 px-3 rounded-full text-xs font-black bg-blue-50 text-blue-800 border-blue-200"><RefreshCw size={14} className="mr-1.5 inline animate-spin" /> Uploading serially...</Badge>;
    }
    if (!isOnline) {
      return <Badge variant="danger" className="py-1 px-3 rounded-full text-xs font-black animate-pulse"><WifiOff size={14} className="mr-1.5 inline" /> Offline &bull; {offlineQueue.length + legacyReviewCount} saved</Badge>;
    }
    if (manualReviewOfflineCount > 0) {
      return <Badge variant="warning" className="py-1 px-3 rounded-full text-xs font-black"><AlertTriangle size={14} className="mr-1.5 inline" /> {manualReviewOfflineCount} review &bull; {replayableOfflineCount} retryable</Badge>;
    }
    if (replayableOfflineCount > 0) {
      return <Badge variant="warning" className="py-1 px-3 rounded-full text-xs font-black animate-pulse"><CloudLightning size={14} className="mr-1.5 inline" /> Waiting to Sync &bull; {replayableOfflineCount}</Badge>;
    }
    return <Badge variant="success" className="py-1 px-3 rounded-full text-xs font-black"><Wifi size={14} className="mr-1.5 inline" /> Sync Active &bull; Cloud Connected</Badge>;
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
    const breakdown: Record<string, number> = {
      Cash: 0.0,
      GCash: 0.0,
      "BPI / Bank Transfer": 0.0,
      Maya: 0.0,
      Card: 0.0,
      Mixed: 0.0,
    };
    reportSalesList.forEach(sale => {
      if (sale.is_preorder && sale.preorder_payment_status !== "Paid") return;
      const rawMethod = String(sale.payment_method || "").trim().toLowerCase();
      const method = ["bpi", "bank transfer", "bpi / bank transfer", "bpi/bank transfer"].includes(rawMethod)
        ? "BPI / Bank Transfer"
        : sale.payment_method;
      if (breakdown[method] !== undefined) {
        breakdown[method] += Number(sale.total_amount) || 0;
      }
    });
    return breakdown;
  };

  const calculateCashSalesTotal = () => {
    if (typeof selectedReportEvent?.cash_sales === "number") {
      return selectedReportEvent.cash_sales;
    }
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

  const isClassicItem = (p: any): boolean => {
    const sku = (p.sku || "").toUpperCase();
    const name = (p.product_name || "").toLowerCase();
    return sku.startsWith("GCP-") || sku.startsWith("PEGG-") || sku.startsWith("PTE-") || sku.startsWith("UYK-") || sku.startsWith("STS-") || sku.startsWith("CMS-") || sku.startsWith("WM-")
      || name.includes("grilled cheese") || name.includes("pesto egg") || name.includes("pesto, tomato") || name.includes("ube, keso") || name.includes("sweet tablea s'mores") || name.includes("cookies & matcha") || name.includes("cookies and matcha") || name.includes("white mocha s'mores");
  };

  const isSignatureItem = (p: any): boolean => {
    const sku = (p.sku || "").toUpperCase();
    const name = (p.product_name || "").toLowerCase();
    return sku.startsWith("TPP-") || sku.startsWith("BMC-") || sku.startsWith("SSC-") || sku.startsWith("PCS-") || sku.startsWith("PCHXW-") || sku.startsWith("BLT-")
      || name.includes("tuna pesto pasta") || name.includes("bacon mac") || name.includes("smoked salmon") || name.includes("pesto club") || name.includes("pesto chicken") || name.includes("bacon, lettuce") || name.includes("(blt)");
  };

  const getItemUnitPrice = (p: any) => {
    return Number(p.retail_price || 0.0);
  };

  const calculateCartSubtotal = () => {
    return Object.entries(cart).reduce((sum, [sku, qty]) => {
      const p = products.find(prod => prod.sku === sku);
      if (!p) return sum;
      const unitPrice = getItemUnitPrice(p);
      return sum + (qty * unitPrice);
    }, 0.0);
  };

  const calculateMixMatchDiscount = () => {
    if (!activeDealPreset) return 0.0;

    const classicUnits: { sku: string; price: number }[] = [];
    const signatureUnits: { sku: string; price: number }[] = [];
    const allUnits: { sku: string; price: number }[] = [];

    Object.entries(cart).forEach(([sku, qty]) => {
      const p = products.find(prod => prod.sku === sku);
      if (!p || qty <= 0) return;
      const unitPrice = getItemUnitPrice(p);
      const isClassic = isClassicItem(p);
      const isSignature = isSignatureItem(p);

      for (let i = 0; i < qty; i++) {
        const item = { sku: p.sku, price: unitPrice };
        allUnits.push(item);
        if (isClassic) classicUnits.push(item);
        if (isSignature) signatureUnits.push(item);
      }
    });

    let discount = 0.0;

    if (activeDealPreset === "CLASSIC_DUO") {
      classicUnits.sort((a, b) => b.price - a.price);
      const targetPrice = MARKET_DEAL_PRICES.CLASSIC_DUO;
      for (let i = 0; i + 1 < classicUnits.length; i += 2) {
        const pairSum = classicUnits[i].price + classicUnits[i + 1].price;
        if (pairSum > targetPrice) {
          discount += (pairSum - targetPrice);
        }
      }
    } else if (activeDealPreset === "SIGNATURE_DUO") {
      signatureUnits.sort((a, b) => b.price - a.price);
      const targetPrice = MARKET_DEAL_PRICES.SIGNATURE_DUO;
      for (let i = 0; i + 1 < signatureUnits.length; i += 2) {
        const pairSum = signatureUnits[i].price + signatureUnits[i + 1].price;
        if (pairSum > targetPrice) {
          discount += (pairSum - targetPrice);
        }
      }
    } else if (activeDealPreset === "COMBO_DUO") {
      classicUnits.sort((a, b) => b.price - a.price);
      signatureUnits.sort((a, b) => b.price - a.price);
      const targetPrice = MARKET_DEAL_PRICES.COMBO_DUO;
      const comboCount = Math.min(classicUnits.length, signatureUnits.length);
      for (let i = 0; i < comboCount; i++) {
        const pairSum = classicUnits[i].price + signatureUnits[i].price;
        if (pairSum > targetPrice) {
          discount += (pairSum - targetPrice);
        }
      }
    } else if (activeDealPreset === "B1T1") {
      allUnits.sort((a, b) => b.price - a.price);
      for (let i = 0; i + 1 < allUnits.length; i += 2) {
        discount += allUnits[i + 1].price;
      }
    }

    return Math.max(0.0, discount);
  };

  const calculateDiscountAmount = () => {
    const subtotal = calculateCartSubtotal();
    if (paymentMethod === "Complimentary / Gift") return subtotal;
    const dealDiscount = calculateMixMatchDiscount();
    const remainingAfterDeal = Math.max(0.0, subtotal - dealDiscount);

    const val = parseFloat(posDiscountValue) || 0.0;
    let manualDiscount = 0.0;
    if (val > 0) {
      if (posDiscountType === "PERCENTAGE") {
        manualDiscount = (remainingAfterDeal * val) / 100.0;
      } else {
        manualDiscount = Math.min(remainingAfterDeal, val);
      }
    }

    return Math.min(subtotal, dealDiscount + manualDiscount);
  };

  const calculateCartTotal = () => {
    if (paymentMethod === "Complimentary / Gift") return 0.0;
    const subtotal = calculateCartSubtotal();
    const discount = calculateDiscountAmount();
    return Math.max(0.0, subtotal - discount);
  };

  const handleUpdateStatusDirectly = async (event: any, nextStatus: string) => {
    if (!navigator.onLine) {
      alert("Status state transitions require a server connection.");
      return;
    }
    if (nextStatus === "Active" && (!event.allocations || event.allocations.length === 0)) {
      alert("Please edit this market event and add at least one product allocation before activating it.");
      handleOpenEdit(event);
      return;
    }
    const hasPendingEventSales = offlineQueue.some((sale) => sale.event_id === event.id);
    if (["Completed", "Cancelled"].includes(nextStatus) && (hasPendingEventSales || syncStatus === "Synchronizing")) {
      alert("Synchronize every pending sale for this event before closing or cancelling it. The event remains Active so no sale or stock movement is stranded.");
      return;
    }
    if (nextStatus === "Completed") {
      setActionLoading(true);
      try {
        const latestEvents = await api.getMarketEvents();
        setEvents(latestEvents);
        const latestEvent = latestEvents.find(candidate => candidate.id === event.id);
        if (!latestEvent || latestEvent.status !== "Active") {
          alert("This event is no longer Active. Refresh the event list before closing it.");
          return;
        }
        setCloseoutEvent(latestEvent);
        setCloseoutAllocations(latestEvent.allocations.map((a: any) => ({
          sku: a.sku,
          product_name: a.product_name,
          size: a.size,
          quantity: a.quantity,
          wasted_quantity: a.wasted_quantity || 0,
          waste_reason: a.waste_reason || ""
        })));
        setCloseoutCashExpenses(Number(latestEvent.cash_expenses ?? latestEvent.total_expenses ?? 0));
        setCloseoutCashRefunds(Number(latestEvent.cash_refunds ?? 0));
        setCloseoutGcashSales(Number(latestEvent.gcash_sales ?? latestEvent.payment_breakdown?.GCash ?? 0));
        setCloseoutBpiSales(Number(latestEvent.bpi_sales ?? latestEvent.payment_breakdown?.["BPI / Bank Transfer"] ?? 0));
        setCloseoutExpenseNotes(latestEvent.expense_notes || "");
        setCloseoutOpeningFloatInput(Number(latestEvent.opening_float ?? latestEvent.initial_cash_balance ?? 0));
        setCloseoutActualCash(latestEvent.actual_closing_cash ?? "");
        setIsCloseoutOpen(true);
      } catch (err: unknown) {
        alert(`Could not refresh the event before closeout: ${getErrorMessage(err)}`);
      } finally {
        setActionLoading(false);
      }
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
    if (!navigator.onLine) {
      alert("Event closeout requires an online server confirmation.");
      return;
    }
    if (offlineQueue.some((sale) => sale.event_id === closeoutEvent.id) || syncStatus === "Synchronizing") {
      alert("Synchronize every pending sale for this event before submitting closeout.");
      return;
    }
    if (closeoutOpeningFloatInput === "") {
      alert("Confirm the opening cash float before submitting closeout.");
      return;
    }
    if (closeoutActualCash === "") {
      alert("Enter the actual physical cash count before submitting closeout.");
      return;
    }
    const missingWasteReason = closeoutAllocations.find(
      allocation => Number(allocation.wasted_quantity) > 0 && !allocation.waste_reason?.trim()
    );
    if (missingWasteReason) {
      alert(`Select or enter a waste reason for ${missingWasteReason.product_name || missingWasteReason.sku}.`);
      return;
    }
    setActionLoading(true);
    try {
      await api.updateMarketEvent(closeoutEvent.id, {
        status: "Completed",
        opening_float: Number(closeoutOpeningFloatInput),
        actual_closing_cash: Number(closeoutActualCash),
        cash_expenses: Number(closeoutCashExpenses) || 0,
        cash_refunds: Number(closeoutCashRefunds) || 0,
        gcash_sales: Number(closeoutGcashSales) || 0,
        bpi_sales: Number(closeoutBpiSales) || 0,
        total_expenses: Number(closeoutCashExpenses) || 0,
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
      alert(`Error completing closeout: ${getErrorMessage(err)}`);
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
  const posProducts = useMemo(() => {
    const effectiveProducts = (!isOnline && offlinePackage?.products?.length)
      ? offlinePackage.products
      : (products.length > 0 ? products : (offlinePackage?.products || []));

    const remainingForProduct = (product: any) => {
      const normalizedSku = (product.sku || "").trim().toLowerCase();
      const allocation = (activeEvent?.allocations || []).find(
        (item: any) => (item.sku || "").trim().toLowerCase() === normalizedSku,
      );
      const offlineItem = offlineStock.find(
        (item: any) => (item.sku || "").trim().toLowerCase() === normalizedSku,
      );
      const quantity = isOnline
        ? Number(allocation?.remaining_quantity ?? allocation?.quantity ?? 0)
        : Number(
          allocation?.remaining_quantity
            ?? allocation?.quantity
            ?? offlineItem?.available_quantity
            ?? 0,
        );
      return Math.max(0, quantity - Number(cart[product.sku] || 0));
    };

    return effectiveProducts.filter(p => {
      const pSkuNorm = (p.sku || "").trim().toLowerCase();
      const isAllocated = (activeEvent?.allocations || []).some((a: any) => (a.sku || "").trim().toLowerCase() === pSkuNorm)
        || (!isOnline && offlineStock.some((s: any) => (s.sku || "").trim().toLowerCase() === pSkuNorm && s.available_quantity > 0));
      if (!isAllocated) return false;

      const matchesSearch = p.product_name.toLowerCase().includes(posSearch.toLowerCase()) || p.sku.toLowerCase().includes(posSearch.toLowerCase());
      const matchesCategory = posCategory === "All" || getProductBusinessCategory(p) === posCategory;
      const remaining = remainingForProduct(p);
      const matchesStockVisibility = posShowOutOfStock || remaining > 0;

      return matchesSearch && matchesCategory && matchesStockVisibility;
    }).sort((left, right) => {
      const leftSoldOut = remainingForProduct(left) <= 0 ? 1 : 0;
      const rightSoldOut = remainingForProduct(right) <= 0 ? 1 : 0;
      return leftSoldOut - rightSoldOut
        || getProductBusinessCategory(left).localeCompare(getProductBusinessCategory(right))
        || String(left.product_name).localeCompare(String(right.product_name));
    });
  }, [activeEvent, cart, isOnline, offlinePackage, offlineStock, posCategory, posSearch, posShowOutOfStock, products]);

  const posProductsByCategory = useMemo(() => {
    const map: Record<string, typeof posProducts> = {};
    posProducts.forEach(p => {
      const cat = getProductBusinessCategory(p);
      if (!map[cat]) map[cat] = [];
      map[cat].push(p);
    });
    return map;
  }, [posProducts]);

  const cartTotal = calculateCartTotal();
  const cashAmountNum = parseFloat(cashReceived) || 0.0;
  const rawChange = Math.max(0.0, cashAmountNum - cartTotal);
  const manualTip = parseFloat(tipAmountInput) || 0.0;
  const effectiveTip = keepChangeAsTip ? rawChange : manualTip;
  const changeDue = Math.max(0.0, rawChange - effectiveTip);
  const cashTenderRequired = paymentMethod === "Cash" && (!isPreorder || preorderPaymentStatus === "Paid");
  const cashTenderInsufficient = cashTenderRequired
    && (cashReceived.trim() === "" || cashAmountNum < (cartTotal + effectiveTip));
  const offlineReady = isOfflinePackageReady(
    offlinePackage,
    activeEvent?.id ?? null,
    cashierName,
    offlineDeviceId,
  );
  const offlinePackageExpired = Boolean(
    offlinePackage && new Date(offlinePackage.expires_at).getTime() <= Date.now(),
  );
  const offlinePreparedUnits = offlineStock.reduce(
    (sum, item) => sum + item.available_quantity,
    0,
  );
  const activeEventUnresolvedCount = activeEvent
    ? offlineQueue.filter((sale) => sale.event_id === activeEvent.id).length
    : 0;
  const quickCashAmounts = Array.from(new Set([
    Math.ceil(cartTotal / 20) * 20,
    Math.ceil(cartTotal / 50) * 50,
    Math.ceil(cartTotal / 100) * 100,
    500,
    1000,
  ]))
    .filter((amount) => Number.isFinite(amount) && amount >= cartTotal && amount > 0)
    .sort((left, right) => left - right)
    .slice(0, 4);
  const closeoutOpeningFloat = closeoutOpeningFloatInput === ""
    ? Number(closeoutEvent?.opening_float ?? closeoutEvent?.initial_cash_balance ?? 0)
    : Number(closeoutOpeningFloatInput);
  const closeoutRecordedCashSales = closeoutEvent?.cash_sales ?? 0;
  const closeoutEndingCashbox = closeoutOpeningFloat
    + closeoutRecordedCashSales
    - closeoutCashExpenses
    - closeoutCashRefunds;

  // ----------------------------------------------------
  // RENDER CASHIER TERMINAL VIEW (PHASE 2 Full-screen)
  // ----------------------------------------------------
  if (isSalesMode && activeEvent) {
    return (
      <div className="space-y-3 2xl:space-y-6 flex flex-col pb-28 min-[900px]:pb-8 2xl:pb-16 animate-fade-in">
        
        {/* Cashier top header */}
        <div className="bg-slate-900 text-white rounded-2xl min-[900px]:rounded-3xl p-3.5 md:p-5 2xl:p-8 flex flex-col md:flex-row md:justify-between md:items-center gap-3 2xl:gap-6 shadow-md border border-slate-800">
          <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
            <div className="shrink-0 rounded-xl bg-primary/20 p-2.5 text-primary-light sm:rounded-2xl sm:p-3">
              <Store size={24} />
            </div>
            <div className="min-w-0">
              <span className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 sm:text-xs">Active market cashier</span>
              <h2 className="mt-0.5 truncate font-heading text-lg font-black tracking-wide text-white md:text-xl 2xl:text-2xl">{activeEvent.name}</h2>
              <p className="mt-0.5 truncate text-xs font-semibold text-slate-300 sm:text-sm">{activeEvent.location}</p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-black">
                <span className="inline-flex min-h-7 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-slate-200">
                  <User size={12} /> {cashierName}
                </span>
                <span className="inline-flex min-h-7 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-slate-200">
                  <ShoppingCart size={12} /> {Object.values(cart).reduce((sum, quantity) => sum + quantity, 0)} item(s)
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 2xl:gap-4">
            {getSyncBadge()}
            
            <Button
              onClick={async () => {
                setIsPreorderLookupOpen(true);
                try {
                  const res = await api.getPreorders({ page_size: 50 });
                  setPreorderLookupList(res.items || []);
                } catch {
                  setPreorderLookupList([]);
                }
              }}
              variant="outline"
              size="sm"
              className="h-10 text-xs px-3 font-bold bg-amber-7 text-white border-amber-600 hover:bg-amber-800"
            >
              <Clock size={15} className="mr-1.5" />
              Fulfill Pre-Order
            </Button>

            <Button
              onClick={async () => {
                try {
                  showToast("Syncing latest stock from server...", "info");
                  await fetchEvents();
                  if (activeEvent?.id) {
                    await fetchRecentSales(activeEvent.id);
                  }
                  showToast("POS stock synchronized!", "success");
                } catch {
                  showToast("Could not reach server to sync stock.", "warning");
                }
              }}
              variant="outline"
              size="sm"
              className="h-10 text-xs px-3 font-bold bg-white text-slate-800 border-slate-200 shadow-2xs hover:bg-slate-50 cursor-pointer"
            >
              <RotateCw size={14} className="mr-1.5 stroke-[2.5]" />
              Refresh Stock
            </Button>

            {replayableOfflineCount > 0 && isOnline && syncStatus !== "Synchronizing" && (
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
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-transparent px-4 text-sm font-bold text-white transition-all hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-2 2xl:h-12 2xl:px-5 cursor-pointer"
            >
              <X size={16} />
              <span className="sm:hidden">Exit terminal</span>
              <span className="hidden sm:inline">Close Cashier Terminal</span>
            </button>
          </div>
        </div>

        <div className={`rounded-2xl border p-3.5 sm:p-4 ${offlineReady ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className={`rounded-xl p-2 ${offlineReady ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                {offlineReady ? <ShieldCheck size={20} /> : <AlertTriangle size={20} />}
              </span>
              <div className="min-w-0">
                <p className={`text-sm font-black ${offlineReady ? "text-emerald-900" : "text-amber-900"}`}>
                  {offlineReady
                    ? "Offline package ready"
                    : offlinePackageExpired
                      ? "Offline package expired"
                      : offlinePackage
                        ? "Offline package is bound to another cashier or device"
                        : "Offline package not prepared"}
                </p>
                <p className="mt-0.5 text-[11px] font-semibold text-slate-600">
                  {offlinePackage ? (
                    <>
                      Schema v{offlinePackage.schema_version} &bull; prepared {formatDateTime(offlineMetadata?.package_cached_at ?? offlinePackage.generated_at)} &bull; {offlineStock.length} SKU{offlineStock.length === 1 ? "" : "s"} / {offlinePreparedUnits} units &bull; expires {formatDateTime(offlinePackage.expires_at)}
                    </>
                  ) : (
                    "Prepare while online to verify active status, cashier identity, prices, and event stock."
                  )}
                </p>
                {activeEventUnresolvedCount > 0 && (
                  <p className="mt-1 text-[11px] font-black text-amber-800">
                    {activeEventUnresolvedCount} saved sale{activeEventUnresolvedCount === 1 ? "" : "s"} must be resolved before this package can be refreshed.
                  </p>
                )}
              </div>
            </div>
            <Button
              onClick={() => handlePrepareOfflinePackage()}
              disabled={!isOnline || offlinePreparing || activeEventUnresolvedCount > 0}
              isLoading={offlinePreparing}
              variant={offlineReady ? "outline" : "primary"}
              size="sm"
              className="h-11 shrink-0 px-4 text-xs font-black"
              leftIcon={<ShieldCheck size={15} />}
            >
              {offlinePackage ? "Refresh Offline" : "Prepare Offline"}
            </Button>
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
                  className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-4 text-base font-semibold 2xl:rounded-2xl"
                  />
                </div>

                {/* Categories */}
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                  {["All", ...BUSINESS_CATEGORIES].map(cat => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setPosCategory(cat)}
                      aria-pressed={posCategory === cat}
                      className={`min-h-11 shrink-0 whitespace-nowrap rounded-xl border-2 px-3 py-2 text-xs font-black uppercase tracking-wider transition-all 2xl:h-12 2xl:rounded-2xl 2xl:px-5 cursor-pointer ${
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

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setPosShowOutOfStock((current) => !current)}
                  aria-pressed={posShowOutOfStock}
                  className={`min-h-11 rounded-xl border px-3 py-2 text-xs font-bold transition-all cursor-pointer ${
                    posShowOutOfStock ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {posShowOutOfStock ? "Hide sold-out items" : "Show sold-out items"}
                </button>

                <p className="text-[11px] font-semibold text-slate-500">
                  Prebuilt gift-set SKUs use their tracked event stock and are ready to sell.
                </p>
              </div>
            </div>

            {/* Categorized POS tactile product grid */}
            {posProducts.length === 0 ? (
              <div className="p-8 md:p-12 text-center border-2 border-dashed border-slate-250 rounded-3xl bg-white space-y-6">
                {activeEvent?.allocations.length === 0 ? (
                  <div className="max-w-xl mx-auto space-y-4">
                    <div className="p-4 bg-amber-50 text-amber-800 rounded-2xl border border-amber-200 flex items-center gap-3 justify-center">
                      <AlertTriangle className="text-amber-600 shrink-0 animate-bounce" size={24} />
                      <span className="font-heading font-black text-sm uppercase">Your Market Booth Crate is Currently Empty!</span>
                    </div>
                    <p className="text-sm text-slate-500 font-semibold leading-relaxed">
                      To record sales at this bazaar, you first need to specify what jars and quantities you brought to the market booth. Click <strong>Edit Event</strong> to reserve inventory allocations for your booth.
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
                    <p className="text-base font-bold text-slate-700">No matching products found.</p>
                    <p className="text-xs text-slate-450">Try adjusting your search query or selecting &quot;Show sold-out items&quot;.</p>
                  </div>
                )}
              </div>
            ) : posCategory === "All" ? (
              <div className="space-y-6">
                {Object.entries(posProductsByCategory).map(([catName, catProducts]) => (
                  <div key={catName} className="space-y-3">
                    <div className="flex items-center gap-2 border-b-2 border-slate-200/80 pb-2 pt-1 sticky top-0 bg-slate-50/90 backdrop-blur-xs z-10">
                      <span className="font-heading font-black text-xs sm:text-sm uppercase tracking-wider text-slate-850 flex items-center gap-1.5">
                        {catName === "Spreads & Sauces" && "🏺 "}
                        {catName === "Sandwiches & Salads" && "🥪 "}
                        {catName === "Gift Sets & Packages" && "🎁 "}
                        {catName === "Add-ons & Packaging" && "📦 "}
                        {catName}
                      </span>
                      <span className="text-[11px] font-mono font-bold text-slate-600 bg-white px-2.5 py-0.5 rounded-full border border-slate-200 shadow-3xs">
                        {catProducts.length} item{catProducts.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5 sm:gap-4 2xl:grid-cols-3 2xl:gap-6">
                      {catProducts.map(p => {
                        const alloc = activeEvent?.allocations.find((a: any) => (a.sku || "").trim().toLowerCase() === (p.sku || "").trim().toLowerCase());
                        const maxQty = alloc ? Number(alloc.remaining_quantity ?? alloc.quantity ?? 0) : 0;
                        const cartQty = cart[p.sku] || 0;
                        const remainingQty = Math.max(0, maxQty - cartQty);

                        return (
                          <button
                            type="button"
                            key={p.sku}
                            disabled={remainingQty === 0}
                            aria-label={`Add ${p.product_name} to the running cart. ${formatProductQuantity(p, remainingQty)} remaining.`}
                            onClick={() => {
                              if (remainingQty > 0) {
                                handleAddToCart(p.sku, maxQty);
                              } else {
                                showToast(`Insufficient market allocation remaining for ${p.product_name}.`, "warning");
                              }
                            }}
                            className={`flex min-h-44 flex-col justify-between overflow-hidden rounded-2xl border-2 bg-white p-3 text-left shadow-3xs select-none transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 2xl:min-h-56 2xl:rounded-3xl 2xl:p-5 cursor-pointer ${
                              remainingQty === 0 
                                ? "opacity-45 bg-slate-50 border-slate-200"
                                : cartQty > 0 
                                  ? "border-primary bg-primary-light/5 ring-4 ring-primary/5 scale-[1.02]" 
                                  : "border-slate-150 hover:border-slate-350 hover:scale-[1.01]"
                            }`}
                          >
                            <div>
                              {PRODUCT_IMAGE_MAP[p.sku.toUpperCase()] && (
                                <div className="relative mb-2 h-20 w-full overflow-hidden rounded-xl border border-slate-100 bg-slate-50 shadow-2xs sm:h-24 2xl:mb-3 2xl:h-32 2xl:rounded-2xl">
                                  <Image
                                    src={PRODUCT_IMAGE_MAP[p.sku.toUpperCase()]}
                                    alt={p.product_name}
                                    fill
                                    sizes="(max-width: 768px) 200px, 200px"
                                    className="object-cover"
                                  />
                                </div>
                              )}

                              <ProductDisplay
                                sku={p.sku}
                                productName={p.product_name}
                                category={p.category}
                                size={p.size}
                                variant="compact"
                              />
                            </div>

                            <div className="mt-3 flex flex-col gap-1 border-t border-slate-100 pt-2 sm:flex-row sm:items-end sm:justify-between sm:gap-2">
                              <div className="min-w-0 flex-1">
                                <span className={`text-xs font-bold block mt-1 ${remainingQty === 0 ? "text-slate-600 font-extrabold" : remainingQty <= 5 ? "text-rose-600 font-extrabold" : "text-slate-550"}`}>
                                  {remainingQty === 0 ? (
                                    <>SOLD OUT · <strong className="font-mono text-sm font-black">{formatProductQuantity(p, 0)}</strong> left</>
                                  ) : (
                                    <>Stock: <strong className="font-mono text-sm font-black">{formatProductQuantity(p, remainingQty)}</strong> left</>
                                  )}
                                </span>
                              </div>
                              <span className="shrink-0 font-mono text-sm font-black text-slate-800 sm:text-base 2xl:text-lg">
                                {formatCurrency(p.retail_price)}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:gap-4 2xl:grid-cols-3 2xl:gap-6">
                {posProducts.map(p => {
                  const alloc = activeEvent?.allocations.find((a: any) => (a.sku || "").trim().toLowerCase() === (p.sku || "").trim().toLowerCase());
                  const maxQty = alloc ? Number(alloc.remaining_quantity ?? alloc.quantity ?? 0) : 0;
                  const cartQty = cart[p.sku] || 0;
                  const remainingQty = Math.max(0, maxQty - cartQty);

                  return (
                    <button
                      type="button"
                      key={p.sku}
                      disabled={remainingQty === 0}
                      aria-label={`Add ${p.product_name} to the running cart. ${formatProductQuantity(p, remainingQty)} remaining.`}
                      onClick={() => {
                        if (remainingQty > 0) {
                          handleAddToCart(p.sku, maxQty);
                        } else {
                          showToast(`Insufficient market allocation remaining for ${p.product_name}.`, "warning");
                        }
                      }}
                      className={`flex min-h-44 flex-col justify-between overflow-hidden rounded-2xl border-2 bg-white p-3 text-left shadow-3xs select-none transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 2xl:min-h-56 2xl:rounded-3xl 2xl:p-5 cursor-pointer ${
                        remainingQty === 0 
                          ? "opacity-45 bg-slate-50 border-slate-200"
                          : cartQty > 0 
                            ? "border-primary bg-primary-light/5 ring-4 ring-primary/5 scale-[1.02]" 
                            : "border-slate-150 hover:border-slate-350 hover:scale-[1.01]"
                      }`}
                    >
                      <div>
                        {PRODUCT_IMAGE_MAP[p.sku.toUpperCase()] && (
                          <div className="relative mb-2 h-20 w-full overflow-hidden rounded-xl border border-slate-100 bg-slate-50 shadow-2xs sm:h-24 2xl:mb-3 2xl:h-32 2xl:rounded-2xl">
                            <Image
                              src={PRODUCT_IMAGE_MAP[p.sku.toUpperCase()]}
                              alt={p.product_name}
                              fill
                              sizes="(max-width: 768px) 200px, 200px"
                              className="object-cover"
                            />
                          </div>
                        )}

                        <ProductDisplay
                          sku={p.sku}
                          productName={p.product_name}
                          category={p.category}
                          size={p.size}
                          variant="compact"
                        />
                      </div>

                      <div className="mt-3 flex flex-col gap-1 border-t border-slate-100 pt-2 sm:flex-row sm:items-end sm:justify-between sm:gap-2">
                        <div className="min-w-0 flex-1">
                          <span className={`text-xs font-bold block mt-1 ${remainingQty === 0 ? "text-slate-600 font-extrabold" : remainingQty <= 5 ? "text-rose-600 font-extrabold" : "text-slate-550"}`}>
                            {remainingQty === 0 ? (
                              <>SOLD OUT · <strong className="font-mono text-sm font-black">{formatProductQuantity(p, 0)}</strong> left</>
                            ) : (
                              <>Stock: <strong className="font-mono text-sm font-black">{formatProductQuantity(p, remainingQty)}</strong> left</>
                            )}
                          </span>
                        </div>
                        <span className="shrink-0 font-mono text-sm font-black text-slate-800 sm:text-base 2xl:text-lg">
                          {formatCurrency(p.retail_price)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* RIGHT: RUNNING TOTAL CART SIDEBAR */}
          <div ref={cartPanelRef} className="scroll-mt-3 min-[900px]:col-span-5 2xl:col-span-4 min-[900px]:sticky min-[900px]:top-4 space-y-4 2xl:space-y-6">
            
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
                      const maxQty = alloc ? Number(alloc.remaining_quantity ?? alloc.quantity ?? 0) : 0;
                      if (!p) return null;

                      const unitPrice = getItemUnitPrice(p);

                      return (
                        <div key={sku} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-3xs">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <ProductDisplay
                                sku={p.sku}
                                productName={p.product_name}
                                category={p.category}
                                size={p.size}
                                variant="selector"
                              />
                            </div>
                            <NumericQuantityInput
                              value={qty}
                              min={0}
                              max={maxQty}
                              label={`${p.product_name} quantity`}
                              onChange={(value) => handleStepCartQty(sku, value - qty, maxQty)}
                              className="shrink-0"
                            />
                          </div>

                          <div className="flex items-center justify-between gap-3 pl-9 pt-1 border-t border-slate-100 text-xs">
                            <span className="font-mono font-bold text-slate-600">
                              {formatCurrency(unitPrice)} each
                            </span>
                            <span className="font-mono font-black text-slate-800">
                              Total {formatCurrency(unitPrice * qty)}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </CardContent>

              <div className="border-t border-slate-100 bg-white p-3 2xl:p-6 space-y-3 2xl:space-y-4 overflow-y-auto min-h-0">
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
                            className="h-12 w-full rounded-xl border-2 border-slate-200 px-2.5 font-bold text-slate-800"
                        />
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-slate-455 font-bold block mb-1 uppercase tracking-wider">Payment Status</label>
                          <select
                            value={preorderPaymentStatus}
                            onChange={(e: any) => setPreorderPaymentStatus(e.target.value)}
                            className="h-12 w-full rounded-xl border-2 border-slate-200 bg-white px-2 font-bold text-slate-800"
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
                            className="h-12 w-full rounded-xl border-2 border-slate-200 bg-white px-2 font-bold text-slate-800"
                          >
                            <option value="Pending">Pending</option>
                            <option value="Picked Up">Picked Up</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Mix & Match Deals & Adjustable Cashier Discount */}
                <div
                  aria-disabled={paymentMethod === "Complimentary / Gift"}
                  className={`bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-3 ${
                    paymentMethod === "Complimentary / Gift"
                      ? "pointer-events-none opacity-50"
                      : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <span>✨ Mix & Match Deals</span>
                    </span>
                    {activeDealPreset && (
                      <button
                        type="button"
                        onClick={() => setActiveDealPreset(null)}
                        className="text-[11px] font-bold text-rose-600 hover:underline cursor-pointer"
                      >
                        Clear Deal
                      </button>
                    )}
                  </div>

                  {/* Preset Deal Buttons */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setActiveDealPreset(activeDealPreset === "CLASSIC_DUO" ? null : "CLASSIC_DUO")}
                      className={`p-2 rounded-xl text-left border transition-all cursor-pointer ${
                        activeDealPreset === "CLASSIC_DUO"
                          ? "border-amber-800 bg-amber-800 text-white shadow-3xs"
                          : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                      }`}
                    >
                      <div className="text-[11px] font-black uppercase">Classic Duo</div>
                      <div className="text-[10px] opacity-90 font-mono">2 for ₱{MARKET_DEAL_PRICES.CLASSIC_DUO}</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveDealPreset(activeDealPreset === "SIGNATURE_DUO" ? null : "SIGNATURE_DUO")}
                      className={`p-2 rounded-xl text-left border transition-all cursor-pointer ${
                        activeDealPreset === "SIGNATURE_DUO"
                          ? "border-amber-800 bg-amber-800 text-white shadow-3xs"
                          : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                      }`}
                    >
                      <div className="text-[11px] font-black uppercase">Signature Duo</div>
                      <div className="text-[10px] opacity-90 font-mono">2 for ₱{MARKET_DEAL_PRICES.SIGNATURE_DUO}</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveDealPreset(activeDealPreset === "COMBO_DUO" ? null : "COMBO_DUO")}
                      className={`p-2 rounded-xl text-left border transition-all cursor-pointer ${
                        activeDealPreset === "COMBO_DUO"
                          ? "border-amber-800 bg-amber-800 text-white shadow-3xs"
                          : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                      }`}
                    >
                      <div className="text-[11px] font-black uppercase">Combo Duo</div>
                      <div className="text-[10px] opacity-90 font-mono">1 Classic + 1 Sig = ₱{MARKET_DEAL_PRICES.COMBO_DUO}</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveDealPreset(activeDealPreset === "B1T1" ? null : "B1T1")}
                      className={`p-2 rounded-xl text-left border transition-all cursor-pointer ${
                        activeDealPreset === "B1T1"
                          ? "border-amber-800 bg-amber-800 text-white shadow-3xs"
                          : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                      }`}
                    >
                      <div className="text-[11px] font-black uppercase">Buy 1 Take 1</div>
                      <div className="text-[10px] opacity-90 font-mono">50% Off Pair</div>
                    </button>
                  </div>

                  {/* Additional Manual Discount (% or ₱) */}
                  <div className="pt-2 space-y-1.5 border-t border-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Additional Discount</span>
                      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5 text-xs font-bold">
                        <button
                          type="button"
                          onClick={() => setPosDiscountType("PERCENTAGE")}
                          className={`px-2 py-0.5 rounded transition-colors text-[10px] ${posDiscountType === "PERCENTAGE" ? "bg-slate-900 text-white" : "text-slate-600"}`}
                        >
                          % Off
                        </button>
                        <button
                          type="button"
                          onClick={() => setPosDiscountType("FIXED")}
                          className={`px-2 py-0.5 rounded transition-colors text-[10px] ${posDiscountType === "FIXED" ? "bg-slate-900 text-white" : "text-slate-600"}`}
                        >
                          ₱ Less
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                         type="number"
                         min={0}
                         max={posDiscountType === "PERCENTAGE" ? 100 : undefined}
                        step={posDiscountType === "PERCENTAGE" ? "1" : "5"}
                        placeholder={posDiscountType === "PERCENTAGE" ? "e.g. 10 (%)" : "e.g. 50 (₱)"}
                        value={posDiscountValue}
                        onChange={(e) => setPosDiscountValue(e.target.value)}
                        className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                      {posDiscountValue && (
                        <button
                          type="button"
                          onClick={() => setPosDiscountValue("")}
                          className="px-2 py-1 text-xs font-bold text-slate-400 hover:text-rose-600"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Totals breakdown */}
                <div className="space-y-1.5 pt-1 border-t border-slate-200">
                  {calculateDiscountAmount() > 0 && (
                    <>
                      <div className="flex justify-between items-center text-xs text-slate-500 font-semibold">
                        <span>Subtotal:</span>
                        <span className="font-mono">{formatCurrency(calculateCartSubtotal())}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs text-emerald-700 font-bold">
                        <span>
                          {paymentMethod === "Complimentary / Gift"
                            ? "Complimentary adjustment:"
                            : `Discount (${posDiscountType === "PERCENTAGE" ? `${posDiscountValue}%` : `₱${posDiscountValue}`}):`}
                        </span>
                        <span className="font-mono">-{formatCurrency(calculateDiscountAmount())}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-455 font-extrabold uppercase tracking-wide">Total Amount:</span>
                    <span className="text-2xl 2xl:text-3xl font-black font-mono text-slate-900">
                      {formatCurrency(cartTotal)}
                    </span>
                  </div>
                </div>

                {/* Payment Methods Touch Options */}
                <div className="space-y-2">
                  <span className="text-xs text-slate-455 font-extrabold uppercase tracking-wider block">Select Payment Method:</span>
                  <div className="grid grid-cols-2 gap-2 text-xs font-black">
                    {[
                      { id: "BPI / Bank Transfer", label: "BPI / Bank", icon: CreditCard },
                      { id: "Cash", label: "Cash", icon: Coins },
                      { id: "GCash", label: "GCash", icon: Smartphone },
                      { id: "Pautang", label: "Pautang / Pay Later", icon: Clock },
                      { id: "Maya", label: "Maya", icon: Wallet },
                      { id: "Card", label: "Card", icon: CreditCard },
                      { id: "Complimentary / Gift", label: "🎁 Free Gift / Sample", icon: Gift }
                    ].map(pay => {
                      const isSelected = paymentMethod === pay.id;
                      return (
                        <button
                          key={pay.id}
                          type="button"
                          onClick={() => {
                            setPaymentMethod(pay.id);
                            if (pay.id !== "Cash") {
                              setCashReceived("");
                              setKeepChangeAsTip(false);
                              setTipAmountInput("");
                            }
                            if (pay.id === "Complimentary / Gift") {
                              setActiveDealPreset(null);
                              setPosDiscountValue("");
                              setPaymentReference("");
                            }
                          }}
                          className={`flex min-h-11 items-center gap-2 rounded-xl border-2 px-3 py-2.5 transition-all 2xl:rounded-2xl 2xl:px-4 2xl:py-3.5 cursor-pointer ${
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

                {/* Complimentary / Free Gift Banner */}
                {paymentMethod === "Complimentary / Gift" && Object.keys(cart).length > 0 && (
                  <div className="p-3 bg-amber-50 border-2 border-amber-300 rounded-2xl text-xs text-amber-900 space-y-1 animate-fade-in shadow-2xs">
                    <span className="flex items-center gap-1.5 font-extrabold uppercase text-amber-950">
                      <Gift size={15} className="text-amber-700" /> Free Gift / Sampling (₱0.00)
                    </span>
                    <p className="text-[11px] font-semibold text-amber-850 leading-normal">
                      Giving items as a gift or free sample (e.g. Gov officials, VIPs, sampling). The sale will be recorded at ₱0.00 and inventory stock will be deducted accordingly.
                    </p>
                  </div>
                )}

                {/* Cash Change Calculator */}
                {cashTenderRequired && Object.keys(cart).length > 0 && (
                  <div className="p-3 2xl:p-4 bg-slate-50 border-2 border-slate-200 rounded-2xl space-y-3 animate-fade-in">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <span className="block text-[10px] font-black uppercase tracking-wider text-slate-500">Total due</span>
                        <span className="mt-1 block font-mono text-xl font-black text-slate-900">{formatCurrency(cartTotal)}</span>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <span className="block text-[10px] font-black uppercase tracking-wider text-slate-500">Cash received</span>
                        <span className="mt-1 block font-mono text-xl font-black text-slate-900">{formatCurrency(cashAmountNum)}</span>
                      </div>
                    </div>
                    <label className="block space-y-1.5">
                      <span className="text-xs text-slate-500 font-extrabold uppercase tracking-wide">Enter cash received</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        inputMode="decimal"
                        placeholder="e.g. 1000"
                        value={cashReceived}
                        onChange={(e) => setCashReceived(e.target.value)}
                        className="h-12 w-full rounded-xl border-2 border-slate-300 bg-white px-3 text-right font-mono text-base font-black text-slate-900 focus:border-primary focus:outline-none"
                      />
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setCashReceived(cartTotal.toFixed(2))}
                        className="min-h-11 rounded-xl border-2 border-primary/40 bg-primary-light/10 px-2 text-xs font-black text-[#885625]"
                      >
                        Exact amount
                      </button>
                      {quickCashAmounts.slice(0, 4).map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          onClick={() => setCashReceived(amount.toFixed(2))}
                          className="min-h-11 rounded-xl border-2 border-slate-200 bg-white px-2 font-mono text-xs font-black text-slate-700 hover:bg-slate-50 cursor-pointer"
                        >
                          {formatCurrency(amount)}
                        </button>
                      ))}
                    </div>
                    {cashReceived.trim() !== "" && cashAmountNum < cartTotal && (
                      <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
                        Cash is short by {formatCurrency(cartTotal - cashAmountNum)}. Checkout is blocked.
                      </div>
                    )}
                    {cashReceived.trim() !== "" && cashAmountNum >= cartTotal && (
                      <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4 text-emerald-900 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-black uppercase tracking-[0.2em] text-emerald-800">Sukli / Change</span>
                          {rawChange > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setKeepChangeAsTip(!keepChangeAsTip);
                                if (!keepChangeAsTip) setTipAmountInput("");
                              }}
                              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer border shadow-3xs ${
                                keepChangeAsTip
                                  ? "bg-amber-500 text-white border-amber-600 shadow-2xs"
                                  : "bg-white text-emerald-900 border-emerald-300 hover:bg-emerald-100"
                              }`}
                            >
                              <Heart size={14} className={keepChangeAsTip ? "fill-white" : "text-amber-600"} />
                              <span>{keepChangeAsTip ? "Tip Recorded!" : `Keep ${formatCurrency(rawChange)} Change as Tip`}</span>
                            </button>
                          )}
                        </div>

                        {keepChangeAsTip ? (
                          <div className="bg-amber-100/90 border border-amber-300 rounded-xl p-3 text-center space-y-1">
                            <span className="text-xs font-black text-amber-950 block uppercase tracking-wider">❤️ Keep Change / Tip Recorded</span>
                            <span className="font-mono text-2xl font-black text-amber-900 block">{formatCurrency(rawChange)}</span>
                            <span className="text-[11px] font-bold text-amber-800 block">Change Given to Customer: {formatCurrency(0)}</span>
                          </div>
                        ) : (
                          <div className="text-center">
                            <span className="mt-1 block font-mono text-3xl font-black">{formatCurrency(changeDue)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {paymentMethod === "Pautang" && Object.keys(cart).length > 0 && (
                  <div className="bg-amber-50/80 border border-amber-300 rounded-2xl p-3 space-y-2.5 animate-fade-in">
                    <span className="text-xs font-black text-amber-950 uppercase tracking-wider block">Pautang / Collectibles Record</span>
                    <label className="block space-y-1">
                      <span className="text-[11px] font-bold text-stone-700">Customer Name (Required):</span>
                      <input
                        type="text"
                        placeholder="Enter customer name..."
                        value={preorderCustomerName}
                        onChange={(e) => setPreorderCustomerName(e.target.value)}
                        className="h-10 w-full rounded-xl border border-amber-300 bg-white px-3 text-sm font-bold text-stone-900 focus:outline-none"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[11px] font-bold text-stone-700">Payment Note / Promise Date:</span>
                      <input
                        type="text"
                        placeholder="e.g. Next week isesend yung bayad"
                        value={paymentReference}
                        onChange={(event) => setPaymentReference(event.target.value)}
                        className="h-10 w-full rounded-xl border border-amber-300 bg-white px-3 text-sm font-bold text-stone-900 focus:outline-none"
                      />
                    </label>
                  </div>
                )}

                {paymentMethod !== "Cash" && paymentMethod !== "Pautang" && Object.keys(cart).length > 0 && (
                  <label className="block space-y-1.5">
                    <span className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Payment reference (optional)</span>
                    <input
                      type="text"
                      maxLength={100}
                      value={paymentReference}
                      onChange={(event) => setPaymentReference(event.target.value)}
                      placeholder="Receipt or transfer reference"
                      className="h-12 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-base font-bold text-slate-900 focus:border-primary focus:outline-none"
                    />
                  </label>
                )}

                {/* Complete Sale button - Sticky at bottom so it's always accessible */}
                <div className="sticky bottom-0 bg-white pt-2 pb-1 z-10 border-t border-slate-100 mt-2">
                  <Button
                    onClick={handleCompleteSale}
                    disabled={
                      actionLoading
                      || (!isOnline && !offlineReady)
                      || Object.keys(cart).length === 0
                      || cashTenderInsufficient
                      || (isPreorder && !preorderCustomerName.trim())
                      || (paymentMethod === "Pautang" && !preorderCustomerName.trim())
                    }
                    isLoading={actionLoading}
                    variant="primary"
                    className="w-full text-sm 2xl:text-base font-extrabold uppercase h-12 2xl:h-16 rounded-2xl shadow-sm"
                    leftIcon={<Check size={18} />}
                  >
                    {(isOnline || offlineReady)
                      ? `Complete Sale (${formatCurrency(cartTotal)})`
                      : "Prepare Offline to Enable Sales"}
                  </Button>
                </div>

              </div>
            </Card>

            {/* Recent Sales Log & Undo Tray */}
            <Card className="rounded-3xl border-slate-200 shadow-sm overflow-hidden">
              <CardHeader className="p-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center flex-row">
                <CardTitle className="text-sm font-heading font-black">Recent Transactions</CardTitle>
                {activeEventUnresolvedCount > 0 && (
                  <Badge variant="warning">{activeEventUnresolvedCount} Saved Locally</Badge>
                )}
              </CardHeader>
              <CardContent className="p-5 space-y-4">
                <div className="space-y-3 max-h-72 overflow-y-auto">
                  {recentSales.slice(0, 10).map((sale) => (
                    <div key={sale.id} className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold text-slate-650 space-y-2">
                      <div className="flex justify-between items-start">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-slate-900 font-black">
                              {sale.is_offline_draft ? "Draft sale" : `Sale #${sale.id}`}
                            </span>
                            <Badge variant="neutral" className="py-0.2 px-1.5 text-[10px] rounded-lg font-mono font-bold bg-white border border-slate-200">
                              {sale.payment_method}
                            </Badge>
                            {Number(sale.tip_amount || 0) > 0 && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
                                <Heart size={10} className="fill-amber-600 text-amber-600" />
                                Tip: {formatCurrency(Number(sale.tip_amount))}
                              </span>
                            )}
                            {sale.is_offline_draft && (
                              <span className="text-[10px] text-amber-600 font-extrabold font-sans">
                                {sale.offline_status === "requires_review" ? "Manual review" : sale.offline_status}
                              </span>
                            )}
                          </div>
                          {sale.is_preorder && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
                                Preorder: {sale.preorder_customer_name}
                              </span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${sale.preorder_payment_status === "Paid" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-rose-50 text-rose-700 border border-rose-200 animate-pulse"}`}>
                                {sale.preorder_payment_status || "Unpaid"}
                              </span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${sale.preorder_fulfillment_status === "Picked Up" ? "bg-blue-50 text-blue-700 border border-blue-200" : "bg-slate-100 text-slate-600 border border-slate-200"}`}>
                                {sale.preorder_fulfillment_status || "Pending"}
                              </span>
                            </div>
                          )}
                        </div>
                        <span className="font-mono text-sm font-black text-slate-900">
                          {formatCurrency(sale.total_amount || 0)}
                        </span>
                      </div>

                      {/* PRODUCT ITEM BREAKDOWN */}
                      {sale.items && sale.items.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1.5 border-t border-slate-200/80">
                          {sale.items.map((item: any, idx: number) => {
                            const prod = products.find((p: any) => p.sku === item.sku);
                            const name = item.product_name || prod?.product_name || item.sku;
                            return (
                              <span key={idx} className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-0.5 text-[11px] font-bold text-slate-700 shadow-3xs">
                                <span className="font-mono font-black text-amber-900">{item.quantity}x</span>
                                <span className="truncate max-w-[150px]">{name}</span>
                              </span>
                            );
                          })}
                        </div>
                      )}

                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold pt-1 border-t border-slate-100">
                        <span>{formatDateTime(sale.timestamp)}</span>
                        <div className="flex items-center gap-2">
                          {sale.payment_method === "Cash" && sale.cash_received != null && (
                            <span className="font-mono font-bold text-slate-600">
                              Cash {formatCurrency(Number(sale.cash_received))}
                              {Number(sale.tip_amount || 0) > 0 ? (
                                <span className="text-amber-800 font-extrabold ml-1">· Tip {formatCurrency(Number(sale.tip_amount))}</span>
                              ) : (
                                ` · Change ${formatCurrency(Number(sale.change_given ?? 0))}`
                              )}
                            </span>
                          )}
                          {sale.is_offline_draft && sale.offline_status === "pending" && (
                            <button
                              type="button"
                              onClick={() => handleUndoSale(sale.client_reference || sale.id)}
                              className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 hover:bg-rose-100 cursor-pointer"
                              aria-label={`Undo pending sale ${sale.id}`}
                            >
                              <Undo2 size={10} className="stroke-[2.5]" /> Undo
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {recentSales.length === 0 && (
                    <div className="text-center text-slate-400 italic py-6 text-xs">No sales logged yet for this active session.</div>
                  )}
                </div>
              </CardContent>
            </Card>

          </div>

        </div>

        {Object.keys(cart).length > 0 && (
          <div className="pos-mobile-checkout fixed inset-x-3 z-40 min-[900px]:hidden">
            <button
              type="button"
              onClick={() => cartPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-left text-white shadow-2xl"
              aria-label={`Review cart with ${Object.values(cart).reduce((sum, quantity) => sum + quantity, 0)} items totaling ${formatCurrency(cartTotal)}`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="rounded-xl bg-white/10 p-2"><ShoppingCart size={18} /></span>
                <span className="min-w-0">
                  <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Current total</span>
                  <span className="block truncate font-mono text-lg font-black">{formatCurrency(cartTotal)}</span>
                </span>
              </span>
              <span className="shrink-0 rounded-xl bg-primary px-3 py-2 text-xs font-black">Review &amp; checkout</span>
            </button>
          </div>
        )}
        {/* PRE-ORDER LOOKUP & FULFILLMENT MODAL */}
        {isPreorderLookupOpen && (
          <Modal
            isOpen={isPreorderLookupOpen}
            onClose={() => setIsPreorderLookupOpen(false)}
            title="Fulfill Customer Pre-Order"
            size="2xl"
          >
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                Search for customer pre-orders to load their items directly into the cashier cart for instant checkout.
              </p>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by customer name or token reference..."
                  value={preorderLookupQuery}
                  onChange={async (e) => {
                    const q = e.target.value;
                    setPreorderLookupQuery(q);
                    try {
                      const res = await api.getPreorders({ q: q.trim() || undefined, page_size: 50 });
                      setPreorderLookupList(res.items || []);
                    } catch {
                      // fallback
                    }
                  }}
                  className="w-full py-2 border border-slate-300 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500 bg-slate-50"
                  style={{ paddingLeft: "2.25rem", paddingRight: "1rem" }}
                />
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-80 overflow-y-auto divide-y divide-slate-100">
                {preorderLookupList.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 text-xs italic">
                    No pre-orders found.
                  </div>
                ) : (
                  preorderLookupList.map((item: any) => (
                    <div key={item.id} className="p-3 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-amber-50/50 transition-colors">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-amber-900 text-xs">{item.public_reference}</span>
                          <span className="font-bold text-slate-900 text-sm">{item.customer_name}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold">{item.status}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Fulfillment: {item.fulfillment_method} &bull; {item.total_units} items &bull; Total {formatCurrency(item.total_amount)}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="primary"
                        className="bg-amber-800 hover:bg-amber-900 text-white text-xs shrink-0"
                        onClick={async () => {
                          try {
                            const detail = await api.getPreorderDetail(item.id);
                            const newCart: Record<string, number> = {};
                            detail.items.forEach((lineItem: any) => {
                              newCart[lineItem.sku] = lineItem.quantity;
                            });
                            setCart(newCart);
                            setIsPreorder(true);
                            setPreorderCustomerName(detail.customer_name);
                            if (detail.payment_status === "Paid") {
                              setPreorderPaymentStatus("Paid");
                              setPaymentMethod("Cash");
                            } else {
                              setPreorderPaymentStatus("Unpaid");
                              setPaymentMethod("Pautang");
                            }
                            setIsPreorderLookupOpen(false);
                            showToast(`Loaded pre-order #${detail.public_reference} for ${detail.customer_name} into cart!`, "success");
                          } catch (err: any) {
                            showToast(err.message || "Failed to load pre-order items", "error");
                          }
                        }}
                      >
                        Load to Cart
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  // ----------------------------------------------------
  // STANDARD MARKET EVENTS DETAILS & LIST VIEW (PHASE 1)
  // ----------------------------------------------------
  return (
    <div className="space-y-8 flex flex-col pb-16">
      
      {/* 1. Header Banner */}
      <div className="bg-[#fcf8f2] border border-[#ece5da] rounded-3xl p-6 md:p-8 flex flex-col md:flex-row md:justify-between md:items-center gap-6 print:hidden">
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
          {replayableOfflineCount > 0 && isOnline && (
            <button
              onClick={handleManualSyncRetry}
              className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-800 py-2.5 px-4 rounded-xl text-xs font-black shadow-3xs cursor-pointer animate-pulse"
              title="Manual Trigger Sync Upload"
            >
              <CloudLightning size={14} />
              <span>Sync {replayableOfflineCount} Saved Sales</span>
            </button>
          )}
          {manualReviewOfflineCount > 0 && (
            <Badge variant="warning" className="py-2.5 px-4 text-xs font-black">
              {manualReviewOfflineCount} Offline Review
            </Badge>
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

      {/* Active Booth Hero Banner for Instant 1-Tap POS Access */}
      {(() => {
        const activeBoothEvent = events.find((e: any) => e.status === "Active");
        if (!activeBoothEvent) return null;
        return (
          <div className="p-4 md:p-5 bg-gradient-to-r from-amber-800 via-amber-900 to-stone-900 rounded-2xl text-white shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-fade-in border border-amber-700/50 print:hidden">
            <div className="flex items-center gap-3.5">
              <div className="p-3 bg-amber-500/20 border border-amber-400/30 backdrop-blur-xs rounded-xl text-amber-300">
                <Store size={26} />
              </div>
              <div>
                <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-emerald-400 text-emerald-950 text-[10px] font-black uppercase tracking-wider mb-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-900 animate-ping" />
                  Active Market Terminal Ready
                </div>
                <h3 className="text-lg md:text-xl font-heading font-black tracking-wide text-amber-100">{activeBoothEvent.name}</h3>
                <p className="text-xs text-stone-300 font-medium">
                  📍 {activeBoothEvent.location} · 📅 {activeBoothEvent.event_date}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleLaunchTerminal(activeBoothEvent)}
              className="w-full md:w-auto px-6 py-3.5 bg-amber-500 hover:bg-amber-400 text-stone-950 font-heading font-black text-sm rounded-xl shadow-md active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <ShoppingCart size={18} />
              <span>Launch POS Cashier Now</span>
            </button>
          </div>
        );
      })()}

      {/* Tabs Menu */}
      <div className="flex border-b border-slate-200 text-sm md:text-base font-heading font-black overflow-x-auto whitespace-nowrap bg-white/50 p-1.5 rounded-2xl border print:hidden">
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
        {userRole === "owner" && (
          <>
            <button
              onClick={() => setActiveMainTab("analytics")}
              className={`inline-flex items-center justify-center gap-2 px-6 py-4 rounded-xl transition-all cursor-pointer font-extrabold shrink-0 text-center ${
                activeMainTab === "analytics"
                  ? "bg-[#885625]/10 text-primary font-black animate-fade-in"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              <BrainCircuit size={16} /> AI Recommendations &amp; Analytics Hub
            </button>
            <button
              onClick={() => setActiveMainTab("reconciliation")}
              className={`inline-flex items-center justify-center gap-2 px-6 py-4 rounded-xl transition-all cursor-pointer font-extrabold shrink-0 text-center ${
                activeMainTab === "reconciliation"
                  ? "bg-[#885625]/10 text-primary font-black animate-fade-in"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              <ShieldCheck size={16} /> Conflict Reconciliation Hub
            </button>
          </>
        )}
      </div>

      {/* 2. SCHEDULER TAB CONTENT */}
      {activeMainTab === "scheduler" && (
        <div className="space-y-6 print:hidden">
          <div className="flex justify-between items-center flex-wrap gap-4">
            <span className="text-sm font-black text-slate-500 uppercase tracking-wider block">Scheduled Pop-Up Markets listing</span>
            {getSyncBadgeInScheduler()}
          </div>

          {/* Sub-tab selection menu & Series grouping toggle */}
          <div className="flex justify-between items-center flex-wrap gap-3">
            <div className="flex gap-2 p-1.5 bg-slate-100/80 rounded-2xl border border-slate-200 w-fit">
              <button
                onClick={() => setSchedulerFilter("active")}
                className={`px-5 py-2.5 rounded-xl text-xs font-heading font-black uppercase tracking-wider transition-all cursor-pointer ${
                  schedulerFilter === "active"
                    ? "bg-white text-slate-850 shadow-3xs scale-[1.01] font-black border border-slate-200/50"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                📅 Active &amp; Planned ({events.filter(e => e.status === "Draft" || e.status === "Active").length})
              </button>
              <button
                onClick={() => setSchedulerFilter("completed")}
                className={`px-5 py-2.5 rounded-xl text-xs font-heading font-black uppercase tracking-wider transition-all cursor-pointer ${
                  schedulerFilter === "completed"
                    ? "bg-white text-slate-850 shadow-3xs scale-[1.01] font-black border border-slate-200/50"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                ✅ Completed / Past ({events.filter(e => e.status === "Completed" || e.status === "Cancelled").length})
              </button>
            </div>

            {schedulerFilter === "active" && (
              <div className="flex items-center gap-1 bg-slate-100/90 p-1.5 rounded-2xl border border-slate-200 text-xs">
                <button
                  type="button"
                  onClick={() => setGroupBySeries(true)}
                  className={`px-3.5 py-1.5 rounded-xl font-black text-[11px] uppercase tracking-wider transition-all cursor-pointer ${
                    groupBySeries ? "bg-white text-slate-900 shadow-3xs border border-slate-200/50" : "text-slate-500 hover:text-slate-700"
                  }`}
                  title="Collapse future recurring instances into single series cards"
                >
                  🔄 Group Series
                </button>
                <button
                  type="button"
                  onClick={() => setGroupBySeries(false)}
                  className={`px-3.5 py-1.5 rounded-xl font-black text-[11px] uppercase tracking-wider transition-all cursor-pointer ${
                    !groupBySeries ? "bg-white text-slate-900 shadow-3xs border border-slate-200/50" : "text-slate-500 hover:text-slate-700"
                  }`}
                  title="Show all individual cards for every date"
                >
                  📜 Show All Cards
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="py-20 text-center text-slate-555 flex flex-col items-center justify-center gap-3">
              <RefreshCw className="animate-spin text-primary" size={40} />
              <span className="text-sm font-semibold">Loading Market Events...</span>
            </div>
          ) : (() => {
            const rawFiltered = events.filter(e => {
              if (schedulerFilter === "active") {
                return e.status === "Draft" || e.status === "Active";
              } else {
                return e.status === "Completed" || e.status === "Cancelled";
              }
            });

            if (rawFiltered.length === 0) {
              return (
                <Card className="rounded-3xl border-slate-200 shadow-sm p-12 text-center text-slate-500 font-semibold italic bg-white">
                  No {schedulerFilter === "active" ? "active or planned" : "completed or cancelled"} market events scheduled yet.
                </Card>
              );
            }

            let displayGroups: Array<{ primary: any; futureOccurrences: any[] }> = [];

            if (schedulerFilter === "active" && groupBySeries) {
              const groupsByName: { [key: string]: any[] } = {};
              rawFiltered.forEach(evt => {
                const key = (evt.name || "").trim().toLowerCase();
                if (!groupsByName[key]) groupsByName[key] = [];
                groupsByName[key].push(evt);
              });

              Object.values(groupsByName).forEach(groupList => {
                groupList.sort((a, b) => (a.event_date || "").localeCompare(b.event_date || ""));
                const primary = groupList.find(e => e.status === "Active") || groupList[0];
                const futureOccurrences = groupList.filter(e => e.id !== primary.id);
                displayGroups.push({ primary, futureOccurrences });
              });
            } else {
              displayGroups = rawFiltered.map(evt => ({ primary: evt, futureOccurrences: [] }));
            }

            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {displayGroups.map(({ primary: event, futureOccurrences }) => {

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
                        <span className="flex items-center gap-2 sm:col-span-2">
                          <Calendar size={18} className="text-amber-800 shrink-0" />
                          <span className="inline-flex rounded-xl border border-amber-300 bg-amber-100 px-3 py-1.5 text-lg font-black leading-none text-amber-950 shadow-3xs">
                            {formatDate(event.event_date)}
                          </span>
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
                      {event.allocations && event.allocations.length > 0 && (() => {
                        const isPastEvent = event.status === "Completed" || event.status === "Cancelled";
                        const displayAllocations = isPastEvent
                          ? [...event.allocations].sort((a: any, b: any) => ((b.remaining_quantity ?? b.quantity) > 0 ? 1 : 0) - ((a.remaining_quantity ?? a.quantity) > 0 ? 1 : 0))
                          : event.allocations;

                        return (
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-xs text-slate-400 font-extrabold uppercase tracking-wide">
                                {event.metrics_basis === "actual" ? "Remaining Event Inventory" : "Reserved Inventory Allocations"}
                              </span>
                              <span className="text-[10px] text-slate-400 font-bold">
                                {event.allocations.length} SKUs allocated
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                              {displayAllocations.map((alloc: any) => {
                                const remainingQty = alloc.remaining_quantity ?? alloc.quantity;
                                const isSoldOut = event.status === "Active" && remainingQty === 0;

                                return (
                                  <div
                                    key={alloc.id || alloc.sku}
                                    className={`p-2.5 rounded-xl border text-xs flex justify-between items-center transition-all ${
                                      isSoldOut
                                        ? "bg-slate-100/90 border-slate-200 text-slate-400"
                                        : "bg-amber-50/40 border-amber-100 text-amber-900"
                                    }`}
                                  >
                                    <div className="truncate pr-1">
                                      <span className={`font-mono font-bold block text-[11px] ${isSoldOut ? "line-through text-slate-400" : ""}`}>
                                        {alloc.sku}
                                      </span>
                                      {alloc.product && (
                                        <span className="text-[10px] text-slate-500 font-medium block truncate">
                                          {alloc.product.product_name}
                                        </span>
                                      )}
                                    </div>
                                    <span className={`font-mono font-black shrink-0 px-2 py-0.5 rounded-lg text-xs ${
                                      isSoldOut
                                        ? "bg-slate-200 text-slate-500"
                                        : "bg-amber-200/60 text-amber-950"
                                    }`}>
                                      {remainingQty}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Performance metrics breakdown for active/completed events */}
                      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 text-xs">
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                            {event.metrics_basis === "actual" ? "Recorded Event Sales" : "Potential Gross Sales"}
                          </span>
                          <span className="font-mono font-black text-slate-800 text-sm mt-0.5 block">
                            {formatCurrency(event.metrics_basis === "actual" ? (event.total_sales_revenue || 0) : (event.potential_gross_sales || 0))}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                            Total Units Allocated
                          </span>
                          <span className="font-mono font-black text-slate-800 text-sm mt-0.5 block">
                            {event.total_allocated_units || 0} units
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                            {event.metrics_basis === "actual" ? "Net Profit" : "Est Profit"}
                          </span>
                          <span className="font-mono font-black text-emerald-600 text-sm mt-0.5 block">
                            {event.costing_complete !== false
                              ? formatCurrency(event.potential_profit ?? 0)
                              : "Unavailable"}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                            Food Waste / Leftovers
                          </span>
                          <span className="font-mono font-black text-rose-600 text-sm mt-0.5 block">
                            {event.metrics_basis === "actual" ? `${event.food_waste_quantity || 0} waste` : "0 recorded"}
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
                      
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Pack & Loadout Manifest button */}
                        {event.allocations && event.allocations.length > 0 && (
                          <Button
                            onClick={() => {
                              setManifestEvent(event);
                              setIsManifestOpen(true);
                            }}
                            variant="outline"
                            className="h-10 text-xs px-3 font-bold border-amber-300 text-amber-900 bg-amber-50/50 hover:bg-amber-100/80 rounded-xl flex items-center gap-1.5 shrink-0"
                            leftIcon={<Package size={14} className="text-[#885625]" />}
                          >
                            Pack &amp; Loadout Sheet
                          </Button>
                        )}

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
                      </div>

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

                      {(userRole === "owner" || userRole === "staff") && (
                        <div className="flex gap-2 ml-auto">
                          {userRole === "owner" && (
                            <Button
                              onClick={() => handleOpenDelete(event)}
                              variant="outline"
                              aria-label={`Delete ${event.name}`}
                              title="Delete market event"
                              className="h-10 text-xs px-3 hover:bg-rose-50 border-rose-150 hover:text-danger hover:border-danger font-bold text-slate-600 rounded-xl"
                            >
                              <Trash2 size={14} />
                            </Button>
                          )}
                          <Button
                            onClick={() => handleOpenEdit(event)}
                            variant="outline"
                            className="h-10 text-xs px-4 font-bold rounded-xl"
                          >
                            <Edit3 size={14} className="mr-1.5" /> Edit
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Expandable future occurrences tray for grouped recurring events */}
                    {futureOccurrences.length > 0 && (() => {
                      const seriesKey = `series_${event.name.trim().toLowerCase()}`;
                      const isExpanded = !!expandedSeriesMap[seriesKey];
                      return (
                        <div className="w-full mt-2 pt-3 border-t border-slate-100">
                          <div className="flex justify-between items-center bg-amber-50/80 p-3 rounded-2xl border border-amber-200/60">
                            <div className="flex items-center gap-2">
                              <RefreshCw size={14} className="text-amber-800 shrink-0" />
                              <span className="text-xs font-heading font-black text-amber-900 uppercase tracking-wide">
                                Recurring Series ({futureOccurrences.length} future {futureOccurrences.length === 1 ? "occurrence" : "occurrences"})
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setExpandedSeriesMap(prev => ({ ...prev, [seriesKey]: !prev[seriesKey] }))}
                              className="px-3 py-1 bg-amber-200/80 hover:bg-amber-300 text-amber-950 text-xs font-extrabold rounded-xl transition-all cursor-pointer flex items-center gap-1"
                            >
                              {isExpanded ? "Hide Dates" : "Show Future Dates"}
                            </button>
                          </div>

                          {isExpanded && (
                            <div className="mt-3 space-y-2 pl-3 border-l-2 border-amber-300">
                              {futureOccurrences.map((occ) => (
                                <div key={occ.id} className="flex justify-between items-center bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Calendar size={14} className="text-amber-800 shrink-0" />
                                    <span className="font-black text-slate-900">{formatDate(occ.event_date)}</span>
                                    <span className="text-[10px] text-slate-400 font-mono font-bold">#{occ.id}</span>
                                    <Badge variant={getStatusBadgeVariant(occ.status)} className="py-0.5 px-2 text-[10px] rounded-md font-bold">
                                      {occ.status}
                                    </Badge>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => handleOpenEdit(occ)}
                                      className="px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-200 rounded-lg transition-all cursor-pointer"
                                    >
                                      Edit
                                    </button>
                                    {userRole === "owner" && (
                                      <button
                                        onClick={() => handleOpenDelete(occ)}
                                        className="px-2.5 py-1 text-xs font-bold text-red-600 hover:bg-red-50 rounded-lg transition-all cursor-pointer"
                                      >
                                        Delete
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
              </div>
            );
          })()}
        </div>
      )}

      {activeMainTab === "analytics" && (
        /* 3. AI & ANALYTICS TAB CONTENT (PHASE 5) */
        <div className="space-y-8 animate-fade-in print:hidden">
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
                  <h3 className="text-xl md:text-2xl font-black text-slate-800 font-mono mt-1">{formatCurrency(analyticsData.overall.total_revenue ?? 0)}</h3>
                  <span className="text-[10px] text-slate-400 block mt-2">All completed pop-up sales</span>
                </div>
                <div className="modern-card p-6 bg-white border-l-4 border-l-primary">
                  <span className="text-xs text-slate-455 font-black uppercase tracking-wider block">Total Net Profit</span>
                  <h3 className="text-xl md:text-2xl font-black text-primary font-mono mt-1">
                    {analyticsData.overall.costing_complete !== false ? formatCurrency(analyticsData.overall.potential_profit ?? 0) : "Unavailable"}
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
                  <h3 className="text-xl md:text-2xl font-black text-slate-800 font-mono mt-1">{formatCurrency(analyticsData.overall.avg_revenue_per_event)}</h3>
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
                        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
                          <ProductDisplay
                            sku={rec.sku}
                            productName={rec.product_name}
                            category={rec.category || ""}
                            size={rec.size}
                          />
                          <Badge variant="warning" className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-black">Bring {formatProductQuantity(rec, rec.recommended_quantity)}</Badge>
                        </div>
                        
                        {/* Dynamic WHY Reason paragraph */}
                        <p className="text-xs md:text-sm text-slate-500 font-semibold bg-slate-50 p-3.5 rounded-xl border border-slate-100 italic leading-relaxed">
                          &ldquo;{rec.reason}&rdquo;
                        </p>
                        
                        {rec.is_stock_short && (
                          <div className="p-3 bg-amber-50 border border-amber-250 rounded-xl flex items-start gap-2 text-xs font-bold text-amber-800 leading-normal">
                            <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                            <span>
                              <strong>Warehouse Stock Alert:</strong> You only have {formatProductQuantity(rec, rec.warehouse_stock)} in the main warehouse. Fulfill this recommendation by scheduling a prep run of at least {formatProductQuantity(rec, rec.recommended_quantity - rec.warehouse_stock)} under <strong>Production Planner</strong>!
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 text-xs font-bold text-slate-550">
                        <div>
                          <span className="text-slate-400">Expected Revenue</span>
                          <span className="block text-sm font-black text-slate-800 font-mono mt-0.5">{formatCurrency(rec.expected_revenue)}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Expected Net Profit</span>
                          <span className="block text-sm font-black text-emerald-600 font-mono mt-0.5">
                            {rec.costing_complete !== false && rec.expected_profit !== null
                              ? formatCurrency(rec.expected_profit ?? 0)
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
                          <ProductDisplay
                            sku={item.sku}
                            productName={item.product_name}
                            category={item.category || ""}
                            size={item.size}
                            variant="compact"
                          />
                        </div>
                        <span className="shrink-0 font-mono text-base font-black text-emerald-600">{formatProductQuantity(item, item.quantity)} sold</span>
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
                          <ProductDisplay
                            sku={item.sku}
                            productName={item.product_name}
                            category={item.category || ""}
                            size={item.size}
                            variant="compact"
                          />
                        </div>
                        <span className="shrink-0 font-mono text-base font-black text-rose-600">{formatProductQuantity(item, item.quantity)} sold</span>
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
                            <Tooltip formatter={(val) => [formatCurrency(Number(val)), "Sales"]} />
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
                          <span className="text-sm font-black text-slate-800 font-mono">{formatCurrency(analyticsData.overall.total_revenue)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="py-12 text-center text-slate-400 italic">No seasonality data.</div>
                    )}

                    <div className="w-full space-y-2 text-xs font-bold text-slate-500 border-t border-slate-100 pt-4 mt-4">
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-1.5 font-bold"><span className="w-2.5 h-2.5 rounded-full bg-[#7b3e19]"></span> Weekend Sales (Sat-Sun)</span>
                        <span className="font-mono text-slate-800 text-sm">{formatCurrency(analyticsData.weekend_sales)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-1.5 font-bold"><span className="w-2.5 h-2.5 rounded-full bg-[#cfaf45]"></span> Weekday Sales (Mon-Fri)</span>
                        <span className="font-mono text-slate-800 text-sm">{formatCurrency(analyticsData.weekday_sales)}</span>
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
                          <Tooltip formatter={(val) => [formatCurrency(Number(val))]} />
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
        <div className="space-y-8 animate-fade-in print:hidden">
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
                    category: alloc.category,
                    size: alloc.size,
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
                              <StatusBadge status="conflict" label="Sync overlap flagged" />
                              <ProductDisplay
                                sku={conf.sku}
                                productName={conf.product_name}
                                category={conf.category || ""}
                                size={conf.size}
                                variant="compact"
                              />
                              <p className="text-xs text-rose-700 font-bold leading-relaxed mt-1">
                                Multiple terminal synchronization overlap: Total synced sales ({formatProductQuantity(conf, conf.sold)}) exceeds the original dispatched allocation ({formatProductQuantity(conf, conf.dispatched)}) by <strong className="font-black text-sm font-mono">{formatProductQuantity(conf, conf.excess)}</strong>.
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
                      <div role="region" aria-label="Synced market transactions" tabIndex={0} className="scroll-fade-x rounded-2xl border border-slate-200 bg-white shadow-3xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
                        <table className="w-full text-left border-collapse text-sm">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-550 font-black uppercase tracking-wider text-xs px-4 py-3">
                              <th scope="col" className="px-5 py-3">Sale ID &amp; Cashier</th>
                              <th scope="col" className="px-5 py-3">Timestamp</th>
                              <th scope="col" className="px-5 py-3">Items Sold</th>
                              <th scope="col" className="px-5 py-3 text-right">Total Amount</th>
                              <th scope="col" className="px-5 py-3 text-center">Actions</th>
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
                                  {formatDateTime(sale.timestamp)}
                                </td>
                                <td className="px-5 py-3.5">
                                  <div className="space-y-1">
                                    {sale.items.map((it: any) => (
                                      <div key={it.id} className="flex min-w-64 items-center justify-between gap-3">
                                        <ProductDisplay
                                          sku={it.sku}
                                          productName={it.product_name}
                                          category={it.category || ""}
                                          size={it.size}
                                          variant="selector"
                                          showIcon={false}
                                        />
                                        <strong className="shrink-0 font-mono text-[#885625]">×{it.quantity}</strong>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                                <td className="px-5 py-3.5 text-right font-mono text-slate-855 text-base font-black">
                                  {formatCurrency(sale.total_amount)}
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
                                    className="h-10 px-3 text-xs font-black text-rose-600 border border-rose-200 hover:bg-rose-50 rounded-xl cursor-pointer transition-colors"
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
          size="4xl"
        >
          <form onSubmit={handleCreateSubmit} className="space-y-4 text-xs font-semibold text-slate-600 leading-normal">
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-[11px] text-slate-500 font-bold uppercase block mb-1">Market Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Laguna Organic Trade Fair"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full text-sm font-semibold text-slate-800 h-10 rounded-xl"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 font-bold uppercase block mb-1">Event Date *</label>
                <input
                  type="date"
                  required
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="w-full font-mono text-sm font-semibold text-slate-800 h-10 rounded-xl"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 font-bold uppercase block mb-1">Location *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Activity Center, Alabang Town Center"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full text-sm font-semibold text-slate-800 h-10 rounded-xl"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 font-bold uppercase block mb-1">Assigned Staff</label>
                <input
                  type="text"
                  placeholder="e.g. Lucia, Mang Roger"
                  value={staffAssigned}
                  onChange={(e) => setStaffAssigned(e.target.value)}
                  className="w-full text-sm font-semibold text-slate-800 h-10 rounded-xl"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 font-bold uppercase block mb-1">Event Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full text-xs font-semibold bg-white h-10 border border-slate-200 rounded-xl px-3"
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

            {/* Recurrence Configuration */}
            <div className="border border-slate-200 rounded-2xl p-5 bg-slate-50/50 space-y-4">
              <div className="flex items-center gap-2">
                <input
                  id="event-is-recurring"
                  type="checkbox"
                  checked={isRecurring}
                  onChange={(e) => setIsRecurring(e.target.checked)}
                  className="w-5 h-5 accent-[#885625] cursor-pointer rounded"
                />
                <label htmlFor="event-is-recurring" className="text-xs text-slate-700 font-black uppercase tracking-wider cursor-pointer select-none">
                  Recurring Event Series (e.g. Weekly Market)
                </label>
              </div>

              {isRecurring && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-200/60 animate-fade-in">
                  <div>
                    <label htmlFor="event-recurrence-frequency" className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Frequency</label>
                    <select
                      id="event-recurrence-frequency"
                      value={recurrenceFrequency}
                      onChange={(e) => setRecurrenceFrequency(e.target.value)}
                      className="w-full text-sm font-bold bg-white h-12 border-2 border-slate-200 rounded-xl px-3"
                    >
                      <option value="weekly">Weekly</option>
                      <option value="bi-weekly">Bi-weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="event-recurrence-count" className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Number of Weeks / Occurrences</label>
                    <input
                      id="event-recurrence-count"
                      type="number"
                      min={2}
                      max={12}
                      value={recurrenceCount}
                      onChange={(e) => setRecurrenceCount(e.target.value === "" ? 2 : Math.min(12, Math.max(2, Number(e.target.value))))}
                      className="w-full text-base font-bold text-slate-800 h-12 border-2 border-slate-200 rounded-xl px-3 outline-none"
                    />
                  </div>
                </div>
              )}
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
                key={getMarketEventChecklistKey(selectedEvent)}
                products={products}
                allocations={allocations}
                setAllocations={setAllocations}
                onRefreshProducts={fetchProducts}
              />

              {/* Summary aggregate info */}
              {allocations.length > 0 && (() => {
                const stats = calculateSummaryMetrics(allocations);
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3.5 sm:p-4 bg-white border border-slate-200 rounded-2xl text-xs font-bold text-slate-555 shadow-3xs">
                    <div className="flex sm:block justify-between items-center">
                      <span className="text-[10px] text-slate-400 uppercase block">Est Revenue</span>
                      <span className="font-mono font-black text-slate-800 text-sm mt-0.5 sm:mt-1 block">{formatCurrency(stats.estimatedRevenue)}</span>
                    </div>
                    <div className="flex sm:block justify-between items-center border-t sm:border-t-0 border-slate-100 pt-1.5 sm:pt-0">
                      <span className="text-[10px] text-slate-400 uppercase block">Est Cost (BOM)</span>
                      <span className="font-mono font-black text-slate-800 text-sm mt-0.5 sm:mt-1 block">
                        {stats.financialsVisible ? formatCurrency(stats.estimatedCost) : "Owner only"}
                      </span>
                    </div>
                    <div className="flex sm:block justify-between items-center border-t sm:border-t-0 border-slate-100 pt-1.5 sm:pt-0">
                      <span className="text-[10px] text-slate-400 uppercase block">Potential Profit</span>
                      <span className="font-mono font-black text-emerald-600 text-sm mt-0.5 sm:mt-1 block">
                        {stats.financialsVisible ? formatCurrency(stats.potentialProfit) : "Owner only"}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 border-t border-slate-100 pt-4 mt-6">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-12 w-full sm:w-auto px-6 cursor-pointer"
                onClick={() => setIsCreateOpen(false)}
                disabled={actionLoading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="h-12 w-full sm:w-auto px-6 font-bold cursor-pointer"
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
          size="4xl"
        >
          <form onSubmit={handleEditSubmit} className="space-y-4 text-xs font-semibold text-slate-600 leading-normal">
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-[11px] text-slate-500 font-bold uppercase block mb-1">Market Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Laguna Organic Trade Fair"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full text-sm font-semibold text-slate-800 h-10 rounded-xl"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 font-bold uppercase block mb-1">Event Date *</label>
                <input
                  type="date"
                  required
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="w-full font-mono text-sm font-semibold text-slate-800 h-10 rounded-xl"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 font-bold uppercase block mb-1">Location *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Activity Center, Alabang Town Center"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full text-sm font-semibold text-slate-800 h-10 rounded-xl"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 font-bold uppercase block mb-1">Assigned Staff</label>
                <input
                  type="text"
                  placeholder="e.g. Lucia, Mang Roger"
                  value={staffAssigned}
                  onChange={(e) => setStaffAssigned(e.target.value)}
                  className="w-full text-sm font-semibold text-slate-800 h-10 rounded-xl"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 font-bold uppercase block mb-1">Event Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full text-xs font-semibold bg-white h-10 border border-slate-200 rounded-xl px-3"
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
              <span className="text-xs text-slate-500 font-black uppercase tracking-wider block">Cash Register &amp; Closing</span>
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
                {(selectedEvent.cash_adjustments || selectedEvent.cash_adjustments_notes) && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800 sm:col-span-2">
                    Historical legacy adjustment: {formatCurrency(selectedEvent.cash_adjustments || 0)}.
                    {selectedEvent.cash_adjustments_notes && ` ${selectedEvent.cash_adjustments_notes}`}
                    <span className="mt-1 block font-semibold text-amber-700">
                      This is retained for audit only and is excluded from the new ending-cashbox formula. Record expenses and refunds in the Closeout Sheet.
                    </span>
                  </div>
                )}
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
              disabled={selectedEvent.status === "Completed" || selectedEvent.status === "Cancelled"}
              className="border border-slate-200 rounded-2xl p-5 bg-slate-50/50 space-y-4 disabled:opacity-70"
            >
              <span className="text-xs text-slate-500 font-black uppercase tracking-wider block">
                {selectedEvent.status === "Active"
                  ? "Booth Inventory Count"
                  : "Reserve Inventory Allocation"}
              </span>
              {(selectedEvent.status === "Completed" || selectedEvent.status === "Cancelled") && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                  Allocations are locked after event completion or cancellation.
                </p>
              )}

              <InventoryChecklist
                products={products}
                allocations={allocations}
                setAllocations={setAllocations}
                mode={selectedEvent.status === "Active" ? "active" : "planning"}
                originalAllocations={selectedEvent.allocations || []}
                onRefreshProducts={fetchProducts}
                disabled={selectedEvent.status === "Completed" || selectedEvent.status === "Cancelled"}
              />

              {/* Summary aggregate info */}
              {allocations.length > 0 && (() => {
                const stats = calculateSummaryMetrics(allocations);
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3.5 sm:p-4 bg-white border border-slate-200 rounded-2xl text-xs font-bold text-slate-555 shadow-3xs">
                    <div className="flex sm:block justify-between items-center">
                      <span className="text-[10px] text-slate-455 uppercase block">Est Revenue</span>
                      <span className="font-mono font-black text-slate-900 text-sm mt-0.5 sm:mt-1 block">{formatCurrency(stats.estimatedRevenue)}</span>
                    </div>
                    <div className="flex sm:block justify-between items-center border-t sm:border-t-0 border-slate-100 pt-1.5 sm:pt-0">
                      <span className="text-[10px] text-slate-455 uppercase block">Est Cost (BOM)</span>
                      <span className="font-mono font-black text-slate-900 text-sm mt-0.5 sm:mt-1 block">
                        {stats.financialsVisible ? formatCurrency(stats.estimatedCost) : "Owner only"}
                      </span>
                    </div>
                    <div className="flex sm:block justify-between items-center border-t sm:border-t-0 border-slate-100 pt-1.5 sm:pt-0">
                      <span className="text-[10px] text-slate-455 uppercase block">Potential Profit</span>
                      <span className="font-mono font-black text-emerald-600 text-sm mt-0.5 sm:mt-1 block">
                        {stats.financialsVisible ? formatCurrency(stats.potentialProfit) : "Owner only"}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </fieldset>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 border-t border-slate-100 pt-4 mt-6">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-12 w-full sm:w-auto px-6 cursor-pointer"
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
                className="h-12 w-full sm:w-auto px-6 font-bold cursor-pointer"
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
          <style dangerouslySetInnerHTML={{ __html: `
            @media print {
              html, body {
                background: white !important;
                color: black !important;
                margin: 0 !important;
                padding: 0 !important;
                height: auto !important;
                overflow: visible !important;
              }
              @page {
                size: portrait;
                margin: 0 !important; /* Hides native browser URL, date, and titles */
              }
              .print-container {
                padding: 0.8cm 1.0cm !important;
                background: white !important;
                width: 100% !important;
                max-width: 100% !important;
                display: block !important;
              }
              .print-container, .print-container span, .print-container p, .print-container th, .print-container td, .print-container div, .print-container p strong {
                font-size: 10.5px !important;
                line-height: 1.3 !important;
              }
              .print-container h2, .print-container .text-xl {
                font-size: 15px !important;
              }
              .print-container h3, .print-container .text-lg {
                font-size: 12px !important;
              }
              .print-container .space-y-6 {
                margin-top: 0 !important;
                margin-bottom: 0 !important;
                gap: 12px !important;
              }
              .print-container .space-y-3, .print-container .space-y-2 {
                margin-top: 0 !important;
                margin-bottom: 0 !important;
                gap: 8px !important;
              }
              /* Table typography & cell padding */
              .print-container table {
                width: 100% !important;
                border-collapse: collapse !important;
              }
              .print-container table tr {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
              }
              .print-container th {
                padding: 6px 8px !important;
                font-size: 10px !important;
                font-weight: 800 !important;
                background-color: #f8fafc !important;
                border-bottom: 2px solid #e2e8f0 !important;
              }
              .print-container td {
                padding: 5px 8px !important;
                font-size: 10px !important;
                line-height: 1.3 !important;
              }
              /* Section card padding & borders */
              .print-container .p-5, .print-container .p-4, .print-container .p-3 {
                padding: 8px 12px !important;
              }
              .print-container .rounded-2xl {
                border-radius: 8px !important;
              }
              .print-container .rounded-xl {
                border-radius: 6px !important;
              }
              /* Hide product photos and icons in print mode */
              .print-container img, .print-container svg, .print-container .relative.shrink-0 {
                display: none !important;
              }
              /* Clean inline styling for product badges in print mode */
              .print-container [class*="rounded-md"], .print-container [class*="rounded-full"] {
                background: transparent !important;
                border: none !important;
                padding: 0 !important;
                font-size: 9.5px !important;
                color: #64748b !important;
                font-weight: 600 !important;
              }
              .print\\:hidden {
                display: none !important;
              }
              /* Hide only the backdrop background color and blur overlays */
              .fixed.inset-0.bg-black\\/25, .fixed.inset-0.bg-slate-500\\/30, .fixed.inset-0.backdrop-blur-xs {
                background: transparent !important;
                backdrop-filter: none !important;
              }
              /* Ensure modal portal wrapper is fully visible and unconstrained */
              div[role="dialog"] {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                max-width: 100% !important;
                height: auto !important;
                border: 0 !important;
                box-shadow: none !important;
                background: white !important;
                padding: 0 !important;
                margin: 0 !important;
                display: block !important;
                overflow: visible !important;
              }
              /* Hide any close/X buttons inside the modal dialog */
              div[role="dialog"] button {
                display: none !important;
              }
            }
          ` }} />
          <div className="space-y-6 text-sm font-semibold text-slate-600 leading-normal print:p-0 print:text-black print-container">
            
            {/* Header info sheet */}
            <div className="flex justify-between items-start border-b-2 border-slate-200 pb-5">
              <div>
                <span className="font-heading font-black text-xl tracking-widest text-slate-900 block leading-none">H+H HUB</span>
                <span className="text-[10px] text-slate-455 uppercase tracking-widest font-black block mt-2">MARKET EVENT CLOSEOUT SUMMARY</span>
                <span className="text-xs text-slate-400 font-semibold block mt-1">Cambria, Bay, Laguna, Brgy. Sto. Domingo</span>
              </div>
              <div className="text-right text-xs font-semibold text-slate-500 space-y-1">
                <span className="font-heading font-black text-slate-800 text-sm uppercase tracking-widest block mb-2">OFFICIAL RECORD</span>
                <p>Event ID: <span className="font-mono font-bold text-slate-850">#{selectedReportEvent.id}</span></p>
                <p>Date: {formatDate(selectedReportEvent.event_date)}</p>
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
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 text-xs font-bold text-slate-655">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-black">Net Sales (After Refunds)</span>
                  <span className="text-base font-black text-slate-800 block font-mono mt-1">{formatCurrency(selectedReportEvent.estimated_revenue)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-black">Total Cost (BOM)</span>
                  <span className="text-base font-black text-slate-800 block font-mono mt-1">
                    {selectedReportEvent.financials_visible === false
                      ? "Owner only"
                      : selectedReportEvent.costing_complete !== false
                        ? formatCurrency(selectedReportEvent.estimated_cost ?? 0)
                        : "Unavailable"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-black">Actual Net Profit</span>
                  <span className="text-lg font-black text-emerald-600 block font-mono mt-1">
                    {selectedReportEvent.financials_visible === false
                      ? "Owner only"
                      : selectedReportEvent.costing_complete !== false
                        ? formatCurrency(selectedReportEvent.potential_profit ?? 0)
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
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-black">Food Waste / Leftovers</span>
                  <span className="text-base font-black text-rose-600 block font-mono mt-1">
                    {selectedReportEvent.food_waste_quantity || 0} / {selectedReportEvent.food_leftover_quantity || 0}
                  </span>
                  <span className="mt-0.5 block text-[9px] text-slate-400">wasted / returned</span>
                </div>
              </div>
            </div>

            {/* Inventory Return sheets (Initial brought vs remaining returned) */}
            <div className="space-y-2">
              <span className="text-xs text-slate-500 font-black uppercase tracking-wider block flex items-center gap-1.5">
                <Package size={16} /> Remaining Stock &amp; Warehouse Return Sheet
              </span>
              <div role="region" aria-label="Market stock return report" tabIndex={0} className="overflow-x-auto print:overflow-visible rounded-2xl border border-slate-200 bg-white shadow-3xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-black uppercase tracking-wider text-[11px]">
                      <th scope="col" className="px-3 py-2.5">Product</th>
                      <th scope="col" className="px-3 py-2.5 text-right">Dispatched</th>
                      <th scope="col" className="px-3 py-2.5 text-right">Sold</th>
                      <th scope="col" className="px-3 py-2.5 text-right">Wasted</th>
                      <th scope="col" className="px-3 py-2.5 text-right">Returned</th>
                      <th scope="col" className="px-3 py-2.5">Reason</th>
                      <th scope="col" className="px-3 py-2.5 text-right">Cost (COGS)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                    {selectedReportEvent.allocations.map((alloc: any) => {
                      const soldQty = reportSalesList.reduce((sum, sale) => {
                        const item = sale.items.find((it: any) => it.sku === alloc.sku);
                        return sum + (item ? item.quantity : 0);
                      }, 0);

                      const initialQty = alloc.quantity + soldQty;
                      const wastedQty = alloc.wasted_quantity || 0;
                      const returnedQty = Math.max(0, alloc.quantity - wastedQty);

                      return (
                        <tr key={alloc.id} className="hover:bg-slate-50/20">
                          <td className="px-3 py-2">
                            <ProductDisplay
                              sku={alloc.sku}
                              productName={alloc.product_name}
                              category={alloc.category || ""}
                              size={alloc.size}
                              variant="compact"
                            />
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-600">{formatProductQuantity(alloc, initialQty)}</td>
                          <td className="px-3 py-2 text-right font-mono text-[#885625]">{formatProductQuantity(alloc, soldQty)}</td>
                          <td className="px-3 py-2 text-right font-mono text-rose-600">{formatProductQuantity(alloc, wastedQty)}</td>
                          <td className="px-3 py-2 text-right font-mono text-emerald-600">{formatProductQuantity(alloc, returnedQty)}</td>
                          <td className="px-3 py-2 text-xs text-slate-500">{alloc.waste_reason || "—"}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-855">
                            {selectedReportEvent.financials_visible === false
                              ? "Owner only"
                              : formatCurrency((soldQty + wastedQty) * (alloc.cost_per_unit || 0))}
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
              const initialFloat = selectedReportEvent.opening_float ?? selectedReportEvent.initial_cash_balance ?? 0.0;
              const cashExpenses = selectedReportEvent.cash_expenses ?? selectedReportEvent.total_expenses ?? 0.0;
              const cashRefunds = selectedReportEvent.cash_refunds ?? 0.0;
              const expectedClosing = selectedReportEvent.ending_cashbox_balance
                ?? (initialFloat + cashSalesTotal - cashExpenses - cashRefunds);
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
                        <span className="font-mono text-slate-800">{formatCurrency(initialFloat)}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-455">2. Cash Sales (Normal &amp; Paid Preorders):</span>
                        <span className="font-mono text-[#885625]">{formatCurrency(cashSalesTotal)}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-455">3. Cash Expenses:</span>
                        <span className="font-mono text-rose-700">- {formatCurrency(cashExpenses)}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-455">4. Cash Refunds:</span>
                        <span className="font-mono text-rose-700">- {formatCurrency(cashRefunds)}</span>
                      </div>
                      <div className="flex justify-between py-1.5 pt-2 border-t-2 border-slate-200 font-black text-sm">
                        <span className="text-slate-800">Expected Closing Cash:</span>
                        <span className="font-mono text-slate-900">{formatCurrency(expectedClosing)}</span>
                      </div>
                    </div>
                    
                    <div className="flex flex-col justify-center items-center p-4 bg-white border border-slate-200 rounded-xl space-y-2.5">
                      <span className="text-[10px] text-slate-400 uppercase font-black tracking-wider">Audit Closer Variance</span>
                      {hasClosing ? (
                        <>
                          <div className="text-center">
                            <span className="text-xs text-slate-400 block font-semibold">Physical Cash Counted</span>
                            <span className="text-xl font-mono font-black text-slate-900">{formatCurrency(actualClosing)}</span>
                          </div>
                          <div className={`text-center py-1 px-3 rounded-lg border font-mono font-black text-xs ${
                            variance === 0 
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                              : variance > 0 
                                ? "bg-blue-50 text-blue-700 border-blue-200" 
                                : "bg-rose-50 text-rose-700 border-rose-200"
                          }`}>
                            {variance === 0
                              ? "Balanced (₱0.00 Variance)"
                              : `${variance > 0 ? "+" : ""}${formatCurrency(variance)} ${variance > 0 ? "Cash Excess" : "Cash Deficit"}`}
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400 font-bold italic py-4">Physical Closing Cash Not Counted</span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 text-xs font-bold md:col-span-2">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400">GCash Received</span>
                        <span className="font-mono text-sm font-black text-blue-800">{formatCurrency(selectedReportEvent.gcash_sales ?? selectedReportEvent.payment_breakdown?.GCash ?? 0)}</span>
                      </div>
                      <div>
                        <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400">BPI / Bank Received</span>
                        <span className="font-mono text-sm font-black text-blue-800">{formatCurrency(selectedReportEvent.bpi_sales ?? selectedReportEvent.payment_breakdown?.["BPI / Bank Transfer"] ?? 0)}</span>
                      </div>
                      <div>
                        <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400">Reconciled Digital Total</span>
                        <span className="font-mono text-sm font-black text-blue-900">{formatCurrency(selectedReportEvent.digital_sales_total || 0)}</span>
                      </div>
                    </div>
                    {selectedReportEvent.expense_notes && (
                      <span className="mt-3 block border-t border-blue-100 pt-2 text-[10px] text-slate-500">Expense log: {selectedReportEvent.expense_notes}</span>
                    )}
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
                      <span className="text-sm font-black text-emerald-700 font-mono block mt-1">{formatCurrency(stats.paidAmount)}</span>
                    </div>
                    <div className="bg-rose-50/30 border border-rose-100 p-3 rounded-xl text-center">
                      <span className="text-[9px] text-rose-600 uppercase font-black block">Total Unpaid Value</span>
                      <span className="text-sm font-black text-rose-700 font-mono block mt-1">{formatCurrency(stats.unpaidAmount)}</span>
                    </div>
                  </div>

                  <div role="region" aria-label="Preorder fulfillment report" tabIndex={0} className="max-h-48 overflow-auto rounded-xl border border-slate-200 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
                    <table className="min-w-[680px] w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-black uppercase text-[10px] px-3 py-2">
                          <th scope="col" className="px-4 py-3">Customer / Order</th>
                          <th scope="col" className="px-4 py-3">Gateway</th>
                          <th scope="col" className="px-4 py-3 text-right">Value</th>
                          <th scope="col" className="px-4 py-3 text-center">Payment</th>
                          <th scope="col" className="px-4 py-3 text-center">Pickup</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                        {preordersList.map(sale => (
                          <tr key={sale.id} className="hover:bg-slate-50/10">
                            <td className="px-4 py-2 text-slate-800 font-black">{sale.preorder_customer_name || "Guest Identifier"}</td>
                            <td className="px-4 py-2 font-mono text-[10px] text-slate-455">{sale.payment_method}</td>
                            <td className="px-4 py-3 text-right font-mono">{formatCurrency(sale.total_amount)}</td>
                            <td className="px-4 py-3 text-center">
                              <StatusBadge status={sale.preorder_payment_status || "Unpaid"} className="justify-center" />
                            </td>
                            <td className="px-4 py-3 text-center">
                              <StatusBadge
                                status={sale.preorder_fulfillment_status || "Pending"}
                                label={sale.preorder_fulfillment_status || "Pending"}
                                className="justify-center"
                              />
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
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {Object.entries(calculatePaymentBreakdown()).map(([method, total]) => (
                  <div key={method} className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center animate-scale-up">
                    <span className="text-slate-400 text-[10px] uppercase font-bold">{method}</span>
                    <span className="text-sm font-black text-slate-805 block font-mono mt-1">{formatCurrency(total)}</span>
                  </div>
                ))}
              </div>
              {(calculatePaymentBreakdown().Mixed || 0) > 0 && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-800">
                  Mixed-tender sales remain unclassified until a per-tender split is recorded; they are not included in the reconciled digital total.
                </p>
              )}
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
                  <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Opening Float Balance</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    value={closeoutOpeningFloatInput}
                    onChange={(e) => setCloseoutOpeningFloatInput(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full h-12 border-2 border-slate-200 rounded-xl px-3 outline-none focus:border-primary font-bold bg-white text-slate-800"
                  />
                </div>
                <div>
                  <span className="text-xs text-slate-455 font-bold uppercase block mb-1">Recorded Cash Sales:</span>
                  <span className="text-sm font-black text-emerald-700 font-mono">{formatCurrency(closeoutRecordedCashSales)}</span>
                </div>
                <div>
                  <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Actual Physical Cash Count</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    required
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
                    value={closeoutCashExpenses}
                    onChange={(e) => setCloseoutCashExpenses(Number(e.target.value) || 0)}
                    className="w-full h-12 border-2 border-slate-200 rounded-xl px-3 outline-none focus:border-primary font-bold bg-white text-slate-800"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Cash Refunds</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={closeoutCashRefunds}
                    onChange={(e) => setCloseoutCashRefunds(Number(e.target.value) || 0)}
                    className="w-full h-12 border-2 border-slate-200 rounded-xl px-3 outline-none focus:border-primary font-bold bg-white text-slate-800"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">GCash Account Received</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={closeoutGcashSales}
                    onChange={(e) => setCloseoutGcashSales(Number(e.target.value) || 0)}
                    className="w-full h-12 border-2 border-blue-200 rounded-xl px-3 outline-none focus:border-blue-500 font-bold bg-blue-50/30 text-slate-800"
                  />
                  <span className="mt-1 block text-[10px] text-slate-400">POS recorded: {formatCurrency(closeoutEvent.payment_breakdown?.GCash || 0)}</span>
                </div>
                <div>
                  <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">BPI / Bank Transfer Received</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={closeoutBpiSales}
                    onChange={(e) => setCloseoutBpiSales(Number(e.target.value) || 0)}
                    className="w-full h-12 border-2 border-blue-200 rounded-xl px-3 outline-none focus:border-blue-500 font-bold bg-blue-50/30 text-slate-800"
                  />
                  <span className="mt-1 block text-[10px] text-slate-400">POS recorded: {formatCurrency(closeoutEvent.payment_breakdown?.["BPI / Bank Transfer"] || 0)}</span>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Expense Breakdown / Notes</label>
                  <textarea
                    placeholder="e.g., Space lease: ₱500, Gas: ₱200"
                    value={closeoutExpenseNotes}
                    onChange={(e) => setCloseoutExpenseNotes(e.target.value)}
                    rows={3}
                    className="w-full min-h-24 resize-y border-2 border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:border-primary font-bold bg-white text-slate-800"
                  />
                </div>
              </div>
              <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4">
                <span className="block text-[10px] font-black uppercase tracking-wider text-emerald-700">Calculated Ending Cashbox</span>
                <span className="mt-1 block font-mono text-2xl font-black text-emerald-900">{formatCurrency(closeoutEndingCashbox)}</span>
                <span className="mt-1 block text-[10px] font-bold text-emerald-700/80">
                  Opening float + recorded cash sales - cash expenses - cash refunds
                </span>
              </div>
            </div>

            {/* Food Waste Tracker Grid */}
            <div className="border border-slate-200 rounded-2xl p-5 bg-slate-50/50 space-y-4">
              <span className="text-xs text-slate-500 font-black uppercase tracking-wider block">Food Waste Tracker (Log damaged/spoiled items)</span>
              
              <div role="region" aria-label="Food waste closeout editor" tabIndex={0} className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-black uppercase tracking-wider text-[10px]">
                      <th scope="col" className="px-3 py-2.5 w-[35%]">Product Name</th>
                      <th scope="col" className="px-3 py-2.5 text-right w-[20%]">Booth Stock</th>
                      <th scope="col" className="px-3 py-2.5 text-center w-[20%]">Qty Wasted</th>
                      <th scope="col" className="px-3 py-2.5 w-[25%]">Waste Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                    {closeoutAllocations.map((alloc, idx) => (
                      <tr key={alloc.sku} className="hover:bg-slate-50/5">
                        <td className="px-3 py-2">
                          <ProductDisplay
                            sku={alloc.sku}
                            productName={alloc.product_name}
                            category={alloc.category || ""}
                            size={alloc.size}
                            variant="selector"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-600">{formatProductQuantity(alloc, alloc.quantity)}</td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            inputMode="numeric"
                            aria-label={`${alloc.product_name} quantity wasted`}
                            min={0}
                            max={alloc.quantity}
                            value={alloc.wasted_quantity === undefined ? "" : alloc.wasted_quantity}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => {
                              const raw = e.target.value;
                              const updated = [...closeoutAllocations];
                              if (raw === "") {
                                updated[idx].wasted_quantity = "";
                              } else {
                                const parsed = parseInt(raw, 10);
                                updated[idx].wasted_quantity = isNaN(parsed) ? "" : Math.min(alloc.quantity, Math.max(0, parsed));
                              }
                              setCloseoutAllocations(updated);
                            }}
                            onBlur={() => {
                              if (alloc.wasted_quantity === "" || alloc.wasted_quantity === undefined) {
                                const updated = [...closeoutAllocations];
                                updated[idx].wasted_quantity = 0;
                                setCloseoutAllocations(updated);
                              }
                            }}
                            className="quantity-input h-9 w-full rounded-lg border border-slate-300 px-2 text-center font-mono font-black"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            aria-label={`${alloc.product_name} waste reason`}
                            required={Number(alloc.wasted_quantity) > 0}
                            value={alloc.waste_reason || ""}
                            onChange={(e) => {
                              const updated = [...closeoutAllocations];
                              updated[idx].waste_reason = e.target.value;
                              setCloseoutAllocations(updated);
                            }}
                            className="h-9 w-full rounded-lg border border-slate-300 px-2 text-xs font-semibold bg-white"
                          >
                            <option value="">Select reason…</option>
                            <option value="Staff Consumed">Staff Consumed</option>
                            <option value="Damaged / Leaked">Damaged / Leaked</option>
                            <option value="Spoiled / Contaminated">Spoiled / Contaminated</option>
                            <option value="Unsold Leftovers">Unsold Leftovers</option>
                            <option value="Sample / Tasting">Sample / Tasting</option>
                          </select>
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

      {/* PRE-ORDER LOOKUP & FULFILLMENT MODAL */}
      {isPreorderLookupOpen && (
        <Modal
          isOpen={isPreorderLookupOpen}
          onClose={() => setIsPreorderLookupOpen(false)}
          title="Fulfill Customer Pre-Order"
          size="2xl"
        >
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              Search for customer pre-orders to load their items directly into the cashier cart for instant checkout.
            </p>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="Search by customer name or token reference..."
                value={preorderLookupQuery}
                onChange={async (e) => {
                  const q = e.target.value;
                  setPreorderLookupQuery(q);
                  try {
                    const res = await api.getPreorders({ q: q.trim() || undefined, page_size: 50 });
                    setPreorderLookupList(res.items || []);
                  } catch {
                    // fallback
                  }
                }}
                className="w-full py-2 border border-slate-300 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500 bg-slate-50"
                style={{ paddingLeft: "2.25rem", paddingRight: "1rem" }}
              />
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden max-h-80 overflow-y-auto divide-y divide-slate-100">
              {preorderLookupList.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-xs italic">
                  No pre-orders found.
                </div>
              ) : (
                preorderLookupList.map((item: any) => (
                  <div key={item.id} className="p-3 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-amber-50/50 transition-colors">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-amber-900 text-xs">{item.public_reference}</span>
                        <span className="font-bold text-slate-900 text-sm">{item.customer_name}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold">{item.status}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Fulfillment: {item.fulfillment_method} &bull; {item.total_units} items &bull; Total {formatCurrency(item.total_amount)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="primary"
                      className="bg-amber-800 hover:bg-amber-900 text-white text-xs shrink-0"
                      onClick={async () => {
                        try {
                          const detail = await api.getPreorderDetail(item.id);
                          const newCart: Record<string, number> = {};
                          detail.items.forEach((lineItem: any) => {
                            newCart[lineItem.sku] = lineItem.quantity;
                          });
                          setCart(newCart);
                          setIsPreorder(true);
                          setPreorderCustomerName(detail.customer_name);
                          if (detail.payment_status === "Paid") {
                            setPreorderPaymentStatus("Paid");
                            setPaymentMethod("Cash");
                          } else {
                            setPreorderPaymentStatus("Unpaid");
                            setPaymentMethod("Pautang");
                          }
                          setIsPreorderLookupOpen(false);
                          showToast(`Loaded pre-order #${detail.public_reference} for ${detail.customer_name} into cart!`, "success");
                        } catch (err: any) {
                          showToast(err.message || "Failed to load pre-order items", "error");
                        }
                      }}
                    >
                      Import to Cart
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
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

      {/* PACK & LOADOUT MANIFEST MODAL */}
      <MarketPackManifestModal
        isOpen={isManifestOpen}
        onClose={() => setIsManifestOpen(false)}
        event={manifestEvent}
      />

    </div>
  );
}
