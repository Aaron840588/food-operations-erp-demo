/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChefHat,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  PackageCheck,
  Printer,
  Search,
  ShoppingBasket,
  Sparkles,
  Warehouse,
} from "lucide-react";

import {
  api,
  type ProductionCatalogItem,
  type ProductionForecastOut,
} from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { ConfirmationModal } from "@/components/ui/Modal";
import { NumericQuantityInput } from "@/components/ui/NumericQuantityInput";
import { ProductDisplay } from "@/components/ui/ProductDisplay";


type PlannerStep = "targets" | "materials" | "recipes";
type Notice = { type: "success" | "error"; text: string };
type ChecklistItem = ProductionForecastOut["material_checklist"][number];

const OUTLETS = [
  "General Stock",
  "AA Mart",
  "ECM",
  "Market Events",
] as const;

const INGREDIENT_CATEGORY_ORDER = [
  "Liquids and water",
  "Dairy",
  "Oils and fats",
  "Sweeteners",
  "Powders and dry ingredients",
  "Fruits and vegetables",
  "Seasonings and flavorings",
  "Toppings and inclusions",
  "Packaging materials",
  "Other / uncategorized",
];

const STEPS: Array<{
  id: PlannerStep;
  number: number;
  title: string;
  description: string;
}> = [
  {
    id: "targets",
    number: 1,
    title: "Set production",
    description: "Choose products and quantities",
  },
  {
    id: "materials",
    number: 2,
    title: "Prepare materials",
    description: "Pick stock and buy shortages",
  },
  {
    id: "recipes",
    number: 3,
    title: "Cook and log",
    description: "Follow scaled sheets, then complete",
  },
];


function getManilaDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat("en-PH", {
    maximumFractionDigits: 2,
  }).format(value);
}

function ingredientKey(item: ChecklistItem): string {
  return `${item.ingredient_name}-${item.unit}`;
}


export default function PlannerPage() {
  const [products, setProducts] = useState<ProductionCatalogItem[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [planDate, setPlanDate] = useState(getManilaDate);
  const [selectedOutlet, setSelectedOutlet] = useState<string>("General Stock");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [productSearch, setProductSearch] = useState("");
  const [ingredientSearch, setIngredientSearch] = useState("");
  const [activeStep, setActiveStep] = useState<PlannerStep>("targets");
  const [forecast, setForecast] = useState<ProductionForecastOut | null>(null);
  const [checkedIngredients, setCheckedIngredients] = useState<Record<string, boolean>>({});
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [forecasting, setForecasting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [marketEvents, setMarketEvents] = useState<any[]>([]);
  const [selectedImportEventId, setSelectedImportEventId] = useState<string>("");

  const loadCatalog = useCallback(async () => {
    setProductsLoading(true);
    setCatalogError(null);
    try {
      const catalog = await api.getProductionCatalog();
      setProducts(catalog);
    } catch (error) {
      setCatalogError(
        getErrorMessage(error, "The production catalog could not be loaded."),
      );
    } finally {
      setProductsLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.all([
      api.getProductionCatalog().catch((error) => {
        setCatalogError(
          getErrorMessage(error, "The production catalog could not be loaded."),
        );
        return [];
      }),
      api.getMarketEvents().catch(() => []),
    ]).then(([catalog, events]) => {
      setProducts(catalog || []);
      const activeOrDraft = (events || []).filter((e: any) => e.status === "Draft" || e.status === "Active");
      setMarketEvents(activeOrDraft);
    }).finally(() => setProductsLoading(false));
  }, []);

  const invalidateForecast = useCallback(() => {
    setForecast(null);
    setCheckedIngredients({});
    setActiveStep("targets");
  }, []);

  const handleImportFromMarketEvent = (eventIdStr: string) => {
    setSelectedImportEventId(eventIdStr);
    if (!eventIdStr) return;
    const eventId = Number(eventIdStr);
    const event = marketEvents.find((e) => e.id === eventId);
    if (!event || !event.allocations || event.allocations.length === 0) {
      setNotice({
        type: "error",
        text: "The selected market event has no target product allocations.",
      });
      return;
    }

    const newQuantities: Record<string, number> = {};
    event.allocations.forEach((alloc: any) => {
      if (alloc.sku && alloc.quantity > 0) {
        newQuantities[alloc.sku] = alloc.quantity;
      }
    });

    setQuantities(newQuantities);
    setSelectedOutlet("Market Events");
    setNotice({
      type: "success",
      text: `Imported target quantities from "${event.name}" (${event.allocations.length} SKUs).`,
    });
    invalidateForecast();
  };

  const handleQuantityChange = (sku: string, value: number) => {
    const wholeQuantity = Math.max(0, Math.floor(value));
    setQuantities((current) => {
      const next = { ...current };
      if (wholeQuantity === 0) {
        delete next[sku];
      } else {
        next[sku] = wholeQuantity;
      }
      return next;
    });
    setNotice(null);
    invalidateForecast();
  };

  const handleOutletChange = (outlet: string) => {
    setSelectedOutlet(outlet);
    setNotice(null);
    invalidateForecast();
  };

  const selectedTargets = useMemo(
    () =>
      Object.entries(quantities)
        .filter(([, quantity]) => quantity > 0)
        .map(([sku, quantity]) => ({
          sku,
          quantity,
          outlet: selectedOutlet,
        })),
    [quantities, selectedOutlet],
  );

  const selectedProducts = useMemo(
    () =>
      selectedTargets
        .map((target) => ({
          target,
          product: products.find((product) => product.sku === target.sku),
        }))
        .filter(
          (
            row,
          ): row is {
            target: (typeof selectedTargets)[number];
            product: ProductionCatalogItem;
          } => Boolean(row.product),
        ),
    [products, selectedTargets],
  );

  const selectedUnits = selectedTargets.reduce(
    (total, target) => total + target.quantity,
    0,
  );

  const categories = useMemo(
    () =>
      Array.from(
        new Set(products.map((product) => product.category || "Uncategorized")),
      ).sort((left, right) => left.localeCompare(right)),
    [products],
  );

  const visibleProducts = useMemo(() => {
    const search = productSearch.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory =
        selectedCategory === "All" || product.category === selectedCategory;
      const matchesSearch =
        !search ||
        product.product_name.toLowerCase().includes(search) ||
        product.sku.toLowerCase().includes(search) ||
        product.category.toLowerCase().includes(search);
      return matchesCategory && matchesSearch;
    });
  }, [productSearch, products, selectedCategory]);

  const visibleProductGroups = useMemo(() => {
    const groups = new Map<string, ProductionCatalogItem[]>();
    visibleProducts.forEach((product) => {
      const category = product.category || "Uncategorized";
      groups.set(category, [...(groups.get(category) || []), product]);
    });
    return Array.from(groups.entries()).sort(([left], [right]) =>
      left.localeCompare(right),
    );
  }, [visibleProducts]);

  const groupedChecklist = useMemo(() => {
    const groups = new Map<string, ChecklistItem[]>();
    const search = ingredientSearch.trim().toLowerCase();
    (forecast?.material_checklist || [])
      .filter(
        (item) =>
          !search ||
          item.ingredient_name.toLowerCase().includes(search) ||
          (item.category || "").toLowerCase().includes(search) ||
          (item.parent_products || []).some((parent) =>
            parent.toLowerCase().includes(search),
          ),
      )
      .forEach((item) => {
        const category = item.category || "Other / uncategorized";
        groups.set(category, [...(groups.get(category) || []), item]);
      });
    return Array.from(groups.entries()).sort(([left], [right]) => {
      const leftIndex = INGREDIENT_CATEGORY_ORDER.indexOf(left);
      const rightIndex = INGREDIENT_CATEGORY_ORDER.indexOf(right);
      return (
        (leftIndex === -1 ? 999 : leftIndex) -
          (rightIndex === -1 ? 999 : rightIndex) ||
        left.localeCompare(right)
      );
    });
  }, [forecast, ingredientSearch]);

  const shortageCount =
    forecast?.material_checklist.filter((item) => item.deficit > 0).length || 0;
  const checkedCount =
    forecast?.material_checklist.filter(
      (item) => checkedIngredients[ingredientKey(item)],
    ).length || 0;

  const handleForecast = async () => {
    if (selectedTargets.length === 0) {
      setNotice({
        type: "error",
        text: "Add at least one product quantity before preparing materials.",
      });
      return;
    }

    setForecasting(true);
    setNotice(null);
    try {
      const result = await api.runForecast(selectedTargets);
      setForecast(result);
      setCheckedIngredients({});
      setActiveStep("materials");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setNotice({
        type: "error",
        text: getErrorMessage(error, "The production forecast could not be computed."),
      });
    } finally {
      setForecasting(false);
    }
  };

  const handleComplete = async () => {
    if (!forecast || selectedTargets.length === 0) return;

    setSaving(true);
    setNotice(null);
    try {
      const completed = await api.completeProductionPlan({
        plan_date: planDate,
        targets: selectedTargets.map((target) => ({
          sku: target.sku,
          outlet: target.outlet,
          target_qty: target.quantity,
        })),
      });
      setIsConfirmOpen(false);
      setQuantities({});
      setForecast(null);
      setCheckedIngredients({});
      setActiveStep("targets");
      setNotice({
        type: "success",
        text: `Production plan #${completed.id} for ${completed.plan_date} is complete. Ingredient and finished-stock balances were updated together.`,
      });
      await loadCatalog();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setNotice({
        type: "error",
        text: getErrorMessage(error, "Production could not be completed."),
      });
      setIsConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const goToStep = (step: PlannerStep) => {
    if (step !== "targets" && !forecast) return;
    setActiveStep(step);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const renderPrimaryAction = (mobile = false) => {
    if (activeStep === "targets") {
      return (
        <Button
          type="button"
          onClick={handleForecast}
          isLoading={forecasting}
          disabled={selectedTargets.length === 0}
          className={mobile ? "w-full" : "w-full"}
          rightIcon={<ArrowRight size={16} />}
        >
          Prepare materials
        </Button>
      );
    }
    if (activeStep === "materials") {
      return (
        <Button
          type="button"
          onClick={() => goToStep("recipes")}
          className={mobile ? "w-full" : "w-full"}
          rightIcon={<ArrowRight size={16} />}
        >
          Open recipe sheets
        </Button>
      );
    }
    return (
      <Button
        type="button"
        onClick={() => setIsConfirmOpen(true)}
        disabled={!forecast || saving}
        className={mobile ? "w-full bg-emerald-700 hover:bg-emerald-800" : "w-full bg-emerald-700 hover:bg-emerald-800"}
        leftIcon={<PackageCheck size={17} />}
      >
        Log finished production
      </Button>
    );
  };

  return (
    <main className="space-y-5 pb-32 print:pb-0 lg:space-y-6 lg:pb-10">
      <header className="rounded-3xl border border-[#dfd5c6] bg-[linear-gradient(135deg,#fff_0%,#fbf7ef_100%)] p-5 shadow-sm sm:p-6 print:border-0 print:p-0 print:shadow-none">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-primary">
              <ChefHat size={17} aria-hidden="true" />
              Kitchen workspace
            </div>
            <h1 className="font-heading text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
              Production Planner
            </h1>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-600">
              Set the finished quantities first. The planner then turns them into
              a pick-and-buy list and dependency-ordered recipe sheets.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:w-[620px]">
            <label className="space-y-1.5 text-xs font-black uppercase tracking-wide text-slate-600">
              <span className="flex items-center gap-1.5">
                <CalendarDays size={14} aria-hidden="true" />
                Production date
              </span>
              <input
                type="date"
                value={planDate}
                onChange={(event) => setPlanDate(event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm font-bold text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="space-y-1.5 text-xs font-black uppercase tracking-wide text-slate-600">
              <span className="flex items-center gap-1.5">
                <Warehouse size={14} aria-hidden="true" />
                Destination
              </span>
              <select
                value={selectedOutlet}
                onChange={(event) => handleOutletChange(event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                {OUTLETS.map((outlet) => (
                  <option key={outlet} value={outlet}>
                    {outlet}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-xs font-black uppercase tracking-wide text-slate-600">
              <span className="flex items-center gap-1.5 text-[#885625]">
                <Sparkles size={14} aria-hidden="true" />
                Import Event Target
              </span>
              <select
                value={selectedImportEventId}
                onChange={(event) => handleImportFromMarketEvent(event.target.value)}
                className="h-11 w-full rounded-xl border-2 border-amber-300 bg-amber-50/60 px-3 text-xs font-bold text-amber-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="">-- Choose Market Event --</option>
                {marketEvents.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({formatDate(e.event_date)})
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </header>

      <nav
        aria-label="Production workflow"
        className="print:hidden"
      >
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {STEPS.map((step) => {
            const isActive = activeStep === step.id;
            const isAvailable = step.id === "targets" || Boolean(forecast);
            const isComplete =
              forecast &&
              ((step.id === "targets" && activeStep !== "targets") ||
                (step.id === "materials" && activeStep === "recipes"));
            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => goToStep(step.id)}
                  disabled={!isAvailable}
                  aria-current={isActive ? "step" : undefined}
                  className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-45 ${
                    isActive
                      ? "border-primary bg-primary text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-700 hover:border-primary/30 hover:bg-[#fbf8f2]"
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                      isActive
                        ? "bg-white text-primary"
                        : isComplete
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {isComplete ? <Check size={16} aria-hidden="true" /> : step.number}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-black">{step.title}</span>
                    <span
                      className={`block truncate text-[11px] font-semibold ${
                        isActive ? "text-white/75" : "text-slate-400"
                      }`}
                    >
                      {step.description}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {notice && (
        <div
          role={notice.type === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`flex items-start gap-3 rounded-2xl border p-4 text-sm font-bold ${
            notice.type === "error"
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {notice.type === "error" ? (
            <AlertTriangle className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
          ) : (
            <CheckCircle2 className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {activeStep === "targets" && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section aria-labelledby="catalog-heading" className="min-w-0 space-y-4">
            <Card className="border border-slate-200 bg-white shadow-sm">
              <CardHeader className="gap-4">
                <div>
                  <CardTitle id="catalog-heading" className="flex items-center gap-2">
                    <ClipboardList size={19} className="text-primary" aria-hidden="true" />
                    1. Choose what the kitchen will produce
                  </CardTitle>
                  <CardDescription>
                    Only active products with a complete recipe appear here. Pasta
                    tubs and other ready-to-eat recipes are included.
                  </CardDescription>
                </div>
                <div className="relative">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    size={16}
                    aria-hidden="true"
                  />
                  <label htmlFor="planner-product-search" className="sr-only">
                    Search producible products
                  </label>
                  <input
                    id="planner-product-search"
                    type="search"
                    value={productSearch}
                    onChange={(event) => setProductSearch(event.target.value)}
                    placeholder="Search product name or SKU"
                    className="h-11 w-full rounded-xl border border-slate-200 bg-[#fbf8f2] text-sm font-semibold text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    style={{ paddingLeft: "2.5rem", paddingRight: "0.75rem" }}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div
                  className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
                  aria-label="Filter products by category"
                >
                  {["All", ...categories].map((category) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setSelectedCategory(category)}
                      aria-pressed={selectedCategory === category}
                      className={`min-h-[44px] shrink-0 rounded-full border px-4 text-xs font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                        selectedCategory === category
                          ? "border-primary bg-primary text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:border-primary/30"
                      }`}
                    >
                      {category}
                    </button>
                  ))}
                </div>

                {productsLoading ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[0, 1, 2, 3].map((item) => (
                      <div
                        key={item}
                        className="h-40 animate-pulse rounded-2xl border border-slate-100 bg-slate-50"
                      />
                    ))}
                  </div>
                ) : catalogError ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-center">
                    <p className="text-sm font-bold text-rose-800">{catalogError}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void loadCatalog()}
                      className="mt-3"
                    >
                      Retry catalog
                    </Button>
                  </div>
                ) : visibleProductGroups.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
                    <p className="font-bold text-slate-700">No producible products match this filter.</p>
                    <p className="mt-1 text-xs font-medium text-slate-500">
                      Clear the search or choose another category.
                    </p>
                  </div>
                ) : (
                  visibleProductGroups.map(([category, categoryProducts]) => (
                    <section key={category} aria-labelledby={`category-${category}`}>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h2
                          id={`category-${category}`}
                          className="font-heading text-base font-black text-slate-900"
                        >
                          {category}
                        </h2>
                        <Badge variant="neutral">
                          {categoryProducts.length} product{categoryProducts.length === 1 ? "" : "s"}
                        </Badge>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {categoryProducts.map((product) => {
                          const quantity = quantities[product.sku] || 0;
                          const selected = quantity > 0;
                          return (
                            <article
                              key={product.sku}
                              className={`min-w-0 rounded-2xl border p-4 transition-colors ${
                                selected
                                  ? "border-primary bg-primary-light/10 ring-1 ring-primary/15"
                                  : "border-slate-200 bg-white"
                              }`}
                            >
                              <ProductDisplay
                                sku={product.sku}
                                productName={product.product_name}
                                category={product.category}
                                size={product.size}
                                variant="compact"
                                showMissingSize={false}
                              />
                              <dl className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-[#fbf8f2] p-3 text-xs">
                                <div>
                                  <dt className="font-bold uppercase tracking-wide text-slate-400">
                                    Finished stock
                                  </dt>
                                  <dd className="mt-0.5 font-mono text-sm font-black text-slate-800">
                                    {formatQuantity(product.warehouse_stock)}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="font-bold uppercase tracking-wide text-slate-400">
                                    Recipe output
                                  </dt>
                                  <dd className="mt-0.5 font-mono text-sm font-black text-slate-800">
                                    {product.units_per_batch} / batch
                                  </dd>
                                </div>
                              </dl>
                              <div className="mt-4 flex min-w-0 items-center justify-between gap-3">
                                <span className="text-xs font-black uppercase tracking-wide text-slate-500">
                                  Target units
                                </span>
                                <NumericQuantityInput
                                  value={quantity}
                                  onChange={(value) =>
                                    handleQuantityChange(product.sku, value)
                                  }
                                  label={`Target quantity for ${product.product_name}`}
                                  min={0}
                                  step={1}
                                  size="sm"
                                />
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  ))
                )}
              </CardContent>
            </Card>
          </section>

          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <SelectionSummary
                selectedProducts={selectedProducts}
                selectedUnits={selectedUnits}
                planDate={planDate}
                outlet={selectedOutlet}
                forecasting={forecasting}
                onPrepare={handleForecast}
              />
            </div>
          </aside>
        </div>
      )}

      {activeStep === "materials" && forecast && (
        <section aria-labelledby="materials-heading" className="space-y-5">
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardContent className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
              <div>
                <div className="flex items-center gap-2">
                  <ShoppingBasket size={20} className="text-primary" aria-hidden="true" />
                  <h2 id="materials-heading" className="font-heading text-xl font-black text-slate-950">
                    2. Prepare ingredients
                  </h2>
                </div>
                <p className="mt-1 text-sm font-medium text-slate-500">
                  Pick available stock first, then purchase only the highlighted shortages.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <Metric label="Ingredients" value={forecast.material_checklist.length} />
                <Metric
                  label="Shortages"
                  value={shortageCount}
                  tone={shortageCount > 0 ? "danger" : "success"}
                />
                <Metric
                  label="Checked"
                  value={`${checkedCount}/${forecast.material_checklist.length}`}
                />
                <Metric
                  label="Buy budget"
                  value={formatCurrency(forecast.total_estimated_raw_material_cost)}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Pick-and-buy checklist</CardTitle>
                <CardDescription>
                  Needed quantities already include every nested sub-recipe.
                </CardDescription>
              </div>
              <div className="relative w-full sm:w-72">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  size={15}
                  aria-hidden="true"
                />
                <label htmlFor="ingredient-search" className="sr-only">
                  Search ingredients
                </label>
                <input
                  id="ingredient-search"
                  type="search"
                  value={ingredientSearch}
                  onChange={(event) => setIngredientSearch(event.target.value)}
                  placeholder="Search ingredient or recipe"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white text-xs font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  style={{ paddingLeft: "2.25rem", paddingRight: "0.75rem" }}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {groupedChecklist.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-500">
                  No ingredients match this search.
                </div>
              ) : (
                groupedChecklist.map(([category, items]) => {
                  const collapsed = Boolean(collapsedCategories[category]);
                  const categoryShortages = items.filter((item) => item.deficit > 0).length;
                  return (
                    <section
                      key={category}
                      className="overflow-hidden rounded-2xl border border-slate-200"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedCategories((current) => ({
                            ...current,
                            [category]: !current[category],
                          }))
                        }
                        aria-expanded={!collapsed}
                        className="flex min-h-12 w-full items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-black text-slate-800">
                            {category}
                          </span>
                          <Badge variant="neutral">{items.length}</Badge>
                          {categoryShortages > 0 && (
                            <Badge variant="danger">
                              {categoryShortages} short
                            </Badge>
                          )}
                        </span>
                        {collapsed ? (
                          <ChevronDown size={17} aria-hidden="true" />
                        ) : (
                          <ChevronUp size={17} aria-hidden="true" />
                        )}
                      </button>

                      {!collapsed && (
                        <div className="divide-y divide-slate-100">
                          {items.map((item) => {
                            const key = ingredientKey(item);
                            const checked = Boolean(checkedIngredients[key]);
                            return (
                              <article
                                key={key}
                                className={`p-4 sm:p-5 ${
                                  item.deficit > 0
                                    ? checked
                                      ? "bg-rose-50/25"
                                      : "bg-rose-50/50"
                                    : checked
                                      ? "bg-emerald-50/50"
                                      : "bg-white"
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  <input
                                    id={`check-${key}`}
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() =>
                                      setCheckedIngredients((current) => ({
                                        ...current,
                                        [key]: !current[key],
                                      }))
                                    }
                                    className="mt-0.5 h-6 w-6 shrink-0 accent-emerald-700"
                                  />
                                  <label htmlFor={`check-${key}`} className="min-w-0 flex-1 cursor-pointer">
                                    <span
                                      className="block text-sm font-black text-slate-900"
                                    >
                                      {item.ingredient_name}
                                    </span>
                                    {(item.parent_products || []).length > 0 && (
                                      <span className="mt-1 block text-xs font-medium leading-5 text-slate-500">
                                        Used for {item.parent_products?.join(", ")}
                                      </span>
                                    )}
                                  </label>
                                  {item.deficit > 0 ? (
                                    <Badge variant="danger">
                                      Buy {item.packs_to_buy} pack{item.packs_to_buy === 1 ? "" : "s"}
                                    </Badge>
                                  ) : (
                                    <Badge variant="success">In stock</Badge>
                                  )}
                                </div>

                                <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                  <IngredientMetric
                                    label="Needed"
                                    value={`${formatQuantity(item.total_needed)} ${item.unit}`}
                                  />
                                  <IngredientMetric
                                    label="Available"
                                    value={`${formatQuantity(item.available_stock)} ${item.unit}`}
                                  />
                                  <IngredientMetric
                                    label="Short"
                                    value={
                                      item.deficit > 0
                                        ? `${formatQuantity(item.deficit)} ${item.unit}`
                                        : "None"
                                    }
                                    tone={item.deficit > 0 ? "danger" : "success"}
                                  />
                                  <IngredientMetric
                                    label="Est. cost"
                                    value={formatCurrency(item.estimated_cost)}
                                  />
                                </dl>
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  );
                })
              )}
            </CardContent>
          </Card>

          <div className="hidden justify-between gap-3 lg:flex">
            <Button
              type="button"
              variant="outline"
              onClick={() => goToStep("targets")}
              leftIcon={<ArrowLeft size={16} />}
            >
              Adjust targets
            </Button>
            <Button
              type="button"
              onClick={() => goToStep("recipes")}
              rightIcon={<ArrowRight size={16} />}
            >
              Open recipe sheets
            </Button>
          </div>
        </section>
      )}

      {activeStep === "recipes" && forecast && (
        <section aria-labelledby="recipes-heading" className="space-y-5 print:space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 print:border-0 print:p-0 print:shadow-none">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <ChefHat size={20} className="text-primary" aria-hidden="true" />
                  <h2 id="recipes-heading" className="font-heading text-xl font-black text-slate-950">
                    3. Cook in dependency order
                  </h2>
                </div>
                <p className="mt-1 text-sm font-medium text-slate-500">
                  Make sub-recipes first. Every ingredient line is scaled to this plan.
                </p>
                <p className="mt-2 font-mono text-xs font-bold text-slate-500">
                  {planDate} · {selectedOutlet} · {selectedUnits} finished units
                </p>
              </div>
              <div className="flex gap-2 print:hidden">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => window.print()}
                  leftIcon={<Printer size={16} />}
                >
                  Print sheets
                </Button>
                <Button
                  type="button"
                  onClick={() => setIsConfirmOpen(true)}
                  className="hidden bg-emerald-700 hover:bg-emerald-800 lg:inline-flex"
                  leftIcon={<PackageCheck size={17} />}
                >
                  Log finished production
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2 print:grid-cols-1">
            {forecast.scaled_recipes.map((recipe, index) => {
              const product = products.find(
                (catalogProduct) => catalogProduct.sku === recipe.target_sku,
              );
              return (
                <article
                  key={`${recipe.target_sku}-${index}`}
                  className="break-inside-avoid rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 print:rounded-none print:border-x-0 print:shadow-none"
                >
                  <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
                    <div className="min-w-0">
                      <span className="mb-2 inline-flex rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-white">
                        {index + 1} of {forecast.scaled_recipes.length}
                      </span>
                      <ProductDisplay
                        sku={recipe.target_sku}
                        productName={product?.product_name || recipe.recipe_name}
                        category={product?.category || "Sub-recipe"}
                        size={product?.size}
                        variant="compact"
                        showMissingSize={false}
                      />
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="block font-mono text-lg font-black text-primary">
                        {formatQuantity(recipe.batches_needed)}
                      </span>
                      <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                        batches
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl bg-[#fbf8f2] px-4 py-3">
                    <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                      Expected yield
                    </span>
                    <span className="ml-2 font-mono text-sm font-black text-slate-900">
                      {formatQuantity(recipe.scaled_yield)} {recipe.yield_unit}
                    </span>
                  </div>

                  <div className="mt-4 divide-y divide-slate-100">
                    {recipe.scaled_ingredients.map((ingredient, ingredientIndex) => (
                      <div
                        key={`${ingredient.id}-${ingredientIndex}`}
                        className="flex items-start justify-between gap-4 py-3"
                      >
                        <div className="min-w-0">
                          <span className="block text-sm font-bold text-slate-800">
                            {ingredient.raw_ingredient_name ||
                              ingredient.sub_product_name ||
                              ingredient.sub_sku}
                          </span>
                          {ingredient.ingredient_type === "sku" && (
                            <span className="mt-0.5 block text-[10px] font-black uppercase tracking-wide text-primary">
                              Prepared sub-recipe
                            </span>
                          )}
                        </div>
                        <span className="shrink-0 font-mono text-sm font-black tabular-nums text-slate-950">
                          {formatQuantity(ingredient.base_qty)} {ingredient.base_unit}
                        </span>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="hidden lg:block print:hidden">
            <Button
              type="button"
              variant="outline"
              onClick={() => goToStep("materials")}
              leftIcon={<ArrowLeft size={16} />}
            >
              Back to materials
            </Button>
          </div>
        </section>
      )}

      {activeStep !== "targets" && !forecast && (
        <Card className="border border-amber-200 bg-amber-50">
          <CardContent className="p-6 text-center">
            <AlertTriangle className="mx-auto text-amber-700" aria-hidden="true" />
            <p className="mt-2 font-black text-amber-900">
              Targets changed, so the previous forecast was cleared.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => goToStep("targets")}
              className="mt-4"
            >
              Return to targets
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur lg:hidden print:hidden">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <span className="block text-[10px] font-black uppercase tracking-wide text-slate-400">
              {selectedTargets.length} product{selectedTargets.length === 1 ? "" : "s"} selected
            </span>
            <span className="block truncate font-mono text-base font-black text-slate-900">
              {selectedUnits} units · {selectedOutlet}
            </span>
          </div>
          <div className="min-w-[178px]">{renderPrimaryAction(true)}</div>
        </div>
      </div>

      {isConfirmOpen && (
        <ConfirmationModal
          isOpen={isConfirmOpen}
          onClose={() => setIsConfirmOpen(false)}
          onConfirm={handleComplete}
          title="Log finished production?"
          confirmLabel="Complete and update stock"
          type="warning"
          isLoading={saving}
          message={
            <div className="space-y-4 text-sm leading-6 text-slate-600">
              <p className="font-bold text-slate-800">
                Confirm only after the kitchen has actually produced these quantities.
              </p>
              <div className="max-h-52 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
                {selectedProducts.map(({ product, target }) => (
                  <div
                    key={product.sku}
                    className="flex items-center justify-between gap-4 rounded-xl bg-white p-3"
                  >
                    <div className="min-w-0">
                      <span className="block truncate font-black text-slate-900">
                        {product.product_name}
                      </span>
                      <span className="font-mono text-[10px] font-bold text-slate-400">
                        {product.sku}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono font-black text-slate-900">
                      {target.quantity} units
                    </span>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                Raw ingredients will be deducted by FIFO, finished stock will be
                added, and Main Facility mirror balances will update in one
                transaction. If any part fails, nothing is committed.
              </div>
            </div>
          }
        />
      )}
    </main>
  );
}


function SelectionSummary({
  selectedProducts,
  selectedUnits,
  planDate,
  outlet,
  forecasting,
  onPrepare,
}: {
  selectedProducts: Array<{
    target: { sku: string; quantity: number; outlet: string };
    product: ProductionCatalogItem;
  }>;
  selectedUnits: number;
  planDate: string;
  outlet: string;
  forecasting: boolean;
  onPrepare: () => void;
}) {
  return (
    <Card className="border border-[#d7c8b5] bg-white shadow-md">
      <CardHeader className="bg-[#fbf8f2]">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles size={17} className="text-primary" aria-hidden="true" />
          Selected production
        </CardTitle>
        <CardDescription>
          Review the finished units before calculating ingredients.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-2">
          <IngredientMetric label="Date" value={planDate} />
          <IngredientMetric label="Destination" value={outlet} />
          <IngredientMetric label="Products" value={selectedProducts.length} />
          <IngredientMetric label="Finished units" value={selectedUnits} />
        </dl>

        {selectedProducts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center">
            <ClipboardList className="mx-auto text-slate-300" aria-hidden="true" />
            <p className="mt-2 text-sm font-bold text-slate-500">
              Enter a target on any product card.
            </p>
          </div>
        ) : (
          <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1">
            {selectedProducts.map(({ target, product }) => (
              <div
                key={target.sku}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <span className="block truncate text-xs font-black text-slate-800">
                    {product.product_name}
                  </span>
                  <span className="font-mono text-[10px] font-bold text-slate-400">
                    {product.sku}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-sm font-black text-primary">
                  {target.quantity}
                </span>
              </div>
            ))}
          </div>
        )}

        <Button
          type="button"
          onClick={onPrepare}
          isLoading={forecasting}
          disabled={selectedProducts.length === 0}
          className="w-full"
          rightIcon={<ArrowRight size={16} />}
        >
          Prepare materials
        </Button>
      </CardContent>
    </Card>
  );
}


function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "danger" | "success";
}) {
  const toneClass =
    tone === "danger"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-slate-200 bg-slate-50 text-slate-800";
  return (
    <div className={`min-w-24 rounded-xl border px-3 py-2 ${toneClass}`}>
      <span className="block text-[9px] font-black uppercase tracking-wide opacity-60">
        {label}
      </span>
      <span className="mt-0.5 block whitespace-nowrap font-mono text-sm font-black">
        {value}
      </span>
    </div>
  );
}


function IngredientMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "danger" | "success";
}) {
  const valueClass =
    tone === "danger"
      ? "text-rose-700"
      : tone === "success"
        ? "text-emerald-700"
        : "text-slate-800";
  return (
    <div className="min-w-0 rounded-xl border border-slate-100 bg-white px-3 py-2">
      <dt className="text-[9px] font-black uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className={`mt-0.5 truncate font-mono text-xs font-black ${valueClass}`}>
        {value}
      </dd>
    </div>
  );
}
