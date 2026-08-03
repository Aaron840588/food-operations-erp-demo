"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import packageMetadata from "../../package.json";
import { api, clearFinancialCaches } from "@/lib/api";
import {
  getAuthenticatedHomePath,
  getRoleRouteRedirect,
  isPublicRoute,
  isRouteAllowedForRole,
} from "@/lib/routeAccess";
import { 
  LayoutDashboard, 
  ChefHat, 
  CalendarRange, 
  Truck, 
  Receipt, 
  Package, 
  ClipboardCheck, 
  Clock3,
  Menu, 
  X,
  LogOut,
  Settings,
  Bell,
  UserCheck,
  Store,
  Search,
  Loader2,
  CircleCheck,
} from "lucide-react";

interface LayoutClientProps {
  children: React.ReactNode;
}

const NAV_SECTIONS = [
  {
    title: "Overview",
    items: [{ name: "Dashboard", path: "/", icon: LayoutDashboard }]
  },
  {
    title: "Sales & Orders",
    items: [
      { name: "Pre-Orders", path: "/preorders", icon: Clock3 },
      { name: "Consignment", path: "/consignment", icon: Truck },
      { name: "Wholesale POS", path: "/resellers", icon: Receipt },
      { name: "Market Events", path: "/market-events", icon: Store }
    ]
  },
  {
    title: "Operations",
    items: [
      { name: "Production Planner", path: "/planner", icon: CalendarRange },
      { name: "Inventory", path: "/inventory", icon: Package },
      { name: "Facility Tasks", path: "/tasks", icon: ClipboardCheck },
      { name: "Timesheets", path: "/timesheets", icon: Clock3 }
    ]
  },
  {
    title: "Management",
    ownerOnly: true,
    items: [
      { name: "Recipes & Costing", path: "/recipes", icon: ChefHat },
      { name: "Settings & Users", path: "/settings", icon: Settings }
    ]
  }
];

interface ActionCenterItem {
  label: string;
  count: number;
  path: string;
  tone: "warning" | "danger" | "info";
}

const SHEET_AUTO_CHECK_STORAGE_KEY = "hh_sheet_auto_check_started_at";

export default function LayoutClient({ children }: LayoutClientProps) {
  const pathname = usePathname();
  const isPublicPage = isPublicRoute(pathname);
  const router = useRouter();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [authorizedPathname, setAuthorizedPathname] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState(packageMetadata.version);
  const [isOnline, setIsOnline] = useState(true);
  const [discardedLegacyActions, setDiscardedLegacyActions] = useState(0);
  const [isCmdOpen, setIsCmdOpen] = useState(false);
  const [cmdSearch, setCmdSearch] = useState("");
  const [selectedCmdIdx, setSelectedCmdIdx] = useState(0);
  const [isActionCenterOpen, setIsActionCenterOpen] = useState(false);
  const [actionCenterLoading, setActionCenterLoading] = useState(false);
  const [actionCenterItems, setActionCenterItems] = useState<ActionCenterItem[]>([]);
  const [actionCenterError, setActionCenterError] = useState<string | null>(null);
  const mobileDrawerRef = useRef<HTMLElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const actionCenterCloseRef = useRef<HTMLButtonElement>(null);

  const categories = NAV_SECTIONS
    .filter(section => !section.ownerOnly || userRole === "owner")
    .map(section => ({
      ...section,
      items: section.items.filter(item => isRouteAllowedForRole(userRole, item.path)),
    }))
    .filter(section => section.items.length > 0);

  // Command Palette Items
  const allCommands = categories.flatMap(category => category.items).map(item => ({
    ...item,
    name: `Open ${item.name}`
  }));

  const filteredCommands = allCommands.filter(cmd =>
    cmd.name.toLowerCase().includes(cmdSearch.toLowerCase())
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsCmdOpen(prev => !prev);
        setCmdSearch("");
        setSelectedCmdIdx(0);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [userRole]);

  useEffect(() => {
    if (!isMobileOpen) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    mobileCloseRef.current?.focus();

    const handleDrawerKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsMobileOpen(false);
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = mobileDrawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleDrawerKeyDown);
    return () => {
      window.removeEventListener("keydown", handleDrawerKeyDown);
      previouslyFocused?.focus();
    };
  }, [isMobileOpen]);

  useEffect(() => {
    if (!isActionCenterOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    actionCenterCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsActionCenterOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      previouslyFocused?.focus();
    };
  }, [isActionCenterOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    api.syncOfflineChanges()
      .then((result) => setDiscardedLegacyActions(result.discarded))
      .catch((error) => console.error("Unable to sanitize the retired offline queue:", error));
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      queueMicrotask(() => {
        setIsOnline(navigator.onLine);
      });
      
      const handleOnline = () => {
        setIsOnline(true);
      };
      const handleOffline = () => setIsOnline(false);

      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);

      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }
  }, []);

  useEffect(() => {
    // Programmatic cleanup of old Service Workers to prevent cache/hydration transition loops on laptop
    if (typeof window !== "undefined" && 'serviceWorker' in navigator) {
      try {
        const hasCleared = localStorage.getItem("hh_sw_cleared_v7");
        if (!hasCleared) {
          navigator.serviceWorker.getRegistrations().then(registrations => {
            if (registrations.length > 0) {
              Promise.all(registrations.map(r => r.unregister())).then(() => {
                console.log("Stale Service Worker purged successfully.");
                try { localStorage.setItem("hh_sw_cleared_v7", "true"); } catch {}
                window.location.reload();
              });
            } else {
              try { localStorage.setItem("hh_sw_cleared_v7", "true"); } catch {}
            }
          });
        }
      } catch (e) {
        console.warn("Storage check failed:", e);
      }
    }
  }, []);

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => {
          console.log('Service Worker registered:', reg);
          // Force update check on load to clear old caches
          reg.update().catch(() => {});
        })
        .catch(err => {
          console.error('Service Worker registration failed:', err);
        });
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const checkAppVersion = async () => {
      try {
        const data = await api.getAppVersion();
        setAppVersion(data.version);
        const serverTimestamp = data.update_timestamp;
        const localTimestamp = localStorage.getItem("hh_app_update_timestamp");
        if (localTimestamp && localTimestamp !== serverTimestamp) {
          localStorage.setItem("hh_app_update_timestamp", serverTimestamp);
          window.location.reload();
        } else if (!localTimestamp) {
          localStorage.setItem("hh_app_update_timestamp", serverTimestamp);
        }
      } catch (e) {
        console.warn("[Version Check] Failed to query application version:", e);
      }
    };

    void checkAppVersion();

    const intervalId = setInterval(checkAppVersion, 30000);
    return () => clearInterval(intervalId);
  }, []);

  const openCommandPalette = () => {
    setCmdSearch("");
    setSelectedCmdIdx(0);
    setIsCmdOpen(true);
  };

  const openActionCenter = async () => {
    setIsActionCenterOpen(true);
    setActionCenterLoading(true);
    setActionCenterError(null);
    try {
      const summary = await api.getDashboardSummary();
      const nextItems: ActionCenterItem[] = [
        { label: userRole === "owner" ? "Pending timesheet approvals" : "Your pending timesheets", count: summary.pending_timesheets_count || 0, path: "/timesheets", tone: "warning" },
        { label: "Low-stock items", count: summary.low_stock?.length || 0, path: "/inventory", tone: "danger" },
        { label: "Expiring ingredient batches", count: summary.expiring_batches?.length || 0, path: "/inventory", tone: "warning" },
        { label: "Costing records to review", count: summary.missing_cost_warnings_count || 0, path: "/recipes", tone: "warning" },
        { label: "Unpaid consignment deliveries", count: summary.unpaid_deliveries?.length || 0, path: "/consignment", tone: "info" },
      ];
      setActionCenterItems(nextItems.filter(item => item.count > 0 && isRouteAllowedForRole(userRole, item.path)));
    } catch (error) {
      setActionCenterError(error instanceof Error ? error.message : "Unable to load action center.");
    } finally {
      setActionCenterLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const checkAuth = async () => {
      if (isPublicPage) {
        if (!cancelled) {
          setAuthorizedPathname(pathname);
          setCheckingAuth(false);
        }
        return;
      }

      const finishAuthenticatedCheck = (role: string | null, username: string | null) => {
        if (cancelled) return;

        if (role !== "owner") clearFinancialCaches();
        setUserRole(role);
        setUserName(username);

        const redirectPath = pathname === "/login"
          ? getAuthenticatedHomePath(role)
          : getRoleRouteRedirect(role, pathname);
        if (redirectPath) {
          router.replace(redirectPath);
          return;
        }

        setAuthorizedPathname(pathname);
        setCheckingAuth(false);
      };

      try {
        const loggedIn = localStorage.getItem("hh_logged_in") === "true";
        if (loggedIn) {
          const role = localStorage.getItem("hh_user_role") || "owner";
          const username = localStorage.getItem("hh_user_name") || "Portfolio Guest";
          finishAuthenticatedCheck(role, username);
          return;
        }

        if (pathname !== "/login") {
          router.replace("/login");
        } else if (!cancelled) {
          setCheckingAuth(false);
        }
      } catch {
        if (pathname !== "/login") {
          router.replace("/login");
        } else if (!cancelled) {
          setCheckingAuth(false);
        }
      }
    };
    
    void checkAuth();
    return () => {
      cancelled = true;
    };
  }, [isPublicPage, pathname, router]);

  useEffect(() => {
    if (isPublicPage || userRole !== "owner" || !isOnline) return;

    let cancelled = false;
    const runAutomaticPriceCheck = async () => {
      if (cancelled || document.visibilityState === "hidden") return;

      try {
        const status = await api.getSheetSyncStatus();
        if (
          cancelled
          || !status.configured
          || !status.auto_apply_prices_enabled
        ) {
          return;
        }

        const intervalMs = Math.max(status.auto_check_interval_minutes, 1) * 60_000;
        const lastStartedAt = Number(localStorage.getItem(SHEET_AUTO_CHECK_STORAGE_KEY) || 0);
        if (Date.now() - lastStartedAt < intervalMs) return;

        localStorage.setItem(SHEET_AUTO_CHECK_STORAGE_KEY, String(Date.now()));
        const run = await api.autoCheckSheetSyncUpdates();
        window.dispatchEvent(new CustomEvent("hh-sheet-sync-updated", {
          detail: { runPublicId: run.public_id },
        }));
      } catch (error) {
        console.warn("[GoogleSheetsSync] Automatic price check skipped:", error);
      }
    };

    const initialTimer = window.setTimeout(() => {
      void runAutomaticPriceCheck();
    }, 1_500);
    const intervalTimer = window.setInterval(() => {
      void runAutomaticPriceCheck();
    }, 5 * 60_000);
    const handleFocus = () => {
      void runAutomaticPriceCheck();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalTimer);
      window.removeEventListener("focus", handleFocus);
    };
  }, [isOnline, isPublicPage, userRole]);

  const getPageTitle = (path: string) => {
    if (path === "/") return "Dashboard";
    const found = categories
      .flatMap(c => c.items)
      .find(i => i.path === path);
    return found ? found.name : "System Details";
  };

  const navContent = (
    <div className="flex h-full min-h-0 flex-col bg-white select-none">
      {/* Brand stays visible while the navigation list scrolls independently. */}
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-[#ece5da] bg-white px-5 pr-16 shadow-3xs lg:px-6 lg:pr-6">
        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-xl shadow-md">
          <Image src="/hh-logo.png" alt="H+H Hub Logo" width={36} height={36} className="h-full w-full object-cover" />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="font-heading text-sm font-black leading-none tracking-wide text-[#2d1f0e]">H+H Hub</span>
          <span className="mt-1 text-[9px] font-bold tracking-[0.12em] text-accent">OPERATIONS PLATFORM</span>
        </div>
      </div>

      <nav
        aria-label="Primary navigation"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 [scrollbar-gutter:stable]"
      >
        <button
          type="button"
          onClick={() => { setIsMobileOpen(false); openCommandPalette(); }}
          className="mb-3 flex min-h-11 w-full items-center gap-3 rounded-xl border border-[#ece5da] bg-[#faf8f5] px-3.5 text-left text-sm font-bold text-[#8a7560] hover:bg-[#f5f0e8] hover:text-[#2d1f0e]"
        >
          <Search size={17} aria-hidden="true" />
          <span className="flex-1">Search pages</span>
          <kbd className="hidden rounded-md border border-[#dfd5c6] bg-white px-1.5 py-0.5 text-[9px] font-black lg:inline">Ctrl K</kbd>
        </button>
        <div className="space-y-3">
          {categories.map((cat) => {
            const headingId = `nav-${cat.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
            return (
              <section key={cat.title} aria-labelledby={headingId} className="space-y-1">
                <h2 id={headingId} className="block px-3.5 text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">
                  {cat.title}
                </h2>
                <div className="space-y-0.5 pt-0.5">
                  {cat.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.path;
                    return (
                      <Link
                        key={item.name}
                        href={item.path}
                        onClick={() => setIsMobileOpen(false)}
                        aria-current={isActive ? "page" : undefined}
                        className={`relative flex min-h-11 items-center gap-3 rounded-xl px-3.5 py-2 text-sm font-bold transition-colors touch-optimize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                          isActive
                            ? "bg-primary-light text-primary"
                            : "text-[#8a7560] hover:bg-[#f5f0e8] hover:text-[#2d1f0e]"
                        }`}
                      >
                        {isActive && (
                          <span aria-hidden="true" className="absolute inset-y-2.5 left-0 w-1 rounded-r-lg bg-accent" />
                        )}
                        <Icon aria-hidden="true" size={17} className={`shrink-0 ${isActive ? "text-primary" : "text-[#b8a898]"}`} />
                        <span className="truncate">{item.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </nav>

      {/* Account actions remain available without covering navigation links. */}
      <div className="flex shrink-0 flex-col gap-2.5 border-t border-[#ece5da] bg-[#faf8f5]/90 p-3.5 lg:p-4">
        {userName && (
          <div className="flex items-center gap-2.5 px-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-black text-xs uppercase font-heading shrink-0">
              {userName.slice(0, 2)}
            </div>
            <div className="flex flex-col truncate">
              <span className="text-xs font-black text-[#2d1f0e] truncate leading-none mb-1">{userName}</span>
              <span className="text-[9px] text-[#a89582] font-black uppercase tracking-wider">
                {userRole === "owner" ? "Owner Account" : "Kitchen Staff"}
              </span>
            </div>
          </div>
        )}
        <button
          onClick={async () => {
            try {
              await api.logout();
            } catch (err) {
              console.warn("Logout request failed, continuing client-side clear:", err);
            }
            try {
              localStorage.removeItem("hh_logged_in");
              localStorage.removeItem("hh_user_name");
              localStorage.removeItem("hh_user_role");
              clearFinancialCaches();
            } catch { /* iOS Private Browsing — ignore */ }
            window.location.href = "/login";
          }}
          className="w-full py-2 bg-white hover:bg-slate-50 text-[#8a7560] hover:text-slate-900 text-xs font-heading font-black rounded-xl transition-all border border-slate-300 cursor-pointer flex items-center justify-center gap-2 shadow-sm"
        >
          <LogOut size={14} />
          Sign Out
        </button>
        <div className="mt-0.5 text-center text-[9px] font-black uppercase tracking-widest text-[#b8a898]">
          V{appVersion} • VERCEL CLOUD
        </div>
      </div>
    </div>
  );

  if (isPublicPage) {
    return <>{children}</>;
  }

  const roleRedirect = userRole ? getRoleRouteRedirect(userRole, pathname) : null;
  if (checkingAuth || authorizedPathname !== pathname || roleRedirect) {
    return (
      <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center bg-slate-50 text-slate-400">
        <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin mb-3"></div>
        <span className="text-xs font-heading font-bold tracking-widest uppercase">Securing Session...</span>
      </div>
    );
  }

  return (
    <div className="app-shell flex bg-[#faf8f5] text-[#2d1f0e] font-sans antialiased overflow-hidden print:h-auto print:bg-white print:overflow-visible">
      {/* 1. DESKTOP SIDEBAR */}
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-300 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-primary focus:shadow-lg">
        Skip to main content
      </a>
      <aside className="hidden h-full w-60 shrink-0 flex-col border-r border-[#ece5da] bg-white select-none lg:flex print:hidden">
        {navContent}
      </aside>

      {/* 2. MOBILE/TABLET MENU DRAWER OVERLAY */}
      {isMobileOpen && (
        <div className="app-shell fixed inset-0 z-50 flex select-none lg:hidden">
          {/* Backdrop blur overlay */}
          <div
            aria-hidden="true"
            onClick={() => setIsMobileOpen(false)}
            className="fixed inset-0 bg-slate-900/30 backdrop-blur-xs transition-opacity duration-300"
          ></div>
          
          {/* Slide-out Drawer Panel */}
          <aside
            ref={mobileDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Quick navigation"
            className="app-safe-drawer relative flex h-full w-[min(88vw,20rem)] flex-col border-r border-[#ece5da] bg-white shadow-xl animate-slide-in"
          >
            <button 
              ref={mobileCloseRef}
              onClick={() => setIsMobileOpen(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-xl border border-[#ece5da] bg-white text-slate-500 shadow-xs hover:bg-[#faf8f5] hover:text-primary lg:hidden cursor-pointer touch-optimize"
            >
              <X size={18} />
            </button>
            {navContent}
          </aside>
        </div>
      )}

      {/* 3. MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden print:h-auto print:overflow-visible">
        {/* Header bar */}
        <header className="app-safe-header h-16 border-b border-[#ece5da] bg-white/95 backdrop-blur-sm flex items-center justify-between px-3 sm:px-6 shrink-0 print:hidden shadow-xs z-20">
          <div className="flex items-center gap-4">
            {/* Hamburger Button for mobile */}
            <button 
              onClick={() => setIsMobileOpen(true)}
              aria-label="Open navigation"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 lg:hidden cursor-pointer touch-optimize"
            >
              <Menu size={24} />
            </button>
            
            <h1 className="max-w-[13rem] truncate font-heading text-lg font-bold leading-none text-slate-900 sm:max-w-none sm:text-xl">
              {getPageTitle(pathname)}
            </h1>
          </div>
          
          <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
            <button
              type="button"
              onClick={openCommandPalette}
              aria-label="Search H+H Hub"
              className="hidden h-10 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-slate-600 transition-colors hover:bg-primary-light hover:text-primary sm:flex"
            >
              <Search size={16} />
              <span className="hidden xl:inline">Search</span>
              <kbd className="hidden rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] text-slate-400 lg:inline">Ctrl K</kbd>
            </button>
            <button
              onClick={() => void openActionCenter()}
              aria-label="Open action center"
              className="relative p-2.5 rounded-xl transition-all cursor-pointer border bg-slate-50 border-slate-200 text-slate-500 hover:text-primary hover:bg-primary-light"
            >
              <Bell size={18} />
              {actionCenterItems.length > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-rose-500" />}
            </button>
            
            {userRole && (
              <div className="hidden md:flex items-center gap-2 bg-slate-50 text-slate-700 px-3 py-1.5 rounded-xl border border-slate-250">
                <UserCheck size={14} className="text-primary" />
                <span className="tracking-wide font-bold capitalize">{userRole}</span>
              </div>
            )}
            
            {isOnline ? (
              <div className="flex h-10 items-center gap-2 bg-teal-light text-teal px-3 rounded-xl border border-teal/25" aria-label="System online">
                <div className="w-2 h-2 rounded-full bg-teal animate-pulse"></div>
                <span className="hidden sm:inline tracking-wide font-bold">Online</span>
              </div>
            ) : (
              <div className="flex h-10 items-center gap-2 bg-warning-light text-warning px-3 rounded-xl border border-warning/25" aria-label="Offline cache active">
                <div className="w-2 h-2 rounded-full bg-warning"></div>
                <span className="hidden sm:inline tracking-wide font-bold">Offline</span>
              </div>
            )}
          </div>
        </header>

        {/* Viewport Scroll Container */}
        {!isOnline && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2 text-xs font-semibold text-amber-900 select-none print:hidden shadow-inner">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
              <span>Offline: the Hub is read-only. Only a prepared Market POS event can record sales offline.</span>
            </div>
          </div>
        )}

        {discardedLegacyActions > 0 && (
          <div className="bg-rose-50 border-b border-rose-200 px-4 py-2 flex items-center justify-between gap-3 text-xs font-semibold text-rose-900 print:hidden">
            <span>
              For safety, {discardedLegacyActions} older unconfirmed offline change{discardedLegacyActions === 1 ? "" : "s"} were removed instead of replayed. Verify the affected records before retrying.
            </span>
            <button
              type="button"
              onClick={() => setDiscardedLegacyActions(0)}
              aria-label="Dismiss offline safety notice"
              className="shrink-0 rounded-lg p-1.5 text-rose-700 hover:bg-rose-100"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <main id="main-content" className="app-safe-main flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-5 print:p-0 print:overflow-visible">
          <div className="max-w-7xl w-full mx-auto print:max-w-none print:w-full">
            {children}
          </div>
        </main>
      </div>

      {isActionCenterOpen && (
        <div className="app-safe-overlay fixed inset-0 z-240 flex items-start justify-center bg-slate-950/35 px-4 pt-20 backdrop-blur-xs" role="presentation" onMouseDown={() => setIsActionCenterOpen(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="action-center-title"
            className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
            onMouseDown={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div>
                <h2 id="action-center-title" className="font-heading text-lg font-black text-slate-900">Action Center</h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">Items that need attention across H+H Hub.</p>
              </div>
              <button ref={actionCenterCloseRef} type="button" onClick={() => setIsActionCenterOpen(false)} aria-label="Close action center" className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"><X size={18} /></button>
            </div>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto p-4">
              {actionCenterLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm font-bold text-slate-500"><Loader2 className="animate-spin" size={18} /> Loading actions...</div>
              ) : actionCenterError ? (
                <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{actionCenterError}</div>
              ) : actionCenterItems.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center"><CircleCheck className="text-emerald-600" size={32} /><p className="text-sm font-bold text-slate-700">You are all caught up.</p></div>
              ) : actionCenterItems.map(item => (
                <button
                  key={`${item.path}-${item.label}`}
                  type="button"
                  onClick={() => { setIsActionCenterOpen(false); router.push(item.path); }}
                  className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-slate-200 p-4 text-left hover:border-primary/30 hover:bg-primary-light/30"
                >
                  <span className="text-sm font-bold text-slate-700">{item.label}</span>
                  <span className={`rounded-full px-2.5 py-1 font-mono text-xs font-black ${item.tone === "danger" ? "bg-rose-100 text-rose-700" : item.tone === "warning" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-700"}`}>{item.count}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* GLOBAL COMMAND PALETTE (CTRL+K) OVERLAY */}
      {isCmdOpen && (
        <div className="app-safe-overlay fixed inset-0 bg-slate-950/40 backdrop-blur-xs z-250 flex items-start justify-center pt-24 px-4">
          <div 
            className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden animate-fade-in animate-scale-up"
            onKeyDown={(e) => {
              if (e.key === "Escape") setIsCmdOpen(false);
              if (e.key === "ArrowDown" && filteredCommands.length > 0) {
                e.preventDefault();
                setSelectedCmdIdx(prev => (prev + 1) % filteredCommands.length);
              }
              if (e.key === "ArrowUp" && filteredCommands.length > 0) {
                e.preventDefault();
                setSelectedCmdIdx(prev => (prev - 1 + filteredCommands.length) % filteredCommands.length);
              }
              if (e.key === "Enter") {
                e.preventDefault();
                const selected = filteredCommands[selectedCmdIdx];
                if (selected) {
                  router.push(selected.path);
                  setIsCmdOpen(false);
                }
              }
            }}
          >
            {/* Input box */}
            <div className="p-4 border-b border-slate-100 flex items-center gap-3">
              <span className="text-slate-400">
                <Menu size={16} />
              </span>
              <input
                type="text"
                aria-label="Search pages"
                placeholder="Type a page name to navigate..."
                value={cmdSearch}
                onChange={(e) => {
                  setCmdSearch(e.target.value);
                  setSelectedCmdIdx(0);
                }}
                className="w-full border-0 focus:ring-0 text-slate-800 text-xs font-semibold placeholder:text-slate-450 bg-transparent h-6 focus:outline-hidden"
                autoFocus
              />
              <span className="text-[9px] text-slate-400 font-bold bg-slate-100 border border-slate-200 rounded-md px-1.5 py-0.5 select-none">ESC</span>
            </div>

            {/* List */}
            <div className="max-h-64 overflow-y-auto p-2 space-y-0.5">
              {filteredCommands.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-xs font-semibold italic">
                  No matching pages found.
                </div>
              ) : (
                filteredCommands.map((cmd, idx) => {
                  const CmdIcon = cmd.icon;
                  const isSelected = idx === selectedCmdIdx;
                  return (
                    <button
                      type="button"
                      key={cmd.name}
                      onClick={() => {
                        router.push(cmd.path);
                        setIsCmdOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                        isSelected 
                          ? "bg-primary-light text-primary font-bold" 
                          : "text-[#8a7560] hover:bg-slate-50 hover:text-slate-800"
                      }`}
                    >
                      <div className="flex items-center gap-3 text-xs">
                        <CmdIcon size={14} className={isSelected ? "text-primary animate-pulse" : "text-slate-400"} />
                        <span>{cmd.name}</span>
                      </div>
                      {isSelected && (
                        <span className="text-[10px] text-primary/70 font-semibold font-mono flex items-center gap-0.5">Navigate ↵</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Help footer */}
            <div className="p-3 bg-slate-50 border-t border-slate-100 flex justify-between items-center text-[9px] text-slate-400 font-bold tracking-wide select-none">
              <div className="flex gap-3">
                <span>↑↓ to select</span>
                <span>↵ to navigate</span>
              </div>
              <span>H+H Hub Cmd Palette (Ctrl+K)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
