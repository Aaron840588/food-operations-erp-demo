/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { api, PreorderSummary, PreorderDetail } from "@/lib/api";
import { formatCurrency, formatDate, getSizeLabel } from "@/lib/utils";
import { 
  Clock3, 
  Search, 
  Copy, 
  Check, 
  RefreshCw, 
  Eye, 
  Calendar, 
  Phone, 
  Mail, 
  MapPin, 
  Plus,
  Minus,
  Trash2,
  Settings2,
  Edit3,
  Save,
  SlidersHorizontal,
  X
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";

const STATUS_TABS = [
  { label: "All Orders", value: "" },
  { label: "Pending", value: "Pending" },
  { label: "Confirmed", value: "Confirmed" },
  { label: "Preparing", value: "Preparing" },
  { label: "Ready", value: "Ready" },
  { label: "Fulfilled", value: "Fulfilled" },
  { label: "Cancelled", value: "Cancelled" },
];

export default function PreordersPage() {
  const { showToast } = useToast();
  const [preorders, setPreorders] = useState<PreorderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/preorder/default` : "/preorder/default";
  const [selectedPreorder, setSelectedPreorder] = useState<PreorderDetail | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Item Editing state
  const [isEditingItems, setIsEditingItems] = useState(false);
  const [editableItems, setEditableItems] = useState<Array<{ sku: string; product_name: string; size: string; quantity: number; unit_price: number }>>([]);
  const [availableProducts, setAvailableProducts] = useState<Array<{ sku: string; product_name: string; size: string; retail_price: number }>>([]);
  const [selectedSkuToAdd, setSelectedSkuToAdd] = useState("");
  const [savingItems, setSavingItems] = useState(false);

  // Form Product Customization state
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const [formDisabledSkus, setFormDisabledSkus] = useState<string[]>([]);
  const [formProductSearch, setFormProductSearch] = useState("");
  const [savingFormProducts, setSavingFormProducts] = useState(false);
  const [defaultFormId, setDefaultFormId] = useState<number | null>(null);

  const fetchPreorders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPreorders({
        status: activeTab || undefined,
        q: searchQuery.trim() || undefined,
        page_size: 100,
      });
      setPreorders(res.items || []);
    } catch (err: any) {
      showToast(err.message || "Failed to load pre-orders", "error");
    } finally {
      setLoading(false);
    }
  }, [activeTab, searchQuery, showToast]);

  const loadAvailableProducts = useCallback(async () => {
    try {
      const catalog = await api.getPublicPreorderCatalog("default");
      if (catalog && catalog.products) {
        setAvailableProducts(catalog.products.map(p => ({
          sku: p.sku,
          product_name: p.product_name,
          size: p.size,
          retail_price: Number(p.retail_price)
        })));
      }
    } catch {
      // Fallback
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      setLoading(true);
      try {
        const [res] = await Promise.all([
          api.getPreorders({
            status: activeTab || undefined,
            q: searchQuery.trim() || undefined,
            page_size: 100,
          }),
          loadAvailableProducts()
        ]);
        // Resolve default form ID for product customization
        try {
          const forms = await api.getPreorderForms();
          const enabledForm = forms.find((f: any) => f.is_enabled) || forms[0];
          if (enabledForm) setDefaultFormId(enabledForm.id);
        } catch { /* non-critical */ }
        if (!ignore) {
          setPreorders(res.items || []);
        }
      } catch (err: any) {
        if (!ignore) {
          showToast(err.message || "Failed to load pre-orders", "error");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      ignore = true;
    };
  }, [activeTab, searchQuery, showToast, loadAvailableProducts]);

  const handleCopyLink = () => {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl);
    setCopiedLink(true);
    showToast("Customer Pre-Order link copied to clipboard!", "success");
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleViewDetail = async (id: number) => {
    try {
      const detail = await api.getPreorderDetail(id);
      setSelectedPreorder(detail);
      setIsEditingItems(false);
      setEditableItems(detail.items.map(item => ({
        sku: item.sku,
        product_name: (item as any).product_name || (item as any).product_name_snapshot || "Item",
        size: (item as any).size || (item as any).size_snapshot || "",
        quantity: item.quantity,
        unit_price: Number((item as any).unit_price ?? (item as any).unit_price_snapshot ?? 0)
      })));
    } catch (err: any) {
      showToast(err.message || "Failed to fetch order details", "error");
    }
  };

  const handleUpdateStatus = async (id: number, newStatus: string) => {
    setActionLoadingId(id);
    try {
      await api.updatePreorderStatus(id, newStatus);
      showToast(`Order updated to ${newStatus}`, "success");
      if (selectedPreorder && selectedPreorder.id === id) {
        setSelectedPreorder(prev => prev ? { ...prev, status: newStatus as any } : null);
      }
      fetchPreorders();
    } catch (err: any) {
      showToast(err.message || "Failed to update status", "error");
    } finally {
      setActionLoadingId(null);
    }
  };

  // Item Editing Helpers
  const handleItemQuantityChange = (sku: string, delta: number) => {
    setEditableItems(prev => prev.map(item => {
      if (item.sku === sku) {
        const nextQty = Math.max(1, item.quantity + delta);
        return { ...item, quantity: nextQty };
      }
      return item;
    }));
  };

  const handleRemoveItem = (sku: string) => {
    setEditableItems(prev => prev.filter(item => item.sku !== sku));
  };

  const handleAddProductToOrder = () => {
    if (!selectedSkuToAdd) return;
    const target = availableProducts.find(p => p.sku === selectedSkuToAdd);
    if (!target) return;

    setEditableItems(prev => {
      const exists = prev.find(i => i.sku === target.sku);
      if (exists) {
        return prev.map(i => i.sku === target.sku ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, {
        sku: target.sku,
        product_name: target.product_name,
        size: target.size,
        quantity: 1,
        unit_price: target.retail_price
      }];
    });
    setSelectedSkuToAdd("");
  };

  const handleSaveItems = async () => {
    if (!selectedPreorder) return;
    if (editableItems.length === 0) {
      showToast("Order must contain at least 1 product.", "error");
      return;
    }

    setSavingItems(true);
    try {
      const updated = await api.updatePreorderItems(
        selectedPreorder.id,
        editableItems.map(i => ({ sku: i.sku, quantity: i.quantity }))
      );
      setSelectedPreorder(updated);
      setIsEditingItems(false);
      showToast("Pre-order products updated successfully!", "success");
      fetchPreorders();
    } catch (err: any) {
      showToast(err.message || "Failed to update pre-order items", "error");
    } finally {
      setSavingItems(false);
    }
  };

  // Form Product Customization Helpers
  const handleOpenFormProductManager = async () => {
    setManageModalOpen(true);
    if (!defaultFormId) return;
    try {
      const disabled = await api.getFormDisabledSkus(defaultFormId);
      setFormDisabledSkus(disabled || []);
    } catch {
      setFormDisabledSkus([]);
    }
  };

  const handleToggleSku = async (sku: string) => {
    if (!defaultFormId) return;
    const nextDisabled = formDisabledSkus.includes(sku)
      ? formDisabledSkus.filter(s => s !== sku)
      : [...formDisabledSkus, sku];
    setFormDisabledSkus(nextDisabled);
    try {
      setSavingFormProducts(true);
      await api.updateFormDisabledSkus(defaultFormId, nextDisabled);
      showToast(
        nextDisabled.includes(sku) 
          ? `Disabled ${sku} on Customer Pre-Order Form` 
          : `Enabled ${sku} on Customer Pre-Order Form`,
        "success"
      );
    } catch (err: any) {
      showToast(err.message || "Failed to update form products", "error");
    } finally {
      setSavingFormProducts(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Pending":
        return <Badge variant="warning" className="px-2.5 py-1 text-xs">Pending</Badge>;
      case "Confirmed":
        return <Badge variant="info" className="px-2.5 py-1 text-xs">Confirmed</Badge>;
      case "Preparing":
        return <Badge variant="info" className="px-2.5 py-1 text-xs">Preparing</Badge>;
      case "Ready":
        return <Badge variant="success" className="px-2.5 py-1 text-xs">Ready for Pickup</Badge>;
      case "Fulfilled":
        return <Badge variant="success" className="px-2.5 py-1 text-xs bg-emerald-700 text-white">Fulfilled</Badge>;
      case "Cancelled":
        return <Badge variant="danger" className="px-2.5 py-1 text-xs">Cancelled</Badge>;
      default:
        return <Badge variant="neutral" className="px-2.5 py-1 text-xs">{status}</Badge>;
    }
  };

  const calculatedEditTotal = editableItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-amber-950 flex items-center gap-3">
            <Clock3 className="w-8 h-8 text-amber-700" />
            Customer Pre-Orders
          </h1>
          <p className="text-sm text-stone-600 mt-1">
            Manage advance pickup and delivery pre-orders from retail customers.
          </p>
        </div>
        <Button variant="secondary" onClick={fetchPreorders} disabled={loading} className="self-start sm:self-auto">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh Orders
        </Button>
      </div>

      {/* Shareable Public Preorder Banner */}
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/80 rounded-2xl p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <h3 className="font-semibold text-amber-950 flex items-center gap-2 text-base">
              <SlidersHorizontal className="w-4 h-4 text-amber-700" />
              Public Customer Pre-Order Form
            </h3>
            <p className="text-xs sm:text-sm text-amber-900/80">
              Share this link with customers to collect advance pre-orders.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              readOnly
              value={publicUrl}
              className="bg-white border border-amber-300 rounded-xl px-3 py-2 text-xs sm:text-sm text-stone-700 font-mono flex-1 sm:w-72 focus:outline-none"
            />
            <Button variant="primary" onClick={handleCopyLink} className="shrink-0 bg-amber-700 hover:bg-amber-800 text-white">
              {copiedLink ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
              {copiedLink ? "Copied!" : "Copy Link"}
            </Button>
            <Button variant="secondary" onClick={handleOpenFormProductManager} className="shrink-0 border-amber-300 text-amber-900 hover:bg-amber-100/60">
              <Settings2 className="w-4 h-4 mr-1.5 text-amber-700" />
              Customize Products
            </Button>
          </div>
        </div>
      </div>

      {/* Controls & Filters */}
      <div className="bg-white border border-stone-200/80 rounded-2xl p-4 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
            {STATUS_TABS.map(tab => (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === tab.value
                    ? "bg-amber-800 text-white shadow-sm"
                    : "bg-stone-100 text-stone-700 hover:bg-stone-200/80"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3 top-3 text-stone-400" />
            <input
              type="text"
              placeholder="Search reference, customer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full py-2 border border-stone-300 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none bg-stone-50/50"
              style={{ paddingLeft: "2.25rem", paddingRight: "1rem" }}
            />
          </div>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-12 text-center text-stone-500">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-700" />
            Loading customer pre-orders...
          </div>
        ) : preorders.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Clock3 className="w-10 h-10 text-stone-300 mx-auto" />
            <h3 className="font-semibold text-stone-800 text-base">No Pre-Orders Found</h3>
            <p className="text-stone-500 text-sm max-w-md mx-auto">
              Share your pre-order link with customers to start receiving advance orders.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-stone-700">
              <thead className="bg-stone-100/80 text-stone-800 text-xs font-semibold uppercase tracking-wider border-b border-stone-200">
                <tr>
                  <th className="py-3 px-4">Ref Token</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Requested Date</th>
                  <th className="py-3 px-4">Method</th>
                  <th className="py-3 px-4 text-center">Items</th>
                  <th className="py-3 px-4 text-right">Total Amount</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {preorders.map((order) => (
                  <tr key={order.id} className="hover:bg-amber-50/30 transition-colors">
                    <td className="py-3.5 px-4 font-mono text-xs font-bold text-amber-950">
                      {order.public_reference}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-stone-900">{order.customer_name}</div>
                      <div className="text-stone-500 text-xs">{order.contact_phone || order.contact_email || "No contact"}</div>
                    </td>
                    <td className="py-3.5 px-4 text-xs">
                      <div>{formatDate(order.requested_fulfillment_date)}</div>
                      <div className="text-stone-500">{order.requested_fulfillment_time}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        order.fulfillment_method === "Pickup" ? "bg-amber-100 text-amber-900" : "bg-blue-100 text-blue-900"
                      }`}>
                        {order.fulfillment_method}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center font-semibold text-xs">
                      {order.total_units} jars
                    </td>
                    <td className="py-3.5 px-4 text-right font-bold text-amber-900 whitespace-nowrap text-xs">
                      {formatCurrency(order.total_amount)}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {getStatusBadge(order.status)}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <button
                        onClick={() => handleViewDetail(order.id)}
                        className="p-1.5 text-stone-600 hover:text-amber-800 hover:bg-stone-100 rounded-lg transition-colors"
                        title="View Order Details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pre-order Details & Edit Items Modal */}
      {selectedPreorder && (
        <Modal
          isOpen={!!selectedPreorder}
          onClose={() => {
            setSelectedPreorder(null);
            setIsEditingItems(false);
          }}
          title={`Pre-Order #${selectedPreorder.public_reference}`}
        >
          <div className="space-y-5 text-sm">
            <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-stone-900 text-base">{selectedPreorder.customer_name}</span>
                {getStatusBadge(selectedPreorder.status)}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-stone-600 pt-2 border-t border-stone-200">
                <div className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 text-stone-400" />
                  {selectedPreorder.contact_phone || "No phone provided"}
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-stone-400" />
                  {selectedPreorder.contact_email || "No email provided"}
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-stone-400" />
                  {formatDate(selectedPreorder.requested_fulfillment_date)} ({selectedPreorder.requested_fulfillment_time})
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-stone-400" />
                  {selectedPreorder.fulfillment_method}: {selectedPreorder.delivery_address || "Pick up at station"}
                </div>
              </div>
              {selectedPreorder.notes && (
                <div className="mt-2 text-xs text-amber-900 bg-amber-50 p-2 rounded-lg border border-amber-200">
                  <span className="font-semibold">Notes:</span> {selectedPreorder.notes}
                </div>
              )}
            </div>

            {/* Line Items & Add/Remove Product Controls */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-stone-800">Order Items</h4>
                {selectedPreorder.status !== "Cancelled" && selectedPreorder.status !== "Fulfilled" && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!isEditingItems) {
                        setEditableItems(selectedPreorder.items.map(item => ({
                          sku: item.sku,
                          product_name: (item as any).product_name || (item as any).product_name_snapshot || "Item",
                          size: (item as any).size || (item as any).size_snapshot || "",
                          quantity: item.quantity,
                          unit_price: Number((item as any).unit_price ?? (item as any).unit_price_snapshot ?? 0)
                        })));
                      }
                      setIsEditingItems(!isEditingItems);
                    }}
                    className="text-xs font-bold text-amber-800 hover:text-amber-900 flex items-center gap-1 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg"
                  >
                    {isEditingItems ? <X size={13} /> : <Edit3 size={13} />}
                    {isEditingItems ? "Cancel Editing" : "Add / Edit Products"}
                  </button>
                )}
              </div>

              {!isEditingItems ? (
                /* Read-Only View */
                <div className="border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-200">
                  {selectedPreorder.items.map(item => {
                    const name = (item as any).product_name || (item as any).product_name_snapshot || "Item";
                    const size = (item as any).size || (item as any).size_snapshot || "";
                    const unitPrice = (item as any).unit_price ?? (item as any).unit_price_snapshot ?? 0;
                    const lineTotal = (item as any).line_total ?? (item as any).line_total_snapshot ?? 0;
                    return (
                      <div key={item.id} className="p-3 flex items-center justify-between text-xs sm:text-sm bg-white">
                        <div>
                          <div className="font-medium text-stone-900">{name} {size ? `(${getSizeLabel(size, item.sku)})` : ""}</div>
                          <div className="text-stone-500 text-xs">{item.quantity} x {formatCurrency(unitPrice)}</div>
                        </div>
                        <div className="font-bold text-amber-900">{formatCurrency(lineTotal)}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Interactive Edit Mode */
                <div className="space-y-3">
                  <div className="border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-200 bg-stone-50/50">
                    {editableItems.map(item => (
                      <div key={item.sku} className="p-3 flex items-center justify-between text-xs sm:text-sm bg-white gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-stone-900 truncate">{item.product_name}</div>
                          <div className="text-stone-500 text-xs font-mono">{item.sku} · {formatCurrency(item.unit_price)}</div>
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="flex items-center border border-stone-300 rounded-lg overflow-hidden bg-stone-100">
                            <button
                              type="button"
                              onClick={() => handleItemQuantityChange(item.sku, -1)}
                              className="p-1.5 hover:bg-stone-200 text-stone-700"
                            >
                              <Minus size={13} />
                            </button>
                            <span className="px-2.5 text-xs font-bold font-mono">{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => handleItemQuantityChange(item.sku, 1)}
                              className="p-1.5 hover:bg-stone-200 text-stone-700"
                            >
                              <Plus size={13} />
                            </button>
                          </div>

                          <span className="font-mono font-bold text-amber-900 min-w-[65px] text-right">
                            {formatCurrency(item.quantity * item.unit_price)}
                          </span>

                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.sku)}
                            className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg"
                            title="Remove product"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Add Product Dropdown */}
                  <div className="flex items-center gap-2 pt-1">
                    <select
                      value={selectedSkuToAdd}
                      onChange={(e) => setSelectedSkuToAdd(e.target.value)}
                      className="flex-1 border border-stone-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    >
                      <option value="">-- Add product to pre-order --</option>
                      {availableProducts.map(p => (
                        <option key={p.sku} value={p.sku}>
                          {p.product_name} ({getSizeLabel(p.size, p.sku)}) — {formatCurrency(p.retail_price)}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="secondary"
                      onClick={handleAddProductToOrder}
                      disabled={!selectedSkuToAdd}
                      className="text-xs px-3 py-2 shrink-0 bg-amber-100 text-amber-900 hover:bg-amber-200 border-amber-300"
                    >
                      <Plus size={14} className="mr-1" /> Add
                    </Button>
                  </div>

                  {/* Save Changes Controls */}
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-stone-500">Updated Total: <strong className="text-amber-950 font-mono text-sm">{formatCurrency(calculatedEditTotal)}</strong></span>
                    <Button
                      variant="primary"
                      onClick={handleSaveItems}
                      disabled={savingItems}
                      className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs px-3 py-1.5"
                    >
                      {savingItems ? <RefreshCw className="animate-spin w-3.5 h-3.5 mr-1" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                      Save Order Items
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Total Footer */}
            <div className="flex items-center justify-between border-t border-stone-200 pt-3">
              <span className="font-bold text-stone-800 text-base">Total Amount:</span>
              <span className="font-bold text-amber-900 text-xl">{formatCurrency(selectedPreorder.total_amount)}</span>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-stone-200">
              {selectedPreorder.status !== "Cancelled" && selectedPreorder.status !== "Fulfilled" && (
                <Button
                  variant="danger"
                  onClick={() => handleUpdateStatus(selectedPreorder.id, "Cancelled")}
                  disabled={actionLoadingId === selectedPreorder.id}
                >
                  Cancel Order
                </Button>
              )}
              {selectedPreorder.status === "Pending" && (
                <Button
                  variant="primary"
                  onClick={() => handleUpdateStatus(selectedPreorder.id, "Confirmed")}
                  disabled={actionLoadingId === selectedPreorder.id}
                >
                  Confirm Order
                </Button>
              )}
              {selectedPreorder.status === "Confirmed" && (
                <Button
                  variant="primary"
                  onClick={() => handleUpdateStatus(selectedPreorder.id, "Preparing")}
                  disabled={actionLoadingId === selectedPreorder.id}
                >
                  Mark Preparing
                </Button>
              )}
              {selectedPreorder.status === "Preparing" && (
                <Button
                  variant="primary"
                  onClick={() => handleUpdateStatus(selectedPreorder.id, "Ready")}
                  disabled={actionLoadingId === selectedPreorder.id}
                >
                  Mark Ready for Pickup
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Form Product Customization Modal */}
      {manageModalOpen && (
        <Modal
          isOpen={manageModalOpen}
          onClose={() => setManageModalOpen(false)}
          title="Customize Products on Pre-Order Form Link"
        >
          <div className="space-y-4 text-sm">
            <p className="text-xs text-stone-600">
              Toggle products ON or OFF. Disabled products will be hidden from customers visiting your public pre-order link.
            </p>

            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-stone-400" />
              <input
                type="text"
                placeholder="Search products to enable or disable..."
                value={formProductSearch}
                onChange={(e) => setFormProductSearch(e.target.value)}
                className="w-full py-2 border border-stone-300 rounded-xl text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none bg-stone-50/50"
                style={{ paddingLeft: "2.25rem", paddingRight: "1rem" }}
              />
            </div>

            <div className="max-h-[380px] overflow-y-auto border border-stone-200 rounded-xl divide-y divide-stone-200 p-1">
              {availableProducts
                .filter(p => !formProductSearch || p.product_name.toLowerCase().includes(formProductSearch.toLowerCase()) || p.sku.toLowerCase().includes(formProductSearch.toLowerCase()))
                .map(product => {
                  const isDisabled = formDisabledSkus.includes(product.sku);
                  return (
                    <div key={product.sku} className="p-3 flex items-center justify-between hover:bg-stone-50 transition-colors">
                      <div>
                        <div className="font-semibold text-stone-900">{product.product_name}</div>
                        <div className="text-xs text-stone-500 font-mono">{product.sku} · {getSizeLabel(product.size, product.sku)} · {formatCurrency(product.retail_price)}</div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleToggleSku(product.sku)}
                        disabled={savingFormProducts}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          isDisabled
                            ? "bg-stone-100 text-stone-500 border border-stone-300 hover:bg-stone-200"
                            : "bg-amber-800 text-white shadow-xs hover:bg-amber-900"
                        }`}
                      >
                        {isDisabled ? "Hidden from Form" : "Visible on Form"}
                      </button>
                    </div>
                  );
                })}
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={() => setManageModalOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
