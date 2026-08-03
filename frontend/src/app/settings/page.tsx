"use client";

import React, { useEffect, useState } from "react";
import { api, type DiscountTierOut, type UserOut } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { configurePushNotifications } from "@/lib/pushNotifications";
import { formatCurrency } from "@/lib/utils";
import { 
  Settings, 
  Percent, 
  Database, 
  Users, 
  ShieldAlert, 
  Plus, 
  Trash2,
  RefreshCw,
  Download,
  UserPlus,
  Bell,
  Save,
  FileSpreadsheet,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ConfirmationModal } from "@/components/ui/Modal";
import { GoogleSheetsSyncPanel } from "@/components/settings/GoogleSheetsSyncPanel";
import {
  DataTableScroll,
  TableCell,
  TableEmptyState,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
} from "@/components/ui/DataTable";


export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<"tiers" | "backup" | "sheets" | "users" | "notifications" | "updates">("tiers");
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  // Discount tiers state
  const [tiers, setTiers] = useState<DiscountTierOut[]>([]);
  const [tiersError, setTiersError] = useState<string | null>(null);
  const [minSubtotal, setMinSubtotal] = useState("");
  const [discountPercent, setDiscountPercent] = useState("");
  const [creatingTier, setCreatingTier] = useState(false);
  
  // Delete tier modal
  const [isDeleteTierOpen, setIsDeleteTierOpen] = useState(false);
  const [deletingTierId, setDeletingTierId] = useState<number | null>(null);

  // User management state
  const [newUsername, setNewUsername] = useState("");
  const [newPasscode, setNewPasscode] = useState("");
  const [newRole, setNewRole] = useState("staff");
  const [newHourlyRate, setNewHourlyRate] = useState("0");
  const [creatingUser, setCreatingUser] = useState(false);
  const [users, setUsers] = useState<UserOut[]>([]);
  const [savingUserId, setSavingUserId] = useState<number | null>(null);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">("default");
  const [configuringPush, setConfiguringPush] = useState(false);

  // Backup state
  const [downloadingBackup, setDownloadingBackup] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const fetchTiers = async () => {
    setTiersError(null);
    try {
      const res = await api.getDiscountTiers();
      setTiers(res);
    } catch (err) {
      console.error(err);
      setTiersError("Unable to load wholesale discount tiers.");
    }
  };

  const fetchUsers = async () => {
    try {
      setUsers(await api.getUsers());
    } catch (err) {
      console.error("Unable to load user accounts", err);
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      const role = localStorage.getItem("hh_user_role");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsOwner(role === "owner");
      setPushPermission("Notification" in window ? Notification.permission : "unsupported");
      if (role === "owner") void fetchUsers();
    }
    void fetchTiers().finally(() => setLoading(false));
  }, []);

  const handleCreateTier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!minSubtotal || !discountPercent) return;
    
    setCreatingTier(true);
    try {
      await api.createDiscountTier({
        min_subtotal: parseFloat(minSubtotal),
        discount_percentage: parseFloat(discountPercent)
      });
      setMinSubtotal("");
      setDiscountPercent("");
      await fetchTiers();
      alert("Discount tier registered successfully!");
    } catch (err: unknown) {
      alert(`Error creating tier: ${getErrorMessage(err)}`);
    } finally {
      setCreatingTier(false);
    }
  };

  const handleTriggerDeleteTier = (id: number) => {
    setDeletingTierId(id);
    setIsDeleteTierOpen(true);
  };

  const handleDeleteTierConfirm = async () => {
    if (!deletingTierId) return;
    try {
      await api.deleteDiscountTier(deletingTierId);
      await fetchTiers();
      setIsDeleteTierOpen(false);
      setDeletingTierId(null);
    } catch (err: unknown) {
      alert(`Error deleting tier: ${getErrorMessage(err)}`);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername || !newPasscode) return;

    setCreatingUser(true);
    try {
      await api.createUser({
        username: newUsername,
        password: newPasscode,
        role: newRole as "owner" | "staff",
        hourly_rate: Number(newHourlyRate) || 0,
      });
      setNewUsername("");
      setNewPasscode("");
      setNewRole("staff");
      setNewHourlyRate("0");
      await fetchUsers();
      alert(`User account "${newUsername}" successfully registered!`);
    } catch (err: unknown) {
      alert(`Error registering user: ${getErrorMessage(err)}`);
    } finally {
      setCreatingUser(false);
    }
  };

  const saveUserRate = async (user: UserOut) => {
    setSavingUserId(user.id);
    try {
      const updated = await api.updateUser(user.id, { hourly_rate: user.hourly_rate });
      setUsers(previous => previous.map(item => item.id === updated.id ? updated : item));
    } catch (err) {
      alert(`Error saving hourly rate: ${getErrorMessage(err)}`);
    } finally {
      setSavingUserId(null);
    }
  };

  const configurePush = async () => {
    setConfiguringPush(true);
    try {
      const permission = await configurePushNotifications();
      setPushPermission(permission);
      alert(permission === "granted" ? "Push alerts are enabled on this device." : "Push permission was not granted.");
    } catch (err) {
      alert(getErrorMessage(err));
    } finally {
      setConfiguringPush(false);
    }
  };

  const handleDownloadBackup = async () => {
    setDownloadingBackup(true);
    try {
      const blob = await api.getBackupBlob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `happy_noether_backup_${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      alert(`Error downloading database backup: ${getErrorMessage(err)}`);
    } finally {
      setDownloadingBackup(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] w-full flex flex-col items-center justify-center text-slate-500 gap-4">
        <RefreshCw className="animate-spin text-primary" size={48} />
        <span className="text-sm font-heading font-extrabold tracking-wider uppercase">Loading Settings...</span>
      </div>
    );
  }

  // Owner Authorization Check
  if (!isOwner) {
    return (
      <div className="max-w-xl mx-auto my-20 bg-white border border-slate-200 rounded-3xl p-10 text-center shadow-lg">
        <ShieldAlert className="text-danger mx-auto mb-6" size={64} />
        <h3 className="font-heading font-black text-slate-800 text-xl uppercase tracking-wide">Access Restricted</h3>
        <p className="text-sm text-slate-500 mt-3 mb-8 leading-relaxed max-w-md mx-auto">
          System preferences, database overrides, and user registrations are only accessible to Owner accounts. Please log in with owner passcode privileges.
        </p>
        <Button variant="outline" size="lg" className="h-12 text-sm font-bold bg-white" onClick={() => window.location.href = "/"}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  const menuItems = [
    { id: "tiers", label: "Wholesale Tiers", icon: Percent },
    { id: "backup", label: "Database Backups", icon: Database },
    { id: "sheets", label: "Google Sheets Review", icon: FileSpreadsheet },
    { id: "users", label: "User Accounts", icon: Users },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "updates", label: "System Updates", icon: RefreshCw }
  ] as const;

  return (
    <div className="space-y-6 flex flex-col pb-16">
      
      {/* Header */}
      <div className="bg-[#fcf8f2] border border-[#ece5da] rounded-2xl p-5 sm:p-6 flex items-start sm:items-center gap-4">
        <div className="p-3 bg-primary/10 text-primary rounded-2xl shrink-0">
          <Settings size={28} />
        </div>
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 leading-tight">Settings &amp; access</h2>
          <p className="text-sm text-slate-500 mt-1 leading-relaxed">
            Configure billing discount tiers, backup data blobs, and register user permissions.
          </p>
        </div>
      </div>

      {/* Split Navigation layout */}
      <div className="flex-1 flex flex-col lg:flex-row gap-6 items-start">
        
        {/* Settings Split Navigation */}
        <div className="w-full lg:w-80 bg-white border border-slate-200 rounded-3xl p-4 shadow-xs self-stretch">
          <div className="space-y-1.5" role="tablist" aria-label="Settings sections">
            {menuItems.map(item => {
              const Icon = item.icon;
              const isSelected = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  aria-controls={`settings-panel-${item.id}`}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full text-left px-5 py-4 rounded-2xl text-sm font-heading font-bold flex items-center gap-3 transition-all relative border-2 cursor-pointer ${
                    isSelected 
                      ? "bg-[#885625]/5 border-[#885625] text-slate-850 shadow-3xs" 
                      : "border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                  }`}
                >
                  {isSelected && (
                    <div className="absolute left-0 top-3.5 bottom-3.5 w-1 bg-accent rounded-r-lg"></div>
                  )}
                  <Icon size={18} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Settings workspace content panel */}
        <div className="flex-1 min-w-0">
          
          {/* 1. DISCOUNT TIERS PANEL */}
          {activeTab === "tiers" && (
            <div id="settings-panel-tiers" role="tabpanel" className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
              
              {/* Discount tier table list */}
              <Card className="xl:col-span-8 rounded-3xl border-slate-200 shadow-sm overflow-hidden">
                <CardHeader className="p-6 md:p-8 bg-slate-50/50 border-b border-slate-100">
                  <CardTitle className="text-lg font-heading font-black">Wholesale Discount Tiers</CardTitle>
                  <CardDescription className="text-sm mt-1 text-slate-500">Automated volume discount ranges calculated during reseller billings:</CardDescription>
                </CardHeader>
                <CardContent className="p-0 bg-white">
                  <DataTableScroll label="Wholesale discount tiers" className="overflow-x-auto">
                    <table className="w-full min-w-[460px] text-left border-collapse text-sm text-slate-700">
                      <thead>
                        <TableHeaderRow>
                          <TableHeaderCell align="right">Minimum Purchase</TableHeaderCell>
                          <TableHeaderCell align="right">Wholesale Discount Percentage</TableHeaderCell>
                          <TableHeaderCell align="right">Actions</TableHeaderCell>
                        </TableHeaderRow>
                      </thead>
                      <tbody className="divide-y divide-slate-150 font-semibold text-slate-700">
                        {tiersError ? (
                          <TableEmptyState colSpan={3} title={tiersError} description="Refresh the page to try again." />
                        ) : tiers.length === 0 ? (
                          <TableEmptyState colSpan={3} title="No discount tiers yet" description="Create a tier to enable automatic wholesale discounts." />
                        ) : tiers.map((tier) => (
                          <TableRow key={tier.id}>
                            <TableCell align="right" className="font-mono font-black text-slate-900 text-base">{formatCurrency(tier.min_subtotal)}</TableCell>
                            <TableCell align="right">
                              <Badge variant="success" className="py-1 px-3 text-xs rounded-xl font-bold bg-emerald-100 text-emerald-800">
                                {tier.discount_percentage.toFixed(1)}% Discount
                              </Badge>
                            </TableCell>
                            <TableCell align="right">
                              <button
                                type="button"
                                onClick={() => handleTriggerDeleteTier(tier.id)}
                                aria-label={`Delete ${tier.discount_percentage.toFixed(1)} percent discount tier`}
                                className="inline-flex h-10 w-10 items-center justify-center text-slate-400 hover:text-danger hover:bg-slate-50 rounded-xl cursor-pointer transition-colors border border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                              >
                                <Trash2 size={16} />
                              </button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </tbody>
                    </table>
                  </DataTableScroll>
                </CardContent>
              </Card>

              {/* Create Tier Form */}
              <Card className="xl:col-span-4 rounded-3xl border-slate-200 shadow-sm">
                <CardHeader className="p-6 md:p-8 bg-slate-50/50 border-b border-slate-100">
                  <CardTitle className="text-base md:text-lg font-heading font-black">Create Discount Tier</CardTitle>
                  <CardDescription className="text-sm mt-1 text-slate-500">Add new billing volume target:</CardDescription>
                </CardHeader>
                <CardContent className="p-6 md:p-8">
                  <form onSubmit={handleCreateTier} className="space-y-5">
                    <div>
                      <label htmlFor="tier-minimum-subtotal" className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Minimum Subtotal (₱)</label>
                      <input
                        id="tier-minimum-subtotal"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={100}
                        required
                        placeholder="e.g. 5000"
                        value={minSubtotal}
                        onChange={(e) => setMinSubtotal(e.target.value)}
                        className="quantity-input w-full text-sm font-mono font-black h-12"
                      />
                    </div>
                    <div>
                      <label htmlFor="tier-discount-percentage" className="text-xs text-slate-455 font-bold uppercase block mb-1.5">Discount Percentage (%)</label>
                      <input
                        id="tier-discount-percentage"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={100}
                        step={0.1}
                        required
                        placeholder="e.g. 15.0"
                        value={discountPercent}
                        onChange={(e) => setDiscountPercent(e.target.value)}
                        className="quantity-input w-full text-sm font-mono font-black h-12"
                      />
                    </div>
                    <Button
                      type="submit"
                      variant="primary"
                      className="w-full h-12 font-bold"
                      isLoading={creatingTier}
                      leftIcon={<Plus size={16} />}
                    >
                      Save Tier Option
                    </Button>
                  </form>
                </CardContent>
              </Card>

            </div>
          )}

          {/* 2. DATABASE BACKUPS PANEL */}
          {activeTab === "backup" && (
            <div id="settings-panel-backup" role="tabpanel" className="space-y-8 max-w-2xl w-full">
              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader className="p-6 md:p-8 bg-slate-50/50 border-b border-slate-100">
                  <CardTitle className="text-lg font-heading font-black">System Database Blob Backups</CardTitle>
                  <CardDescription className="text-sm mt-1 text-slate-500">Export complete relational database records to a JSON file format:</CardDescription>
                </CardHeader>
                <CardContent className="p-6 md:p-8 space-y-5">
                  <div className="p-5 bg-slate-50 border border-[#ece5da] rounded-2xl text-xs md:text-sm font-semibold text-slate-600 leading-relaxed">
                    <p>Database backup files include all users, suppliers, product SKUs, recipes BOMs, wholesale invoices, B2B dispatches, checklists, and inventory transaction ledgers.</p>
                    <p className="mt-3 text-slate-400">Regularly backing up ensures your local data remains secure and transportable across secondary staging setups.</p>
                  </div>
                  <div className="flex justify-end pt-3">
                    <Button
                      onClick={handleDownloadBackup}
                      variant="primary"
                      size="lg"
                      className="h-12 font-bold"
                      isLoading={downloadingBackup}
                      leftIcon={<Download size={16} />}
                    >
                      {downloadingBackup ? "Preparing backup..." : "Download JSON Database Backup"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* NEW: RESET TESTING DATA CARD */}
              <Card className="rounded-3xl border-2 border-rose-250 bg-rose-50/5 shadow-xs overflow-hidden">
                <CardHeader className="p-6 md:p-8 bg-rose-50/50 border-b border-rose-100">
                  <div className="flex items-center gap-3">
                    <ShieldAlert className="text-danger animate-pulse shrink-0" size={24} />
                    <div>
                      <CardTitle className="text-lg font-heading font-black text-danger">Reset Testing Transactions &amp; Logs</CardTitle>
                      <CardDescription className="text-sm mt-1 text-slate-500">Clear test records and transaction ledgers back to clean empty states:</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6 md:p-8 space-y-5">
                  <div className="p-5 bg-white border border-rose-200 rounded-2xl text-xs md:text-sm font-semibold text-rose-800 leading-relaxed space-y-2">
                    <p><strong>Danger: highly critical system override</strong></p>
                    <p>This action will permanently delete all dynamic test records and transactional logs, including:</p>
                    <ul className="list-disc pl-5 mt-1.5 space-y-1 text-slate-600 text-xs">
                      <li>All B2B Reseller Wholesale Orders &amp; Items</li>
                      <li>All B2B Consignment Shipments, Returns &amp; Pull-outs</li>
                      <li>All Pop-Up Market Events, Allocations, POS Sales &amp; Cashier receipts</li>
                      <li>All Production Cooking Batches &amp; Scaling Planner Logs</li>
                      <li>All Double-Entry Inventory Audit Ledger transactions &amp; batches</li>
                      <li>Resets Warehouse inventory stock balances back to 0</li>
                    </ul>
                    <p className="mt-3 text-rose-700"><strong>Note:</strong> Your master static catalog (Products SKU definitions, Raw Ingredients listings, nested Recipes formulas, Supplier directories, and User accounts) will be completely kept so you don&apos;t have to re-enter them!</p>
                  </div>
                  <div className="flex justify-end pt-3">
                    <Button
                      onClick={async () => {
                        const confirmWipe = confirm("Danger: wiping database transactional records.\nAre you absolutely sure you want to permanently delete all test orders, deliveries, market POS sales, and audit ledgers?");
                        if (!confirmWipe) return;
                        
                        setResetLoading(true);
                        try {
                          await api.resetTestData();
                          alert("Database reset completed. Transaction lists, POS terminals, and analytics records were cleared.");
                          window.location.reload();
                        } catch (err: unknown) {
                          alert(`Wipe Authorization Failed: ${getErrorMessage(err)}`);
                        } finally {
                          setResetLoading(false);
                        }
                      }}
                      variant="danger"
                      size="lg"
                      className="h-12 font-bold"
                      isLoading={resetLoading}
                      leftIcon={<Trash2 size={16} />}
                    >
                      {resetLoading ? "Clearing database..." : "Clear Testing Data & Reset Logs"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* 3. USER MANAGEMENT PANEL */}
          {activeTab === "users" && (
            <Card id="settings-panel-users" role="tabpanel" className="max-w-4xl rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="p-6 md:p-8 bg-slate-50/50 border-b border-slate-100">
                <CardTitle className="text-lg font-heading font-black">Register User Accounts</CardTitle>
                <CardDescription className="text-sm mt-1 text-slate-500">Configure secondary login access and passcode permissions:</CardDescription>
              </CardHeader>
              <CardContent className="p-6 md:p-8">
                <form onSubmit={handleCreateUser} className="space-y-5">
                  <div>
                    <label htmlFor="new-user-username" className="text-xs text-slate-455 font-bold uppercase tracking-wider block mb-1.5">Username Identifier</label>
                    <input
                      id="new-user-username"
                      type="text"
                      required
                      minLength={3}
                      maxLength={100}
                      pattern="[A-Za-z0-9._-]+"
                      placeholder="e.g. staff_member"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      className="w-full text-sm font-bold h-12 text-slate-800"
                    />
                  </div>
                  <div>
                    <label htmlFor="new-user-passcode" className="text-xs text-slate-455 font-bold uppercase tracking-wider block mb-1.5">Passcode Password</label>
                    <input
                      id="new-user-passcode"
                      type="password"
                      required
                      minLength={8}
                      maxLength={128}
                      placeholder="Enter login passcode..."
                      value={newPasscode}
                      onChange={(e) => setNewPasscode(e.target.value)}
                      className="w-full text-sm font-bold h-12 text-slate-800"
                    />
                  </div>
                  <div>
                    <label htmlFor="new-user-role" className="text-xs text-slate-455 font-bold uppercase tracking-wider block mb-1.5">System Privilege Role</label>
                    <select
                      id="new-user-role"
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value)}
                      className="w-full text-sm font-bold bg-white h-12 border-2 border-slate-200 rounded-xl"
                    >
                      <option value="staff">Staff Privileges - Operations &amp; Checklists Logs Only</option>
                      <option value="owner">Owner Privileges - Full Control &amp; System Settings</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="new-user-hourly-rate" className="text-xs text-slate-455 font-bold uppercase tracking-wider block mb-1.5">Hourly Labor Rate (₱)</label>
                    <input
                      id="new-user-hourly-rate"
                      type="number"
                      min="0"
                      max="10000"
                      step="0.01"
                      value={newHourlyRate}
                      onChange={(e) => setNewHourlyRate(e.target.value)}
                      className="w-full text-sm font-bold h-12 text-slate-800"
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    className="w-full mt-4 h-12 font-bold"
                    isLoading={creatingUser}
                    leftIcon={<UserPlus size={16} />}
                  >
                    Register Account
                  </Button>
                </form>

                <div className="mt-8 border-t border-slate-100 pt-8">
                  <h3 className="font-heading text-base font-black text-slate-900">Employee labor rates</h3>
                  <p className="mt-1 text-xs font-semibold text-slate-500">Approved attendance uses these rates in payroll and production labor summaries.</p>
                  <div className="mt-4 space-y-3">
                    {users.map(user => (
                      <div key={user.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-4 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-black text-slate-800">{user.username}</p>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{user.role} · {user.is_active ? "Active" : "Inactive"}</p>
                        </div>
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                          ₱ / hour
                          <input
                            type="number"
                            min="0"
                            max="10000"
                            step="0.01"
                            aria-label={`Hourly rate for ${user.username}`}
                            value={user.hourly_rate}
                            onChange={event => setUsers(previous => previous.map(item => item.id === user.id ? { ...item, hourly_rate: Number(event.target.value) } : item))}
                            className="h-10 w-28 rounded-xl border-2 border-slate-200 bg-white px-3 font-mono text-sm font-black"
                          />
                        </label>
                        <Button type="button" variant="outline" size="sm" onClick={() => void saveUserRate(user)} isLoading={savingUserId === user.id} leftIcon={<Save size={14} />}>Save rate</Button>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === "notifications" && (
            <Card id="settings-panel-notifications" role="tabpanel" className="max-w-2xl rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="p-6 md:p-8 bg-slate-50/50 border-b border-slate-100">
                <CardTitle className="text-lg font-heading font-black">Device Notifications</CardTitle>
                <CardDescription className="text-sm mt-1 text-slate-500">Configure push alerts for this browser. The header bell now opens the operational Action Center.</CardDescription>
              </CardHeader>
              <CardContent className="p-6 md:p-8">
                <div className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-[#fcf8f2] p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-black text-slate-800">Current permission</p>
                    <p className="mt-1 text-xs font-semibold capitalize text-slate-500">{pushPermission}</p>
                  </div>
                  <Button type="button" variant="primary" onClick={() => void configurePush()} isLoading={configuringPush} leftIcon={<Bell size={16} />}>Enable push alerts</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === "sheets" && <GoogleSheetsSyncPanel />}

          {activeTab === "updates" && (
            <Card id="settings-panel-updates" role="tabpanel" className="max-w-2xl rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="p-6 md:p-8 bg-slate-50/50 border-b border-slate-100">
                <CardTitle className="text-lg font-heading font-black">System Maintenance &amp; Reload</CardTitle>
                <CardDescription className="text-sm mt-1 text-slate-500">Force connected devices to reload and retrieve latest updates:</CardDescription>
              </CardHeader>
              <CardContent className="p-6 md:p-8 space-y-5">
                <div className="p-5 bg-[#fcf8f2] border border-[#ece5da] rounded-2xl text-xs md:text-sm font-semibold text-slate-600 leading-relaxed">
                  <p>Click the button below to publish a force-refresh signal to the server. All active client browsers and tablet endpoints running the H+H Hub will immediately perform a hard reload to check for version changes.</p>
                </div>
                <div className="flex justify-end pt-3">
                  <Button
                    onClick={async () => {
                      if (!confirm("Are you sure you want to force all connected devices to reload immediately?")) return;
                      try {
                        const res = await api.forceRefreshDevices();
                        alert(`Reload signal successfully broadcasted! Server timestamp set to: ${res.update_timestamp}`);
                      } catch (err: unknown) {
                        alert(`Failed to broadcast reload signal: ${getErrorMessage(err)}`);
                      }
                    }}
                    variant="primary"
                    size="lg"
                    className="h-12 font-bold"
                    leftIcon={<RefreshCw size={16} />}
                  >
                    Force Refresh All Devices
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

        </div>

      </div>

      {/* DELETE DISCOUNT TIER MODAL */}
      {isDeleteTierOpen && (
        <ConfirmationModal
          isOpen={isDeleteTierOpen}
          onClose={() => {
            setIsDeleteTierOpen(false);
            setDeletingTierId(null);
          }}
          onConfirm={handleDeleteTierConfirm}
          title="Delete Volume Discount Tier"
          confirmLabel="Permanently Delete"
          cancelLabel="Cancel"
          type="danger"
          message="Are you sure you want to delete this discount tier? Wholesale reseller orders matching this subtotal range will no longer calculate this tier rate automatically. This action cannot be undone."
        />
      )}
    </div>
  );
}
