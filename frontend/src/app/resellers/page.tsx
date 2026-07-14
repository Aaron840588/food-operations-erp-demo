"use client";

import React, { useEffect, useRef, useState } from "react";
import { api, type DiscountTierOut, type ProductSKUOut } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { getProductBusinessCategory, BUSINESS_CATEGORIES, getSizeBadgeStyle } from "@/lib/utils";
import { ProductSizeBadge } from "@/components/ui/ProductSizeBadge";
import { 
  Receipt, 
  Printer, 
  FileCheck,
  Plus,
  Minus,
  Search,
  Sparkles,
  Undo2,
  Trash2
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

  // Frequent customers database mock for quick clicking
  const frequentCustomers = [
    { name: "Ms. Anna Dolores", defaultNotes: "Regular pickup", category: "High Volume" },
    { name: "Sir Jerry Sy", defaultNotes: "Delivery via Pasig Courier", category: "Pasig Area" },
    { name: "Nene's Foodmart", defaultNotes: "Cash on delivery", category: "Standard" }
  ];

  useEffect(() => {
    api.getProducts().then(res => {
      const filtered = (res || []).filter((p) => p.sku !== "SKU" && p.is_active !== false);
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
        // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // Group products by business category
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const categories: { [cat: string]: any[] } = {};
  BUSINESS_CATEGORIES.forEach(c => {
    categories[c] = [];
  });
  products.forEach(p => {
    const cat = getProductBusinessCategory(p);
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(p);
  });

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
  const taxAmt = discountedSubtotal * (taxRate / 100.0);
  const grandTotal = discountedSubtotal + taxAmt;

  const activeOrderItems = getActiveOrderItems();
  const hasStockShortage = activeOrderItems.some((item) => {
    const product = products.find((candidate) => candidate.sku === item.sku);
    return !product || item.quantity > Math.max(0, product.warehouse_stock || 0);
  });

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
      setMessage({
        type: "success",
        text: `Successfully logged reseller invoice. Payout total: ₱${res.grand_total.toFixed(2)}. Warehouse stock updated.`
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
        setProducts((res || []).filter((product) => product.sku !== "SKU" && product.is_active !== false));
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
                  placeholder="Search products by SKU or name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ paddingLeft: "3rem" }}
                  className="w-full pr-4 py-4 border border-slate-200 rounded-2xl text-base h-12 focus:ring-primary/20 bg-slate-50 font-semibold"
                />
              </div>

              {/* Category pills */}
              <div className="flex flex-wrap gap-2">
                {["All", ...BUSINESS_CATEGORIES].map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategoryTab(cat)}
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

            </div>
          </div>

          {/* POS Product Cards Grid (Spacious layout, large fonts) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 2xl:gap-6">
            {products
              .filter(p => {
                const matchesSearch = p.product_name.toLowerCase().includes(searchQuery.toLowerCase()) || p.sku.toLowerCase().includes(searchQuery.toLowerCase());
                const matchesCategory = selectedCategoryTab === "All" || getProductBusinessCategory(p) === selectedCategoryTab;
                return matchesSearch && matchesCategory;
              })
              .map((p) => {
                const qty = quantities[p.sku] || 0;
                return (
                  <div 
                    key={p.sku} 
                    className={`p-4 2xl:p-6 bg-white border-2 rounded-3xl transition-all flex flex-col justify-between min-h-48 2xl:min-h-52 shadow-3xs ${
                      qty > 0 ? "border-primary bg-primary-light/5 ring-4 ring-primary/5" : "border-slate-150 hover:border-slate-350"
                    }`}
                  >
                    <div>
                      <div className="flex justify-between items-start gap-4">
                        <span className="text-base 2xl:text-lg font-heading font-black text-slate-800 leading-tight line-clamp-2">{p.product_name}</span>
                        <span className={`text-xs font-extrabold font-mono uppercase py-1 px-2.5 rounded-lg shrink-0 ${getSizeBadgeStyle(p.size)}`}>{p.size}</span>
                      </div>
                      <span className="text-xs text-slate-400 font-mono block mt-2 uppercase tracking-wider font-extrabold">SKU Code: {p.sku}</span>
                      <span className="text-xs text-slate-505 block mt-1 font-bold">Warehouse Stock: <strong className="font-mono text-slate-800">{p.warehouse_stock}</strong> jars left</span>
                    </div>

                    <div className="flex justify-between items-center mt-4 pt-3 border-t border-slate-100">
                      <span className="text-lg 2xl:text-xl font-black text-slate-800 font-mono">
                        ₱{p.retail_price.toFixed(2)}
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
                        <div className="flex items-center gap-3 animate-scale-up">
                          <button
                            onClick={() => handleQtyChange(p.sku, qty - 1)}
                            className="w-10 h-10 rounded-xl border-2 border-slate-200 flex items-center justify-center hover:bg-slate-100 cursor-pointer text-slate-600 bg-white"
                          >
                            <Minus size={14} className="stroke-[3]" />
                          </button>
                          <input
                            type="number"
                            min={0}
                            max={Math.max(0, p.warehouse_stock || 0)}
                            placeholder="0"
                            value={qty || ""}
                            onChange={(e) => handleQtyChange(p.sku, parseInt(e.target.value) || 0)}
                            className="w-16 h-10 text-center font-mono font-black text-base p-1 bg-white border-2 border-slate-200 rounded-xl text-slate-800 focus:border-primary focus:ring-0"
                          />
                          <button
                            onClick={() => handleQtyChange(p.sku, qty + 1)}
                            disabled={qty >= Math.max(0, p.warehouse_stock || 0)}
                            className="w-10 h-10 rounded-xl border-2 border-slate-200 flex items-center justify-center hover:bg-slate-100 cursor-pointer text-slate-600 bg-white disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Plus size={14} className="stroke-[3]" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
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
                    activeOrderItems.map((item, idx) => {
                      const p = products.find(prod => prod.sku === item.sku);
                      if (!p) return null;
                      return (
                        <div key={idx} className="flex justify-between items-center p-3 bg-white rounded-xl border border-slate-200 shadow-3xs text-sm">
                          <div className="truncate pr-3">
                            <span className="font-black text-slate-800 block truncate">{p.product_name}</span>
                            <span className={`text-[10px] font-bold font-mono py-0.5 px-1.5 rounded mt-1 inline-block ${getSizeBadgeStyle(p.size)}`}>{p.size}</span> <span className="text-xs text-slate-450">· ₱{p.retail_price.toFixed(2)}</span>
                          </div>
                          
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleQtyChange(p.sku, item.quantity - 1)}
                              className="w-8 h-8 border-2 border-slate-200 rounded-lg flex items-center justify-center hover:bg-slate-50 cursor-pointer bg-white"
                            >
                              <Minus size={11} className="stroke-[3]" />
                            </button>
                            <span className="w-8 text-center font-black text-slate-850 font-mono text-sm">{item.quantity}</span>
                            <button
                              onClick={() => handleQtyChange(p.sku, item.quantity + 1)}
                              disabled={item.quantity >= Math.max(0, p.warehouse_stock || 0)}
                              className="w-8 h-8 border-2 border-slate-200 rounded-lg flex items-center justify-center hover:bg-slate-50 cursor-pointer bg-white disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Plus size={11} className="stroke-[3]" />
                            </button>
                          </div>
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
                  <span>₱{subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs 2xl:text-sm text-emerald-700 font-bold font-mono">
                  <span>Discount ({discountPct}%):</span>
                  <span>-₱{discountAmt.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs 2xl:text-sm text-slate-555 font-semibold font-mono border-b border-slate-100 pb-2 2xl:pb-3">
                  <span>Value Added Tax ({taxRate}%):</span>
                  <span>+₱{taxAmt.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center pt-1 2xl:pt-2">
                  <span className="text-xs text-slate-450 font-extrabold uppercase tracking-wide">Grand Total Payout:</span>
                  <span className="text-xl 2xl:text-2xl font-black font-mono text-slate-900">
                    ₱{grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
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

      {/* LIVE INVOICE PREVIEW SHEET (High Fidelity, beautiful print-friendly format) */}
      {activeOrderItems.length > 0 && (
        <Card className="max-w-3xl mx-auto w-full print:border-0 print:p-0 print:shadow-none bg-white p-8 sm:p-12 shadow-md border-2 border-slate-200 rounded-3xl">
          <div className="space-y-6">
            
            {/* Receipt Header */}
            <div className="flex justify-between items-start border-b-2 border-slate-200 pb-6">
              <div>
                <span className="font-heading font-black text-2xl tracking-widest text-slate-900 block leading-none">H+H HUB</span>
                <span className="text-[10px] text-slate-455 uppercase tracking-widest font-black block mt-2">PREMIUM SPREADS & FOOD PRODUCTS</span>
                <span className="text-xs text-slate-400 font-semibold block mt-1">128 Kitchen Facility Lane, Pasig City | +63 917 123 4567</span>
              </div>
              <div className="text-right text-xs font-semibold text-slate-500 space-y-1">
                <span className="font-heading font-black text-slate-800 text-sm uppercase tracking-widest block mb-2">RESELLER BILLING</span>
                <p>Invoice #: <span className="font-mono font-bold text-slate-800 text-sm">HH-INVS-{new Date(orderDate).getTime().toString().slice(-6)}</span></p>
                <p>Date: {orderDate}</p>
                <p>Terms: Due on Receipt</p>
              </div>
            </div>

            <div className="text-sm">
              <span className="text-xs text-slate-400 font-bold uppercase tracking-wider block mb-1">Bill To:</span>
              <span className="font-black text-slate-800 text-lg">{resellerName || "(Enter customer name)"}</span>
            </div>

            {/* Receipt table */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-3xs overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm text-slate-700">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-black uppercase tracking-wider text-xs">
                    <th className="px-6 py-4">Item Description</th>
                    <th className="px-6 py-4 text-right">Qty</th>
                    <th className="px-6 py-4 text-right">Unit Price</th>
                    <th className="px-6 py-4 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-semibold">
                  {activeOrderItems.map((item, idx) => {
                    const p = products.find(prod => prod.sku === item.sku);
                    const price = p ? p.retail_price : 0.0;
                    const itemSub = item.quantity * price;
                    
                    return (
                      <tr key={idx} className="hover:bg-slate-50/20">
                        <td className="px-6 py-3.5">
                          <span className="flex flex-wrap items-center gap-2 font-black text-slate-850 text-base">{p ? <>{p.product_name} <ProductSizeBadge size={p.size} sku={p.sku} /></> : "Unknown Item"}</span>
                          <span className="font-mono text-xs text-slate-400 mt-1 block">{item.sku}</span>
                        </td>
                        <td className="px-6 py-3.5 text-right font-mono font-black text-slate-900 text-base">{item.quantity} jars</td>
                        <td className="px-6 py-3.5 text-right text-slate-455 font-mono">₱{price.toFixed(2)}</td>
                        <td className="px-6 py-3.5 text-right font-black text-slate-900 font-mono text-base">₱{itemSub.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Aggregates */}
            <div className="flex flex-col items-end space-y-2 text-sm border-b-2 border-slate-100 pb-5 pt-3">
              <div className="flex justify-between w-72 text-slate-500 font-semibold font-mono">
                <span>Gross Subtotal:</span>
                <span>₱{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between w-72 text-emerald-700 font-bold font-mono">
                <span>Volume Discount ({discountPct}%):</span>
                <span>-₱{discountAmt.toFixed(2)}</span>
              </div>
              <div className="flex justify-between w-72 text-slate-550 font-semibold font-mono">
                <span>VAT ({taxRate}%):</span>
                <span>+₱{taxAmt.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex justify-between items-center pt-3">
              <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Statement Net Total:</span>
              <span className="text-xl font-black font-mono text-slate-950">
                ₱{grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>

            {/* GCash / Bank settlement instruction footer */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-8 border-t border-slate-200 text-xs font-semibold text-slate-400 leading-relaxed">
              <div className="space-y-1.5">
                <span className="text-xs text-slate-500 font-black uppercase tracking-wider block">Payment Instructions</span>
                <p>Transfer GCash or BDO bank payments to:</p>
                <p className="text-slate-700 font-extrabold">GCash Account: <span className="font-mono text-sm block md:inline">0917-123-4567</span> (H+H Food Corp)</p>
                <p className="text-slate-700 font-extrabold">BDO Bank Account: <span className="font-mono text-sm block md:inline">0012-3456-7890</span> (Pasig Branch)</p>
                <p className="text-[10px] text-slate-455 italic">Please email payment receipts to billing@hplusfood.com.</p>
              </div>
              <div className="flex flex-col justify-end items-end h-32">
                <div className="w-56 border-t border-slate-400 text-center pt-3 text-[10px] text-slate-500 font-black uppercase tracking-widest">
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
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
