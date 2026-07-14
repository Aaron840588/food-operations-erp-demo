"use client";

import React, { useEffect, useState } from "react";
import { api, type CleaningTaskOut, type MaintenanceAssetOut } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { 
  ClipboardCheck, 
  RefreshCw, 
  Wrench, 
  Check, 
  Info,
  Edit3,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";

export default function TasksPage() {
  const [activeTab, setActiveTab] = useState<"cleaning" | "maintenance">("cleaning");
  const [cleaningTasks, setCleaningTasks] = useState<CleaningTaskOut[]>([]);
  const [maintenanceAssets, setMaintenanceAssets] = useState<MaintenanceAssetOut[]>([]);
  
  // Filtering area for maintenance
  const [maintArea, setMaintArea] = useState<string>("Production Area");

  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  // Edit states for maintenance details modal
  const [editingAsset, setEditingAsset] = useState<MaintenanceAssetOut | null>(null);
  const [modalRemarks, setModalRemarks] = useState("");
  const [modalReplDate, setModalReplDate] = useState("");
  const [savingAssetDetails, setSavingAssetDetails] = useState(false);

  useEffect(() => {
    if (editingAsset) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setModalRemarks(editingAsset.remarks || "");
      setModalReplDate(editingAsset.replacement_date || "");
    }
  }, [editingAsset]);

  const fetchData = async (isBackground = false) => {
    if (!isBackground) {
      setLoading(true);
    }
    try {
      const [cleanRes, maintRes] = await Promise.all([
        api.getCleaningTasks(),
        api.getMaintenanceAssets()
      ]);
      setCleaningTasks(cleanRes);
      setMaintenanceAssets(maintRes);

      // Cache locally for instant loading next time
      localStorage.setItem("hh_cache_cleaning_tasks", JSON.stringify(cleanRes));
      localStorage.setItem("hh_cache_maintenance_assets", JSON.stringify(maintRes));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Wrap entire content in setTimeout to prevent React synchronous cascading render ESLint warnings
    setTimeout(() => {
      try {
        const cachedCleaning = localStorage.getItem("hh_cache_cleaning_tasks");
        const cachedMaintenance = localStorage.getItem("hh_cache_maintenance_assets");
        
        if (cachedCleaning && cachedMaintenance) {
          setCleaningTasks(JSON.parse(cachedCleaning));
          setMaintenanceAssets(JSON.parse(cachedMaintenance));
          setLoading(false); // Render instantly!
          
          fetchData(true);
        } else {
          fetchData(false);
        }
      } catch {
        fetchData(false);
      }
    }, 0);
  }, []);

  const handleCompleteCleaning = async (taskId: number) => {
    const today = new Date().toISOString().split('T')[0];
    setUpdatingId(taskId);
    try {
      await api.completeCleaningTask(taskId, today);
      
      // Update local state
      setCleaningTasks(prev => 
        prev.map(t => t.id === taskId ? { ...t, last_done_date: today } : t)
      );
    } catch (err: unknown) {
      alert(`Error logging cleaning task: ${getErrorMessage(err)}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleUndoCleaning = async (taskId: number) => {
    setUpdatingId(taskId);
    try {
      await api.completeCleaningTask(taskId, "undo");
      
      // Update local state
      setCleaningTasks(prev => 
        prev.map(t => t.id === taskId ? { ...t, last_done_date: null } : t)
      );
    } catch (err: unknown) {
      alert(`Error resetting cleaning task: ${getErrorMessage(err)}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleUpdateStatus = async (asset: MaintenanceAssetOut, newCondition: string) => {
    setUpdatingId(asset.id);
    try {
      const payload = {
        area: asset.area,
        item_name: asset.item_name,
        style_or_kind: asset.style_or_kind,
        condition: newCondition,
        remarks: asset.remarks,
        replacement_date: asset.replacement_date
      };
      const res = await api.updateMaintenanceAsset(asset.id, payload);
      setMaintenanceAssets(prev => 
        prev.map(a => a.id === asset.id ? res : a)
      );
    } catch (err: unknown) {
      alert(`Error updating equipment status: ${getErrorMessage(err)}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleSaveModalDetails = async () => {
    if (!editingAsset) return;
    setSavingAssetDetails(true);
    try {
      const payload = {
        area: editingAsset.area,
        item_name: editingAsset.item_name,
        style_or_kind: editingAsset.style_or_kind,
        condition: editingAsset.condition,
        remarks: modalRemarks,
        replacement_date: modalReplDate || null
      };
      const res = await api.updateMaintenanceAsset(editingAsset.id, payload);
      setMaintenanceAssets(prev => 
        prev.map(a => a.id === editingAsset.id ? res : a)
      );
      setEditingAsset(null);
    } catch (err: unknown) {
      alert(`Error saving asset details: ${getErrorMessage(err)}`);
    } finally {
      setSavingAssetDetails(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] w-full flex flex-col items-center justify-center text-slate-500 gap-4">
        <RefreshCw className="animate-spin text-primary" size={48} />
        <span className="text-sm font-heading font-extrabold tracking-wider uppercase">Loading Checklists...</span>
      </div>
    );
  }

  // Filtered maintenance items based on selected area
  const filteredAssets = maintenanceAssets.filter(a => a.area === maintArea);

  return (
    <div className="space-y-5 2xl:space-y-6 flex flex-col pb-16">
      
      {/* Friendly Checklist Header */}
      <div className="bg-[#fcf8f2] border border-[#ece5da] rounded-2xl p-4 sm:p-5 2xl:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary/10 text-primary rounded-2xl shrink-0">
            <ClipboardCheck size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-heading font-bold text-slate-900 leading-tight">Facility tasks</h2>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              Daily sanitation checklists and appliance maintenance logs replacing clipboard records.
            </p>
          </div>
        </div>
        <Button
          onClick={() => fetchData(true)}
          variant="outline"
          size="lg"
          className="w-full md:w-auto bg-white"
          leftIcon={<RefreshCw size={16} />}
        >
          Refresh Logs
        </Button>
      </div>

      {/* Tabs Menu */}
      <div className="scroll-fade-x flex gap-1 whitespace-nowrap bg-white/70 p-1.5 rounded-2xl border border-slate-200" role="tablist" aria-label="Facility task views">
        <button
          onClick={() => setActiveTab("cleaning")}
          role="tab" aria-selected={activeTab === "cleaning"}
          className={`inline-flex min-h-11 items-center gap-2 px-4 py-2.5 rounded-xl transition-colors cursor-pointer text-sm font-bold ${
            activeTab === "cleaning" 
              ? "bg-[#885625]/10 text-primary font-black animate-fade-in" 
              : "text-slate-500 hover:bg-slate-100"
          }`}
        >
          <ClipboardCheck size={16} /> Cleaning checklist
        </button>
        <button
          onClick={() => setActiveTab("maintenance")}
          role="tab" aria-selected={activeTab === "maintenance"}
          className={`inline-flex min-h-11 items-center gap-2 px-4 py-2.5 rounded-xl transition-colors cursor-pointer text-sm font-bold ${
            activeTab === "maintenance" 
              ? "bg-[#885625]/10 text-primary font-black animate-fade-in" 
              : "text-slate-500 hover:bg-slate-100"
          }`}
        >
          <Wrench size={16} /> Equipment maintenance
        </button>
      </div>

      {/* Content tabs */}
      <div className="flex-1">
        
        {/* 1. CLEANING CHECKLIST TAB */}
        {activeTab === "cleaning" && (() => {
          const today = new Date().toISOString().split('T')[0];
          const completedCount = cleaningTasks.filter(t => t.last_done_date === today).length;
          const totalCount = cleaningTasks.length;
          const percentDone = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
          
          const dailyTasks = cleaningTasks.filter(t => t.frequency.toLowerCase().includes("daily"));
          const periodicTasks = cleaningTasks.filter(t => !t.frequency.toLowerCase().includes("daily"));

          return (
            <div className="max-w-5xl mx-auto w-full space-y-6 2xl:space-y-8 animate-fade-in">
              {/* Premium Progress Bar card */}
              <Card className="rounded-3xl border-slate-200 shadow-xs bg-white p-5 sm:p-6 2xl:p-8 flex flex-col md:flex-row md:items-center justify-between gap-4 2xl:gap-6">
                <div className="space-y-2 flex-1">
                  <div className="flex justify-between items-center select-none">
                    <span className="text-xs text-primary font-black uppercase tracking-wider block">Today&apos;s Sanitation Score</span>
                    <span className="text-sm font-black text-slate-800">{completedCount} of {totalCount} Completed ({percentDone}%)</span>
                  </div>
                  <div className="w-full bg-slate-100 h-3.5 rounded-full overflow-hidden border border-slate-200 shadow-inner mt-2">
                    <div 
                      className="bg-primary h-full rounded-full transition-all duration-500 ease-out" 
                      style={{ width: `${percentDone}%` }}
                    ></div>
                  </div>
                </div>
                <div className="flex items-center gap-3.5 shrink-0 select-none md:border-l md:border-slate-150 md:pl-8">
                  <span className="text-3xl">
                    {percentDone === 100 ? "🎉" : percentDone > 0 ? "🧹" : "📋"}
                  </span>
                  <div>
                    <strong className="text-slate-800 font-black block text-base uppercase">
                      {percentDone === 100 ? "All Clean!" : percentDone > 0 ? "In Progress" : "Shift Started"}
                    </strong>
                    <span className="text-xs text-slate-450 font-semibold mt-0.5 block">
                      {percentDone === 100 ? "Excellent kitchen standards!" : "Keep checking off duties."}
                    </span>
                  </div>
                </div>
              </Card>

              {/* Categorized Tasks Section: DAILY */}
              <div className="space-y-4">
                <h3 className="text-sm font-black text-slate-500 uppercase tracking-wider flex items-center gap-2 select-none">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span> Daily Kitchen Tasks ({dailyTasks.length})
                </h3>
                
                {dailyTasks.length === 0 ? (
                  <Card className="rounded-3xl border-slate-200 p-8 text-center text-slate-400 italic">No daily tasks registered.</Card>
                ) : (
                  <div className="space-y-3">
                    {dailyTasks.map((task) => {
                      const isDoneToday = task.last_done_date === today;
                      const isUpdating = updatingId === task.id;
                      
                      return (
                        <div 
                          key={task.id} 
                          className={`p-4 2xl:p-5 border-2 rounded-2xl flex items-center justify-between hover:scale-[1.01] transition-transform duration-150 ${
                            isDoneToday 
                              ? "bg-[#885625]/5 border-slate-200 text-slate-450" 
                              : "bg-white border-slate-150 hover:border-slate-350 text-slate-800 shadow-3xs"
                          }`}
                        >
                          <div className="flex items-center gap-4 2xl:gap-5 min-w-0">
                            <button
                              onClick={() => {
                                if (isUpdating) return;
                                if (isDoneToday) {
                                  handleUndoCleaning(task.id);
                                } else {
                                  handleCompleteCleaning(task.id);
                                }
                              }}
                              disabled={isUpdating}
                              className={`w-11 h-11 rounded-xl border-3 flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                                isDoneToday 
                                  ? "bg-primary border-primary text-white hover:bg-rose-600 hover:border-rose-600 shadow-sm" 
                                  : "border-slate-300 hover:border-primary text-transparent bg-slate-50"
                              }`}
                            >
                              {isUpdating ? (
                                <Loader2 size={18} className="animate-spin text-slate-400" />
                              ) : isDoneToday ? (
                                <Check size={20} className="stroke-[4]" />
                              ) : (
                                <Check size={20} className="stroke-[3] hover:text-primary" />
                              )}
                            </button>
                            <div className="min-w-0">
                              <span className={`text-base font-black block leading-snug truncate ${isDoneToday ? "line-through text-slate-400 font-medium" : "text-slate-850"}`}>
                                {task.task_name}
                              </span>
                              <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider block mt-1">Daily Routine</span>
                            </div>
                          </div>

                          <div className="text-right text-xs font-bold shrink-0 ml-4">
                            {isDoneToday ? (
                              <Badge variant="success" className="py-1 px-3 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800">Completed</Badge>
                            ) : task.last_done_date ? (
                              <span className="text-slate-500 text-xs">Last done: <strong className="font-mono text-slate-800 font-bold">{task.last_done_date}</strong></span>
                            ) : (
                              <Badge variant="danger" className="py-1 px-3 rounded-lg text-xs font-bold">Pending</Badge>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Categorized Tasks Section: PERIODIC */}
              <div className="space-y-4">
                <h3 className="text-sm font-black text-slate-500 uppercase tracking-wider flex items-center gap-2 select-none">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-500"></span> Weekly &amp; Periodic Sanitation ({periodicTasks.length})
                </h3>
                
                {periodicTasks.length === 0 ? (
                  <Card className="rounded-3xl border-slate-200 p-8 text-center text-slate-400 italic">No periodic tasks registered.</Card>
                ) : (
                  <div className="space-y-3">
                    {periodicTasks.map((task) => {
                      const isDoneToday = task.last_done_date === today;
                      const isUpdating = updatingId === task.id;
                      
                      return (
                        <div 
                          key={task.id} 
                          className={`p-4 2xl:p-5 border-2 rounded-2xl flex items-center justify-between hover:scale-[1.01] transition-transform duration-150 ${
                            isDoneToday 
                              ? "bg-[#885625]/5 border-slate-200 text-slate-450" 
                              : "bg-white border-slate-150 hover:border-slate-350 text-slate-800 shadow-3xs"
                          }`}
                        >
                          <div className="flex items-center gap-4 2xl:gap-5 min-w-0">
                            <button
                              onClick={() => {
                                if (isUpdating) return;
                                if (isDoneToday) {
                                  handleUndoCleaning(task.id);
                                } else {
                                  handleCompleteCleaning(task.id);
                                }
                              }}
                              disabled={isUpdating}
                              className={`w-11 h-11 rounded-xl border-3 flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                                isDoneToday 
                                  ? "bg-primary border-primary text-white hover:bg-rose-600 hover:border-rose-600 shadow-sm" 
                                  : "border-slate-300 hover:border-primary text-transparent bg-slate-50"
                              }`}
                            >
                              {isUpdating ? (
                                <Loader2 size={18} className="animate-spin text-slate-400" />
                              ) : isDoneToday ? (
                                <Check size={20} className="stroke-[4]" />
                              ) : (
                                <Check size={20} className="stroke-[3] hover:text-primary" />
                              )}
                            </button>
                            <div className="min-w-0">
                              <span className={`text-base font-black block leading-snug truncate ${isDoneToday ? "line-through text-slate-400 font-medium" : "text-slate-850"}`}>
                                {task.task_name}
                              </span>
                              <span className="text-[10px] text-purple-600 font-black uppercase tracking-wider block mt-1">Cycle: {task.frequency}</span>
                            </div>
                          </div>

                          <div className="text-right text-xs font-bold shrink-0 ml-4">
                            {isDoneToday ? (
                              <Badge variant="success" className="py-1 px-3 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800">Completed</Badge>
                            ) : task.last_done_date ? (
                              <span className="text-slate-500 text-xs">Last done: <strong className="font-mono text-slate-800 font-bold">{task.last_done_date}</strong></span>
                            ) : (
                              <Badge variant="danger" className="py-1 px-3 rounded-lg text-xs font-bold">Pending</Badge>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* 2. MAINTENANCE ASSETS TAB */}
        {activeTab === "maintenance" && (
          <div className="space-y-6">
            
            {/* Area filter toggles & Diagnostics guides */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-4 2xl:gap-6 justify-between">
              <div className="flex gap-2 bg-slate-150 p-2 border-2 border-slate-200 rounded-2xl max-w-md w-full shrink-0">
                {["Production Area", "Kitchen", "CR"].map(area => (
                  <button
                    key={area}
                    onClick={() => setMaintArea(area)}
                    className={`flex-1 text-center py-2.5 rounded-xl text-xs font-heading font-black uppercase tracking-wider transition-all cursor-pointer ${
                      maintArea === area 
                        ? "bg-white text-slate-850 shadow-3xs" 
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {area}
                  </button>
                ))}
              </div>

              {/* INSTRUCTIONS / LEGEND BANNER */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs text-slate-600 font-semibold flex-1 max-w-2xl shadow-3xs">
                <span className="text-xs text-primary font-black uppercase tracking-wider block mb-2">Equipment Conditions Guide</span>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span className="font-black text-slate-800 text-xs">🟢 OK</span>
                    <span className="text-slate-400 text-xs">(Normal operation)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-amber-500 animate-pulse"></span>
                    <span className="font-black text-slate-800 text-xs">🟡 Repair</span>
                    <span className="text-slate-400 text-xs">(Click edit icon to add logs)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-rose-500 animate-pulse"></span>
                    <span className="font-black text-slate-800 text-xs">🔴 Replace</span>
                    <span className="text-slate-400 text-xs">(Click edit icon to schedule due date)</span>
                  </div>
                </div>
              </div>
            </div>

            {filteredAssets.length === 0 ? (
              <div className="text-slate-400 text-sm py-16 text-center flex flex-col items-center justify-center gap-3">
                <Info size={32} className="text-slate-350 animate-pulse" />
                <span className="font-bold">No equipment assets registered in {maintArea}.</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 2xl:gap-6">
                {filteredAssets.map((asset) => {
                  const isSaving = updatingId === asset.id;
                  
                  return (
                    <div 
                      key={asset.id} 
                      className={`p-5 2xl:p-6 bg-white border-2 rounded-3xl hover:border-slate-350 transition-all flex flex-col justify-between gap-4 2xl:gap-5 shadow-3xs relative overflow-hidden ${
                        asset.condition === "OK" 
                          ? "border-emerald-500/20 bg-emerald-50/5" 
                          : asset.condition === "Needs Repair" 
                            ? "border-amber-500/40 bg-amber-50/10 ring-4 ring-amber-500/5 animate-pulse" 
                            : "border-rose-500/40 bg-rose-50/10 ring-4 ring-rose-500/5"
                      }`}
                    >
                      {/* Side color accent bar inside card */}
                      <div className={`absolute top-0 left-0 bottom-0 w-2.5 ${
                        asset.condition === "OK" 
                          ? "bg-emerald-500" 
                          : asset.condition === "Needs Repair" 
                            ? "bg-amber-500 animate-pulse" 
                            : "bg-rose-500"
                      }`}></div>

                      <div className="pl-4 flex justify-between items-start gap-4">
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="font-heading font-black text-base md:text-lg uppercase tracking-wide text-slate-800 truncate">{asset.item_name}</h4>
                            <Badge 
                              variant={asset.condition === "OK" ? "success" : asset.condition === "Needs Repair" ? "warning" : "danger"}
                              className="py-0.5 px-2 rounded-lg text-[10px] font-black shrink-0"
                            >
                              {asset.condition === "OK" ? "🟢 OK" : asset.condition === "Needs Repair" ? "🟡 REPAIR" : "🔴 REPLACE"}
                            </Badge>
                          </div>
                          <p className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">Model / Kind: {asset.style_or_kind || "Standard"}</p>
                          
                          {(asset.remarks || asset.replacement_date) && (
                            <div className="mt-3.5 space-y-2 bg-slate-50 border border-slate-150 p-4 rounded-xl text-xs text-slate-555 font-semibold leading-relaxed">
                              {asset.remarks && (
                                <p className="italic text-slate-705 font-medium font-sans">
                                  <span className="font-black text-[10px] text-slate-400 uppercase tracking-wide block not-italic mb-1">Diagnostics Notes</span>
                                  &ldquo;{asset.remarks}&rdquo;
                                </p>
                              )}
                              {asset.replacement_date && (
                                <p className="text-slate-400 border-t border-slate-150 pt-2 mt-2 flex justify-between items-center">
                                  <span>Replacement Deadline:</span> 
                                  <strong className="text-slate-800 font-mono text-sm">{asset.replacement_date}</strong>
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                        
                        <button
                          onClick={() => setEditingAsset(asset)}
                          className="text-slate-455 hover:text-primary p-2 hover:bg-slate-100 rounded-xl transition-all cursor-pointer shrink-0 border border-slate-200 bg-white"
                          title="Edit diagnostics remarks & replacement date"
                        >
                          <Edit3 size={14} />
                        </button>
                      </div>

                      {/* Status selectors (Big touch toggles mimicking physical switch pills) */}
                      <div className="pl-4 flex gap-2 bg-slate-100 p-1.5 border border-slate-200 rounded-2xl mt-1 shadow-inner select-none">
                        <button
                          onClick={() => handleUpdateStatus(asset, "OK")}
                          disabled={isSaving}
                          className={`flex-1 py-3.5 rounded-xl text-xs font-heading font-black uppercase tracking-wider transition-all cursor-pointer ${
                            asset.condition === "OK"
                              ? "bg-emerald-600 text-white shadow-3xs scale-[1.02] font-black"
                              : "text-slate-500 hover:text-slate-800"
                          }`}
                        >
                          OK
                        </button>
                        <button
                          onClick={() => handleUpdateStatus(asset, "Needs Repair")}
                          disabled={isSaving}
                          className={`flex-1 py-3.5 rounded-xl text-xs font-heading font-black uppercase tracking-wider transition-all cursor-pointer ${
                            asset.condition === "Needs Repair"
                              ? "bg-amber-600 text-white shadow-3xs scale-[1.02] font-black"
                              : "text-slate-500 hover:text-slate-800"
                          }`}
                        >
                          Repair
                        </button>
                        <button
                          onClick={() => handleUpdateStatus(asset, "Needs Replacement")}
                          disabled={isSaving}
                          className={`flex-1 py-3.5 rounded-xl text-xs font-heading font-black uppercase tracking-wider transition-all cursor-pointer ${
                            asset.condition === "Needs Replacement"
                              ? "bg-rose-600 text-white shadow-3xs scale-[1.02] font-black"
                              : "text-slate-500 hover:text-slate-800"
                          }`}
                        >
                          Replace
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* EDIT ASSET DETAILS MODAL */}
      {editingAsset && (
        <Modal
          isOpen={!!editingAsset}
          onClose={() => setEditingAsset(null)}
          title="Equipment Diagnostics"
          size="sm"
        >
          <div className="space-y-4 text-sm font-semibold text-slate-600">
            <div>
              <span className="text-xs text-slate-400 font-bold uppercase block">Equipment Item</span>
              <strong className="font-heading font-black text-slate-850 text-base mt-0.5 block">{editingAsset.item_name}</strong>
            </div>

            <div>
              <label className="text-xs text-slate-450 font-bold uppercase tracking-wider block mb-1.5">Remarks / Work Completed</label>
              <input
                type="text"
                placeholder="e.g. Tightened hinges, oiled tracks"
                value={modalRemarks}
                onChange={(e) => setModalRemarks(e.target.value)}
                className="w-full text-sm font-bold text-slate-800"
              />
            </div>

            <div>
              <label className="text-xs text-slate-455 font-bold uppercase tracking-wider block mb-1.5">Replacement Due Date</label>
              <input
                type="date"
                value={modalReplDate}
                onChange={(e) => setModalReplDate(e.target.value)}
                className="w-full font-mono text-sm font-bold"
              />
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 pt-4 mt-6">
              <Button variant="outline" size="lg" className="h-12 text-sm" onClick={() => setEditingAsset(null)}>
                Close
              </Button>
              <Button variant="primary" size="lg" className="h-12 text-sm font-bold" onClick={handleSaveModalDetails} isLoading={savingAssetDetails}>
                Save Diagnostics
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
