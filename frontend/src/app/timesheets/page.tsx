"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Clock3, Eye, FileSpreadsheet, ImagePlus, Loader2, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { api, TimesheetEntryOut } from "@/lib/api";
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
  const [manual, setManual] = useState({ work_date: today(), clock_in: "", clock_out: "", notes: "", proof: "", proofType: "" });
  const manualReference = useRef<string | null>(null);
  const manualRequestInFlight = useRef(false);

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
      void api.getCurrentUser().then(user => setRole(user.role)).catch(error => alert(getErrorMessage(error)));
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

  return <div className="space-y-6 pb-16">
    <div className="bg-[#fcf8f2] border border-[#ece5da] rounded-2xl p-5 sm:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      <div className="flex items-center gap-4">
        <div className="p-3 bg-primary/10 text-primary rounded-2xl"><Clock3 size={28} /></div>
        <div><h2 className="text-2xl font-heading font-bold text-slate-900">Timesheets</h2><p className="text-sm text-slate-500 mt-1">Deli USB attendance imports and photo-verified manual time entries.</p></div>
      </div>
      <Button onClick={() => void load()} variant="outline" leftIcon={<RefreshCw size={16} />} disabled={loading}>Refresh</Button>
    </div>

    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
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
        {role === "owner" && <Card className="p-5 rounded-3xl border-slate-200 flex flex-col sm:flex-row sm:items-center gap-4"><div className="p-3 bg-emerald-50 text-emerald-700 rounded-2xl"><FileSpreadsheet size={24} /></div><div className="flex-1"><h3 className="font-heading font-black text-slate-900">Import Deli USB report</h3><p className="text-xs text-slate-500 mt-1">Export a CSV/TXT report. First and last punches become clock-in and clock-out; ambiguous dates are rejected before anything is saved.</p></div><label className="inline-flex justify-center items-center gap-2 rounded-xl bg-primary text-white px-4 py-3 text-sm font-bold cursor-pointer">{importing ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}Upload report<input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onReport} className="sr-only" disabled={importing} /></label></Card>}

        <Card className="rounded-3xl border-slate-200 overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between"><div><h3 className="font-heading font-black text-slate-900">Attendance ledger</h3><p className="text-xs text-slate-500 mt-1">{totalEntries} {totalEntries === 1 ? "entry" : "entries"} · {hours.approved.toFixed(1)} approved hours · {hours.pending.toFixed(1)} pending hours in loaded records</p></div><ShieldCheck className="text-emerald-600" size={22} /></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase"><tr><th className="text-left p-4">Employee</th><th className="text-left p-4">Date</th><th className="text-left p-4">In / Out</th><th className="text-left p-4">Source</th><th className="text-left p-4">Status</th><th className="text-right p-4">Proof / Review</th></tr></thead>
              <tbody>{loading
                ? <tr><td colSpan={6} className="p-10 text-center text-slate-400">Loading timesheets…</td></tr>
                : entries.length === 0
                  ? <tr><td colSpan={6} className="p-10 text-center text-slate-400">No timesheets yet.</td></tr>
                  : entries.map(entry => <tr key={entry.id} className="border-t border-slate-100">
                    <td className="p-4 font-bold text-slate-800 max-w-48 break-words">{entry.employee_name}<span className="block text-xs font-normal text-slate-400">{entry.machine_employee_id ? `Machine ID: ${entry.machine_employee_id}` : entry.has_proof ? "Photo proof attached" : ""}</span></td>
                    <td className="p-4">{entry.work_date}</td>
                    <td className="p-4 font-mono text-xs whitespace-nowrap">{entry.clock_in ? new Date(entry.clock_in).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"} / {entry.clock_out ? new Date(entry.clock_out).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    <td className="p-4 capitalize">{entry.source}</td>
                    <td className="p-4"><StatusBadge status={entry.review_status === "Approved" ? "completed" : entry.review_status === "Rejected" ? "danger" : "pending"} label={entry.review_status} /></td>
                    <td className="p-4 text-right"><div className="inline-flex items-center gap-3">{entry.has_proof && <button type="button" onClick={() => void viewProof(entry)} disabled={proofLoadingId === entry.id} className="inline-flex items-center gap-1 text-xs font-bold text-primary disabled:opacity-50">{proofLoadingId === entry.id ? <Loader2 className="animate-spin" size={13} /> : <Eye size={13} />}View</button>}{role === "owner" && entry.source === "manual" && entry.review_status === "Pending" && <><button type="button" onClick={() => void review(entry, "Approved")} className="text-xs font-bold text-emerald-700">Approve</button><button type="button" onClick={() => void review(entry, "Rejected")} className="text-xs font-bold text-rose-700">Reject</button></>}</div></td>
                  </tr>)}</tbody>
            </table>
          </div>
          {entries.length < totalEntries && <div className="p-4 border-t border-slate-100 text-center"><Button variant="outline" onClick={() => void load(entries.length)} disabled={loadingMore} leftIcon={loadingMore ? <Loader2 className="animate-spin" size={15} /> : undefined}>Load more</Button></div>}
        </Card>
      </div>
    </div>

    <Modal isOpen={proof !== null} onClose={() => setProof(null)} title={proof ? `${proof.employee} — attendance proof` : "Attendance proof"} size="lg">
      {proof && <Image src={proof.dataUrl} alt={`Attendance proof submitted by ${proof.employee}`} width={1600} height={1200} unoptimized className="w-full h-auto max-h-[70dvh] object-contain rounded-xl bg-slate-50" />}
    </Modal>
  </div>;
}
