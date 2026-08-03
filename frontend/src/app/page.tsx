"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeDollarSign,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  CookingPot,
  Info,
  PackageSearch,
  RefreshCw,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  api,
  type DashboardMetric,
  type DashboardSummaryOut,
  type OwnerDashboardAlert,
  type OwnerDashboardProduct,
  type OwnerWeeklyDashboard,
} from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";

const DASHBOARD_CACHE_KEY = "hh_cache_dashboard_summary";
const DAY_MS = 86_400_000;
const COST_COLORS = ["#0284c7", "#f97316", "#10b981", "#f59e0b"];

type ProductView =
  | "srp_margin"
  | "price_food"
  | "price_labor"
  | "price_utility"
  | "all_costs";
type AlertFilter = "all" | OwnerDashboardAlert["priority"];
type ProductCategory = "all" | OwnerDashboardProduct["category"];

const PRODUCT_VIEW_OPTIONS: Array<{ value: ProductView; label: string }> = [
  { value: "srp_margin", label: "SRP vs profit margin" },
  { value: "price_food", label: "Price vs food cost" },
  { value: "price_labor", label: "Price vs labor cost" },
  { value: "price_utility", label: "Price vs utility cost" },
  { value: "all_costs", label: "All costs per product" },
];

function getManilaTodayIso() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addIsoDays(isoDate: string, days: number) {
  const value = new Date(`${isoDate}T00:00:00Z`);
  return new Date(value.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function startOfWeekIso(isoDate: string) {
  const value = new Date(`${isoDate}T00:00:00Z`);
  const mondayOffset = (value.getUTCDay() + 6) % 7;
  return addIsoDays(isoDate, -mondayOffset);
}

function shortProductName(name: string) {
  return name.length > 17 ? `${name.slice(0, 15)}…` : name;
}

function percentage(value: number) {
  return `${value.toFixed(1)}%`;
}

function comparisonText(metric: DashboardMetric, comparisonLabel: string) {
  if (metric.change_pct === null) return "No comparable activity";
  const direction = metric.direction === "up" ? "up" : metric.direction === "down" ? "down" : "flat";
  return `${Math.abs(metric.change_pct).toFixed(1)}% ${direction} vs ${comparisonLabel}`;
}

function DeltaIcon({ direction }: { direction: DashboardMetric["direction"] }) {
  if (direction === "up") return <ArrowUpRight className="h-3.5 w-3.5 text-emerald-600 stroke-[2.5]" />;
  if (direction === "down") return <ArrowDownRight className="h-3.5 w-3.5 text-rose-600 stroke-[2.5]" />;
  return <span className="h-px w-3 bg-current" aria-hidden="true" />;
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-[1540px] animate-pulse space-y-5 pb-8">
      <div className="h-24 rounded-2xl border border-[#dfd5c6] bg-white/60" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-36 rounded-2xl border border-[#dfd5c6] bg-white/70" />
        ))}
      </div>
      <div className="h-80 rounded-2xl border border-[#dfd5c6] bg-white/70" />
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="h-80 rounded-2xl border border-[#dfd5c6] bg-white/70" />
        <div className="h-80 rounded-2xl border border-[#dfd5c6] bg-white/70" />
      </div>
    </div>
  );
}

function KpiCard({
  title,
  metric,
  icon,
  comparisonLabel,
  caption,
  accent = "sky",
  isPending = false,
}: {
  title: string;
  metric: DashboardMetric;
  icon: React.ReactNode;
  comparisonLabel: string;
  caption: React.ReactNode;
  accent?: "sky" | "blue" | "emerald" | "amber" | "rose" | "brown";
  isPending?: boolean;
}) {
  const accentIconStyles = {
    sky: "bg-sky-600 text-white shadow-xs",
    blue: "bg-blue-600 text-white shadow-xs",
    emerald: "bg-emerald-600 text-white shadow-xs",
    amber: "bg-amber-500 text-white shadow-xs",
    rose: "bg-rose-600 text-white shadow-xs",
    brown: "bg-[#885625] text-white shadow-xs",
  };

  return (
    <Card className="min-h-36 border border-slate-200/80 bg-white shadow-xs transition-all hover:shadow-md">
      <CardContent className="flex h-full flex-col justify-between gap-5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">
              {title}
            </p>
            {isPending ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="font-heading text-[1.85rem] font-black leading-none tracking-tight text-slate-400">
                  —
                </span>
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 border border-amber-300/70">
                  Formula Pending
                </span>
              </div>
            ) : (
              <p className="mt-2 font-heading text-[2rem] font-black leading-none tracking-tight text-slate-900">
                {formatCurrency(metric.value)}
              </p>
            )}
          </div>
          <div className={`rounded-xl p-2.5 ${accentIconStyles[accent]}`}>{icon}</div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
          {isPending ? (
            <span className="inline-flex items-center gap-1 text-amber-700 font-bold">
              Unlinked (awaiting formula)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-slate-600">
              <DeltaIcon direction={metric.direction} />
              {comparisonText(metric, comparisonLabel)}
            </span>
          )}
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-700 border border-slate-200/60">
            {caption}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function PriorityIcon({ priority }: { priority: OwnerDashboardAlert["priority"] }) {
  if (priority === "critical") {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-50 text-rose-600">
        <CircleAlert className="h-4 w-4" />
      </span>
    );
  }
  if (priority === "warning") {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-50 text-amber-700">
        <AlertTriangle className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-50 text-sky-700">
      <Info className="h-4 w-4" />
    </span>
  );
}

function AlertsPanel({
  alerts,
  onNavigate,
}: {
  alerts: OwnerDashboardAlert[];
  onNavigate: (path: string) => void;
}) {
  const [filter, setFilter] = useState<AlertFilter>("all");
  const filteredAlerts = alerts.filter((alert) => filter === "all" || alert.priority === filter);
  const counts = alerts.reduce(
    (acc, alert) => ({ ...acc, [alert.priority]: acc[alert.priority] + 1 }),
    { critical: 0, warning: 0, info: 0 },
  );

  return (
    <Card>
      <CardHeader className="gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <CardTitle>Action Center</CardTitle>
            <span className="rounded-full bg-[#f5ede4] px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-[#885625]">
              {alerts.length} active
            </span>
          </div>
          <CardDescription>Ranked by what needs the owner&apos;s attention first.</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Filter action center">
          {([
            ["all", "All", alerts.length],
            ["critical", "Critical", counts.critical],
            ["warning", "Watch", counts.warning],
            ["info", "Events", counts.info],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                filter === value
                  ? "border-[#885625] bg-[#885625] text-white"
                  : "border-[#dfd5c6] bg-white text-[#735f4b] hover:bg-[#faf6ef]"
              }`}
            >
              {label} {count}
            </button>
          ))}
        </div>
      </CardHeader>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[920px] border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-100/80 text-[10px] font-black uppercase tracking-[0.12em] text-slate-600">
              <th className="px-6 py-3">Priority</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">What happened</th>
              <th className="px-4 py-3">Business impact</th>
              <th className="px-4 py-3">Due</th>
              <th className="px-6 py-3 text-right">Link to Page</th>
            </tr>
          </thead>
          <tbody>
            {filteredAlerts.map((alert) => (
              <tr key={alert.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80">
                <td className="px-6 py-3.5"><PriorityIcon priority={alert.priority} /></td>
                <td className="px-4 py-3.5 text-sm font-black text-slate-900">{alert.type}</td>
                <td className="max-w-md px-4 py-3.5 text-sm font-medium text-slate-700">{alert.message}</td>
                <td className="px-4 py-3.5 text-sm font-semibold text-slate-600">{alert.impact}</td>
                <td className="whitespace-nowrap px-4 py-3.5 text-sm font-bold text-slate-600">
                  {alert.due.match(/^\d{4}-\d{2}-\d{2}$/) ? formatDate(alert.due) : alert.due}
                </td>
                <td className="px-6 py-3.5 text-right">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-black text-[#0284c7] hover:text-sky-800 hover:underline"
                    onClick={() => onNavigate(alert.action_href)}
                  >
                    {alert.action_label}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-[#eee5d9] lg:hidden">
        {filteredAlerts.map((alert) => (
          <div key={alert.id} className="space-y-3 p-5">
            <div className="flex items-start gap-3">
              <PriorityIcon priority={alert.priority} />
              <div className="min-w-0 flex-1">
                <p className="font-black text-[#3b2b1b]">{alert.type}</p>
                <p className="mt-1 text-sm font-medium leading-relaxed text-[#66513c]">{alert.message}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 pl-11 text-xs font-bold text-[#8a7560]">
              <span>{alert.impact}</span>
              <span>{alert.due}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="ml-11"
              rightIcon={<ArrowRight className="h-3.5 w-3.5" />}
              onClick={() => onNavigate(alert.action_href)}
            >
              {alert.action_label}
            </Button>
          </div>
        ))}
      </div>
      {filteredAlerts.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
          <p className="font-heading text-lg font-bold text-[#3b2b1b]">Nothing in this queue</p>
          <p className="text-sm font-medium text-[#8a7560]">Choose another filter to review the remaining items.</p>
        </div>
      )}
    </Card>
  );
}

function WeeklyCostCharts({ dashboard }: { dashboard: OwnerWeeklyDashboard }) {
  const totalDirectCost = dashboard.cost_breakdown.reduce((sum, item) => sum + item.value, 0);
  return (
    <section className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
      <Card>
        <CardHeader>
          <CardTitle>Weekly direct cost by product line</CardTitle>
          <CardDescription>
            Food, labor, and utility allocations for items sold through {formatDate(dashboard.period.data_through)}.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {dashboard.cost_by_category.length > 0 ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dashboard.cost_by_category} margin={{ top: 12, right: 12, left: 4, bottom: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eadfd1" vertical={false} />
                  <XAxis
                    dataKey="category"
                    tick={{ fill: "#735f4b", fontSize: 11, fontWeight: 700 }}
                    axisLine={{ stroke: "#dfd5c6" }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(value) => `₱${Math.round(Number(value) / 1000)}k`}
                    tick={{ fill: "#8a7560", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    contentStyle={{ borderRadius: 12, borderColor: "#dfd5c6", boxShadow: "0 8px 24px rgba(45,31,14,.08)" }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
                  <Bar dataKey="food_cost" name="Food & packaging" stackId="cost" fill="#0284c7" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="labor_cost" name="Labor" stackId="cost" fill="#f97316" />
                  <Bar dataKey="utility_cost" name="Utilities" stackId="cost" fill="#10b981" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyChart message="No sold items were recorded in this period." />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Overall direct cost mix</CardTitle>
          <CardDescription>
            Labor basis: {dashboard.labor_basis === "approved_timesheets" ? "approved timesheets" : "standard SKU allocation"}.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {dashboard.cost_breakdown.length > 0 ? (
            <>
              <div className="relative h-[238px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={dashboard.cost_breakdown}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={67}
                      outerRadius={94}
                      paddingAngle={2}
                      stroke="#fff"
                      strokeWidth={3}
                    >
                      {dashboard.cost_breakdown.map((entry, index) => (
                        <Cell key={entry.name} fill={COST_COLORS[index % COST_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => formatCurrency(Number(value))}
                      contentStyle={{ borderRadius: 12, borderColor: "#dfd5c6" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#8a7560]">Direct cost</span>
                  <span className="mt-1 font-heading text-xl font-bold text-[#2d1f0e]">{formatCurrency(totalDirectCost)}</span>
                </div>
              </div>
              <div className="grid gap-2">
                {dashboard.cost_breakdown.map((item, index) => (
                  <div key={item.name} className="flex items-center justify-between gap-4 text-sm">
                    <span className="flex items-center gap-2 font-semibold text-[#66513c]">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COST_COLORS[index % COST_COLORS.length] }} />
                      {item.name}
                    </span>
                    <span className="font-black text-[#3b2b1b]">
                      {totalDirectCost > 0 ? percentage((item.value / totalDirectCost) * 100) : "0.0%"}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyChart message="No direct costs were recorded in this period." />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-[260px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#d9cbbb] bg-[#fcfaf7] text-center">
      <PackageSearch className="h-7 w-7 text-[#a8927b]" />
      <p className="text-sm font-bold text-[#735f4b]">{message}</p>
    </div>
  );
}

function ProductVisualizer({
  products,
  onOpenCosting,
}: {
  products: OwnerDashboardProduct[];
  onOpenCosting: () => void;
}) {
  const [view, setView] = useState<ProductView>("srp_margin");
  const [category, setCategory] = useState<ProductCategory>("all");

  const chartRows = useMemo(() => {
    const filtered = products.filter((product) => (
      product.cost_status === "ok"
      && (category === "all" || product.category === category)
    ));
    return filtered
      .sort((left, right) => {
        if (right.weekly_net_sales !== left.weekly_net_sales) {
          return right.weekly_net_sales - left.weekly_net_sales;
        }
        return right.net_margin_pct - left.net_margin_pct;
      })
      .slice(0, 10)
      .map((product) => ({
        ...product,
        chart_name: shortProductName(`${product.product_name} ${product.size}`),
      }));
  }, [category, products]);

  const invalidCount = products.filter((product) => product.cost_status !== "ok").length;
  const comparisonKey =
    view === "price_food"
      ? "food_cost"
      : view === "price_labor"
        ? "labor_cost"
        : "utility_cost";
  const comparisonLabel =
    view === "price_food"
      ? "Food & packaging"
      : view === "price_labor"
        ? "Labor"
        : "Utilities";

  return (
    <Card>
      <CardHeader className="gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <CardTitle>Product cost & margin visualizer</CardTitle>
          <CardDescription>
            Current per-unit economics for active Spreads & Sauces and Sandwiches & Salads.
          </CardDescription>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex rounded-xl border border-[#dfd5c6] bg-[#fcfaf7] p-1">
            {([
              ["all", "All"],
              ["Spreads & Sauces", "Spreads"],
              ["Sandwiches & Salads", "Ready-to-eat"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setCategory(value)}
                className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                  category === value ? "bg-white text-[#885625] shadow-sm" : "text-[#806b56] hover:text-[#3b2b1b]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="relative">
            <span className="sr-only">Select chart view</span>
            <select
              value={view}
              onChange={(event) => setView(event.target.value as ProductView)}
              className="h-11 min-w-56 appearance-none rounded-xl border border-[#d7c9b8] bg-white py-2 pl-4 pr-10 text-sm font-bold text-[#3b2b1b] outline-none focus:border-[#885625]"
            >
              {PRODUCT_VIEW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-[#8a7560]" />
          </label>
        </div>
      </CardHeader>
      <CardContent>
        {chartRows.length > 0 ? (
          <div className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              {view === "srp_margin" ? (
                <ComposedChart data={chartRows} margin={{ top: 16, right: 18, left: 6, bottom: 44 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eadfd1" vertical={false} />
                  <XAxis
                    dataKey="chart_name"
                    angle={-24}
                    textAnchor="end"
                    interval={0}
                    height={78}
                    tick={{ fill: "#735f4b", fontSize: 10, fontWeight: 700 }}
                    axisLine={{ stroke: "#dfd5c6" }}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="money"
                    tickFormatter={(value) => `₱${Number(value)}`}
                    tick={{ fill: "#8a7560", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="margin"
                    orientation="right"
                    domain={[0, 100]}
                    tickFormatter={(value) => `${value}%`}
                    tick={{ fill: "#8a7560", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(value, name) =>
                      name === "Net margin" ? `${Number(value).toFixed(1)}%` : formatCurrency(Number(value))
                    }
                    contentStyle={{ borderRadius: 12, borderColor: "#dfd5c6" }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
                  <Bar yAxisId="money" dataKey="selling_price" name="SRP" fill="#0284c7" radius={[6, 6, 0, 0]} maxBarSize={42} />
                  <Line yAxisId="margin" type="monotone" dataKey="net_margin_pct" name="Net margin" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4, fill: "#f59e0b" }} />
                </ComposedChart>
              ) : view === "all_costs" ? (
                <ComposedChart data={chartRows} margin={{ top: 16, right: 18, left: 6, bottom: 44 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eadfd1" vertical={false} />
                  <XAxis
                    dataKey="chart_name"
                    angle={-24}
                    textAnchor="end"
                    interval={0}
                    height={78}
                    tick={{ fill: "#735f4b", fontSize: 10, fontWeight: 700 }}
                    axisLine={{ stroke: "#dfd5c6" }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(value) => `₱${Number(value)}`}
                    tick={{ fill: "#8a7560", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} contentStyle={{ borderRadius: 12, borderColor: "#dfd5c6" }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
                  <Bar dataKey="food_cost" name="Food & packaging" stackId="cost" fill="#0284c7" maxBarSize={42} />
                  <Bar dataKey="labor_cost" name="Labor" stackId="cost" fill="#f97316" />
                  <Bar dataKey="utility_cost" name="Utilities" stackId="cost" fill="#10b981" radius={[6, 6, 0, 0]} />
                  <Line type="monotone" dataKey="selling_price" name="SRP" stroke="#0f172a" strokeWidth={2.5} dot={false} />
                </ComposedChart>
              ) : (
                <BarChart data={chartRows} margin={{ top: 16, right: 18, left: 6, bottom: 44 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eadfd1" vertical={false} />
                  <XAxis
                    dataKey="chart_name"
                    angle={-24}
                    textAnchor="end"
                    interval={0}
                    height={78}
                    tick={{ fill: "#735f4b", fontSize: 10, fontWeight: 700 }}
                    axisLine={{ stroke: "#dfd5c6" }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(value) => `₱${Number(value)}`}
                    tick={{ fill: "#8a7560", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} contentStyle={{ borderRadius: 12, borderColor: "#dfd5c6" }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
                  <Bar dataKey="selling_price" name="Price" fill="#0284c7" radius={[6, 6, 0, 0]} maxBarSize={32} />
                  <Bar dataKey={comparisonKey} name={comparisonLabel} fill="#f97316" radius={[6, 6, 0, 0]} maxBarSize={32} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyChart message="No active products match this filter." />
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#eee5d9] pt-4">
          <p className="text-xs font-semibold text-[#806b56]">
            Products are ordered by this week&apos;s sales, then margin. {invalidCount > 0 ? `${invalidCount} costing record(s) need review.` : "All displayed costs pass validation."}
          </p>
          <Button
            variant="outline"
            size="sm"
            rightIcon={<ArrowRight className="h-3.5 w-3.5" />}
            onClick={onOpenCosting}
          >
            Open full costing
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function OwnerDashboardView({
  dashboard,
  refreshing,
  onRefresh,
  onPreviousWeek,
  onNextWeek,
  onCurrentWeek,
}: {
  dashboard: OwnerWeeklyDashboard;
  refreshing: boolean;
  onRefresh: () => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onCurrentWeek: () => void;
}) {
  const router = useRouter();
  const sales = dashboard.kpis.weekly_net_sales.value;
  const contributionMargin = sales > 0 ? (dashboard.kpis.contribution_profit.value / sales) * 100 : 0;
  const confidenceLabel =
    dashboard.confidence.status === "complete"
      ? "Complete"
      : dashboard.confidence.status === "needs_review"
        ? "Needs review"
        : "Estimated";

  return (
    <div className="mx-auto max-w-[1540px] space-y-5 pb-8">
      <header className="flex flex-col gap-5 rounded-2xl border border-[#dfd5c6] bg-white px-5 py-5 shadow-sm sm:px-6 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#9c732c]">Owner overview</p>
          <h1 className="mt-1 font-heading text-3xl font-bold tracking-tight text-[#2d1f0e]">Weekly business dashboard</h1>
          <p className="mt-1 text-sm font-medium text-[#806b56]">
            Outcomes first, then the actions and cost drivers behind them.
          </p>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex items-center rounded-xl border border-[#dfd5c6] bg-[#fcfaf7] p-1">
            <button type="button" onClick={onPreviousWeek} className="rounded-lg p-2.5 text-[#735f4b] hover:bg-white hover:text-[#885625]" aria-label="Previous week">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-44 px-3 text-center">
              <p className="text-[10px] font-black uppercase tracking-wider text-[#9a846e]">
                {dashboard.period.is_current_week ? "This week" : "Selected week"}
              </p>
              <p className="text-sm font-black text-[#3b2b1b]">{dashboard.period.label}</p>
            </div>
            <button
              type="button"
              onClick={onNextWeek}
              disabled={dashboard.period.is_current_week}
              className="rounded-lg p-2.5 text-[#735f4b] hover:bg-white hover:text-[#885625] disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Next week"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          {!dashboard.period.is_current_week && (
            <Button variant="ghost" size="sm" onClick={onCurrentWeek}>Back to this week</Button>
          )}
          <details className="group relative">
            <summary className={`flex h-11 cursor-pointer list-none items-center gap-2 rounded-xl border px-3.5 text-xs font-black ${
              dashboard.confidence.status === "needs_review"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : dashboard.confidence.status === "estimated"
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}>
              {dashboard.confidence.status === "complete" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              {confidenceLabel} · {dashboard.confidence.gap_count} gap{dashboard.confidence.gap_count === 1 ? "" : "s"}
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <div className="absolute right-0 z-30 mt-2 w-[min(90vw,390px)] rounded-2xl border border-[#d9cbbb] bg-white p-4 shadow-xl">
              <p className="font-heading text-base font-bold text-[#3b2b1b]">Data confidence</p>
              <p className="mt-1 text-xs font-medium leading-relaxed text-[#806b56]">
                These notes explain where the dashboard uses estimates instead of immutable source data.
              </p>
              <ul className="mt-3 space-y-2">
                {dashboard.confidence.gaps.map((gap) => (
                  <li key={gap} className="flex gap-2 text-xs font-semibold leading-relaxed text-[#66513c]">
                    <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#bc9037]" />
                    {gap}
                  </li>
                ))}
              </ul>
            </div>
          </details>
          <Button
            variant="outline"
            size="sm"
            isLoading={refreshing}
            leftIcon={<RefreshCw className="h-4 w-4" />}
            onClick={onRefresh}
          >
            Refresh
          </Button>
        </div>
        <div className="border-t border-[#eee5d9] pt-3 text-xs font-semibold text-[#8a7560] xl:border-0 xl:pt-0">
          Data through {formatDate(dashboard.period.data_through)} · Updated{" "}
          {new Date(dashboard.refreshed_at).toLocaleTimeString("en-PH", {
            timeZone: "Asia/Manila",
            hour: "numeric",
            minute: "2-digit",
          })} PHT
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Weekly net sales"
          metric={dashboard.kpis.weekly_net_sales}
          comparisonLabel={dashboard.period.previous_label}
          icon={<BadgeDollarSign className="h-5 w-5" />}
          caption={`${dashboard.sales_by_channel.filter((row) => row.net_sales > 0).length} active channels`}
          accent="sky"
        />
        <KpiCard
          title="Weekly food cost"
          metric={dashboard.kpis.weekly_food_cost}
          comparisonLabel={dashboard.period.previous_label}
          icon={<CookingPot className="h-5 w-5" />}
          caption="Formula input pending by owner"
          accent="amber"
          isPending={true}
        />
        <KpiCard
          title="Contribution profit"
          metric={dashboard.kpis.contribution_profit}
          comparisonLabel={dashboard.period.previous_label}
          icon={<TrendingUp className="h-5 w-5" />}
          caption={`${percentage(contributionMargin)} margin`}
          accent="emerald"
        />
        <KpiCard
          title="Pending collectibles"
          metric={dashboard.kpis.pending_collectibles}
          comparisonLabel={dashboard.period.previous_label}
          icon={<WalletCards className="h-5 w-5" />}
          caption={
            dashboard.kpis.pending_collectibles.overdue_count > 0
              ? `${formatCurrency(dashboard.kpis.pending_collectibles.overdue_total)} overdue`
              : "Nothing overdue"
          }
          accent="rose"
        />
      </section>

      <AlertsPanel alerts={dashboard.alerts} onNavigate={(path) => router.push(path)} />
      <WeeklyCostCharts dashboard={dashboard} />
      <ProductVisualizer products={dashboard.product_analysis} onOpenCosting={() => router.push("/recipes")} />
    </div>
  );
}

function StaffDashboard({ summary, onRefresh, refreshing }: { summary: DashboardSummaryOut; onRefresh: () => void; refreshing: boolean }) {
  const router = useRouter();
  const cleaning = summary.cleaning_summary;
  const planDate = summary.today_plan ? String(summary.today_plan["plan_date"] || "") : "";
  return (
    <div className="mx-auto max-w-[1200px] space-y-5 pb-8">
      <header className="flex flex-col gap-4 rounded-2xl border border-[#dfd5c6] bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#9c732c]">Operations overview</p>
          <h1 className="mt-1 font-heading text-3xl font-bold text-[#2d1f0e]">Today&apos;s work</h1>
          <p className="mt-1 text-sm font-medium text-[#806b56]">Only operational tasks are shown in the staff view.</p>
        </div>
        <Button variant="outline" isLoading={refreshing} leftIcon={<RefreshCw className="h-4 w-4" />} onClick={onRefresh}>
          Refresh
        </Button>
      </header>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Low-stock items", value: summary.low_stock.length, icon: <PackageSearch className="h-5 w-5" />, path: "/inventory" },
          { label: "Expiring batches", value: summary.expiring_batches.length, icon: <Clock3 className="h-5 w-5" />, path: "/inventory" },
          { label: "Cleaning complete", value: `${cleaning.completed_tasks}/${cleaning.total_tasks}`, icon: <CheckCircle2 className="h-5 w-5" />, path: "/tasks" },
          { label: "Production plan", value: planDate ? formatDate(planDate) : "Not set", icon: <CalendarDays className="h-5 w-5" />, path: "/planner" },
        ].map((item) => (
          <button key={item.label} type="button" onClick={() => router.push(item.path)} className="text-left">
            <Card className="h-full hover:border-[#c8b89e]">
              <CardContent>
                <span className="inline-flex rounded-xl bg-[#f5ede4] p-2.5 text-[#885625]">{item.icon}</span>
                <p className="mt-5 text-[11px] font-black uppercase tracking-wider text-[#8a7560]">{item.label}</p>
                <p className="mt-1 font-heading text-2xl font-bold text-[#2d1f0e]">{item.value}</p>
              </CardContent>
            </Card>
          </button>
        ))}
      </section>
    </div>
  );
}

export default function DashboardPage() {
  const currentWeekStart = useMemo(() => startOfWeekIso(getManilaTodayIso()), []);
  const [weekStart, setWeekStart] = useState(currentWeekStart);
  const [cacheState, setCacheState] = useState<{
    weekStart: string;
    summary?: DashboardSummaryOut;
  } | null>(null);

  useEffect(() => {
    let cachedSummary: DashboardSummaryOut | undefined;
    try {
      const cached = localStorage.getItem(DASHBOARD_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as {
          weekStart?: string;
          summary?: DashboardSummaryOut;
        };
        if (parsed.weekStart === weekStart && parsed.summary) {
          cachedSummary = parsed.summary;
        }
      }
    } catch {
      // Ignore stale or malformed browser cache.
    }
    const cacheHydration = window.setTimeout(() => {
      setCacheState({ weekStart, summary: cachedSummary });
    }, 0);
    return () => window.clearTimeout(cacheHydration);
  }, [weekStart]);

  const cacheReady = cacheState?.weekStart === weekStart;
  const swrKey = cacheReady ? `dashboard-summary:${weekStart}` : null;
  const {
    data: summary,
    error: requestError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<DashboardSummaryOut>(
    swrKey,
    () => api.getDashboardSummary({
      period: "custom",
      date_from: weekStart,
      date_to: addIsoDays(weekStart, 6),
    }),
    {
      fallbackData: cacheReady ? cacheState?.summary : undefined,
      keepPreviousData: false,
      revalidateOnFocus: false,
    },
  );

  useEffect(() => {
    if (!cacheReady || !summary) return;
    try {
      localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({ weekStart, summary }));
    } catch {
      // The SWR response remains available even when storage is blocked.
    }
  }, [cacheReady, summary, weekStart]);

  if (!cacheReady || (isLoading && !summary)) return <DashboardSkeleton />;

  const error = requestError
    ? "We could not refresh the dashboard. Check the connection and try again."
    : null;

  if (!summary) {
    return (
      <div className="mx-auto flex min-h-[55vh] max-w-lg flex-col items-center justify-center text-center">
        <AlertTriangle className="h-10 w-10 text-rose-600" />
        <h1 className="mt-4 font-heading text-2xl font-bold text-[#2d1f0e]">Dashboard unavailable</h1>
        <p className="mt-2 text-sm font-medium text-[#806b56]">{error || "No dashboard data is available."}</p>
        <Button className="mt-5" onClick={() => void mutate()}>Try again</Button>
      </div>
    );
  }

  if (summary.viewer_role === "staff" || !summary.owner_weekly) {
    return <StaffDashboard summary={summary} refreshing={isValidating} onRefresh={() => void mutate()} />;
  }

  return (
    <>
      {error && (
        <div className="mx-auto mb-4 flex max-w-[1540px] items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          <span>{error} Showing the most recent available data.</span>
          <button type="button" className="font-black underline underline-offset-2" onClick={() => void mutate()}>Retry</button>
        </div>
      )}
      <OwnerDashboardView
        dashboard={summary.owner_weekly}
        refreshing={isValidating}
        onRefresh={() => void mutate()}
        onPreviousWeek={() => setWeekStart((value) => addIsoDays(value, -7))}
        onNextWeek={() => setWeekStart((value) => addIsoDays(value, 7))}
        onCurrentWeek={() => setWeekStart(currentWeekStart)}
      />
    </>
  );
}
