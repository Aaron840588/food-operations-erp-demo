"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import React, { useEffect, useRef, useState } from "react";
import { api, type DiscountTierOut, type ProductSKUOut } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import {
  getProductBusinessCategory,
  BUSINESS_CATEGORIES,
  getProductSizeGroup,
  isCurrentLineupProduct,
  formatCurrency,
  formatDate,
  formatProductQuantity,
} from "@/lib/utils";
import { ProductDisplay } from "@/components/ui/ProductDisplay";
import { NumericQuantityInput } from "@/components/ui/NumericQuantityInput";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  DataTableScroll,
  DataTableShell,
  TableCell,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
} from "@/components/ui/DataTable";
import { 
  Receipt, 
  Printer, 
  FileCheck,
  Search,
  Sparkles,
  Undo2,
  Trash2,
  FileText,
  RefreshCw
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";

export default function ResellersPage() {
  const { showToast } = useToast();
  const [products, setProducts] = useState<ProductSKUOut[]>([]);
  const [resellerName, setResellerName] = useState("");
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [quantities, setQuantities] = useState<{ [sku: string]: number }>({});
  const [notes, setNotes] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategoryTab, setSelectedCategoryTab] = useState("All");
  const [userRole, setUserRole] = useState("staff");

  // Discount Overrides states
  const [overrideDiscount, setOverrideDiscount] = useState(false);
  const [customDiscountPct, setCustomDiscountPct] = useState(10);

  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [lastInvoiceId, setLastInvoiceId] = useState<number | null>(null);
  const [tiers, setTiers] = useState<DiscountTierOut[]>([]);

  // Draft active detection
  const [hasDraft, setHasDraft] = useState(false);

  // New POS & History states
  const [resellerTab, setResellerTab] = useState<"pos" | "history">("pos");
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [printedInvoice, setPrintedInvoice] = useState<any | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const fetchOrderHistory = async () => {
    setOrdersLoading(true);
    try {
      const res = await api.getResellerOrders(50, 0);
      setOrders(res);
    } catch (err) {
      showToast(`Error loading order logs: ${getErrorMessage(err)}`, "error");
    } finally {
      setOrdersLoading(false);
    }
  };

  // Frequent customers database mock for quick clicking
  const frequentCustomers = [
    { name: "Ms. Anna Dolores", defaultNotes: "Regular pickup", category: "High Volume" },
    { name: "Sir Jerry Sy", defaultNotes: "Delivery via Pasig Courier", category: "Pasig Area" },
    { name: "Nene's Foodmart", defaultNotes: "Cash on delivery", category: "Standard" }
  ];

  useEffect(() => {
    api.getProducts().then(res => {
      const filtered = (res || []).filter((p) => p.sku !== "SKU" && p.is_active !== false && isCurrentLineupProduct(p));
      setProducts(filtered);
    }).catch(console.error);

    api.getDiscountTiers().then(res => {
      setTiers(res);
    }).catch(console.error);

    // Check for autosaved drafts
    try {
      const draftCart = localStorage.getItem("hh_pos_draft_cart");
      const draftName = localStorage.getItem("hh_pos_draft_name");
      
      if (draftCart && (JSON.parse(draftCart) && Object.keys(JSON.parse(draftCart)).length > 0) || draftName) {
        setHasDraft(true);
      }
    } catch (e) {
      console.warn("Draft restore check failed:", e);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setUserRole(localStorage.getItem("hh_user_role") || "staff");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Autosave POS progress to localStorage whenever things change
  useEffect(() => {
    if (Object.keys(quantities).length > 0 || resellerName || notes) {
      try {
        localStorage.setItem("hh_pos_draft_cart", JSON.stringify(quantities));
        localStorage.setItem("hh_pos_draft_name", resellerName);
        localStorage.setItem("hh_pos_draft_notes", notes);
      } catch {}
    }
  }, [quantities, resellerName, notes]);

  const handleQtyChange = (sku: string, val: number) => {
    const availableStock = Math.max(0, products.find((product) => product.sku === sku)?.warehouse_stock || 0);
    setQuantities(prev => ({
      ...prev,
      [sku]: Math.min(availableStock, Math.max(0, Math.floor(val)))
    }));
  };

  const handleRestoreDraft = () => {
    try {
      const draftCart = localStorage.getItem("hh_pos_draft_cart");
      const draftName = localStorage.getItem("hh_pos_draft_name");
      const draftNotes = localStorage.getItem("hh_pos_draft_notes");

      if (draftCart) setQuantities(JSON.parse(draftCart));
      if (draftName) setResellerName(draftName);
      if (draftNotes) setNotes(draftNotes);

      setHasDraft(false);
      showToast("Autosaved invoice draft successfully restored!", "success");
    } catch {
      showToast("Failed to restore draft.", "error");
    }
  };

  const handleDiscardDraft = () => {
    try {
      localStorage.removeItem("hh_pos_draft_cart");
      localStorage.removeItem("hh_pos_draft_name");
      localStorage.removeItem("hh_pos_draft_notes");
      setHasDraft(false);
      showToast("Draft discarded.", "info");
    } catch {}
  };

  const getActiveOrderItems = () => {
    return Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([sku, qty]) => ({
        sku,
        quantity: qty
      }));
  };

  const calculateSubtotal = () => {
    return Object.entries(quantities).reduce((sum, [sku, qty]) => {
      const p = products.find(prod => prod.sku === sku);
      const price = p ? p.retail_price : 0.0;
      return sum + (qty * price);
    }, 0.0);
  };

  const getTieredDiscount = (sub: number) => {
    if (overrideDiscount) {
      return customDiscountPct;
    }

    if (tiers.length === 0) {
      if (sub < 1300.0) return 10.0;
      else if (sub >= 1300.0 && sub <= 1999.99) return 12.0;
      else if (sub >= 2000.0 && sub <= 3499.99) return 15.0;
      else if (sub >= 3500.0 && sub <= 6999.99) return 18.0;
      else return 22.0;
    }

    let resolved = 0.0;
    for (const t of tiers) {
      if (sub >= t.min_subtotal) {
        resolved = t.discount_percentage;
      } else {
        break;
      }
    }
    return resolved;
  };

  const subtotal = calculateSubtotal();
  const discountPct = getTieredDiscount(subtotal);
  const discountAmt = subtotal * (discountPct / 100.0);
  const taxRate = 12.0;
  const discountedSubtotal = subtotal - discountAmt;
  const taxAmt = discountedSubtotal * (taxRate / (100.0 + taxRate));
  const grandTotal = discountedSubtotal;

  const activeOrderItems = getActiveOrderItems();
  const hasStockShortage = activeOrderItems.some((item) => {
    const product = products.find((candidate) => candidate.sku === item.sku);
    return !product || item.quantity > Math.max(0, product.warehouse_stock || 0);
  });

  // If activeOrderItems has elements, clear the printed invoice preview automatically to show the new draft
  useEffect(() => {
    if (activeOrderItems.length > 0) {
      setPrintedInvoice(null);
      setLastInvoiceId(null);
    }
  }, [activeOrderItems.length, setPrintedInvoice, setLastInvoiceId]);

  const handleSubmitOrder = async () => {
    if (submittingRef.current) return;
    if (!resellerName.trim() || activeOrderItems.length === 0) {
      showToast("Please enter a Reseller Customer Name and specify order quantities.", "warning");
      return;
    }
    if (hasStockShortage) {
      showToast("One or more order quantities exceed current warehouse stock. Refresh stock levels and review the cart.", "warning");
      return;
    }
    
    submittingRef.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const res = await api.createResellerOrder({
        reseller_name: resellerName,
        order_date: orderDate,
        items: activeOrderItems,
        notes: notes.trim() || null,
        tax_rate: taxRate,
        manual_discount_percentage: userRole === "owner" && overrideDiscount ? customDiscountPct : null,
      });
      
      setLastInvoiceId(res.id);
      
      // Map return details into printedInvoice state
      setPrintedInvoice({
        invoiceNumber: `HH-INVS-${res.id.toString().padStart(6, '0')}`,
        date: res.order_date,
        customerName: res.reseller_name,
        items: res.items.map((item: any) => {
          const p = products.find(prod => prod.sku === item.sku);
          return {
            sku: item.sku,
            product_name: p ? p.product_name : "Unknown Item",
            size: p ? p.size : "",
            quantity: item.quantity,
            price: item.price_snapshot,
            subtotal: item.quantity * item.price_snapshot
          };
        }),
        subtotal: res.subtotal,
        discountPct: res.discount_percentage,
        discountAmount: res.discount_amount,
        taxAmount: res.tax_amount,
        grandTotal: res.grand_total,
        isDraft: false
      });

      setMessage({
        type: "success",
        text: `Successfully logged reseller invoice. Payout total: ${formatCurrency(res.grand_total)}. Warehouse stock updated.`
      });

      // Clear draft states
      localStorage.removeItem("hh_pos_draft_cart");
      localStorage.removeItem("hh_pos_draft_name");
      localStorage.removeItem("hh_pos_draft_notes");
      setHasDraft(false);

      setQuantities({});
      setResellerName("");
      setNotes("");
      setOverrideDiscount(false);

      api.getProducts().then((res) => {
        setProducts((res || []).filter((product) => product.sku !== "SKU" && product.is_active !== false && isCurrentLineupProduct(product)));
      }).catch((error) => {
        console.warn("Invoice saved, but refreshed stock levels could not be loaded:", error);
      });
    } catch (err: unknown) {
      setMessage({
        type: "error",
        text: `Error saving wholesale order: ${getErrorMessage(err, "Failed")}`
      });
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDeleteOrder = async (orderId: number) => {
    if (!confirm("Are you sure you want to permanently delete this order? This will restore the items back to the main warehouse stock levels.")) return;
    try {
      await api.deleteResellerOrder(orderId);
      showToast("Order deleted successfully and stock restored.", "success");
      fetchOrderHistory();
      
      // Also refresh products stock list
      api.getProducts().then((res) => {
        setProducts((res || []).filter((product) => product.sku !== "SKU" && product.is_active !== false && isCurrentLineupProduct(product)));
      }).catch(console.error);
    } catch (err) {
      alert(`Error deleting order: ${getErrorMessage(err)}`);
    }
  };

  const handleSelectFrequentCustomer = (cust: { name: string; defaultNotes: string }) => {
    setResellerName(cust.name);
    setNotes(cust.defaultNotes);
    showToast(`Selected ${cust.name}! Form prefilled automatically.`, "success");
  };

  const handleApplyPopularTemplate = () => {
    if (products.length === 0) return;
    
    const starterQuantities: { [sku: string]: number } = {};
    products.slice(0, 3).forEach(p => {
      starterQuantities[p.sku] = 10; 
    });
    
    setQuantities(starterQuantities);
    showToast("Starter quantities prefilled (10 jars for top 3 products)!", "info");
  };

  return (
    <div className="space-y-6 flex flex-col pb-16 print:p-0 print:space-y-0">
      
      {/* Friendly POS Header Banner */}
      <div className="bg-[#fcf8f2] border border-[#ece5da] rounded-2xl p-5 sm:p-6 flex items-start sm:items-center gap-4 print:hidden">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary/10 text-primary rounded-2xl shrink-0">
            <Receipt size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-heading font-bold text-slate-900 leading-tight">Wholesale order</h2>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              Select products and quantities below to compile a wholesale reseller invoice with automatic stock deductions.
            </p>
          </div>
        </div>
      </div>

      {/* Tabs Menu */}
      <div className="scroll-fade-x flex gap-1 whitespace-nowrap bg-white/70 p-1.5 rounded-2xl border border-slate-200 print:hidden" role="tablist" aria-label="POS views">
        <button
          onClick={() => setResellerTab("pos")}
          role="tab" aria-selected={resellerTab === "pos"}
          className={`inline-flex min-h-11 items-center gap-2 px-4 py-2.5 rounded-xl transition-colors cursor-pointer text-sm font-bold ${
            resellerTab === "pos" 
              ? "bg-[#885625]/10 text-primary font-black animate-fade-in" 
              : "text-slate-500 hover:bg-slate-100"
          }`}
        >
          <Receipt size={16} /> New Wholesale Order
        </button>
        <button
          onClick={() => {
            setResellerTab("history");
            fetchOrderHistory();
          }}
          role="tab" aria-selected={resellerTab === "history"}
          className={`inline-flex min-h-11 items-center gap-2 px-4 py-2.5 rounded-xl transition-colors cursor-pointer text-sm font-bold ${
            resellerTab === "history" 
              ? "bg-[#885625]/10 text-primary font-black animate-fade-in" 
              : "text-slate-500 hover:bg-slate-100"
          }`}
        >
          <FileText size={16} /> Order History &amp; Logs
        </button>
      </div>

      {resellerTab === "pos" ? (
        <>


      {/* Unfinished invoice detection banner */}
      {hasDraft && (
        <div className="p-5 bg-[#885625]/10 border-2 border-[#885625] rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 print:hidden animate-fade-in shadow-xs">
          <div className="flex items-center gap-3">
            <Sparkles className="text-primary shrink-0 animate-bounce" size={24} />
            <div>
              <span className="text-base font-black text-slate-800 block">Unfinished Invoice Draft Detected</span>
              <p className="text-xs text-slate-600 font-semibold mt-1">Would you like to restore your last unfinished invoice draft?</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={handleDiscardDraft}
              variant="outline"
              size="sm"
              className="bg-white hover:bg-rose-50 hover:text-danger h-10 px-4 font-bold border-rose-200 text-slate-650"
              leftIcon={<Trash2 size={14} />}
            >
              Discard Draft
            </Button>
            <Button
              onClick={handleRestoreDraft}
              variant="primary"
              size="sm"
              className="h-10 px-4 font-bold"
              leftIcon={<Undo2 size={14} />}
            >
              Restore Draft
            </Button>
          </div>
        </div>
      )}

      {/* POS CONTAINER SPLIT - Hidden during printing */}
      <div className="grid grid-cols-1 min-[900px]:grid-cols-12 gap-4 2xl:gap-8 items-start print:hidden">
        
        {/* LEFT COLUMN: PRODUCT SELECTION & CARDS (7/12 width) */}
        <div className="order-2 min-[900px]:order-1 min-[900px]:col-span-7 space-y-4 2xl:space-y-6">
          
          {/* Header, Search & Filter Tab */}
          <div className="bg-white border border-slate-200 rounded-3xl p-4 2xl:p-6 shadow-sm space-y-4 2xl:space-y-5">
            <div className="flex flex-col 2xl:flex-row gap-4">
              
              {/* Large POS Search */}
              <div className="relative flex-1">
                <span className="absolute inset-y-0 left-4 flex items-center text-slate-400">
                  <Search size={20} />
                </span>
                <input
                  type="text"
                  aria-label="Search products by SKU or name"
                  placeholder="Search products by SKU or name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ paddingLeft: "3rem" }}
                  className="w-full pr-4 py-4 border border-slate-200 rounded-2xl text-base h-12 focus:ring-primary/20 bg-slate-50 font-semibold"
                />
              </div>

              {/* Category pills & out-of-stock toggle */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {["All", ...BUSINESS_CATEGORIES].map(cat => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategoryTab(cat)}
                      aria-pressed={selectedCategoryTab === cat}
                      className={`px-3 2xl:px-5 py-2 h-10 2xl:h-12 rounded-xl 2xl:rounded-2xl text-xs font-black uppercase tracking-wider transition-all border-2 cursor-pointer ${
                        selectedCategoryTab === cat
                          ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                          : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-xs font-bold text-slate-600 select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showOutOfStock}
                    onChange={(e) => setShowOutOfStock(e.target.checked)}
                    className="w-4 h-4 rounded accent-primary"
                  />
                  <span>Show out-of-stock items</span>
                </label>
              </div>

            </div>
          </div>


          {/* POS Product Cards Grid (Spacious layout, large fonts) */}
          <div className="space-y-8">
            {(() => {
              const filteredProducts = products.filter(p => {
                const matchesSearch = p.product_name.toLowerCase().includes(searchQuery.toLowerCase()) || p.sku.toLowerCase().includes(searchQuery.toLowerCase());
                const matchesCategory = selectedCategoryTab === "All" || getProductBusinessCategory(p) === selectedCategoryTab;
                const matchesStock = showOutOfStock || (p.warehouse_stock ?? 0) > 0;
                return matchesSearch && matchesCategory && matchesStock;
              });

              const groupedProducts = new Map<string, { title: string; order: number; items: ProductSKUOut[] }>();
              filteredProducts.forEach((product) => {
                const sizeGroup = getProductSizeGroup(product);
                const existing = groupedProducts.get(sizeGroup.key);
                if (existing) {
                  existing.items.push(product);
                } else {
                  groupedProducts.set(sizeGroup.key, {
                    title: sizeGroup.label,
                    order: sizeGroup.order,
                    items: [product],
                  });
                }
              });
              const groups = Array.from(groupedProducts.entries())
                .map(([key, group]) => ({ key, ...group }))
                .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

              if (groups.length === 0) {
                return (
                  <div className="py-12 text-center text-slate-455 font-semibold italic bg-white border border-slate-200 rounded-3xl">
                    No matching products found. Try a different search or filter.
                  </div>
                );
              }

              return groups.map((g) => (
                <div key={g.key} className="space-y-4">
                  <div className="flex items-center gap-3 border-b border-slate-200 pb-2">
                    <span className="text-sm font-heading font-black text-slate-800 tracking-wide uppercase">{g.title}</span>
                    <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-[#885625]/10 text-primary">{g.items.length} items</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 2xl:gap-6">
                    {g.items.map((p) => {
                      const qty = quantities[p.sku] || 0;
                      return (
                        <div 
                          key={p.sku} 
                          className={`p-4 2xl:p-6 bg-white border-2 rounded-3xl transition-all flex flex-col justify-between min-h-48 2xl:min-h-52 shadow-3xs ${
                            qty > 0 
                              ? "border-primary bg-primary-light/5 ring-4 ring-primary/5" 
                              : (p.warehouse_stock || 0) <= 0 
                                ? "border-slate-200 bg-slate-50/40 opacity-60" 
                                : "border-slate-150 hover:border-slate-350"
                          }`}
                        >
                          <div className="min-w-0">
                            <ProductDisplay
                              sku={p.sku}
                              productName={p.product_name}
                              category={p.category}
                              size={p.size}
                              isActive={p.is_active !== false}
                              showCategory={selectedCategoryTab === "All"}
                              className="items-start"
                            />
                            <span className="text-xs text-slate-505 block mt-2 font-bold">
                              Warehouse Stock: <strong className="font-mono text-slate-800">{formatProductQuantity(p, p.warehouse_stock || 0)}</strong> left
                            </span>
                          </div>

                          <div className="flex justify-between items-center mt-4 pt-3 border-t border-slate-100">
                            <span className="text-lg 2xl:text-xl font-black text-slate-800 font-mono">
                              {formatCurrency(p.retail_price)}
                            </span>

                            {qty === 0 ? (
                              <Button
                                size="md"
                                variant="outline"
                                onClick={() => handleQtyChange(p.sku, 1)}
                                disabled={(p.warehouse_stock || 0) <= 0}
                                className="font-black text-xs uppercase h-11 px-5 rounded-2xl border-[#885625] text-[#885625] hover:bg-[#885625] hover:text-white transition-all shadow-3xs"
                              >
                                {(p.warehouse_stock || 0) > 0 ? "+ Add to Order" : "Out of Stock"}
                              </Button>
                            ) : (
                              <NumericQuantityInput
                                value={qty}
                                onChange={(value) => handleQtyChange(p.sku, value)}
                                min={0}
                                max={Math.max(0, p.warehouse_stock || 0)}
                                label={`${p.product_name} order quantity`}
                                className="animate-scale-up"
                                inputClassName="w-24 min-w-24 text-base"
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ));
            })()}
          </div>

        </div>

        {/* RIGHT COLUMN: STICKY BILLING & CART SUMMARY (5/12 width) */}
        <div className="order-1 min-[900px]:order-2 min-[900px]:col-span-5 min-[900px]:sticky min-[900px]:top-4">
          <Card className="shadow-lg border-2 border-slate-200 rounded-3xl overflow-hidden min-[900px]:h-[calc(100dvh-6.5rem)] min-[900px]:grid min-[900px]:grid-rows-[auto_minmax(0,1fr)_auto]">
            <CardHeader className="shrink-0 p-4! 2xl:p-8! border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-2">
                <Receipt className="text-primary" size={20} />
                <CardTitle className="text-lg font-heading font-black">Invoice Details</CardTitle>
              </div>
              <CardDescription className="text-xs mt-1 text-slate-500">Configure your wholesale reseller billing here:</CardDescription>
            </CardHeader>
            <CardContent className="p-4! 2xl:p-8! space-y-4 min-[900px]:min-h-0 min-[900px]:overflow-y-auto min-[900px]:overscroll-contain">
              
              {/* Customer Info */}
              <div className="space-y-3">
                
                {/* Autocomplete active resellers list */}
                <div className="space-y-2">
                  <span className="text-xs text-slate-450 font-extrabold uppercase tracking-wider block">Frequent Customers</span>
                  <div className="flex flex-wrap gap-1.5 pb-2">
                    {frequentCustomers.map(cust => (
                      <button
                        key={cust.name}
                        onClick={() => handleSelectFrequentCustomer(cust)}
                        type="button"
                        className="px-3 py-1.5 bg-slate-100 hover:bg-[#885625]/10 hover:text-primary rounded-xl text-xs font-bold text-slate-600 border border-slate-200 cursor-pointer transition-colors"
                      >
                        {cust.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-450 font-bold uppercase tracking-wider block mb-1.5">Reseller Customer Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Ms. Anna Dolores"
                    value={resellerName}
                    onChange={(e) => setResellerName(e.target.value)}
                    className="w-full text-sm font-bold h-10 2xl:h-12 text-slate-800"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-450 font-bold uppercase tracking-wider block mb-1.5">Order Date</label>
                  <input
                    type="date"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                    className="w-full font-mono text-sm font-bold h-10 2xl:h-12 text-slate-800"
                  />
                </div>
              </div>

              {/* Shopping Cart Summary */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-455 font-extrabold uppercase tracking-wider">Shopping Cart Items</span>
                  {activeOrderItems.length === 0 && (
                    <button
                      type="button"
                      onClick={handleApplyPopularTemplate}
                      className="text-[#885625] hover:underline text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Sparkles size={14} className="animate-pulse" /> Prefill Starter Template
                    </button>
                  )}
                </div>
                
                <div className="border-2 border-slate-200 rounded-2xl bg-slate-50/50 max-h-40 2xl:max-h-52 overflow-y-auto p-3 space-y-2">
                  {activeOrderItems.length === 0 ? (
                    <div className="py-6 2xl:py-12 text-center text-slate-400 text-xs italic font-semibold leading-relaxed">
                      Your order cart is empty.<br />Select products from the selection on the left.
                    </div>
                  ) : (
                    activeOrderItems.map((item) => {
                      const p = products.find(prod => prod.sku === item.sku);
                      if (!p) return null;
                      return (
                        <div key={item.sku} className="flex flex-col gap-3 p-3 bg-white rounded-xl border border-slate-200 shadow-3xs text-sm sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <ProductDisplay
                              sku={p.sku}
                              productName={p.product_name}
                              category={p.category}
                              size={p.size}
                              isActive={p.is_active !== false}
                              variant="compact"
                              showIcon={false}
                            />
                            <span className="mt-1 block text-xs font-mono font-bold text-slate-500">{formatCurrency(p.retail_price)} each</span>
                          </div>
                          
                          <NumericQuantityInput
                            value={item.quantity}
                            onChange={(value) => handleQtyChange(p.sku, value)}
                            min={0}
                            max={Math.max(0, p.warehouse_stock || 0)}
                            label={`${p.product_name} cart quantity`}
                            className="shrink-0 self-end sm:self-auto"
                            inputClassName="w-16 min-w-16"
                          />
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Pricing overrides */}
              {userRole === "owner" && <div className="p-3 2xl:p-4 bg-slate-50 border-2 border-slate-200 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#7b3e19] font-black uppercase tracking-wider">Tiered Discounting</span>
                  <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-750">
                    <input
                      type="checkbox"
                      checked={overrideDiscount}
                      onChange={(e) => setOverrideDiscount(e.target.checked)}
                      className="rounded text-primary focus:ring-primary/20 h-4 w-4 bg-white"
                    />
                    Manual Override
                  </label>
                </div>

                {overrideDiscount ? (
                  <div className="flex items-center gap-3 animate-fade-in">
                    <span className="text-xs text-slate-550 font-bold">Custom Discount %:</span>
                    <input
                      type="number"
                      aria-label="Custom discount percentage"
                      min={0}
                      max={100}
                      step={0.5}
                      value={customDiscountPct}
                      onChange={(e) => setCustomDiscountPct(parseFloat(e.target.value) || 0)}
                      className="w-24 h-10 font-mono font-black text-sm bg-white py-1 px-3 border-2 border-slate-200 rounded-xl"
                    />
                  </div>
                ) : (
                  <div className="text-xs text-slate-600 leading-relaxed font-semibold">
                    Volume discount of <strong className="text-emerald-600 font-mono text-sm">{discountPct}%</strong> auto-calculated from subtotal bounds.
                  </div>
                )}
              </div>}

              {/* Notes */}
              <div>
                <label className="text-xs text-slate-455 font-bold uppercase tracking-wider block mb-1.5">Wholesale Order Notes</label>
                <input
                  type="text"
                  placeholder="e.g. Bulk reseller pickup next Thursday"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full text-sm h-10 2xl:h-12"
                />
              </div>
            </CardContent>

            <div className="shrink-0 border-t border-slate-100 bg-white p-3 2xl:p-8">
              {/* Invoice Totals Panel */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs 2xl:text-sm text-slate-550 font-semibold font-mono">
                  <span>Gross Subtotal:</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between text-xs 2xl:text-sm text-emerald-700 font-bold font-mono">
                  <span>Discount ({discountPct}%):</span>
                  <span>{formatCurrency(-discountAmt)}</span>
                </div>
                <div className="flex justify-between text-xs 2xl:text-sm text-slate-555 font-semibold font-mono border-b border-slate-100 pb-2 2xl:pb-3">
                  <span>Value Added Tax ({taxRate}% Included):</span>
                  <span>{formatCurrency(taxAmt)}</span>
                </div>
                <div className="flex justify-between items-center pt-1 2xl:pt-2">
                  <span className="text-xs text-slate-450 font-extrabold uppercase tracking-wide">Grand Total Payout:</span>
                  <span className="text-xl 2xl:text-2xl font-black font-mono text-slate-900">
                    {formatCurrency(grandTotal)}
                  </span>
                </div>
              </div>

              {/* Main Submit Button */}
              <Button
                onClick={handleSubmitOrder}
                disabled={saving || activeOrderItems.length === 0 || hasStockShortage}
                isLoading={saving}
                variant="primary"
                className="w-full text-sm 2xl:text-base font-extrabold uppercase h-11 2xl:h-14 rounded-xl 2xl:rounded-2xl mt-2 2xl:mt-3 cursor-pointer disabled:opacity-40"
                leftIcon={!saving ? <FileCheck size={18} /> : undefined}
              >
                Confirm &amp; Log Sale
              </Button>
            </div>
          </Card>
        </div>

      </div>

      {/* SUCCESS ALERTS MESSAGE - Hidden during printing */}
      {message && (
        <div className={`p-5 rounded-2xl text-sm font-bold border print:hidden flex justify-between items-center ${
          message.type === "error" 
            ? "bg-rose-50 text-rose-700 border-rose-200" 
            : "bg-emerald-50 text-emerald-700 border-emerald-200"
        }`}>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
            <span>{message.text}</span>
          </div>
          {lastInvoiceId && (
            <Button
              onClick={handlePrint}
              variant="outline"
              size="md"
              className="bg-white border-slate-200 h-10 px-4"
              leftIcon={<Printer size={14} />}
            >
              Print Invoice
            </Button>
          )}
        </div>
      )}

        </>
      ) : (
        <>
          {/* ORDER LOGS / HISTORY VIEW */}
          <Card className="rounded-3xl border-slate-200 shadow-sm bg-white p-6 space-y-6 print:hidden">
          <div className="flex justify-between items-center border-b border-slate-100 pb-4">
            <div>
              <CardTitle className="text-lg font-black text-slate-800">Wholesale Order History</CardTitle>
              <CardDescription className="text-xs text-slate-400 font-semibold mt-0.5">Logs of wholesale dispatches, reseller payouts, and invoices.</CardDescription>
            </div>
            <Button
              onClick={fetchOrderHistory}
              variant="outline"
              size="sm"
              className="h-10 px-3 bg-white"
              leftIcon={<RefreshCw size={14} className={ordersLoading ? "animate-spin" : ""} />}
            >
              Refresh Logs
            </Button>
          </div>

          {ordersLoading ? (
            <div className="py-12 text-center text-slate-455 font-semibold flex flex-col items-center justify-center gap-2">
              <RefreshCw size={24} className="animate-spin text-primary" />
              <span>Loading invoice logs...</span>
            </div>
          ) : orders.length === 0 ? (
            <div className="py-12 text-center text-slate-400 font-semibold italic">No past wholesale orders logged.</div>
          ) : (
            <DataTableShell className="shadow-3xs">
              <DataTableScroll label="Wholesale order history" className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left border-collapse text-xs text-slate-700">
                <thead>
                  <TableHeaderRow>
                    <TableHeaderCell>Order ID / #</TableHeaderCell>
                    <TableHeaderCell>Date</TableHeaderCell>
                    <TableHeaderCell>Reseller Customer</TableHeaderCell>
                    <TableHeaderCell>Delivered SKUs</TableHeaderCell>
                    <TableHeaderCell align="right">Net Total</TableHeaderCell>
                    <TableHeaderCell align="center">Status</TableHeaderCell>
                    <TableHeaderCell align="center">Actions</TableHeaderCell>
                  </TableHeaderRow>
                </thead>
                <tbody className="divide-y divide-slate-100 font-bold">
                  {orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-mono text-slate-850 font-black">HH-INVS-{order.id.toString().padStart(6, '0')}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(order.order_date)}</TableCell>
                      <TableCell className="text-slate-900 text-xs font-black">{order.reseller_name}</TableCell>
                      <TableCell className="max-w-sm">
                        <div className="space-y-2">
                          {order.items.slice(0, 2).map((item: any) => {
                            const matchedProduct = products.find((product) => product.sku === item.sku);
                            const identity = {
                              sku: item.sku,
                              product_name: item.product_name || item.sku,
                              category: matchedProduct?.category || getProductBusinessCategory(item),
                              size: item.size,
                            };
                            return (
                              <div key={`${order.id}-${item.sku}`} className="flex items-center justify-between gap-3">
                                <ProductDisplay
                                  sku={identity.sku}
                                  productName={identity.product_name}
                                  category={identity.category}
                                  size={identity.size}
                                  variant="compact"
                                  showIcon={false}
                                />
                                <span className="shrink-0 text-[10px] font-black text-slate-500">{formatProductQuantity(identity, item.quantity)}</span>
                              </div>
                            );
                          })}
                          {order.items.length > 2 && (
                            <span className="block text-[10px] font-bold text-slate-400">+{order.items.length - 2} more products</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell align="right" className="font-mono text-slate-900 font-black">{formatCurrency(order.grand_total)}</TableCell>
                      <TableCell align="center">
                        <StatusBadge status={order.is_paid ? "paid" : "unpaid"} className="text-[10px] uppercase" />
                      </TableCell>
                      <TableCell align="center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => {
                              setPrintedInvoice({
                                invoiceNumber: `HH-INVS-${order.id.toString().padStart(6, '0')}`,
                                date: order.order_date,
                                customerName: order.reseller_name,
                                items: order.items.map((item: any) => ({
                                  sku: item.sku,
                                  product_name: item.product_name,
                                  size: item.size,
                                  quantity: item.quantity,
                                  price: item.price_snapshot,
                                  subtotal: item.item_subtotal
                                })),
                                subtotal: order.subtotal,
                                discountPct: order.discount_percentage,
                                discountAmount: order.discount_amount,
                                taxAmount: order.tax_amount,
                                grandTotal: order.grand_total,
                                isDraft: false
                              });
                              showToast("Invoice loaded. Printing...", "info");
                              setTimeout(() => {
                                window.print();
                              }, 150);
                            }}
                            className="inline-flex items-center justify-center h-10 px-3 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 rounded-xl text-[10px] font-bold gap-1 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                            title="Print invoice receipt"
                          >
                            <Printer size={10} /> Print
                          </button>
                          {!order.is_paid && (
                            <button
                              onClick={async () => {
                                try {
                                  await api.payResellerOrder(order.id);
                                  showToast(`Order #${order.id} marked as PAID.`, "success");
                                  fetchOrderHistory();
                                } catch (err) {
                                  alert(`Error settling payment: ${getErrorMessage(err)}`);
                                }
                              }}
                              className="inline-flex items-center justify-center h-10 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-bold cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                            >
                              Settle Payout
                            </button>
                          )}
                          {userRole === "owner" && (
                            <button
                              onClick={() => handleDeleteOrder(order.id)}
                              className="inline-flex items-center justify-center h-10 px-3 border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-[10px] font-bold gap-1 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                              title="Delete reseller order permanently"
                            >
                              <Trash2 size={10} /> Delete
                            </button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </table>
              </DataTableScroll>
            </DataTableShell>
          )}
        </Card>
        </>
      )}

      {/* FINALIZED OR LIVE INVOICE PREVIEW SHEET (High Fidelity, beautiful print-friendly format) */}
      {(() => {
        const invoiceData = activeOrderItems.length > 0 
          ? {
              invoiceNumber: `HH-INVS-${new Date(orderDate).getTime().toString().slice(-6)}`,
              date: orderDate,
              customerName: resellerName || "(Enter customer name)",
              items: activeOrderItems.map(item => {
                const p = products.find(prod => prod.sku === item.sku);
                return {
                  sku: item.sku,
                  product_name: p ? p.product_name : "Unknown Item",
                  size: p ? p.size : "",
                  quantity: item.quantity,
                  price: p ? p.retail_price : 0.0,
                  subtotal: item.quantity * (p ? p.retail_price : 0.0)
                };
              }),
              subtotal: calculateSubtotal(),
              discountPct: getTieredDiscount(calculateSubtotal()),
              discountAmount: calculateSubtotal() * (getTieredDiscount(calculateSubtotal()) / 100),
              taxAmount: (calculateSubtotal() - (calculateSubtotal() * (getTieredDiscount(calculateSubtotal()) / 100))) * (12 / 112),
              grandTotal: calculateSubtotal() - (calculateSubtotal() * (getTieredDiscount(calculateSubtotal()) / 100)),
              isDraft: true
            }
          : printedInvoice;

        if (!invoiceData) return null;

        return (
          <div className="max-w-3xl mx-auto w-full print:border-0 print:p-0 print:m-0 print:shadow-none bg-white p-8 sm:p-12 shadow-md border-2 border-slate-200 rounded-3xl mt-8">
            <style dangerouslySetInnerHTML={{ __html: `
              @media print {
                html, body {
                  background: white !important;
                  color: black !important;
                  margin: 0 !important;
                  padding: 0 !important;
                }
                @page {
                  size: portrait;
                  margin: 0.6cm 0.8cm 0.6cm 0.8cm !important;
                }
                .print\\:hidden {
                  display: none !important;
                }
              }
            ` }} />
            <div className="space-y-6 print:space-y-3 print-container">
              
              {/* Receipt Header */}
              <div className="flex justify-between items-start border-b-2 border-slate-200 pb-6 print:pb-3">
                <div>
                  <span className="font-heading font-black text-2xl print:text-lg tracking-widest text-slate-900 block leading-none">H+H HUB</span>
                  <span className="text-[10px] print:text-[8px] text-slate-455 uppercase tracking-widest font-black block mt-2 print:mt-1">PREMIUM SPREADS & FOOD PRODUCTS</span>
                  <span className="text-xs print:text-[9px] text-slate-400 font-semibold block mt-1 print:mt-0.5">Cambria, Bay, Laguna, Brgy. Sto. Domingo | +63 917 123 4567</span>
                </div>
                <div className="text-right text-xs print:text-[10px] font-semibold text-slate-500 space-y-1 print:space-y-0.5">
                  <p>Invoice #: <span className="font-mono font-bold text-slate-800 text-sm print:text-xs">{invoiceData.invoiceNumber}</span></p>
                  <p>Date: {formatDate(invoiceData.date)}</p>
                  <p>Terms: Due on Receipt</p>
                </div>
              </div>

              <div className="text-sm print:text-xs">
                <span className="text-xs text-slate-455 font-bold uppercase tracking-wider block mb-1 print:mb-0">Bill To:</span>
                <span className="font-black text-slate-800 text-lg print:text-sm">{invoiceData.customerName}</span>
              </div>

              {/* Receipt table */}
              <DataTableShell className="shadow-3xs">
                <DataTableScroll label="Invoice line items" className="overflow-x-auto print:overflow-visible">
                <table className="w-full text-left border-collapse text-sm text-slate-700">
                  <thead>
                    <TableHeaderRow className="print:text-[10px]">
                      <TableHeaderCell className="print:px-3 print:py-2 border border-slate-200">Item Description</TableHeaderCell>
                      <TableHeaderCell align="right" className="print:px-3 print:py-2 border border-slate-200">Qty</TableHeaderCell>
                      <TableHeaderCell align="right" className="print:px-3 print:py-2 border border-slate-200">Subtotal</TableHeaderCell>
                    </TableHeaderRow>
                  </thead>
                  <tbody className="font-bold text-slate-800">
                    {invoiceData.items.map((item: any) => {
                      const matchedProduct = products.find((product) => product.sku === item.sku);
                      const identity = {
                        sku: item.sku,
                        product_name: item.product_name,
                        category: matchedProduct?.category || getProductBusinessCategory(item),
                        size: item.size,
                      };
                      return (
                        <TableRow key={item.sku}>
                          <TableCell className="print:px-3 print:py-1.5 border border-slate-200">
                            <ProductDisplay
                              sku={identity.sku}
                              productName={identity.product_name}
                              category={identity.category}
                              size={identity.size}
                              variant="compact"
                              showIcon={false}
                            />
                          </TableCell>
                          <TableCell align="right" className="print:px-3 print:py-1.5 font-mono font-black text-slate-900 text-base print:text-xs border border-slate-200">{formatProductQuantity(identity, item.quantity)}</TableCell>
                          <TableCell align="right" className="print:px-3 print:py-1.5 font-black text-slate-900 font-mono text-base print:text-xs border border-slate-200">{formatCurrency(item.subtotal)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </tbody>
                </table>
                </DataTableScroll>
              </DataTableShell>

              {/* Aggregates */}
              <div className="flex flex-col items-end space-y-2 text-sm border-b-2 border-slate-100 pb-5 pt-3 print:pb-2 print:pt-1.5 print:space-y-1">
                <div className="flex justify-between w-72 print:w-64 text-slate-500 font-semibold font-mono print:text-xs">
                  <span>Gross Subtotal:</span>
                  <span>{formatCurrency(invoiceData.subtotal)}</span>
                </div>
                <div className="flex justify-between w-72 print:w-64 text-emerald-750 font-bold font-mono print:text-xs">
                  <span>Volume Discount ({invoiceData.discountPct}%):</span>
                  <span>{formatCurrency(-invoiceData.discountAmount)}</span>
                </div>
                <div className="flex justify-between w-72 print:w-64 text-slate-555 font-semibold font-mono print:text-xs">
                  <span>VAT (12% Included):</span>
                  <span>{formatCurrency(invoiceData.taxAmount)}</span>
                </div>
              </div>

              <div className="flex justify-between items-center pt-3 print:pt-1.5">
                <span className="text-xs print:text-[10px] text-slate-400 font-bold uppercase tracking-wider">Statement Net Total:</span>
                <span className="text-xl print:text-sm font-black font-mono text-slate-950">
                  {formatCurrency(invoiceData.grandTotal)}
                </span>
              </div>

              {/* GCash / Bank settlement instruction footer */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-8 border-t border-slate-200 text-xs font-semibold text-slate-400 leading-relaxed print:pt-3 print:gap-4 print:text-[9px]">
                <div className="space-y-1.5">
                  <span className="text-xs print:text-[10px] text-slate-500 font-black uppercase tracking-wider block">Payment Instructions</span>
                  <p>Please request payment details from the H+H owner.</p>
                  <p className="text-[10px] print:text-[8px] text-slate-455 italic">Please email payment receipts to billing@hplusfood.com.</p>
                </div>
                <div className="flex flex-col justify-end items-end h-32 print:h-12">
                  <div className="w-56 print:w-44 border-t border-slate-400 text-center pt-3 print:pt-1 text-[10px] print:text-[8px] text-slate-500 font-black uppercase tracking-widest">
                    Authorized Signature
                  </div>
                </div>
              </div>

              {/* Print and Save dispatches */}
              <div className="flex justify-end gap-3 pt-8 border-t border-slate-100 print:hidden">
                <Button
                  onClick={handlePrint}
                  variant="outline"
                  size="lg"
                  className="h-12 border-slate-200"
                >
                  Print Statement
                </Button>
                {invoiceData.isDraft && (
                  <Button
                    onClick={handleSubmitOrder}
                    disabled={saving || hasStockShortage}
                    variant="primary"
                    size="lg"
                    className="h-12"
                    leftIcon={<FileCheck size={16} />}
                  >
                    {saving ? "Saving..." : "Log Sale & Deduct"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
