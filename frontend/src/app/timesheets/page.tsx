"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Clock3, Download, Eye, FileSpreadsheet, ImagePlus, Loader2, RefreshCw, ShieldCheck, Upload, WalletCards } from "lucide-react";
import { api, type ProductionPlanOut, type TimesheetEntryOut, type TimesheetLaborSummary, type TimesheetCalculatorResponse } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { getErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";

const PAGE_SIZE = 50;

const today = () => {
  const value = new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const firstDayOfMonth = () => {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-01`;
};

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("The attendance report contains an unclosed quoted value.");
  cells.push(cell.trim());
  return cells;
}

function parseDelimitedReport(text: string): Array<Record<string, string>> {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) throw new Error("The report needs a header row and at least one attendance row.");
  const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  const headers = parseDelimitedLine(lines[0], delimiter);
  if (headers.some(header => !header) || new Set(headers.map(header => header.toLowerCase())).size !== headers.length) {
    throw new Error("The attendance report needs unique, non-empty column headers.");
  }
  return lines.slice(1).map((line, rowIndex) => {
    const cells = parseDelimitedLine(line, delimiter);
    if (cells.length !== headers.length) {
      throw new Error(`Attendance row ${rowIndex + 2} has ${cells.length} columns; expected ${headers.length}.`);
    }
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
  });
}

export default function TimesheetsPage() {
  const [entries, setEntries] = useState<TimesheetEntryOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [totalEntries, setTotalEntries] = useState(0);
  const [role, setRole] = useState("staff");
  const [proof, setProof] = useState<{ employee: string; dataUrl: string } | null>(null);
  const [proofLoadingId, setProofLoadingId] = useState<number | null>(null);
  const [plans, setPlans] = useState<ProductionPlanOut[]>([]);
  const [laborSummary, setLaborSummary] = useState<TimesheetLaborSummary | null>(null);
  const [laborDateFrom, setLaborDateFrom] = useState(firstDayOfMonth);
  const [laborDateTo, setLaborDateTo] = useState(today);
  const [laborLoading, setLaborLoading] = useState(false);
  const [allocatingId, setAllocatingId] = useState<number | null>(null);
  const [manual, setManual] = useState({ work_date: today(), clock_in: "", clock_out: "", notes: "", proof: "", proofType: "" });
  const manualReference = useRef<string | null>(null);
  const manualRequestInFlight = useRef(false);

  const [activeTab, setActiveTab] = useState<"ledger" | "calculator">("ledger");
  const [calculatorData, setCalculatorData] = useState<TimesheetCalculatorResponse | null>(null);
  const [calculatorLoading, setCalculatorLoading] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<string>("");
  const [selectedPeriodIndex, setSelectedPeriodIndex] = useState<number>(0);

  const loadCalculator = useCallback(async () => {
    setCalculatorLoading(true);
    try {
      const data = await api.getTimesheetCalculatorData();
      setCalculatorData(data);
      const employeeKeys = Object.keys(data.employees);
      if (employeeKeys.length > 0 && !selectedEmployee) {
        setSelectedEmployee(employeeKeys[0]);
        setSelectedPeriodIndex(0);
      }
    } catch (error) {
      console.warn("Failed to load calculator data on boot:", error);
    } finally {
      setCalculatorLoading(false);
    }
  }, [selectedEmployee]);

  const onCalculatorUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) return alert("Please upload a valid .xlsx Excel spreadsheet.");

    setCalculatorLoading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const data = await api.uploadTimesheetCalculatorFile(formData);
      setCalculatorData(data);
      const employeeKeys = Object.keys(data.employees);
      if (employeeKeys.length > 0) {
        setSelectedEmployee(employeeKeys[0]);
        setSelectedPeriodIndex(0);
      }
      alert("Timesheet calculator spreadsheet uploaded and parsed successfully!");
    } catch (error) {
      alert(getErrorMessage(error));
    } finally {
      setCalculatorLoading(false);
    }
  };

  const activeEmployee = useMemo(() => {
    if (!calculatorData || !selectedEmployee) return null;
    return calculatorData.employees[selectedEmployee] || null;
  }, [calculatorData, selectedEmployee]);

  const activePeriod = useMemo(() => {
    if (!activeEmployee || selectedPeriodIndex >= activeEmployee.periods.length) return null;
    return activeEmployee.periods[selectedPeriodIndex] || null;
  }, [activeEmployee, selectedPeriodIndex]);

  const load = useCallback(async (offset = 0) => {
    const reset = offset === 0;
    if (reset) setLoading(true); else setLoadingMore(true);
    try {
      const page = await api.getTimesheets(PAGE_SIZE, offset);
      setEntries(previous => reset
        ? page.items
        : [...previous, ...page.items.filter(item => !previous.some(existing => existing.id === item.id))]);
      setTotalEntries(page.total);
    } catch (error) {
      alert(getErrorMessage(error));
    } finally {
      if (reset) setLoading(false); else setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    const initialize = window.setTimeout(() => {
      void api.getCurrentUser().then(async user => {
        setRole(user.role);
        if (user.role === "owner") {
          const [productionPlans, summary] = await Promise.all([
            api.getPlans(),
            api.getTimesheetLaborSummary(firstDayOfMonth(), today()),
          ]);
          setPlans(productionPlans);
          setLaborSummary(summary);
        }
      }).catch(error => alert(getErrorMessage(error)));
      void load();
    }, 0);
    return () => window.clearTimeout(initialize);
  }, [load]);

  const hours = useMemo(() => entries.reduce((summary, entry) => {
    if (!entry.clock_in || !entry.clock_out) return summary;
    const duration = Math.max(0, (new Date(entry.clock_out).getTime() - new Date(entry.clock_in).getTime()) / 3_600_000);
    if (entry.review_status === "Approved") summary.approved += duration;
    if (entry.review_status === "Pending") summary.pending += duration;
    return summary;
  }, { approved: 0, pending: 0 }), [entries]);

  const onReport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) return alert("Export the Deli report as CSV or tab-delimited TXT first.");
    setImporting(true);
    try {
      const created = await api.importMachineTimesheets(parseDelimitedReport(await file.text()));
      await load();
      alert(`${created.length} machine ${created.length === 1 ? "timesheet" : "timesheets"} imported.`);
    } catch (error) {
      alert(getErrorMessage(error));
    } finally {
      setImporting(false);
    }
  };

  const onProof = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return alert("Use a JPG, PNG, or WEBP proof photo.");
    if (file.size > 2_500_000) return alert("Keep the proof image below 2.5 MB.");
    const reader = new FileReader();
    reader.onload = () => setManual(previous => ({ ...previous, proof: String(reader.result), proofType: file.type }));
    reader.onerror = () => alert("The proof image could not be read. Please choose it again.");
    reader.readAsDataURL(file);
  };

  const submitManual = async () => {
    if (!manual.clock_in || !manual.proof || !manual.proofType) return alert("Clock-in time and a proof photo are required.");
    if (manualRequestInFlight.current) return;
    manualRequestInFlight.current = true;
    manualReference.current ??= crypto.randomUUID();
    setSaving(true);
    try {
      const entry = await api.createManualTimesheet({
        client_reference: manualReference.current,
        work_date: manual.work_date,
        clock_in: `${manual.work_date}T${manual.clock_in}:00`,
        clock_out: manual.clock_out ? `${manual.work_date}T${manual.clock_out}:00` : null,
        notes: manual.notes || undefined,
        proof_image_data: manual.proof,
        proof_image_type: manual.proofType as "image/jpeg" | "image/png" | "image/webp",
      });
      setEntries(previous => [entry, ...previous.filter(item => item.id !== entry.id)]);
      setManual({ work_date: today(), clock_in: "", clock_out: "", notes: "", proof: "", proofType: "" });
      manualReference.current = null;
      await load();
    } catch (error) {
      alert(getErrorMessage(error));
    } finally {
      manualRequestInFlight.current = false;
      setSaving(false);
    }
  };

  const review = async (entry: TimesheetEntryOut, status: "Approved" | "Rejected") => {
    try {
      const updated = await api.reviewTimesheet(entry.id, status);
      setEntries(previous => previous.map(item => item.id === updated.id ? updated : item));
    } catch (error) {
      alert(getErrorMessage(error));
    }
  };

  const viewProof = async (entry: TimesheetEntryOut) => {
    setProofLoadingId(entry.id);
    try {
      const result = await api.getTimesheetProof(entry.id);
      setProof({ employee: entry.employee_name, dataUrl: result.data_url });
    } catch (error) {
      alert(getErrorMessage(error));
    } finally {
      setProofLoadingId(null);
    }
  };

  const refreshLaborSummary = async () => {
    setLaborLoading(true);
    try {
      setLaborSummary(await api.getTimesheetLaborSummary(laborDateFrom, laborDateTo));
    } catch (error) {
      alert(getErrorMessage(error));
    } finally {
      setLaborLoading(false);
    }
  };

  const allocate = async (entry: TimesheetEntryOut, productionPlanId: number | null) => {
    setAllocatingId(entry.id);
    try {
      const updated = await api.allocateTimesheet(entry.id, productionPlanId);
      setEntries(previous => previous.map(item => item.id === updated.id ? updated : item));
      await refreshLaborSummary();
    } catch (error) {
      alert(getErrorMessage(error));
    } finally {
      setAllocatingId(null);
    }
  };

  const exportLaborCsv = () => {
    if (!laborSummary) return;
    const rows = [
      ["Employee", "Hourly Rate", "Approved Hours", "Labor Cost", "Allocated Hours", "Unallocated Hours", "Missing Rate Hours"],
      ...laborSummary.employees.map(employee => [
        employee.employee_name,
        employee.hourly_rate.toFixed(2),
        employee.approved_hours.toFixed(2),
        employee.labor_cost.toFixed(2),
        employee.allocated_hours.toFixed(2),
        employee.unallocated_hours.toFixed(2),
        employee.missing_rate_hours.toFixed(2),
      ]),
    ];
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `hh-labor-${laborSummary.date_from}-to-${laborSummary.date_to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return <div className="space-y-6 pb-16">
    <div className="bg-[#fcf8f2] border border-[#ece5da] rounded-2xl p-5 sm:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      <div className="flex items-center gap-4">
        <div className="p-3 bg-primary/10 text-primary rounded-2xl"><Clock3 size={28} /></div>
        <div><h2 className="text-2xl font-heading font-bold text-slate-900">Timesheets</h2><p className="text-sm text-slate-500 mt-1">Deli USB attendance imports and photo-verified manual time entries.</p></div>
      </div>
      <Button onClick={() => { if (activeTab === "ledger") void load(); else void loadCalculator(); }} variant="outline" leftIcon={<RefreshCw size={16} />} disabled={loading || calculatorLoading}>Refresh</Button>
    </div>

    {/* Tabs Menu */}
    <div className="scroll-fade-x flex gap-1 whitespace-nowrap bg-white/70 p-1.5 rounded-2xl border border-slate-200" role="tablist" aria-label="Timesheets navigation">
      <button
        onClick={() => setActiveTab("ledger")}
        role="tab"
        aria-selected={activeTab === "ledger"}
        className={`inline-flex min-h-11 items-center gap-2 px-4 py-2.5 rounded-xl transition-colors cursor-pointer text-sm font-bold ${
          activeTab === "ledger"
            ? "bg-[#885625]/10 text-primary font-black"
            : "text-slate-500 hover:bg-slate-100"
        }`}
      >
        <Clock3 size={16} /> Attendance ledger
      </button>
      <button
        onClick={() => {
          setActiveTab("calculator");
          if (!calculatorData) {
            void loadCalculator();
          }
        }}
        role="tab"
        aria-selected={activeTab === "calculator"}
        className={`inline-flex min-h-11 items-center gap-2 px-4 py-2.5 rounded-xl transition-colors cursor-pointer text-sm font-bold ${
          activeTab === "calculator"
            ? "bg-[#885625]/10 text-primary font-black"
            : "text-slate-500 hover:bg-slate-100"
        }`}
      >
        <FileSpreadsheet size={16} /> Timesheet calculator
      </button>
    </div>

    {activeTab === "ledger" ? (
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start animate-fade-in">
        <Card className="p-5 rounded-3xl border-slate-200 xl:col-span-1">
          <form className="space-y-5" onSubmit={event => { event.preventDefault(); void submitManual(); }}>
            <div><h3 className="font-heading font-black text-slate-900">Manual time entry</h3><p className="text-xs text-slate-500 mt-1">A photo proof is required and sent for owner review.</p></div>
            <label className="block text-xs font-bold text-slate-600">Work date<input required type="date" value={manual.work_date} onChange={event => setManual({ ...manual, work_date: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-bold text-slate-600">Clock in<input required type="time" value={manual.clock_in} onChange={event => setManual({ ...manual, clock_in: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
              <label className="text-xs font-bold text-slate-600">Clock out<input type="time" value={manual.clock_out} onChange={event => setManual({ ...manual, clock_out: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
            </div>
            <label className="block text-xs font-bold text-slate-600">Reason / note<textarea value={manual.notes} onChange={event => setManual({ ...manual, notes: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 min-h-20" placeholder="Why a manual entry is needed" /></label>
            <label className="block rounded-2xl border-2 border-dashed border-slate-300 p-4 text-center cursor-pointer hover:border-primary"><ImagePlus className="mx-auto text-primary" size={22} /><span className="mt-2 block text-xs font-bold text-slate-700">{manual.proof ? "Proof attached" : "Attach clock-in proof photo"}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={onProof} className="sr-only" /></label>
            <Button type="submit" disabled={saving} className="w-full" leftIcon={saving ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}>Submit for review</Button>
          </form>
        </Card>

        <div className="xl:col-span-2 space-y-6">
          {role === "owner" && laborSummary && (
            <Card className="rounded-3xl border-slate-200 overflow-hidden">
              <div className="flex flex-col gap-4 border-b border-slate-100 p-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl bg-primary/10 p-3 text-primary"><WalletCards size={22} /></div>
                  <div><h3 className="font-heading font-black text-slate-900">Approved labor cost</h3><p className="mt-1 text-xs font-semibold text-slate-500">Payroll-ready hours, rates, and production allocation status.</p></div>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">From<input type="date" value={laborDateFrom} onChange={event => setLaborDateFrom(event.target.value)} className="mt-1 block h-10 rounded-xl border border-slate-300 px-2 font-mono text-xs" /></label>
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">To<input type="date" value={laborDateTo} onChange={event => setLaborDateTo(event.target.value)} className="mt-1 block h-10 rounded-xl border border-slate-300 px-2 font-mono text-xs" /></label>
                  <Button type="button" size="sm" variant="outline" onClick={() => void refreshLaborSummary()} isLoading={laborLoading}>Apply</Button>
                  <Button type="button" size="sm" variant="outline" onClick={exportLaborCsv} leftIcon={<Download size={14} />}>CSV</Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 p-5 lg:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Approved hours</span><strong className="mt-1 block font-mono text-xl text-slate-900">{laborSummary.approved_hours.toFixed(2)}</strong></div>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><span className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Labor cost</span><strong className="mt-1 block font-mono text-xl text-emerald-800">{formatCurrency(laborSummary.total_labor_cost)}</strong></div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><span className="text-[10px] font-black uppercase tracking-wider text-amber-700">Unallocated</span><strong className="mt-1 block font-mono text-xl text-amber-800">{laborSummary.unallocated_hours.toFixed(2)}h</strong></div>
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4"><span className="text-[10px] font-black uppercase tracking-wider text-rose-700">Missing rate</span><strong className="mt-1 block font-mono text-xl text-rose-800">{laborSummary.missing_rate_hours.toFixed(2)}h</strong></div>
              </div>
              {laborSummary.employees.length > 0 && <div className="border-t border-slate-100 px-5 pb-5"><div className="mt-4 space-y-2">{laborSummary.employees.map(employee => <div key={`${employee.employee_user_id ?? "machine"}-${employee.employee_name}`} className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 p-3 text-xs"><div><strong className="block text-slate-800">{employee.employee_name}</strong><span className="text-slate-400">{formatCurrency(employee.hourly_rate)}/hour</span></div><div className="text-right font-mono"><strong className="block text-slate-800">{employee.approved_hours.toFixed(2)}h</strong><span className="text-emerald-700">{formatCurrency(employee.labor_cost)}</span></div></div>)}</div></div>}
            </Card>
          )}

          {role === "owner" && <Card className="p-5 rounded-3xl border-slate-200 flex flex-col sm:flex-row sm:items-center gap-4"><div className="p-3 bg-emerald-50 text-emerald-700 rounded-2xl"><FileSpreadsheet size={24} /></div><div className="flex-1"><h3 className="font-heading font-black text-slate-900">Import Deli USB report</h3><p className="text-xs text-slate-500 mt-1">Export a CSV/TXT report. First and last punches become clock-in and clock-out; ambiguous dates are rejected before anything is saved.</p></div><label className="inline-flex justify-center items-center gap-2 rounded-xl bg-primary text-white px-4 py-3 text-sm font-bold cursor-pointer">{importing ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}Upload report<input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onReport} className="sr-only" disabled={importing} /></label></Card>}

          <Card className="rounded-3xl border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between"><div><h3 className="font-heading font-black text-slate-900">Attendance ledger</h3><p className="text-xs text-slate-500 mt-1">{totalEntries} {totalEntries === 1 ? "entry" : "entries"} · {hours.approved.toFixed(1)} approved hours · {hours.pending.toFixed(1)} pending hours in loaded records</p></div><ShieldCheck className="text-emerald-600" size={22} /></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase"><tr><th className="text-left p-4">Employee</th><th className="text-left p-4">Date</th><th className="text-left p-4">In / Out</th><th className="text-left p-4">Source</th><th className="text-left p-4">Status</th><th className="text-left p-4">Labor / Production</th><th className="text-right p-4">Proof / Review</th></tr></thead>
                <tbody>{loading
                  ? <tr><td colSpan={7} className="p-10 text-center text-slate-400">Loading timesheets…</td></tr>
                  : entries.length === 0
                    ? <tr><td colSpan={7} className="p-10 text-center text-slate-400">No timesheets yet.</td></tr>
                    : entries.map(entry => <tr key={entry.id} className="border-t border-slate-100">
                      <td className="p-4 font-bold text-slate-800 max-w-48 break-words">{entry.employee_name}<span className="block text-xs font-normal text-slate-400">{entry.machine_employee_id ? `Machine ID: ${entry.machine_employee_id}` : entry.has_proof ? "Photo proof attached" : ""}</span></td>
                      <td className="p-4">{entry.work_date}</td>
                      <td className="p-4 font-mono text-xs whitespace-nowrap">{entry.clock_in ? new Date(entry.clock_in).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"} / {entry.clock_out ? new Date(entry.clock_out).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                      <td className="p-4 capitalize">{entry.source}</td>
                      <td className="p-4"><StatusBadge status={entry.review_status === "Approved" ? "completed" : entry.review_status === "Rejected" ? "danger" : "pending"} label={entry.review_status} /></td>
                      <td className="p-4"><div className="min-w-48 space-y-1.5"><p className="font-mono text-xs font-black text-slate-800">{entry.duration_hours.toFixed(2)}h · {formatCurrency(entry.labor_cost)}</p>{entry.review_status === "Approved" && role === "owner" ? <select aria-label={`Production allocation for ${entry.employee_name} on ${entry.work_date}`} value={entry.production_plan_id ?? ""} disabled={allocatingId === entry.id || entry.hourly_rate <= 0} onChange={event => void allocate(entry, event.target.value ? Number(event.target.value) : null)} className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold"><option value="">{entry.hourly_rate <= 0 ? "Set employee rate first" : "Unallocated"}</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.plan_date} · {plan.status}</option>)}</select> : <span className="text-[10px] font-semibold text-slate-400">{entry.allocation_status.replaceAll("_", " ")}</span>}</div></td>
                      <td className="p-4 text-right"><div className="inline-flex items-center gap-3">{entry.has_proof && <button type="button" onClick={() => void viewProof(entry)} disabled={proofLoadingId === entry.id} className="inline-flex items-center gap-1 text-xs font-bold text-primary disabled:opacity-50">{proofLoadingId === entry.id ? <Loader2 className="animate-spin" size={13} /> : <Eye size={13} />}View</button>}{role === "owner" && entry.source === "manual" && entry.review_status === "Pending" && <><button type="button" onClick={() => void review(entry, "Approved")} className="text-xs font-bold text-emerald-700">Approve</button><button type="button" onClick={() => void review(entry, "Rejected")} className="text-xs font-bold text-rose-700">Reject</button></>}</div></td>
                    </tr>)}</tbody>
              </table>
            </div>
            {entries.length < totalEntries && <div className="p-4 border-t border-slate-100 text-center"><Button variant="outline" onClick={() => void load(entries.length)} disabled={loadingMore} leftIcon={loadingMore ? <Loader2 className="animate-spin" size={15} /> : undefined}>Load more</Button></div>}
          </Card>
        </div>
      </div>
    ) : (
      <div className="space-y-6 animate-fade-in">
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 items-start">
          {/* Left Column: Staff Selection & Advances */}
          <div className="xl:col-span-1 space-y-6">
            <Card className="p-5 rounded-3xl border-slate-200">
              <h3 className="font-heading font-black text-slate-900 mb-3">Staff List</h3>
              <div className="flex flex-col gap-1">
                {calculatorLoading && !calculatorData && (
                  <p className="text-xs text-slate-400">Loading staff list…</p>
                )}
                {calculatorData && Object.keys(calculatorData.employees).map((empKey) => {
                  const emp = calculatorData.employees[empKey];
                  const isSelected = selectedEmployee === empKey;
                  return (
                    <button
                      key={empKey}
                      onClick={() => {
                        setSelectedEmployee(empKey);
                        setSelectedPeriodIndex(0);
                      }}
                      className={`text-left px-4 py-3 rounded-xl font-bold transition-colors cursor-pointer text-sm ${
                        isSelected
                          ? "bg-[#885625] text-white"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {emp.employee_name}
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* Cash advances if available */}
            {activeEmployee && activeEmployee.cash_advances && activeEmployee.cash_advances.length > 0 && (
              <Card className="p-5 rounded-3xl border-slate-200">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-heading font-black text-slate-900">Cash Advances</h3>
                  <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-1 text-xs font-black text-amber-700 ring-1 ring-inset ring-amber-500/10">
                    {activeEmployee.cash_advances.length}
                  </span>
                </div>
                <div className="overflow-x-auto max-h-[300px] scrollbar-thin">
                  <table className="w-full text-xs">
                    <thead className="text-[10px] uppercase font-black tracking-wider text-slate-450 bg-slate-50 border-b border-slate-100">
                      <tr>
                        <th className="text-left py-2 px-1">Date</th>
                        <th className="text-right py-2 px-1">Amount</th>
                        <th className="text-center py-2 px-1">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeEmployee.cash_advances.map((ca, idx) => (
                        <tr key={idx} className="border-b border-slate-100">
                          <td className="py-2 px-1 font-mono text-slate-600">{ca.date || "—"}</td>
                          <td className="py-2 px-1 text-right font-mono font-bold text-slate-800">₱{ca.amount.toFixed(2)}</td>
                          <td className="py-2 px-1 text-center font-bold">
                            {ca.status ? (
                              <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-bold ${
                                ca.status.toLowerCase() === "done"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-amber-50 text-amber-700"
                              }`}>
                                {ca.status}
                              </span>
                            ) : (
                              <span className="text-slate-350">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Uploader Card */}
            {role === "owner" && (
              <Card className="p-5 rounded-3xl border-slate-200">
                <h3 className="font-heading font-black text-slate-900 mb-2">Upload Calculator</h3>
                <p className="text-xs text-slate-500 mb-4 leading-relaxed">Upload a new `Timesheet Calculator.xlsx` to recalculate and refresh the views.</p>
                <label className="inline-flex w-full justify-center items-center gap-2 rounded-xl bg-[#885625] hover:bg-[#74481d] text-white px-4 py-3 text-sm font-bold cursor-pointer transition-colors">
                  {calculatorLoading ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
                  Upload XLSX file
                  <input type="file" accept=".xlsx" onChange={onCalculatorUpload} className="sr-only" disabled={calculatorLoading} />
                </label>
              </Card>
            )}
          </div>

          {/* Right Columns: Period Selector, Shift Logs & Payout summary */}
          <div className="xl:col-span-3 space-y-6">
            {calculatorLoading && (
              <Card className="p-12 text-center text-slate-400 border-slate-200 bg-white rounded-3xl">
                <Loader2 className="animate-spin mx-auto text-primary mb-3" size={32} />
                <p className="text-sm font-black font-heading tracking-wide uppercase">Parsing spreadsheet calculations…</p>
              </Card>
            )}

            {!calculatorLoading && !activeEmployee && (
              <Card className="p-12 text-center text-slate-400 italic border-slate-200 bg-white rounded-3xl">
                No calculator data loaded. Ensure the excel file exists at the required location or upload one using the sidebar.
              </Card>
            )}

            {!calculatorLoading && activeEmployee && (
              <>
                {/* Period selection */}
                <Card className="p-5 rounded-3xl border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white">
                  <div className="flex-1">
                    <h3 className="font-heading font-black text-slate-900 text-lg">
                      {activeEmployee.employee_name}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">Select a payroll period to view logs and calculated totals.</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Period:</span>
                    <select
                      value={selectedPeriodIndex}
                      onChange={(e) => setSelectedPeriodIndex(Number(e.target.value))}
                      className="h-11 rounded-xl border border-slate-350 bg-white px-3 text-sm font-bold"
                    >
                      {activeEmployee.periods.map((p, idx) => (
                        <option key={idx} value={idx}>
                          {p.period_name} ({p.side === "left" ? "Left Period" : "Right Period"})
                        </option>
                      ))}
                    </select>
                  </div>
                </Card>

                {activePeriod && (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-start">
                    {/* Left part: Shift Logs Table */}
                    <div className="md:col-span-3 space-y-6">
                      <Card className="rounded-3xl border-slate-200 overflow-hidden bg-white">
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                          <h4 className="font-heading font-black text-slate-900 text-base uppercase tracking-wider">Shift Logs</h4>
                          <span className="inline-flex items-center rounded-md bg-slate-100 px-2.5 py-1 text-xs font-mono font-black text-slate-700 ring-1 ring-inset ring-slate-500/10">
                            {activePeriod.shifts.length} shifts
                          </span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[700px] text-sm">
                            <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wider text-slate-450 border-b border-slate-100">
                              <tr>
                                <th className="text-left p-4">Date</th>
                                <th className="text-center p-4">Start</th>
                                <th className="text-center p-4">End</th>
                                <th className="text-right p-4">Total Hours</th>
                                <th className="text-right p-4">Working Days (Shifts)</th>
                                <th className="text-right p-4">Total Pay</th>
                              </tr>
                            </thead>
                            <tbody>
                              {activePeriod.shifts.length === 0 ? (
                                <tr>
                                  <td colSpan={6} className="p-10 text-center text-slate-400 italic">No shifts recorded in this period.</td>
                                </tr>
                              ) : (
                                activePeriod.shifts.map((s, idx) => (
                                  <tr key={idx} className="border-t border-slate-100 hover:bg-[#fcf8f2]/10">
                                    <td className="p-4 font-bold text-slate-800 font-mono text-xs">{s.date}</td>
                                    <td className="p-4 text-center font-mono text-xs">{s.start || "—"}</td>
                                    <td className="p-4 text-center font-mono text-xs">{s.end || "—"}</td>
                                    <td className="p-4 text-right font-mono text-xs">{s.total_hours !== null && s.total_hours !== undefined ? s.total_hours.toFixed(2) : "—"}</td>
                                    <td className="p-4 text-right font-mono text-xs">{s.working_days !== null && s.working_days !== undefined ? s.working_days.toFixed(3) : "—"}</td>
                                    <td className="p-4 text-right font-mono text-xs font-bold text-slate-900">{s.total_pay !== null && s.total_pay !== undefined ? `₱${s.total_pay.toFixed(2)}` : "—"}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </Card>
                    </div>

                    {/* Right part: Totals & Rate Specs Summary */}
                    <div className="md:col-span-1 space-y-6">
                      {/* Rate specs card */}
                      <Card className="p-5 rounded-3xl border-slate-200 bg-white space-y-4">
                        <h4 className="font-heading font-black text-slate-900 border-b border-slate-100 pb-2 text-xs uppercase tracking-wider select-none">Rate Specs</h4>
                        <div className="space-y-3">
                          <div className="flex justify-between text-xs font-semibold">
                            <span className="text-slate-400">Daily Rate:</span>
                            <strong className="text-slate-800 font-mono">₱{(activePeriod.rate || 0).toFixed(2)}</strong>
                          </div>
                          <div className="flex justify-between text-xs font-semibold">
                            <span className="text-slate-400">Hours/Shift:</span>
                            <strong className="text-slate-800 font-mono">{(activePeriod.hours_per_shift || 0).toFixed(1)}h</strong>
                          </div>
                          <div className="flex justify-between text-xs font-semibold">
                            <span className="text-slate-400">Standard hours:</span>
                            <strong className="text-slate-800 font-mono">{(activePeriod.standard_working_hours || 0).toFixed(1)}h</strong>
                          </div>
                          <div className="flex justify-between text-xs font-semibold border-t border-slate-100 pt-3">
                            <span className="text-slate-400">Calculated Hourly:</span>
                            <strong className="text-primary font-mono text-sm">₱{(activePeriod.hourly_rate || 0).toFixed(2)}/h</strong>
                          </div>
                        </div>
                      </Card>

                      {/* Summary card */}
                      <Card className="rounded-3xl border-slate-200 overflow-hidden bg-white shadow-2xs">
                        <div className="bg-[#fcf8f2] border-b border-[#ece5da] p-5">
                          <span className="text-[10px] font-black uppercase tracking-wider text-slate-450 block">Calculated payout</span>
                          <strong className="mt-2 block font-heading font-black text-2xl text-[#885625]">
                            ₱{(activePeriod.summary.total_pay || 0).toFixed(2)}
                          </strong>
                        </div>
                        <div className="p-5 space-y-4 text-xs font-semibold">
                          <div className="flex justify-between">
                            <span className="text-slate-400">Total Hours:</span>
                            <span className="font-mono text-slate-800">{(activePeriod.summary.total_hours || 0).toFixed(2)}h</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Working Days:</span>
                            <span className="font-mono text-slate-800">{(activePeriod.summary.working_days || 0).toFixed(3)}</span>
                          </div>
                          <div className="flex justify-between border-t border-slate-100 pt-3">
                            <span className="text-slate-400">Gross Paid Work:</span>
                            <span className="font-mono text-slate-800">₱{(activePeriod.summary.paid_work || 0).toFixed(2)}</span>
                          </div>

                          {activePeriod.summary.allowances && activePeriod.summary.allowances.length > 0 && (
                            <div className="border-t border-slate-100 pt-3 space-y-2">
                              <span className="text-[10px] font-black uppercase tracking-wider text-slate-450 block mb-1.5">Incentives / Deductions</span>
                              {activePeriod.summary.allowances.map((al, idx) => (
                                <div key={idx} className="flex justify-between text-xs">
                                  <span className="text-slate-400">{al.label}:</span>
                                  <span className={`font-mono font-bold ${al.amount && al.amount < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                                    {al.amount && al.amount < 0 ? "-" : "+"}₱{Math.abs(al.amount || 0).toFixed(2)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                          {(activePeriod.summary.status || activePeriod.summary.remarks) && (
                            <div className="border-t border-slate-100 pt-3 space-y-2">
                              {activePeriod.summary.status && (
                                <div className="flex justify-between items-center">
                                  <span className="text-slate-400">Status:</span>
                                  <span className="inline-flex items-center rounded-md bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/10 uppercase">
                                    {activePeriod.summary.status}
                                  </span>
                                </div>
                              )}
                              {activePeriod.summary.remarks && (
                                <div className="bg-[#fcf8f2]/30 p-3 rounded-xl border border-slate-200 text-slate-500 italic text-[11px] font-medium leading-relaxed">
                                  Remarks: {activePeriod.summary.remarks}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </Card>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    )}

    <Modal isOpen={proof !== null} onClose={() => setProof(null)} title={proof ? `${proof.employee} — attendance proof` : "Attendance proof"} size="lg">
      {proof && <Image src={proof.dataUrl} alt={`Attendance proof submitted by ${proof.employee}`} width={1600} height={1200} unoptimized className="w-full h-auto max-h-[70dvh] object-contain rounded-xl bg-slate-50" />}
    </Modal>
  </div>;
}
