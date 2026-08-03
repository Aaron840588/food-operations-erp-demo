"use client";

import Image from "next/image";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Search,
  ShieldCheck,
  ShoppingBag,
  Truck,
  X,
} from "lucide-react";

import { ProductDisplay } from "@/components/ui/ProductDisplay";
import { NumericQuantityInput } from "@/components/ui/NumericQuantityInput";
import {
  api,
  type PublicPreorderCatalog,
  type PublicPreorderReceipt,
} from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import {
  BUSINESS_CATEGORIES,
  formatCurrency,
  formatDate,
  getProductBusinessCategory,
  getProductSizeGroup,
} from "@/lib/utils";

type FulfillmentMethod = "Pickup" | "Delivery";

interface PreorderDraft {
  customerName: string;
  contactPhone: string;
  contactEmail: string;
  fulfillmentDate: string;
  fulfillmentTime: string;
  fulfillmentMethod: FulfillmentMethod;
  deliveryAddress: string;
  paymentPreference: string;
  notes: string;
  cart: Record<string, number>;
}

const EMPTY_DRAFT: PreorderDraft = {
  customerName: "",
  contactPhone: "",
  contactEmail: "",
  fulfillmentDate: "",
  fulfillmentTime: "",
  fulfillmentMethod: "Pickup",
  deliveryAddress: "",
  paymentPreference: "",
  notes: "",
  cart: {},
};

function safeStorageKey(prefix: string, publicToken: string): string {
  return `${prefix}:${publicToken.slice(-20)}`;
}

function getOrCreateSubmissionReference(publicToken: string): string {
  const key = safeStorageKey("hh_preorder_submission", publicToken);
  let existing: string | null = null;
  try {
    existing = sessionStorage.getItem(key);
  } catch {
    // Keep the reference in memory when private browsing blocks storage.
  }
  if (existing) return existing;
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error("This browser cannot create a secure order reference.");
  const reference = `preorder:${uuid}`;
  try {
    sessionStorage.setItem(key, reference);
  } catch {
    // The component ref still preserves this ID for retries in the current tab.
  }
  return reference;
}

export default function PublicPreorderPage() {
  const params = useParams<{ publicToken: string }>();
  const publicToken = params.publicToken;
  const [catalog, setCatalog] = useState<PublicPreorderCatalog | null>(null);
  const [draft, setDraft] = useState<PreorderDraft>(EMPTY_DRAFT);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [mobileCheckoutOpen, setMobileCheckoutOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<PublicPreorderReceipt | null>(null);
  const submitInFlight = useRef(false);
  const submissionReferenceRef = useRef<string | null>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const checkoutCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobileCheckoutOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.body.style.overflow = "hidden";
    checkoutCloseRef.current?.focus();

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileCheckoutOpen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
      previouslyFocused?.focus();
    };
  }, [mobileCheckoutOpen]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const nextCatalog = await api.getPublicPreorderCatalog(publicToken);
        if (cancelled) return;

        setCatalog(nextCatalog);
        const draftKey = safeStorageKey("hh_preorder_draft", publicToken);
        let savedDraft: string | null = null;
        try {
          savedDraft = sessionStorage.getItem(draftKey);
        } catch {
          // Private browsing may block storage; continue with a fresh draft.
        }
        if (savedDraft) {
          try {
            const parsed = JSON.parse(savedDraft) as Partial<PreorderDraft>;
            setDraft({
              ...EMPTY_DRAFT,
              ...parsed,
              cart: parsed.cart && typeof parsed.cart === "object" ? parsed.cart : {},
            });
          } catch {
            try {
              sessionStorage.removeItem(draftKey);
            } catch {
              // Ignore storage cleanup failures.
            }
          }
        } else {
          setDraft((current) => ({
            ...current,
            fulfillmentDate: nextCatalog.event?.event_date ?? new Date().toISOString().slice(0, 10),
            fulfillmentMethod: nextCatalog.allowed_fulfillment_methods[0] ?? "Pickup",
            paymentPreference: nextCatalog.payment_preferences[0] ?? "",
          }));
        }
        submissionReferenceRef.current = getOrCreateSubmissionReference(publicToken);
      } catch (loadError) {
        if (!cancelled) {
          setError(getErrorMessage(loadError, "This pre-order link is unavailable."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [publicToken]);

  useEffect(() => {
    if (!catalog || receipt) return;
    try {
      sessionStorage.setItem(
        safeStorageKey("hh_preorder_draft", publicToken),
        JSON.stringify(draft),
      );
    } catch {
      // The form remains usable when private browsing blocks session storage.
    }
  }, [catalog, draft, publicToken, receipt]);

  const orderableProducts = useMemo(
    () => (catalog?.products ?? []).filter((product) => Number(product.retail_price) > 0),
    [catalog],
  );

  const categories = useMemo(() => {
    const present = new Set(
      orderableProducts.map((product) => getProductBusinessCategory(product))
    );
    const orderedPresent = BUSINESS_CATEGORIES.filter((cat) => present.has(cat));
    // Include any unexpected business categories if present
    Array.from(present).forEach((cat) => {
      if (!orderedPresent.includes(cat as (typeof BUSINESS_CATEGORIES)[number])) {
        orderedPresent.push(cat as (typeof BUSINESS_CATEGORIES)[number]);
      }
    });
    return ["All", ...orderedPresent];
  }, [orderableProducts]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return orderableProducts.filter((product) => {
      const businessCat = getProductBusinessCategory(product);
      const matchesCategory = category === "All" || businessCat === category;
      const matchesSearch = !query
        || product.product_name.toLowerCase().includes(query)
        || product.sku.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [category, orderableProducts, search]);

  const groupedProducts = useMemo(() => {
    type ProductType = (typeof filteredProducts)[number];
    const groups: { label: string; order: number; products: ProductType[] }[] = [];
    const groupMap = new Map<string, { label: string; order: number; products: ProductType[] }>();

    for (const product of filteredProducts) {
      const sizeGroup = getProductSizeGroup(product);
      let group = groupMap.get(sizeGroup.key);
      if (!group) {
        group = {
          label: sizeGroup.label,
          order: sizeGroup.order,
          products: [],
        };
        groupMap.set(sizeGroup.key, group);
        groups.push(group);
      }
      group.products.push(product);
    }

    groups.sort((a, b) => a.order - b.order);
    return groups;
  }, [filteredProducts]);

  const selectedLines = useMemo(() => (
    orderableProducts
      .filter((product) => (draft.cart[product.sku] ?? 0) > 0)
      .map((product) => ({ product, quantity: draft.cart[product.sku] }))
  ), [draft.cart, orderableProducts]);
  const itemCount = selectedLines.reduce((sum, line) => sum + line.quantity, 0);
  const total = selectedLines.reduce(
    (sum, line) => sum + Number(line.product.retail_price) * line.quantity,
    0,
  );

  const setQuantity = (sku: string, quantity: number) => {
    setDraft((current) => {
      const nextCart = { ...current.cart };
      if (quantity <= 0) delete nextCart[sku];
      else nextCart[sku] = Math.min(50, quantity);
      return { ...current, cart: nextCart };
    });
  };

  const updateDraft = <K extends keyof PreorderDraft>(key: K, value: PreorderDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!catalog || submitInFlight.current) return;
    if (selectedLines.length === 0) {
      setError("Add at least one item before submitting your pre-order.");
      return;
    }
    if (total <= 0) {
      setError("This order has an invalid total. Remove the affected item and contact H+H.");
      return;
    }
    if (!draft.contactPhone.trim() && !draft.contactEmail.trim()) {
      setError("Enter a mobile number or email so the team can confirm your order.");
      return;
    }
    if (draft.fulfillmentMethod === "Delivery" && !draft.deliveryAddress.trim()) {
      setError("Enter a delivery address.");
      return;
    }

    submitInFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const nextReceipt = await api.submitPublicPreorder(publicToken, {
        submission_reference: submissionReferenceRef.current
          ?? (submissionReferenceRef.current = getOrCreateSubmissionReference(publicToken)),
        customer_name: draft.customerName.trim(),
        contact_email: draft.contactEmail.trim() || null,
        contact_phone: draft.contactPhone.trim() || null,
        requested_fulfillment_date: draft.fulfillmentDate,
        requested_fulfillment_time: draft.fulfillmentTime,
        fulfillment_method: draft.fulfillmentMethod,
        delivery_address: draft.fulfillmentMethod === "Delivery"
          ? draft.deliveryAddress.trim()
          : null,
        notes: draft.notes.trim() || null,
        payment_preference: draft.paymentPreference || null,
        items: selectedLines.map(({ product, quantity }) => ({
          sku: product.sku,
          quantity,
        })),
        extension: {},
      });
      setReceipt(nextReceipt);
      try {
        sessionStorage.removeItem(safeStorageKey("hh_preorder_draft", publicToken));
        sessionStorage.removeItem(safeStorageKey("hh_preorder_submission", publicToken));
      } catch {
        // No cleanup is needed when storage was unavailable.
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (submitError) {
      setError(getErrorMessage(submitError, "Your pre-order could not be submitted."));
    } finally {
      setSubmitting(false);
      submitInFlight.current = false;
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-[100svh] items-center justify-center bg-[#f4eee3] px-5">
        <div className="flex items-center gap-3 rounded-2xl border border-[#dfd5c6] bg-white px-5 py-4 text-sm font-bold text-slate-700 shadow-sm">
          <Loader2 className="animate-spin text-primary" aria-hidden="true" />
          Loading pre-order form
        </div>
      </main>
    );
  }

  if (!catalog) {
    return (
      <main className="flex min-h-[100svh] items-center justify-center bg-[#f4eee3] px-5">
        <section className="w-full max-w-md rounded-3xl border border-rose-200 bg-white p-6 text-center shadow-lg">
          <AlertCircle className="mx-auto text-rose-600" size={36} aria-hidden="true" />
          <h1 className="mt-4 font-heading text-2xl font-black text-slate-900">Pre-order link unavailable</h1>
          <p className="mt-2 text-base text-slate-600">{error ?? "Ask H+H for an updated pre-order link."}</p>
        </section>
      </main>
    );
  }

  if (receipt) {
    return (
      <main className="min-h-[100svh] bg-[#f4eee3] px-4 py-8 sm:px-6">
        <section className="mx-auto w-full max-w-xl rounded-3xl border border-emerald-200 bg-white p-5 shadow-lg sm:p-8">
          <div className="flex justify-center">
            <Image src="/hh-logo.png" alt="Handmade and Homemade" width={88} height={88} priority />
          </div>
          <CheckCircle2 className="mx-auto mt-4 text-emerald-600" size={44} aria-hidden="true" />
          <h1 className="mt-3 text-center font-heading text-3xl font-black text-slate-900">Pre-order received</h1>
          <p className="mt-2 text-center text-base text-slate-600">Keep this reference for pickup or follow-up.</p>
          <div className="mt-5 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-5 text-center">
            <span className="block text-xs font-black uppercase tracking-[0.18em] text-primary">Order reference</span>
            <strong className="mt-2 block break-all font-mono text-2xl font-black tracking-wide text-slate-950">{receipt.public_reference}</strong>
          </div>
          <div className="mt-5 space-y-3">
            {receipt.items.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900">{item.product_name}</p>
                  <p className="text-sm text-slate-500">{item.size} · {item.quantity} × {formatCurrency(Number(item.unit_price))}</p>
                </div>
                <span className="shrink-0 font-mono font-black tabular-nums text-slate-900">{formatCurrency(Number(item.line_total))}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between rounded-2xl bg-slate-900 px-4 py-4 text-white">
            <span className="font-bold">Order total</span>
            <strong className="font-mono text-xl tabular-nums">{formatCurrency(Number(receipt.total_amount))}</strong>
          </div>
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            Stock is confirmed during H+H’s fulfillment review. This submission does not reserve inventory yet.
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-[100svh] overflow-x-clip bg-[#f4eee3] pb-28 text-slate-900 md:pb-10">
      <header className="border-b border-[#dfd5c6] bg-white/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <Image src="/hh-logo.png" alt="Handmade and Homemade" width={52} height={52} priority />
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">H+H customer pre-order</p>
            <h1 className="truncate font-heading text-xl font-black text-slate-950 sm:text-2xl">
              {(catalog.form_name || "").replace(/^default\s+/i, "").trim() || "Customer Pre-Order Form"}
            </h1>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        {catalog.event ? (
          <section className="grid gap-3 rounded-2xl border border-[#dfd5c6] bg-white p-4 shadow-sm sm:grid-cols-3">
            <div className="flex items-start gap-3 sm:col-span-3">
              <ShoppingBag className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">For event</p>
                <h2 className="font-heading text-xl font-black text-slate-950">{catalog.event.name}</h2>
              </div>
            </div>
            <div className="flex min-h-11 items-center gap-2 rounded-xl bg-slate-50 px-3 text-sm font-bold">
              <CalendarDays size={18} className="text-primary" aria-hidden="true" />
              {formatDate(catalog.event.event_date)}
            </div>
            <div className="flex min-h-11 items-center gap-2 rounded-xl bg-slate-50 px-3 text-sm font-bold sm:col-span-2">
              <MapPin size={18} className="shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 break-words">{catalog.event.location}</span>
            </div>
          </section>
        ) : null}

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(21rem,0.65fr)]">
          <section className="min-w-0">
            <div className="rounded-2xl border border-[#dfd5c6] bg-white p-3 shadow-sm sm:p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={19} aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search products or SKU"
                  aria-label="Search products or SKU"
                  className="h-12 w-full text-base"
                  style={{ paddingLeft: "2.75rem" }}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:overflow-x-auto sm:pb-1" aria-label="Product categories">
                {categories.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setCategory(item)}
                    aria-pressed={category === item}
                    className={`min-h-12 min-w-0 rounded-xl border px-3 text-xs font-black uppercase tracking-wide sm:shrink-0 ${
                      category === item
                        ? "border-primary bg-primary text-white"
                        : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 space-y-6">
              {groupedProducts.map((group) => (
                <section key={group.label} className="space-y-3">
                  <div className="flex items-center gap-2.5 rounded-2xl border border-amber-900/20 bg-amber-100/80 px-4 py-3 shadow-xs">
                    <span className="h-3 w-3 rounded-full bg-amber-800 shrink-0" aria-hidden="true" />
                    <h2 className="font-sans text-sm sm:text-base font-bold text-amber-950 uppercase tracking-wide">
                      {group.label}
                    </h2>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {group.products.map((product) => {
                      const quantity = draft.cart[product.sku] ?? 0;
                      return (
                        <article key={product.sku} className="flex min-w-0 flex-col rounded-2xl border border-[#dfd5c6] bg-white p-4 shadow-sm">
                          <ProductDisplay
                            sku={product.sku}
                            productName={product.product_name}
                            category={product.category}
                            size={product.size}
                            showCategory
                          />
                          <p className="mt-4 font-mono text-xl font-black tabular-nums text-primary">{formatCurrency(Number(product.retail_price))}</p>
                          <div className="mt-auto pt-4">
                            {quantity > 0 ? (
                              <div className="flex flex-col gap-2">
                                <NumericQuantityInput
                                  value={quantity}
                                  onChange={(nextQuantity) => setQuantity(product.sku, nextQuantity)}
                                  min={0}
                                  max={50}
                                  label={`Quantity of ${product.product_name}`}
                                  className="w-full justify-between"
                                />
                                <button
                                  type="button"
                                  onClick={() => setQuantity(product.sku, 0)}
                                  className="min-h-11 rounded-xl px-3 text-sm font-bold text-rose-700 hover:bg-rose-50"
                                >
                                  Remove
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setQuantity(product.sku, 1)}
                                className="min-h-12 w-full rounded-xl bg-primary px-4 text-base font-black text-white shadow-sm hover:bg-primary-hover cursor-pointer"
                              >
                                Add to order
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
            {filteredProducts.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
                No products match this search.
              </div>
            ) : null}
          </section>

          <div
            id="checkout-section"
            ref={detailsRef}
            className={`${mobileCheckoutOpen ? "fixed inset-0 z-50 flex items-end" : "hidden"} min-w-0 lg:static lg:z-auto lg:block lg:scroll-mt-4`}
          >
            {mobileCheckoutOpen ? (
              <button
                type="button"
                aria-label="Close order review"
                onClick={() => setMobileCheckoutOpen(false)}
                className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px] lg:hidden"
              />
            ) : null}
            <form
              onSubmit={handleSubmit}
              role={mobileCheckoutOpen ? "dialog" : undefined}
              aria-modal={mobileCheckoutOpen ? true : undefined}
              aria-labelledby="checkout-title"
              className="relative z-10 max-h-[92svh] w-full space-y-4 overflow-y-auto rounded-t-3xl border border-[#dfd5c6] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:p-5 lg:max-h-none lg:overflow-visible lg:rounded-2xl lg:shadow-sm"
            >
              <div className="sticky top-0 z-20 -mx-4 -mt-4 flex items-start justify-between gap-3 border-b border-[#eee5d9] bg-white px-4 py-4 sm:-mx-5 sm:-mt-5 sm:px-5 lg:static lg:m-0 lg:border-0 lg:p-0">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-primary">Order details</p>
                  <h2 id="checkout-title" className="font-heading text-2xl font-black text-slate-950">Review and submit</h2>
                </div>
                <button
                  ref={checkoutCloseRef}
                  type="button"
                  onClick={() => setMobileCheckoutOpen(false)}
                  aria-label="Close order review"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 lg:hidden"
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>

              {selectedLines.length > 0 ? (
                <div className="space-y-2 rounded-2xl bg-slate-50 p-3">
                  {selectedLines.map(({ product, quantity }) => (
                    <div key={product.sku} className="flex items-start justify-between gap-3 border-b border-slate-200 pb-2 last:border-0 last:pb-0">
                      <div className="min-w-0 text-sm">
                        <p className="line-clamp-2 font-bold text-slate-900">{product.product_name}</p>
                        <p className="text-slate-500">{quantity} × {formatCurrency(Number(product.retail_price))}</p>
                      </div>
                      <span className="shrink-0 font-mono font-black tabular-nums">{formatCurrency(quantity * Number(product.retail_price))}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 text-lg font-black">
                    <span>Total</span>
                    <span className="font-mono tabular-nums text-primary">{formatCurrency(total)}</span>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm font-semibold text-slate-500">
                  Add products to begin your order.
                </div>
              )}

              <label className="block space-y-1.5 text-sm font-bold text-slate-800">
                Full name
                <input required value={draft.customerName} onChange={(event) => updateDraft("customerName", event.target.value)} className="w-full text-base sm:text-sm" autoComplete="name" placeholder="Juan Dela Cruz" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5 text-sm font-bold text-slate-800">
                  Mobile number
                  <input type="tel" value={draft.contactPhone} onChange={(event) => updateDraft("contactPhone", event.target.value)} className="w-full text-base sm:text-sm" autoComplete="tel" inputMode="tel" placeholder="09171234567" />
                </label>
                <label className="block space-y-1.5 text-sm font-bold text-slate-800">
                  Email
                  <input type="email" value={draft.contactEmail} onChange={(event) => updateDraft("contactEmail", event.target.value)} className="w-full text-base sm:text-sm" autoComplete="email" inputMode="email" placeholder="name@example.com" />
                </label>
              </div>
              <p className="-mt-2 text-xs font-semibold text-slate-500">At least one contact method is required.</p>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5 text-sm font-bold text-slate-800">
                  Fulfillment date
                  <input type="date" required min={new Date().toISOString().slice(0, 10)} value={draft.fulfillmentDate} onChange={(event) => updateDraft("fulfillmentDate", event.target.value)} className="w-full text-base sm:text-sm" />
                </label>
                <label className="block space-y-1.5 text-sm font-bold text-slate-800">
                  Fulfillment time
                  <input type="time" required value={draft.fulfillmentTime} onChange={(event) => updateDraft("fulfillmentTime", event.target.value)} className="w-full text-base sm:text-sm" />
                </label>
              </div>

              <fieldset>
                <legend className="text-sm font-bold text-slate-800">Fulfillment method</legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {catalog.allowed_fulfillment_methods.map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => updateDraft("fulfillmentMethod", method)}
                      className={`flex min-h-12 items-center justify-center rounded-xl border text-sm font-bold transition-colors cursor-pointer ${
                        draft.fulfillmentMethod === method
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </fieldset>

              {draft.fulfillmentMethod === "Pickup" ? (
                <div className="rounded-2xl border border-sky-200 bg-sky-50/90 p-4 text-sky-950 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-sky-900 text-sm">
                    <MapPin size={18} className="text-sky-600 shrink-0" aria-hidden="true" />
                    <span>Sunday Market Pickup Schedule & Location</span>
                  </div>
                  <div className="text-xs leading-relaxed text-sky-900 space-y-1">
                    <p className="flex items-center gap-1.5 font-bold">
                      <Clock size={14} className="text-sky-600 shrink-0" aria-hidden="true" />
                      Sundays ONLY: 7:45 AM – 11:30 AM
                    </p>
                    <p className="font-bold text-sky-950 pt-0.5">Elbi Community Market</p>
                    <p className="text-sky-800">
                      Meister&apos;s Uncorked Parking Lot, Ruby St., corner Bulusan St., Umali Subd., Brgy. Batong Malake, Los Baños, Philippines, 4030
                    </p>
                  </div>
                </div>
              ) : null}

              {draft.fulfillmentMethod === "Delivery" ? (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 space-y-1.5 shadow-xs">
                    <div className="flex items-center gap-2 font-black text-amber-900 text-sm">
                      <Truck size={18} className="text-amber-700 shrink-0" aria-hidden="true" />
                      <span>CLIENT WILL SHOULDER DELIVERY FEE</span>
                    </div>
                    <p className="text-xs font-semibold text-amber-900 leading-relaxed">
                      Customer to book their own delivery service (e.g. Lalamove, Maxim, Grab Express) once H+H confirms order readiness.
                    </p>
                  </div>
                  <label className="block space-y-1.5 text-sm font-bold text-slate-800">
                    Delivery address
                    <textarea
                      required
                      rows={3}
                      value={draft.deliveryAddress}
                      onChange={(event) => updateDraft("deliveryAddress", event.target.value)}
                      placeholder="Complete delivery address and landmarks"
                      className="w-full text-base sm:text-sm"
                    />
                  </label>
                </div>
              ) : null}

              {catalog.payment_preferences.length > 0 ? (
                <label className="block space-y-1.5 text-sm font-bold text-slate-800">
                  Preferred payment
                  <select
                    value={draft.paymentPreference}
                    onChange={(event) => updateDraft("paymentPreference", event.target.value)}
                    className="w-full text-base sm:text-sm"
                  >
                    {catalog.payment_preferences.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className="block space-y-1.5 text-sm font-bold text-slate-800">
                Notes (optional)
                <textarea
                  rows={2}
                  value={draft.notes}
                  onChange={(event) => updateDraft("notes", event.target.value)}
                  placeholder="Special instructions or gift notes"
                  className="w-full text-base sm:text-sm"
                />
              </label>

              {error ? (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-800">
                  <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <p>{error}</p>
                </div>
              ) : null}

              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                <ShieldCheck size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                <p><strong>Inventory notice:</strong> H+H reviews availability before confirming. Submitting does not reserve stock.</p>
              </div>

              <button
                type="submit"
                disabled={submitting || itemCount === 0 || total <= 0}
                className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-black text-white shadow-md hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              >
                {submitting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ShoppingBag aria-hidden="true" />}
                {submitting ? "Submitting securely" : `Submit ${formatCurrency(total)} pre-order`}
              </button>
            </form>
          </div>
        </div>
      </div>

      {itemCount > 0 && (
        <div className="pos-mobile-checkout fixed inset-x-3 bottom-3 z-40 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileCheckoutOpen(true)}
            aria-controls="checkout-section"
            aria-expanded={mobileCheckoutOpen}
            className="flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border border-amber-900/40 bg-amber-950 px-4 py-3 text-left text-white shadow-2xl backdrop-blur-md cursor-pointer"
          >
            <span>
              <span className="block text-xs font-medium text-amber-200">{itemCount} item{itemCount === 1 ? "" : "s"} selected</span>
              <span className="block font-mono text-lg font-black tabular-nums">{formatCurrency(total)}</span>
            </span>
            <span className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-600 px-3.5 text-sm font-bold text-white shadow-sm">
              Review order
              <ArrowRight size={16} aria-hidden="true" />
            </span>
          </button>
        </div>
      )}
    </main>
  );
}
