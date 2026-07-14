"use client";

import React, { useEffect, useState } from "react";
import { api, type ConsignmentDeliveryOut, type ConsignmentPartnerOut, type ProductSKUOut } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { getProductBusinessCategory, BUSINESS_CATEGORIES, getSizeBadgeStyle } from "@/lib/utils";
import { 
  Truck, 
  RefreshCw, 
  Calendar, 
  FileText, 
  Plus, 
  CheckCircle2, 
  AlertCircle,
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
import { Badge } from "@/components/ui/Badge";
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

    api.getProducts().then(res => {
      const filtered = (res || []).filter((p) => p.sku !== "SKU" && p.is_active !== false);
      setProducts(filtered);
      if (filtered.length > 0) {
        setNewSku(filtered[0].sku);
      }
    }).catch(console.error);

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
    } catch (err: any) {
      alert(`Error deactivating store: ${err.message}`);
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
                    onClick={() => setSelectedPartnerId(p.id)}
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
                      onClick={() => setSelectedPartnerId(p.id)}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <Card className="border-l-8 border-l-primary bg-primary-light/5 shadow-xs rounded-2xl">
                  <CardContent className="p-6 flex justify-between items-center">
                    <div>
                      <span className="text-xs text-slate-500 font-extrabold uppercase tracking-wider block">Unsettled Consignment Value</span>
                      <p className="text-xs text-slate-400 font-semibold mt-0.5 leading-normal">Estimated wholesale value of jar products currently on shelves.</p>
                    </div>
                    <span className="text-2xl font-black font-mono text-primary ml-4 shrink-0">₱{totalUnsettledValue.toLocaleString()}</span>
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
                            } catch (err: any) {
                              alert(`Error reactivating store: ${err.message}`);
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
                        const todayDateObj = new Date("2026-07-11"); // Constant today reference
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
                                  <strong className="text-slate-850 text-base font-mono">{delivery.delivery_date}</strong>
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
                                        onClick={() => handleSaveDR(delivery.id)}
                                        className="p-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl cursor-pointer"
                                      >
                                        <Check size={14} className="stroke-[3]" />
                                      </button>
                                      <button
                                        onClick={() => setEditingDrId(null)}
                                        className="p-2 bg-slate-200 hover:bg-slate-300 text-slate-600 rounded-xl cursor-pointer"
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
                                        onClick={() => {
                                          setEditingDrId(delivery.id);
                                          setEditingDrVal(delivery.dr_number || "");
                                        }}
                                        className="text-[#885625] hover:text-[#cfaf45] p-1.5 hover:bg-slate-100 rounded-lg transition-all cursor-pointer opacity-80 md:opacity-0 group-hover:opacity-100"
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
                                    <strong className="text-slate-800 font-mono">{predictedSettlementDate}</strong>
                                  </span>
                                )}
                              </div>
                              
                              <div className="flex items-center gap-3">
                                {isOverdue && (
                                  <Badge variant="danger" className="text-xs py-1.5 px-3 rounded-full animate-pulse bg-rose-150 border-rose-300 text-rose-800 font-black uppercase">
                                    ⚠️ OVERDUE (Outstanding {diffDays} Days)
                                  </Badge>
                                )}

                                {delivery.is_paid ? (
                                  <Badge variant="success" className="text-sm py-1.5 px-3 rounded-full">
                                    <CheckCircle2 size={14} className="mr-1.5 inline" /> Paid on {delivery.payment_date}
                                  </Badge>
                                ) : (
                                  <div className="flex items-center gap-3">
                                    <Badge variant="danger" className="text-sm py-1.5 px-3 rounded-full">
                                      <AlertCircle size={14} className="mr-1.5 inline" /> Unsettled
                                    </Badge>
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
                            <div className="hidden md:block overflow-x-auto border border-slate-200 rounded-2xl">
                              <table className="w-full text-left border-collapse text-sm text-slate-700">
                                <thead>
                                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-black uppercase tracking-wider text-xs">
                                    <th className="px-6 py-4">Finished SKU</th>
                                    <th className="px-6 py-4 text-right">Store SRP</th>
                                    <th className="px-6 py-4 text-right">Wholesale Price</th>
                                    <th className="px-6 py-4 text-center">QTY Dispatched</th>
                                    <th className="px-6 py-4 text-center">Units Sold</th>
                                    <th className="px-6 py-4 text-center">Returns</th>
                                    <th className="px-6 py-4 text-right">Sell-thru</th>
                                    <th className="px-6 py-4 text-right">Net Sales</th>
                                    <th className="px-6 py-4 text-right">Save</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                                  {delivery.items.map((item) => {
                                    const isEditing = editSold[item.id] !== undefined || editPulled[item.id] !== undefined;
                                    const soldVal = editSold[item.id] !== undefined ? editSold[item.id] : item.units_sold;
                                    const pulledVal = editPulled[item.id] !== undefined ? editPulled[item.id] : item.qty_pulled_out;

                                    return (
                                      <tr key={item.id} className="hover:bg-slate-50/20 transition-colors">
                                        <td className="px-6 py-4">
                                          <span className="font-black text-slate-850 block text-base">{item.product_name}</span>
                                          <div className="flex items-center gap-1.5 mt-1">
                                            <span className={`text-[10px] font-black font-mono px-1.5 py-0.5 rounded ${getSizeBadgeStyle(item.size)}`}>{item.size}</span>
                                            <span className="font-mono text-xs text-slate-400">{item.sku}</span>
                                          </div>
                                        </td>
                                        <td className="px-6 py-4 text-right font-mono text-slate-500">₱{item.store_price_snapshot.toFixed(2)}</td>
                                        <td className="px-6 py-4 text-right font-mono font-bold text-slate-850">₱{item.reseller_price_snapshot.toFixed(2)}</td>
                                        <td className="px-6 py-4 text-center font-black text-slate-900 text-base">{item.qty_delivered}</td>
                                        
                                        {/* SOLD INPUT */}
                                        <td className="px-6 py-4 text-center">
                                          {delivery.is_paid ? (
                                            <span className="font-bold text-slate-800">{item.units_sold}</span>
                                          ) : (
                                            <input
                                              type="number"
                                              min={0}
                                              max={item.qty_delivered}
                                              value={soldVal}
                                              onChange={(e) => setEditSold({ ...editSold, [item.id]: e.target.value })}
                                              className="w-20 h-10 text-center font-mono font-black text-base border-2 border-slate-200 rounded-xl bg-white focus:border-primary focus:ring-1 focus:ring-primary/20"
                                            />
                                          )}
                                        </td>

                                        {/* RETURNS INPUT */}
                                        <td className="px-6 py-4 text-center">
                                          {delivery.is_paid ? (
                                            <span className="font-bold text-slate-400">{item.qty_pulled_out}</span>
                                          ) : (
                                            <input
                                              type="number"
                                              min={0}
                                              max={item.qty_delivered}
                                              value={pulledVal}
                                              onChange={(e) => setEditPulled({ ...editPulled, [item.id]: e.target.value })}
                                              className="w-20 h-10 text-center font-mono font-black text-base border-2 border-slate-200 rounded-xl bg-white focus:border-primary focus:ring-1 focus:ring-primary/20"
                                            />
                                          )}
                                        </td>

                                        <td className="px-6 py-4 text-right font-bold">
                                          <span className={item.efficiency_rate >= 70 ? "text-emerald-600" : "text-amber-600"}>
                                            {item.efficiency_rate}%
                                          </span>
                                        </td>
                                        <td className="px-6 py-4 text-right font-mono font-black text-slate-900 text-base">₱{item.sales_revenue.toFixed(2)}</td>
                                        
                                        <td className="px-6 py-4 text-right">
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
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>

                            {/* Mobile View Card items */}
                            <div className="md:hidden space-y-4">
                              {delivery.items.map((item) => {
                                const isEditing = editSold[item.id] !== undefined || editPulled[item.id] !== undefined;
                                const soldVal = editSold[item.id] !== undefined ? editSold[item.id] : item.units_sold;
                                const pulledVal = editPulled[item.id] !== undefined ? editPulled[item.id] : item.qty_pulled_out;

                                return (
                                  <div key={item.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
                                    <div className="flex justify-between items-start">
                                      <div>
                                        <span className="font-black text-slate-800 block text-base">{item.product_name}</span>
                                        <div className="flex items-center gap-1.5 mt-1">
                                          <span className={`text-[10px] font-black font-mono px-1.5 py-0.5 rounded ${getSizeBadgeStyle(item.size)}`}>{item.size}</span>
                                          <span className="font-mono text-xs text-slate-400">{item.sku}</span>
                                        </div>
                                      </div>
                                      <div className="text-right">
                                        <span className="text-base font-black text-slate-900 font-mono">₱{item.sales_revenue.toFixed(2)}</span>
                                        <span className="text-xs text-slate-400 block mt-0.5 font-bold">Revenue</span>
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-3 gap-3 border-y border-slate-200 py-3 text-xs text-slate-555 font-bold">
                                      <div>
                                        <span className="text-slate-450 block text-[10px] uppercase tracking-wider mb-1">Wholesale Price</span>
                                        <span className="font-mono text-slate-700 text-sm">₱{item.reseller_price_snapshot.toFixed(2)}</span>
                                      </div>
                                      <div className="text-center">
                                        <span className="text-slate-455 block text-[10px] uppercase tracking-wider mb-1">Dispatched</span>
                                        <span className="text-slate-850 font-black text-sm">{item.qty_delivered} jars</span>
                                      </div>
                                      <div className="text-right">
                                        <span className="text-slate-450 block text-[10px] uppercase tracking-wider mb-1">Sell-Thru</span>
                                        <span className="text-primary font-black text-sm">{item.efficiency_rate}%</span>
                                      </div>
                                    </div>

                                    <div className="flex items-center justify-between gap-4">
                                      {delivery.is_paid ? (
                                        <div className="flex justify-between w-full text-xs text-slate-500 font-bold">
                                          <span>Sold: <strong className="text-slate-850 text-sm">{item.units_sold} jars</strong></span>
                                          <span>Returns: <strong className="text-slate-850 text-sm">{item.qty_pulled_out} jars</strong></span>
                                        </div>
                                      ) : (
                                        <>
                                          <div className="flex items-center gap-4 flex-1 min-w-0">
                                            <div className="flex-1">
                                              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">Sold</label>
                                              <input
                                                type="number"
                                                min={0}
                                                max={item.qty_delivered}
                                                value={soldVal}
                                                onChange={(e) => setEditSold({ ...editSold, [item.id]: e.target.value })}
                                                className="w-full h-10 text-center font-mono font-black text-base bg-white border border-slate-200 rounded-xl"
                                              />
                                            </div>
                                            <div className="flex-1">
                                              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">Returns</label>
                                              <input
                                                type="number"
                                                min={0}
                                                max={item.qty_delivered}
                                                value={pulledVal}
                                                onChange={(e) => setEditPulled({ ...editPulled, [item.id]: e.target.value })}
                                                className="w-full h-10 text-center font-mono font-black text-base bg-white border border-slate-200 rounded-xl"
                                              />
                                            </div>
                                          </div>

                                          {isEditing && (
                                            <Button
                                              onClick={() => handleUpdateItem(item.id)}
                                              disabled={updatingItemId === item.id}
                                              size="sm"
                                              variant="primary"
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
          size="md"
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

            {/* Select Sku tool card */}
            <div className="border border-slate-200 rounded-2xl p-5 bg-slate-50/50 space-y-4">
              <span className="text-xs text-slate-500 font-black uppercase tracking-wider block">Select finished goods SKU:</span>
              <div className="flex flex-col sm:flex-row gap-3">
                <select
                  value={newSku}
                  onChange={(e) => setNewSku(e.target.value)}
                  className="flex-1 text-sm font-black bg-white"
                >
                  {BUSINESS_CATEGORIES.map(cat => {
                    const catProds = products.filter(p => getProductBusinessCategory(p) === cat);
                    if (catProds.length === 0) return null;
                    return (
                      <optgroup key={cat} label={cat}>
                        {catProds.map(p => (
                          <option key={p.sku} value={p.sku}>
                            {p.sku} - {p.product_name} ({p.warehouse_stock} available in main warehouse)
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    value={newQty}
                    onChange={(e) => setNewQty(parseInt(e.target.value) || 1)}
                    className="w-24 h-12 text-center font-mono font-black text-sm bg-white"
                  />
                  <Button
                    size="md"
                    variant="outline"
                    className="h-12 border-slate-300 hover:bg-slate-100 px-4 font-black"
                    onClick={handleAddDeliveryItem}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </div>

            {/* Added list */}
            {deliveryItems.length > 0 ? (
              <div className="space-y-4 animate-fade-in">
                <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-3xs">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-slate-455 font-bold uppercase tracking-wider text-[11px]">
                        <th className="px-5 py-3">Finished SKU</th>
                        <th className="px-5 py-3 text-right">Quantity</th>
                        <th className="px-5 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-bold text-slate-750">
                      {deliveryItems.map((item, idx) => {
                        const matchedProd = products.find(p => p.sku === item.sku);
                        return (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="px-5 py-3 font-mono">
                              <span className="text-slate-800 font-black block text-sm">{matchedProd ? matchedProd.product_name : item.sku}</span>
                              <span className="text-xs text-slate-400 font-mono font-bold">{item.sku}</span>
                            </td>
                            <td className="px-5 py-3 text-right font-mono font-black text-[#885625] text-base">{item.target_qty} jars</td>
                            <td className="px-5 py-3 text-right">
                              <button
                                onClick={() => handleRemoveDeliveryItem(idx)}
                                className="text-slate-400 hover:text-danger p-2 hover:bg-slate-100 rounded-xl cursor-pointer transition-colors"
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
                  >
                    Confirm & Deduct Warehouse Stock
                  </Button>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-slate-400 italic">
                Your dispatch checklist is empty. Use recommendations above to prefill or select a SKU manually.
              </div>
            )}
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
