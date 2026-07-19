"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
 

import React, { useEffect, useState } from "react";
import { api, type ConsignmentDeliveryOut, type ConsignmentPartnerOut, type ProductSKUOut } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import {
  formatCurrency,
  formatDate,
  formatProductQuantity,
  getProductBusinessCategory,
  isCurrentLineupProduct,
} from "@/lib/utils";
import { InventoryChecklist } from "@/components/inventory/InventoryChecklist";
import { ProductDisplay } from "@/components/ui/ProductDisplay";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  DataTableScroll,
  TableCell,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
} from "@/components/ui/DataTable";

import { 
  Truck, 
  RefreshCw, 
  Calendar, 
  FileText, 
  Plus, 
  Save,
  Trash2,
  Sparkles,
  Edit3,
  Check,
  X,
  Clock
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Modal, PromptModal, ConfirmationModal } from "@/components/ui/Modal";

export default function ConsignmentPage() {
  const [partners, setPartners] = useState<ConsignmentPartnerOut[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | null>(null);
  const [deliveries, setDeliveries] = useState<ConsignmentDeliveryOut[]>([]);
  const [products, setProducts] = useState<ProductSKUOut[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [userRole, setUserRole] = useState("staff");
  const LIMIT = 10;
  
  // Loading states
  const [loading, setLoading] = useState(true);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [updatingItemId, setUpdatingItemId] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  
  // Forms and Modals state
  const [showNewDelivery, setShowNewDelivery] = useState(false);
  const [isSettleOpen, setIsSettleOpen] = useState(false);
  const [settlingDeliveryId, setSettlingDeliveryId] = useState<number | null>(null);
  const [settleLoading, setSettleLoading] = useState(false);
  const [isConfirmDeactivateOpen, setIsConfirmDeactivateOpen] = useState(false);

  // New Delivery Form state
  const [drNumber, setDrNumber] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [deliveryItems, setDeliveryItems] = useState<{ sku: string; target_qty: number; outlet: string }[]>([]);
  const [newSku, setNewSku] = useState("");
  const [newQty, setNewQty] = useState(12); // prefilled with 12 as a smart default box size

  // Inline edits
  const [editSold, setEditSold] = useState<{ [key: number]: string }>({});
  const [editPulled, setEditPulled] = useState<{ [key: number]: string }>({});
  const [editingDrId, setEditingDrId] = useState<number | null>(null);
  const [editingDrVal, setEditingDrVal] = useState("");

  const handleSaveDR = async (deliveryId: number) => {
    try {
      await api.updateDeliveryDR(deliveryId, editingDrVal);
      setDeliveries(prev => 
        prev.map(d => d.id === deliveryId ? { ...d, dr_number: editingDrVal } : d)
      );
      setEditingDrId(null);
    } catch (err: unknown) {
      alert(`Error saving DR number: ${getErrorMessage(err)}`);
    }
  };

  const fetchPartners = async (isBackground = false) => {
    if (!isBackground) {
      setLoading(true);
    }
    try {
      const res = await api.getPartners();
      setPartners(res);
      if (res.length > 0 && selectedPartnerId === null) {
        setSelectedPartnerId(res[0].id);
      }
      localStorage.setItem("hh_cache_consignment_partners", JSON.stringify(res));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDeliveries = async (partnerId: number, currentOffset: number, replace = false) => {
    setDeliveriesLoading(true);
    try {
      const res = await api.getPartnerDeliveries(partnerId, LIMIT, currentOffset);
      if (replace) {
        setDeliveries(res);
      } else {
        setDeliveries(prev => [...prev, ...res]);
      }
      if (res.length < LIMIT) {
        setHasMore(false);
      } else {
        setHasMore(true);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDeliveriesLoading(false);
    }
  };

  const refreshDeliveries = async (partnerId: number) => {
    setOffset(0);
    await fetchDeliveries(partnerId, 0, true);
  };

  const handleLoadMore = () => {
    if (selectedPartnerId !== null && !deliveriesLoading && hasMore) {
      const nextOffset = offset + LIMIT;
      setOffset(nextOffset);
      fetchDeliveries(selectedPartnerId, nextOffset, false);
    }
  };

  const fetchProducts = () => {
    api.getProducts().then(res => {
      const filtered = (res || []).filter((p) => p.sku !== "SKU" && p.is_active !== false && isCurrentLineupProduct(p));
      setProducts(filtered);
      if (filtered.length > 0) {
        setNewSku(filtered[0].sku);
      }
    }).catch(console.error);
  };

  useEffect(() => {

    try {
      const cached = localStorage.getItem("hh_cache_consignment_partners");
      if (cached) {
        const parsed = JSON.parse(cached);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPartners(parsed);
        if (parsed.length > 0 && selectedPartnerId === null) {
          setSelectedPartnerId(parsed[0].id);
        }
        setLoading(false);
        fetchPartners(true);
      } else {
        fetchPartners(false);
      }
    } catch {
      fetchPartners(false);
    }

    fetchProducts();

    const timer = window.setTimeout(() => {
      setUserRole(localStorage.getItem("hh_user_role") || "staff");
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedPartnerId !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      refreshDeliveries(selectedPartnerId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPartnerId]);

  const handleUpdateItem = async (itemId: number) => {
    setUpdatingItemId(itemId);
    try {
      const sold = parseInt(editSold[itemId]);
      const pulled = parseInt(editPulled[itemId]);
      
      const payload: { units_sold?: number; qty_pulled_out?: number } = {};
      if (!isNaN(sold)) payload.units_sold = sold;
      if (!isNaN(pulled)) payload.qty_pulled_out = pulled;

      await api.updateDeliveryItem(itemId, payload);
      
      if (selectedPartnerId !== null) {
        await refreshDeliveries(selectedPartnerId);
      }
      
      // Clear inputs
      setEditSold(prev => {
        const copy = { ...prev }; delete copy[itemId]; return copy;
      });
      setEditPulled(prev => {
        const copy = { ...prev }; delete copy[itemId]; return copy;
      });
    } catch (err: unknown) {
      alert(`Error updating logs: ${getErrorMessage(err)}`);
    } finally {
      setUpdatingItemId(null);
    }
  };

  const handleOpenSettle = (deliveryId: number) => {
    setSettlingDeliveryId(deliveryId);
    setIsSettleOpen(true);
  };

  const handleSettleConfirm = async (paymentDate: string) => {
    if (!settlingDeliveryId) return;
    setSettleLoading(true);
    try {
      await api.payDelivery(settlingDeliveryId, paymentDate);
      setIsSettleOpen(false);
      setSettlingDeliveryId(null);
      if (selectedPartnerId !== null) {
        refreshDeliveries(selectedPartnerId);
      }
      fetchPartners(); // Refresh stats
    } catch (err: unknown) {
      alert(`Error settling payment: ${getErrorMessage(err)}`);
    } finally {
      setSettleLoading(false);
    }
  };

  const handleAddDeliveryItem = () => {
    if (!newSku) return;
    const existing = deliveryItems.findIndex(i => i.sku === newSku);
    if (existing !== -1) {
      const updated = [...deliveryItems];
      updated[existing].target_qty += newQty;
      setDeliveryItems(updated);
    } else {
      setDeliveryItems([...deliveryItems, { sku: newSku, target_qty: newQty, outlet: "Consignment" }]);
    }
  };

  const handleRemoveDeliveryItem = (idx: number) => {
    const updated = [...deliveryItems];
    updated.splice(idx, 1);
    setDeliveryItems(updated);
  };

  const handleSubmitDelivery = async () => {
    if (!selectedPartnerId || deliveryItems.length === 0) return;
    try {
      await api.recordConsignmentDelivery({
        partner_id: selectedPartnerId,
        delivery_date: deliveryDate,
        dr_number: drNumber || null,
        items: deliveryItems
      });
      setShowNewDelivery(false);
      setDrNumber("");
      setDeliveryItems([]);
      fetchDeliveries(selectedPartnerId, 0, true);
      setOffset(0);
      fetchPartners();
      fetchProducts();

    } catch (err: unknown) {
      alert(`Error logging delivery receipt: ${getErrorMessage(err)}`);
    }
  };

  const handleDeactivatePartner = async () => {
    if (!activePartner) return;
    setActionLoading(true);
    try {
      await api.updatePartner(activePartner.id, {
        name: activePartner.name,
        discount_rate: activePartner.discount_rate || 0.10,
        collection_frequency: activePartner.collection_frequency || "Weekly",
        minimum_order_amount: activePartner.minimum_order_amount !== undefined && activePartner.minimum_order_amount !== null ? activePartner.minimum_order_amount : 1500.00,
        is_active: false
      });
      alert("Store successfully deactivated.");
      fetchPartners();
      setIsConfirmDeactivateOpen(false);
    } catch (err) {
      alert(`Error deactivating store: ${getErrorMessage(err)}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Smart Suggestion Logic
  const activePartner = partners.find(p => p.id === selectedPartnerId);

  const handleApplySmartSuggestions = () => {
    if (!activePartner || products.length === 0) return;
    
    // Auto fill recommended products based on category sell-thru efficiency
    const isHighEfficiency = (activePartner.average_efficiency_rate ?? 0) > 70;
    
    // Sort products by stock to ensure we recommend what is actually available in the main warehouse
    const sortedProducts = [...products]
      .filter(p => (p.warehouse_stock ?? 0) > 10)
      .slice(0, 3); // pick top 3 available items

    const recommendedItems = sortedProducts.map(p => {
      // Suggest more if store has high sell-thru efficiency, otherwise safe quantity of 12 (1 box)
      const targetQty = isHighEfficiency ? 24 : 12;
      return {
        sku: p.sku,
        target_qty: targetQty,
        outlet: "Consignment"
      };
    });

    setDeliveryItems(recommendedItems);
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] w-full flex flex-col items-center justify-center text-slate-500 gap-4">
        <RefreshCw className="animate-spin text-primary" size={48} />
        <span className="text-sm font-heading font-extrabold tracking-wider uppercase">Loading Retail Partners...</span>
      </div>
    );
  }

  // Compute B2B aggregate details
  const totalUnsettledValue = deliveries
    .filter(d => !d.is_paid)
    .reduce((sum, d) => {
      const deliveryTotal = d.items.reduce((itemSum, item) => {
        return itemSum + (item.qty_delivered * item.reseller_price_snapshot);
      }, 0);
      return sum + deliveryTotal;
    }, 0);

  const unsettledCount = deliveries.filter(d => !d.is_paid).length;

  return (
    <div className="flex flex-col gap-6 pb-16">
      
      {/* Friendly Guide Header Banner */}
      <div className="bg-[#fcf8f2] border border-[#ece5da] rounded-2xl p-5 sm:p-6 flex items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary/10 text-primary rounded-2xl shrink-0">
            <Truck size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-heading font-bold text-slate-900 leading-tight">Consignment operations</h2>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              Track and log dispatches, sold units, and returns for retail store consignments (e.g. AA Mart, OTOP, etc.).
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        
        {/* 1. PARTNERS LIST SIDEBAR (300px width on desktop) */}
        <div className="w-full lg:w-80 lg:shrink-0 bg-white border border-slate-200 rounded-3xl p-6 shadow-sm self-stretch flex flex-col">
          <h3 className="font-heading font-black text-xs uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
            Select Retail Partner Store
          </h3>
          <div className="space-y-4 flex-1 overflow-y-auto">
            {/* Active Partners */}
            <div className="space-y-2">
              <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider block mb-1">Active Stores</span>
              {partners.filter(p => p.is_active !== false).map(p => {
                const isSelected = selectedPartnerId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPartnerId(p.id)}
                    aria-pressed={isSelected}
                    className={`w-full text-left px-4 py-3.5 rounded-2xl text-sm font-heading font-bold flex flex-col justify-between transition-all relative border-2 cursor-pointer ${
                      isSelected 
                        ? "bg-[#885625]/5 border-[#885625] text-[#2d1f0e] shadow-3xs" 
                        : "border-transparent text-slate-555 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <span className="font-black text-sm text-slate-800">{p.name}</span>
                    <div className="grid grid-cols-2 gap-2 w-full mt-2 pt-2 border-t border-dashed border-slate-200/50 text-[9px] text-slate-500 uppercase tracking-wider font-bold">
                      <div>Sell-thru: <strong className="text-emerald-600 block text-[10px] mt-0.5">{p.average_efficiency_rate}%</strong></div>
                      <div>Waste: <strong className="text-rose-600 block text-[10px] mt-0.5">{p.average_waste_percentage}%</strong></div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Inactive Partners */}
            {partners.some(p => p.is_active === false) && (
              <div className="space-y-2 pt-3 border-t border-slate-100">
                <span className="text-[10px] text-slate-450 font-extrabold uppercase tracking-wider block mb-1">Inactive Stores</span>
                {partners.filter(p => p.is_active === false).map(p => {
                  const isSelected = selectedPartnerId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedPartnerId(p.id)}
                      aria-pressed={isSelected}
                      className={`w-full text-left px-4 py-3.5 rounded-2xl text-sm font-heading font-bold flex flex-col justify-between transition-all relative border-2 cursor-pointer opacity-75 ${
                        isSelected 
                          ? "bg-slate-100 border-slate-350 text-slate-800 shadow-3xs" 
                          : "border-transparent text-slate-455 hover:bg-slate-50 hover:text-slate-800"
                      }`}
                    >
                      <span className="font-black text-sm text-slate-700 line-through">{p.name}</span>
                      <div className="grid grid-cols-2 gap-2 w-full mt-2 pt-2 border-t border-dashed border-slate-200/50 text-[9px] text-slate-400 uppercase tracking-wider font-bold">
                        <div>Sell-thru: <span className="block mt-0.5">{p.average_efficiency_rate}%</span></div>
                        <div>Waste: <span className="block mt-0.5">{p.average_waste_percentage}%</span></div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 2. DELIVERIES AND LOGS AREA */}
        <div className="flex-1 min-w-0 space-y-6">
          {activePartner && (
            <div className="space-y-6">
              
              {/* Active partner highlights / KPI cards */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <Card className="border-l-8 border-l-primary bg-primary-light/5 shadow-xs rounded-2xl">
                  <CardContent className="p-6 flex justify-between items-center">
                    <div>
                      <span className="text-xs text-slate-500 font-extrabold uppercase tracking-wider block">Unsettled Consignment Value</span>
                      <p className="text-xs text-slate-400 font-semibold mt-0.5 leading-normal">Estimated wholesale value of jar products currently on shelves.</p>
                    </div>
                    <span className="text-2xl font-black font-mono text-primary ml-4 shrink-0">{formatCurrency(totalUnsettledValue)}</span>
                  </CardContent>
                </Card>

                <Card className="border-l-8 border-l-accent bg-accent-light/5 shadow-xs rounded-2xl">
                  <CardContent className="p-6 flex justify-between items-center">
                    <div>
                      <span className="text-xs text-slate-500 font-extrabold uppercase tracking-wider block">Pending Collections</span>
                      <p className="text-xs text-slate-400 font-semibold mt-0.5 leading-normal">Number of completed dispatches awaiting payout settlements.</p>
                    </div>
                    <span className="text-2xl font-black font-mono text-slate-800 ml-4 shrink-0">{unsettledCount} runs</span>
                  </CardContent>
                </Card>
              </div>

              {/* Deliveries Ledger Card */}
              <Card className="rounded-3xl shadow-sm border-slate-200 overflow-hidden">
                <CardHeader className="p-6 md:p-8 bg-slate-50/50 border-b border-slate-100 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                  <div>
                    <CardTitle className="text-lg md:text-xl font-heading font-black text-slate-800">Historical Shipments to {activePartner.name}</CardTitle>
                    <CardDescription className="text-sm mt-1 text-slate-500">
                      Consignment rate: <strong>{activePartner.discount_rate * 100}% Off SRP</strong> | Minimum Order: <strong>₱{activePartner.minimum_order_amount}</strong>
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    {/* Owner toggle active controls */}
                    {userRole === "owner" && (
                      activePartner.is_active !== false ? (
                        <Button
                          onClick={() => setIsConfirmDeactivateOpen(true)}
                          variant="outline"
                          size="lg"
                          className="h-12 border-rose-300 text-rose-700 hover:bg-rose-50 font-bold"
                        >
                          Deactivate Partner
                        </Button>
                      ) : (
                        <Button
                          onClick={async () => {
                            try {
                              await api.updatePartner(activePartner.id, {
                                name: activePartner.name,
                                discount_rate: activePartner.discount_rate || 0.10,
                                collection_frequency: activePartner.collection_frequency || "Weekly",
                                minimum_order_amount: activePartner.minimum_order_amount !== undefined && activePartner.minimum_order_amount !== null ? activePartner.minimum_order_amount : 1500.00,
                                is_active: true
                              });
                              alert("Store successfully reactivated!");
                              fetchPartners();
                            } catch (err) {
                              alert(`Error reactivating store: ${getErrorMessage(err)}`);
                            }
                          }}
                          variant="primary"
                          size="lg"
                          className="h-12 font-bold bg-emerald-600 hover:bg-emerald-700 border-emerald-500"
                        >
                          Reactivate Partner
                        </Button>
                      )
                    )}

                    {activePartner.is_active !== false ? (
                      <Button
                        onClick={() => {
                          setDrNumber("");
                          setDeliveryItems([]);
                          setShowNewDelivery(true);
                        }}
                        variant="primary"
                        size="lg"
                        className="h-12 font-bold"
                        leftIcon={<Plus size={16} />}
                      >
                        Log New Shipment
                      </Button>
                    ) : (
                      userRole !== "owner" && (
                        <span className="text-xs font-black text-rose-600 bg-rose-50 border border-rose-250 py-2.5 px-4 rounded-xl">
                          ⚠️ Inactive Store — Shipments disabled
                        </span>
                      )
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {deliveriesLoading ? (
                    <div className="py-16 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="animate-spin text-primary" size={32} />
                      <span className="text-sm font-semibold">Loading deliveries... Please wait.</span>
                    </div>
                  ) : deliveries.length === 0 ? (
                    <div className="py-16 text-center text-sm text-slate-500 font-semibold italic">
                      No dispatches logged for this store yet.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200">
                      {deliveries.map((delivery) => {
                        // Intelligent settlement calculations:
                        const deliveryDateObj = new Date(delivery.delivery_date);
                        // Standard settlement cycle of 15 days
                        const predictedSettlementDate = new Date(deliveryDateObj.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                        
                        // Overdue check (if unpaid and past 15 days from delivery date)
                        const todayDateObj = new Date();
                        const timeDiff = todayDateObj.getTime() - deliveryDateObj.getTime();
                        const diffDays = Math.ceil(timeDiff / (1000 * 3600 * 24));
                        const isOverdue = !delivery.is_paid && diffDays > 15;

                        return (
                          <div key={delivery.id} className="p-6 md:p-8 space-y-6">
                            
                            {/* Delivery Run Header Row */}
                            <div className="flex flex-col xl:flex-row xl:justify-between xl:items-center gap-4 bg-slate-50 p-5 border border-slate-200 rounded-2xl shadow-3xs">
                              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-bold text-slate-650">
                                <span className="flex items-center gap-2">
                                  <Calendar size={18} className="text-[#885625] shrink-0" /> 
                                  <span>Delivery Date:</span>
                                  <strong className="text-slate-850 text-base font-mono">{formatDate(delivery.delivery_date)}</strong>
                                </span>
                                <span className="flex items-center gap-2">
                                  <FileText size={18} className="text-[#885625] shrink-0" /> 
                                  <span>DR Number:</span>
                                  {editingDrId === delivery.id ? (
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="text"
                                        value={editingDrVal}
                                        onChange={(e) => setEditingDrVal(e.target.value)}
                                        placeholder="Enter DR#"
                                        className="px-3 py-1 border border-primary/30 rounded-xl text-sm font-mono font-bold bg-white text-slate-800 w-32 h-10"
                                        autoFocus
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") handleSaveDR(delivery.id);
                                          if (e.key === "Escape") setEditingDrId(null);
                                        }}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => handleSaveDR(delivery.id)}
                                        aria-label="Save DR number"
                                        className="inline-flex h-10 w-10 items-center justify-center bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                                      >
                                        <Check size={14} className="stroke-[3]" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingDrId(null)}
                                        aria-label="Cancel editing DR number"
                                        className="inline-flex h-10 w-10 items-center justify-center bg-slate-200 hover:bg-slate-300 text-slate-600 rounded-xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                                      >
                                        <X size={14} className="stroke-[3]" />
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-2 group">
                                      <strong className="text-slate-850 text-base font-mono">
                                        {delivery.dr_number || "N/A"}
                                      </strong>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingDrId(delivery.id);
                                          setEditingDrVal(delivery.dr_number || "");
                                        }}
                                        aria-label="Edit DR number"
                                        className="inline-flex h-10 w-10 items-center justify-center text-[#885625] hover:text-[#cfaf45] hover:bg-slate-100 rounded-lg transition-all cursor-pointer opacity-80 md:opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                                        title="Edit DR Number"
                                      >
                                        <Edit3 size={14} />
                                      </button>
                                    </div>
                                  )}
                                </span>

                                {/* Predicted Settlement Date display */}
                                {!delivery.is_paid && (
                                  <span className="flex items-center gap-2 text-slate-500 font-semibold bg-slate-100 border border-slate-200 px-3 py-1 rounded-xl">
                                    <Clock size={14} className="text-primary shrink-0" />
                                    <span>Predicted Settlement: </span>
                                    <strong className="text-slate-800 font-mono">{formatDate(predictedSettlementDate)}</strong>
                                  </span>
                                )}
                              </div>
                              
                              <div className="flex flex-wrap items-center gap-3">
                                {isOverdue && (
                                  <StatusBadge
                                    status="overdue"
                                    label={`Overdue (${diffDays} days outstanding)`}
                                    className="rounded-full px-3 py-1.5 text-xs font-black uppercase motion-safe:animate-pulse"
                                  />
                                )}

                                {delivery.is_paid ? (
                                  <StatusBadge
                                    status="paid"
                                    label={`Paid on ${formatDate(delivery.payment_date)}`}
                                    className="rounded-full px-3 py-1.5 text-sm"
                                  />
                                ) : (
                                  <div className="flex flex-wrap items-center gap-3">
                                    <StatusBadge status="unpaid" label="Unsettled" className="rounded-full px-3 py-1.5 text-sm" />
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-10 py-1 px-4 border border-[#885625] text-primary hover:bg-[#885625]/5 text-xs font-bold"
                                      onClick={() => handleOpenSettle(delivery.id)}
                                    >
                                      Settle Run
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Desktop View Table (Larger and wider columns) */}
                            <DataTableScroll label={`Shipment items for ${delivery.dr_number || "draft DR"}`} className="hidden md:block overflow-x-auto border border-slate-200 rounded-2xl">
                              <table className="w-full min-w-[1120px] text-left border-collapse text-sm text-slate-700">
                                <thead>
                                  <TableHeaderRow>
                                    <TableHeaderCell>Finished SKU</TableHeaderCell>
                                    <TableHeaderCell align="right">Store SRP</TableHeaderCell>
                                    <TableHeaderCell align="right">Wholesale Price</TableHeaderCell>
                                    <TableHeaderCell align="center">Qty Dispatched</TableHeaderCell>
                                    <TableHeaderCell align="center">Units Sold</TableHeaderCell>
                                    <TableHeaderCell align="center">Returns</TableHeaderCell>
                                    <TableHeaderCell align="right">Sell-through</TableHeaderCell>
                                    <TableHeaderCell align="right">Net Sales</TableHeaderCell>
                                    <TableHeaderCell align="right">Save</TableHeaderCell>
                                  </TableHeaderRow>
                                </thead>
                                <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                                  {delivery.items.map((item) => {
                                    const isEditing = editSold[item.id] !== undefined || editPulled[item.id] !== undefined;
                                    const soldVal = editSold[item.id] !== undefined ? editSold[item.id] : item.units_sold;
                                    const pulledVal = editPulled[item.id] !== undefined ? editPulled[item.id] : item.qty_pulled_out;
                                    const matchedProduct = products.find((product) => product.sku === item.sku);
                                    const identity = {
                                      sku: item.sku,
                                      product_name: item.product_name,
                                      category: matchedProduct?.category || getProductBusinessCategory(item),
                                      size: item.size,
                                    };

                                    return (
                                      <TableRow key={item.id}>
                                        <TableCell>
                                          <ProductDisplay
                                            sku={identity.sku}
                                            productName={identity.product_name}
                                            category={identity.category}
                                            size={identity.size}
                                          />
                                        </TableCell>
                                        <TableCell align="right" className="font-mono text-slate-500">{formatCurrency(item.store_price_snapshot)}</TableCell>
                                        <TableCell align="right" className="font-mono font-bold text-slate-850">{formatCurrency(item.reseller_price_snapshot)}</TableCell>
                                        <TableCell align="center" className="font-black text-slate-900">{formatProductQuantity(identity, item.qty_delivered)}</TableCell>
                                        
                                        {/* SOLD INPUT */}
                                        <TableCell align="center">
                                          {delivery.is_paid ? (
                                            <span className="font-bold text-slate-800">{formatProductQuantity(identity, item.units_sold ?? 0)}</span>
                                          ) : (
                                            <input
                                              type="number"
                                              inputMode="numeric"
                                              aria-label={`Units sold for ${item.product_name}`}
                                              min={0}
                                              max={item.qty_delivered}
                                              value={soldVal}
                                              onChange={(e) => setEditSold({ ...editSold, [item.id]: e.target.value })}
                                              className="quantity-input w-24 h-10 text-center font-mono font-black text-base border-2 border-slate-200 rounded-xl bg-white focus:border-primary focus:ring-1 focus:ring-primary/20"
                                            />
                                          )}
                                        </TableCell>

                                        {/* RETURNS INPUT */}
                                        <TableCell align="center">
                                          {delivery.is_paid ? (
                                            <span className="font-bold text-slate-500">{formatProductQuantity(identity, item.qty_pulled_out ?? 0)}</span>
                                          ) : (
                                            <input
                                              type="number"
                                              inputMode="numeric"
                                              aria-label={`Returns for ${item.product_name}`}
                                              min={0}
                                              max={item.qty_delivered}
                                              value={pulledVal}
                                              onChange={(e) => setEditPulled({ ...editPulled, [item.id]: e.target.value })}
                                              className="quantity-input w-24 h-10 text-center font-mono font-black text-base border-2 border-slate-200 rounded-xl bg-white focus:border-primary focus:ring-1 focus:ring-primary/20"
                                            />
                                          )}
                                        </TableCell>

                                        <TableCell align="right" className="font-bold">
                                          <span className={item.efficiency_rate >= 70 ? "text-emerald-600" : "text-amber-600"}>
                                            {item.efficiency_rate}%
                                          </span>
                                        </TableCell>
                                        <TableCell align="right" className="font-mono font-black text-slate-900">{formatCurrency(item.sales_revenue)}</TableCell>
                                        
                                        <TableCell align="right">
                                          {isEditing && !delivery.is_paid && (
                                            <Button
                                              onClick={() => handleUpdateItem(item.id)}
                                              disabled={updatingItemId === item.id}
                                              size="sm"
                                              variant="primary"
                                              className="h-10 px-3 shrink-0 flex items-center justify-center rounded-xl"
                                            >
                                              {updatingItemId === item.id ? (
                                                <RefreshCw className="animate-spin h-4 w-4" />
                                              ) : (
                                                <span className="text-xs font-bold flex items-center gap-1.5"><Save size={14} /> Save</span>
                                              )}
                                            </Button>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </DataTableScroll>

                            {/* Mobile View Card items */}
                            <div className="md:hidden space-y-4">
                              {delivery.items.map((item) => {
                                const isEditing = editSold[item.id] !== undefined || editPulled[item.id] !== undefined;
                                const soldVal = editSold[item.id] !== undefined ? editSold[item.id] : item.units_sold;
                                const pulledVal = editPulled[item.id] !== undefined ? editPulled[item.id] : item.qty_pulled_out;
                                const matchedProduct = products.find((product) => product.sku === item.sku);
                                const identity = {
                                  sku: item.sku,
                                  product_name: item.product_name,
                                  category: matchedProduct?.category || getProductBusinessCategory(item),
                                  size: item.size,
                                };

                                return (
                                  <div key={item.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
                                    <div className="flex justify-between items-start gap-4">
                                      <div className="min-w-0 flex-1">
                                        <ProductDisplay
                                          sku={identity.sku}
                                          productName={identity.product_name}
                                          category={identity.category}
                                          size={identity.size}
                                          variant="compact"
                                        />
                                      </div>
                                      <div className="shrink-0 text-right">
                                        <span className="text-base font-black text-slate-900 font-mono">{formatCurrency(item.sales_revenue)}</span>
                                        <span className="text-xs text-slate-400 block mt-0.5 font-bold">Revenue</span>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-3 border-y border-slate-200 py-3 text-xs text-slate-555 font-bold">
                                      <div>
                                        <span className="text-slate-455 block text-[10px] uppercase tracking-wider mb-1">Wholesale Price</span>
                                        <span className="font-mono text-slate-700 text-sm">{formatCurrency(item.reseller_price_snapshot)}</span>
                                      </div>
                                      <div className="text-center">
                                        <span className="text-slate-455 block text-[10px] uppercase tracking-wider mb-1">Dispatched</span>
                                        <span className="text-slate-850 font-black text-sm">{formatProductQuantity(identity, item.qty_delivered)}</span>
                                      </div>
                                      <div className="text-right">
                                        <span className="text-slate-455 block text-[10px] uppercase tracking-wider mb-1">Sell-Thru</span>
                                        <span className="text-primary font-black text-sm">{item.efficiency_rate}%</span>
                                      </div>
                                    </div>

                                    <div className="flex items-center justify-between gap-4">
                                      {delivery.is_paid ? (
                                        <div className="flex justify-between w-full text-xs text-slate-500 font-bold">
                                          <span>Sold: <strong className="text-slate-850 text-sm">{formatProductQuantity(identity, item.units_sold ?? 0)}</strong></span>
                                          <span>Returns: <strong className="text-slate-850 text-sm">{formatProductQuantity(identity, item.qty_pulled_out ?? 0)}</strong></span>
                                        </div>
                                      ) : (
                                        <>
                                          <div className="flex items-center gap-4 flex-1 min-w-0">

                                            <div className="flex-1">
                                              <label htmlFor={`mobile-sold-${item.id}`} className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">Sold</label>
                                              <input
                                                id={`mobile-sold-${item.id}`}
                                                type="number"
                                                inputMode="numeric"
                                                min={0}
                                                max={item.qty_delivered}
                                                value={soldVal}
                                                onChange={(e) => setEditSold({ ...editSold, [item.id]: e.target.value })}
                                                className="quantity-input w-full min-w-20 h-10 text-center font-mono font-black text-base bg-white border border-slate-200 rounded-xl"
                                              />
                                            </div>
                                            <div className="flex-1">
                                              <label htmlFor={`mobile-returns-${item.id}`} className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">Returns</label>
                                              <input
                                                id={`mobile-returns-${item.id}`}
                                                type="number"
                                                inputMode="numeric"
                                                min={0}
                                                max={item.qty_delivered}
                                                value={pulledVal}
                                                onChange={(e) => setEditPulled({ ...editPulled, [item.id]: e.target.value })}
                                                className="quantity-input w-full min-w-20 h-10 text-center font-mono font-black text-base bg-white border border-slate-200 rounded-xl"
                                              />
                                            </div>
                                          </div>

                                          {isEditing && (
                                            <Button
                                              onClick={() => handleUpdateItem(item.id)}
                                              disabled={updatingItemId === item.id}
                                              size="sm"
                                              variant="primary"
                                              aria-label={`Save sold and return quantities for ${item.product_name}`}
                                              className="h-10 w-12 shrink-0 flex items-center justify-center p-0 rounded-xl"
                                            >
                                              {updatingItemId === item.id ? (
                                                <RefreshCw className="animate-spin h-4 w-4" />
                                              ) : (
                                                <Save size={16} />
                                              )}
                                            </Button>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                          </div>
                        );
                      })}
                    </div>
                  )}
                  {hasMore && deliveries.length > 0 && (
                    <div className="p-6 text-center border-t border-slate-200 bg-slate-50/50">
                      <Button
                        onClick={handleLoadMore}
                        disabled={deliveriesLoading}
                        variant="outline"
                        size="md"
                        className="bg-white hover:bg-slate-50 text-[#885625] font-black border border-slate-350"
                        leftIcon={deliveriesLoading ? <RefreshCw className="animate-spin" size={16} /> : <Clock size={16} />}
                      >
                        {deliveriesLoading ? "Loading..." : "Load More Deliveries"}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>

      </div>

      {/* 3. NEW DELIVERY DISPATCH MODAL */}
      {showNewDelivery && (
        <Modal
          isOpen={showNewDelivery}
          onClose={() => {
            setShowNewDelivery(false);
            setDrNumber("");
            setDeliveryItems([]);
          }}
          title="Log New Dispatch Shipment"
          size="3xl"
        >
          <div className="space-y-6 text-sm font-semibold text-slate-600">
            
            {/* Smart automation section */}
            <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-[#ece5da] rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="space-y-1">
                <span className="text-xs font-extrabold text-[#7b3e19] uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles size={16} className="animate-pulse" /> Smart Recommendations
                </span>
                <p className="text-xs text-slate-600 font-medium">
                  Click the helper button to automatically prefill recommended stock dispatches based on store sell-thru rate!
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="bg-white hover:bg-slate-50 border-[#885625] text-primary shrink-0 h-10 px-4 font-bold text-xs shadow-3xs"
                onClick={handleApplySmartSuggestions}
              >
                Apply Smart Recommendations
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-450 font-bold uppercase tracking-wider block mb-1.5">DR Number</label>
                <input
                  type="text"
                  placeholder="e.g. DR-1045"
                  value={drNumber}
                  onChange={(e) => setDrNumber(e.target.value)}
                  className="w-full text-base font-bold text-slate-800"
                />
              </div>
              <div>
                <label className="text-xs text-slate-450 font-bold uppercase tracking-wider block mb-1.5">Delivery Date</label>
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className="w-full text-base font-bold font-mono text-slate-800"
                />
              </div>
            </div>

            {/* Dispatch checklist using shared InventoryChecklist */}
            <div className="space-y-4">
              <span className="text-xs text-slate-500 font-black uppercase tracking-wider block">Reserve Inventory Allocation</span>
              <InventoryChecklist
                products={products as any[]}
                allocations={deliveryItems.map(item => ({
                  sku: item.sku,
                  quantity: item.target_qty
                }))}
                setAllocations={(newAllocs) => {
                  setDeliveryItems(newAllocs.map(alloc => ({
                    sku: alloc.sku,
                    target_qty: alloc.quantity,
                    outlet: "Consignment"
                  })));
                }}
              />
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 pt-6 mt-8">
              <Button
                variant="outline"
                size="lg"
                className="h-12 px-6"
                onClick={() => {
                  setShowNewDelivery(false);
                  setDeliveryItems([]);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="lg"
                className="h-12 px-6 font-bold"
                onClick={handleSubmitDelivery}
                disabled={deliveryItems.length === 0}
              >
                Confirm & Deduct Warehouse Stock
              </Button>
            </div>
          </div>
        </Modal>
      )}


      {/* 4. SETTLE CONSIGNMENT PAYMENT MODAL */}
      <PromptModal
        isOpen={isSettleOpen}
        onClose={() => {
          setIsSettleOpen(false);
          setSettlingDeliveryId(null);
        }}
        onConfirm={handleSettleConfirm}
        title="Settle Shipment Payment"
        message="Select the date retail partner completed the collections settlement transfer."
        defaultValue={new Date().toISOString().split("T")[0]}
        inputType="date"
        confirmLabel="Record Settled"
        isLoading={settleLoading}
      />

      {/* 5. DEACTIVATE PARTNER CONFIRMATION MODAL */}
      {isConfirmDeactivateOpen && activePartner && (
        <ConfirmationModal
          isOpen={isConfirmDeactivateOpen}
          onClose={() => setIsConfirmDeactivateOpen(false)}
          onConfirm={handleDeactivatePartner}
          title="Deactivate Consignment Partner"
          confirmLabel="Deactivate Store"
          cancelLabel="Cancel"
          type="warning"
          isLoading={actionLoading}
          message={`Are you sure you want to deactivate ${activePartner.name}? Past history will remain visible, but new dispatches will be disabled.`}
        />
      )}
    </div>
  );
}
