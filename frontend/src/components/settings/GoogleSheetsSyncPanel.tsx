"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleDollarSign,
  Clock3,
  EyeOff,
  FileSpreadsheet,
  PackageSearch,
  RefreshCw,
  ShieldCheck,
  Zap,
  X,
} from "lucide-react";

import {
  api,
  type SheetSyncChange,
  type SheetSyncChangeStatus,
  type SheetSyncConfigStatus,
  type SheetSyncQueue,
  type SheetSyncRun,
} from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";


type QueueFilter = "pending" | "conflict" | "applied" | "all";

const EMPTY_COUNTS: Record<SheetSyncChangeStatus, number> = {
  pending: 0,
  accepted: 0,
  rejected: 0,
  ignored: 0,
  applied: 0,
  failed: 0,
  conflict: 0,
};

function statusVariant(status: SheetSyncChangeStatus) {
  if (status === "applied") return "success" as const;
  if (status === "pending" || status === "accepted") return "warning" as const;
  if (status === "conflict" || status === "failed") return "danger" as const;
  return "neutral" as const;
}

function riskVariant(risk: SheetSyncChange["risk_level"]) {
  if (risk === "high") return "danger" as const;
  if (risk === "medium") return "warning" as const;
  return "info" as const;
}

function displayValue(change: SheetSyncChange, value: unknown) {
  if (value === null || value === undefined || value === "") return "Blank";
  if (["retail_price", "reseller_price"].includes(change.destination_field)) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? formatCurrency(numeric) : String(value);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function runVariant(status: SheetSyncRun["status"]) {
  if (status === "completed") return "success" as const;
  if (status === "completed_with_errors") return "warning" as const;
  if (status === "failed") return "danger" as const;
  return "info" as const;
}

export function GoogleSheetsSyncPanel() {
  const [config, setConfig] = useState<SheetSyncConfigStatus | null>(null);
  const [queue, setQueue] = useState<SheetSyncQueue>({ counts: EMPTY_COUNTS, changes: [] });
  const [runs, setRuns] = useState<SheetSyncRun[]>([]);
  const [filter, setFilter] = useState<QueueFilter>("pending");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [updatingSettings, setUpdatingSettings] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const statusFilter = filter === "all" ? undefined : filter;
      const nextConfig = await api.getSheetSyncStatus();
      setConfig(nextConfig);

      try {
        const [nextRuns, nextQueue] = await Promise.all([
          api.getSheetSyncRuns(8),
          api.getSheetSyncChanges(statusFilter),
        ]);
        setRuns(nextRuns);
        setQueue(nextQueue);
      } catch (queueErr) {
        console.warn("[GoogleSheetsSync] Queue fetching encountered warning:", queueErr);
      }
    } catch (error) {
      setNotice({ tone: "error", text: getErrorMessage(error, "Unable to load Google Sheets synchronization status.") });
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    // Data is synchronized from the owner-only API after the panel mounts or
    // its explicit queue filter changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleAutomaticUpdate = () => {
      void refresh();
    };
    window.addEventListener("hh-sheet-sync-updated", handleAutomaticUpdate);
    return () => {
      window.removeEventListener("hh-sheet-sync-updated", handleAutomaticUpdate);
    };
  }, [refresh]);

  const checkNow = async () => {
    if (!config?.configured) {
      setNotice({
        tone: "error",
        text: "Google Sheets service account is disabled or missing credentials in server environment.",
      });
      return;
    }
    setChecking(true);
    setNotice(null);
    try {
      const run = await api.checkSheetSyncUpdates();
      const detected = Number(run.summary.changes_detected || 0);
      const autoApplied = Number(run.summary.auto_applied || 0);
      setNotice({
        tone: "success",
        text: autoApplied > 0
          ? `Check completed. ${autoApplied} price update${autoApplied === 1 ? "" : "s"} applied automatically; other detected changes remain for review.`
          : `Check completed. ${detected} new change${detected === 1 ? "" : "s"} detected.`,
      });
      await refresh();
    } catch (error) {
      setNotice({ tone: "error", text: getErrorMessage(error, "The Sheet check could not be completed.") });
    } finally {
      setChecking(false);
    }
  };

  const toggleAutomaticPrices = async () => {
    if (!config) return;
    const nextEnabled = !config.auto_apply_prices_enabled;
    if (
      nextEnabled
      && !window.confirm(
        "Turn on automatic SRP and reseller-price updates?\n\nOnly the two approved price columns matched by SKU will update automatically. Product names, categories, sizes, pack quantities, jar costs, stock, and transactions will still require review or remain disconnected.",
      )
    ) {
      return;
    }

    setUpdatingSettings(true);
    setNotice(null);
    try {
      const updated = await api.updateSheetSyncSettings(nextEnabled);
      setConfig(updated);

      if (nextEnabled && updated.configured) {
        const run = await api.checkSheetSyncUpdates(["partner_rte_food_info"]);
        const autoApplied = Number(run.summary.auto_applied || 0);
        setNotice({
          tone: "success",
          text: `Automatic prices are on. Initial check applied ${autoApplied} price update${autoApplied === 1 ? "" : "s"}.`,
        });
      } else if (nextEnabled) {
        setNotice({
          tone: "success",
          text: "Automatic prices are prepared. They will start after the read-only Google connection is configured.",
        });
      } else {
        setNotice({
          tone: "success",
          text: "Automatic prices are off. New Sheet differences will wait for owner review.",
        });
      }
      await refresh();
    } catch (error) {
      setNotice({ tone: "error", text: getErrorMessage(error, "The automatic price setting could not be saved.") });
    } finally {
      setUpdatingSettings(false);
    }
  };

  const review = async (
    change: SheetSyncChange,
    action: "accept" | "reject" | "ignore",
  ) => {
    if (
      action === "accept"
      && !window.confirm(
        `Apply ${change.destination_field.replaceAll("_", " ")} for ${change.stable_identifier}?\n\nCurrent: ${displayValue(change, change.previous_value)}\nProposed: ${displayValue(change, change.proposed_value)}`,
      )
    ) {
      return;
    }
    setReviewingId(change.public_id);
    setNotice(null);
    try {
      const updated = await api.reviewSheetSyncChange(change.public_id, action);
      setNotice({
        tone: "success",
        text: action === "accept"
          ? `${updated.stable_identifier} was validated and updated.`
          : `${updated.stable_identifier} was ${updated.status}.`,
      });
      await refresh();
    } catch (error) {
      setNotice({ tone: "error", text: getErrorMessage(error, "The review action could not be confirmed.") });
    } finally {
      setReviewingId(null);
    }
  };

  return (
    <div id="settings-panel-sheets" role="tabpanel" className="space-y-6">
      <Card className="rounded-3xl border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-slate-50/50 p-5 sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
                <FileSpreadsheet size={22} />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-lg font-heading font-black">Google Sheets price sync</CardTitle>
                  {config && (
                    <Badge variant={config.configured ? "success" : "warning"}>
                      {config.configured ? "Configured" : "Setup required"}
                    </Badge>
                  )}
                  {config && (
                    <Badge variant={config.auto_apply_prices_enabled ? "success" : "neutral"}>
                      {config.auto_apply_prices_enabled ? "Automatic prices on" : "Review mode"}
                    </Badge>
                  )}
                </div>
                <CardDescription className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
                  Keep SRP and reseller prices aligned by SKU, with a review queue for structural product changes.
                </CardDescription>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Button
                type="button"
                variant={config?.auto_apply_prices_enabled ? "outline" : "primary"}
                onClick={() => void toggleAutomaticPrices()}
                disabled={!config || loading}
                isLoading={updatingSettings}
                leftIcon={<Zap size={16} />}
                className="w-full sm:w-auto"
              >
                {config?.auto_apply_prices_enabled ? "Turn off auto prices" : "Turn on auto prices"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void checkNow()}
                disabled={!config?.configured || loading}
                isLoading={checking}
                leftIcon={<RefreshCw size={16} />}
                className="w-full sm:w-auto"
              >
                Check now
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 p-5 sm:p-7">
          {notice && (
            <div
              role={notice.tone === "error" ? "alert" : "status"}
              className={`rounded-2xl border px-4 py-3 text-sm font-bold ${
                notice.tone === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-800"
              }`}
            >
              {notice.text}
            </div>
          )}

          {!loading && config && !config.configured && (
            <div className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 sm:p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 shrink-0" size={20} />
                <div className="min-w-0">
                  <p className="font-black">Google Sheets connection is not ready yet</p>
                  <p className="mt-1 text-xs font-semibold leading-relaxed text-amber-900">
                    The Hub uses a dedicated read-only Google identity and keyless Vercel authentication. No private key needs to be downloaded or stored. The approved workbook must still be shared with the service-account email as Viewer.
                  </p>
                </div>
              </div>

              <ol className="grid gap-2 lg:grid-cols-2">
                {[
                  {
                    title: "Create the Google reader",
                    description: "Enable Sheets API, create a service account, and connect Vercel through Workload Identity.",
                  },
                  {
                    title: "Share the approved workbook",
                    description: "Share Partner Inventory with the service-account email as Viewer only.",
                  },
                  {
                    title: "Connect the deployment",
                    description: "Add the keyless Google and workbook settings to the Vercel hh-hub project.",
                  },
                  {
                    title: "Redeploy and verify",
                    description: "Run Check now first. Turn on automatic prices only after the first clean review.",
                  },
                ].map((step, index) => (
                  <li key={step.title} className="flex gap-3 rounded-xl border border-amber-200/80 bg-white/70 p-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-900 text-xs font-black text-white">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-900">{step.title}</p>
                      <p className="mt-0.5 text-[11px] font-semibold leading-relaxed text-slate-600">{step.description}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-amber-200 bg-white/75 p-3">
                  <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">Sync switch</span>
                  <span className={`mt-1 block text-xs font-black ${config.enabled ? "text-emerald-700" : "text-amber-900"}`}>
                    {config.enabled ? "Enabled" : "Not enabled"}
                  </span>
                </div>
                <div className="rounded-xl border border-amber-200 bg-white/75 p-3">
                  <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">Service account</span>
                  <span className={`mt-1 block text-xs font-black ${config.service_account_configured ? "text-emerald-700" : "text-amber-900"}`}>
                    {config.service_account_configured ? "Detected" : "Missing"}
                  </span>
                </div>
                <div className="rounded-xl border border-amber-200 bg-white/75 p-3">
                  <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">Approved workbooks</span>
                  <span className={`mt-1 block text-xs font-black ${config.approved_spreadsheet_count > 0 ? "text-emerald-700" : "text-amber-900"}`}>
                    {config.approved_spreadsheet_count > 0 ? config.approved_spreadsheet_count : "Missing"}
                  </span>
                </div>
              </div>

              <details className="rounded-xl border border-amber-200 bg-white/75 px-3 py-2.5">
                <summary className="cursor-pointer text-xs font-black text-slate-800">
                  Deployment variable names
                </summary>
                <div className="mt-3 grid gap-1.5">
                  {[
                    "GOOGLE_SHEETS_SYNC_ENABLED",
                    "GOOGLE_SHEETS_AUTH_MODE",
                    "GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL",
                    "GOOGLE_SHEETS_PROJECT_ID",
                    "GOOGLE_SHEETS_PROJECT_NUMBER",
                    "GOOGLE_SHEETS_WORKLOAD_IDENTITY_POOL_ID",
                    "GOOGLE_SHEETS_WORKLOAD_IDENTITY_PROVIDER_ID",
                    "GOOGLE_SHEETS_ALLOWED_SPREADSHEET_IDS",
                  ].map((variable) => (
                    <code key={variable} className="block break-all rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-bold text-slate-100">
                      {variable}
                    </code>
                  ))}
                </div>
              </details>

              <p className="text-[11px] font-semibold text-amber-900">
                Current server status: <span className="font-mono font-black">{config.status_code.replaceAll("_", " ")}</span>. Authentication: <span className="font-mono font-black">{config.authentication_mode.replaceAll("_", " ")}</span>. The keyless setup does not create a private key.
              </p>
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
              <div className="flex items-center gap-2 text-emerald-800">
                <CircleDollarSign size={17} />
                <span className="text-xs font-black uppercase tracking-wide">Automatic when enabled</span>
              </div>
              <p className="mt-2 text-xs font-semibold leading-relaxed text-emerald-900">
                H+H Price (SRP) and Reseller&apos;s Price, matched by a unique SKU. Price jumps above {config?.auto_apply_max_price_change_pct ?? 25}% stay for review.
              </p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
              <div className="flex items-center gap-2 text-amber-800">
                <ShieldCheck size={17} />
                <span className="text-xs font-black uppercase tracking-wide">Still reviewed</span>
              </div>
              <p className="mt-2 text-xs font-semibold leading-relaxed text-amber-900">
                Product name, category, size, and pack quantity never auto-overwrite the Hub.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-slate-700">
                <PackageSearch size={17} />
                <span className="text-xs font-black uppercase tracking-wide">Jar cost needs cleanup</span>
              </div>
              <p className="mt-2 text-xs font-semibold leading-relaxed text-slate-700">
                Jar prices remain disconnected until one canonical packaging table and code replace the repeated workbook cells.
              </p>
            </div>
          </div>

          {config?.auto_apply_prices_enabled && (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs font-semibold leading-relaxed text-sky-900">
              The Hub checks when an owner opens or returns to the app, then every {config.auto_check_interval_minutes} minutes while it stays open. Conflicts stop safely and appear below.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">Pending review</span>
              <span className="mt-1 block font-mono text-2xl font-black text-slate-900">{queue.counts.pending}</span>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">Conflicts</span>
              <span className="mt-1 block font-mono text-2xl font-black text-rose-700">{queue.counts.conflict}</span>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">Applied</span>
              <span className="mt-1 block font-mono text-2xl font-black text-emerald-700">{queue.counts.applied}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0 rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="font-heading text-base font-black">Incoming change queue</CardTitle>
                <CardDescription className="mt-1 text-xs text-slate-500">Automatic price changes are audited here; all other mapped fields wait for approval.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-1 rounded-2xl bg-slate-100 p-1.5 border border-slate-200/80" role="tablist" aria-label="Sheet change status">
                {(["pending", "conflict", "applied", "all"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    aria-selected={filter === item}
                    onClick={() => setFilter(item)}
                    className={`min-h-9 rounded-xl px-3 py-1 text-xs font-extrabold capitalize transition-all cursor-pointer ${
                      filter === item
                        ? "bg-white text-slate-900 shadow-xs border border-slate-200/60 font-black"
                        : "text-slate-500 hover:text-slate-900 hover:bg-slate-200/50"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-4 sm:p-6">
            {loading ? (
              <div className="flex min-h-40 items-center justify-center text-sm font-bold text-slate-500">
                <RefreshCw className="mr-2 animate-spin" size={16} /> Loading review queue
              </div>
            ) : queue.changes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center">
                <ShieldCheck className="mx-auto text-emerald-600" size={28} />
                <p className="mt-3 text-sm font-black text-slate-800">No {filter === "all" ? "recorded" : filter} changes</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">Run Check now after the server connection is configured.</p>
              </div>
            ) : (
              queue.changes.map((change) => (
                <article key={change.public_id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-black text-slate-900">{change.stable_identifier}</span>
                        <Badge variant={statusVariant(change.status)} className="capitalize">{change.status}</Badge>
                        <Badge variant={riskVariant(change.risk_level)} className="capitalize">{change.risk_level} risk</Badge>
                        {change.approval_mode === "auto_apply" && (
                          <Badge variant="info">Automatic price</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs font-semibold text-slate-500">
                        {change.source_name} · {change.sheet_name} row {change.source_row_number}
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold text-slate-400">{formatDateTime(change.detected_at)}</span>
                  </div>

                  <div className="mt-4">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                      {change.destination_field.replaceAll("_", " ")}
                    </span>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] sm:items-center">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <span className="block text-[10px] font-black uppercase text-slate-400">Current H+H</span>
                        <span className="mt-1 block break-words text-sm font-black text-slate-800">{displayValue(change, change.previous_value)}</span>
                      </div>
                      <ArrowRight className="mx-auto hidden text-slate-400 sm:block" size={18} aria-hidden="true" />
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                        <span className="block text-[10px] font-black uppercase text-emerald-600">Proposed</span>
                        <span className="mt-1 block break-words text-sm font-black text-emerald-900">{displayValue(change, change.proposed_value)}</span>
                      </div>
                    </div>
                  </div>

                  {change.error_message && (
                    <div role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800">
                      {change.error_message}
                    </div>
                  )}

                  {(change.status === "pending" || change.status === "conflict") && (
                    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Button
                        type="button"
                        onClick={() => void review(change, "accept")}
                        disabled={change.status === "conflict"}
                        isLoading={reviewingId === change.public_id}
                        leftIcon={<Check size={15} />}
                      >
                        Accept &amp; apply
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void review(change, "reject")}
                        disabled={reviewingId === change.public_id}
                        leftIcon={<X size={15} />}
                      >
                        Reject
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => void review(change, "ignore")}
                        disabled={reviewingId === change.public_id}
                        leftIcon={<EyeOff size={15} />}
                      >
                        Ignore
                      </Button>
                    </div>
                  )}
                </article>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="rounded-3xl border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 p-5">
              <CardTitle className="font-heading text-sm font-black">Approved sources</CardTitle>
              <CardDescription className="mt-1 text-xs text-slate-500">Code-locked ranges and fields only.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-5">
              {config?.approved_sources.map((source) => (
                <div key={source.key} className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm font-black text-slate-800">{source.display_name}</p>
                  <p className="mt-1 font-mono text-[10px] font-semibold text-slate-500">{source.sheet_name}!{source.range}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {source.fields.map((field) => (
                      <Badge
                        key={`${source.key}-${field.destination_field}`}
                        variant={field.approval_mode === "auto_apply" ? "success" : riskVariant(field.risk_level)}
                      >
                        {field.destination_field.replaceAll("_", " ")}
                        {field.approval_mode === "auto_apply" ? " · auto" : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 p-5">
              <CardTitle className="font-heading text-sm font-black">Recent checks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-5">
              {runs.length === 0 ? (
                <p className="text-xs font-semibold text-slate-500">No synchronization checks recorded.</p>
              ) : runs.map((run) => (
                <div key={run.public_id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={runVariant(run.status)} className="capitalize">{run.status.replaceAll("_", " ")}</Badge>
                    <Clock3 size={13} className="text-slate-400" />
                  </div>
                  <p className="mt-2 text-[11px] font-semibold text-slate-500">{formatDateTime(run.started_at)}</p>
                  <p className="mt-1 text-[11px] font-bold text-slate-700">
                    {Number(run.summary.changes_detected || 0)} detected · {Number(run.summary.auto_applied || 0)} auto-applied · {Number(run.summary.invalid_rows || 0)} invalid
                  </p>
                  <p className="mt-1 text-[10px] font-semibold text-slate-400">
                    {run.trigger_type === "owner_poll" ? "Automatic owner check" : "Manual check"}
                  </p>
                  {run.error_message && <p className="mt-1 text-[11px] font-bold text-rose-700">{run.error_message}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
