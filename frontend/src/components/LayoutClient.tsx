"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { api, clearFinancialCaches } from "@/lib/api";
import { 
  LayoutDashboard, 
  ChefHat, 
  CalendarRange, 
  Truck, 
  Receipt, 
  Package, 
  ClipboardCheck, 
  Menu, 
  X,
  LogOut,
  Settings,
  Bell,
  UserCheck,
  Store
} from "lucide-react";

interface LayoutClientProps {
  children: React.ReactNode;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function LayoutClient({ children }: LayoutClientProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState("default");
  const [isOnline, setIsOnline] = useState(true);
  const [pendingActionsCount, setPendingActionsCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [isCmdOpen, setIsCmdOpen] = useState(false);
  const [cmdSearch, setCmdSearch] = useState("");
  const [selectedCmdIdx, setSelectedCmdIdx] = useState(0);
  const mobileDrawerRef = useRef<HTMLElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);

  // Command Palette Items
  const allCommands = [
    { name: "Navigate to Dashboard", path: "/", icon: LayoutDashboard },
    { name: "Navigate to Partner Shipments", path: "/consignment", icon: Truck },
    { name: "Navigate to Wholesale Billing", path: "/resellers", icon: Receipt },
    { name: "Navigate to Market Events", path: "/market-events", icon: Store },
    { name: "Navigate to Cooking Planner", path: "/planner", icon: CalendarRange },
    { name: "Navigate to Warehouse Stocks", path: "/inventory", icon: Package },
    { name: "Navigate to Facility Checklist", path: "/tasks", icon: ClipboardCheck },
    ...(userRole === "owner" ? [{ name: "Navigate to Recipe Manager", path: "/recipes", icon: ChefHat }] : []),
    ...(userRole === "owner" ? [{ name: "Navigate to Settings Admin", path: "/settings", icon: Settings }] : [])
  ];

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

  const updatePendingCount = () => {
    api.getOfflineActionsCount().then(count => {
      setPendingActionsCount(count);
    }).catch(() => {});
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      updatePendingCount();
      window.addEventListener("hh-offline-actions-updated", updatePendingCount);
      return () => {
        window.removeEventListener("hh-offline-actions-updated", updatePendingCount);
      };
    }
  }, []);

  useEffect(() => {
    api.getHealth()
      .then(res => {
        if (res?.demo_mode) {
          setIsDemoMode(true);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      let perm = "default";
      try {
        if (typeof Notification !== "undefined" && "permission" in Notification) {
          perm = Notification.permission;
        }
      } catch (e) {
        console.warn("Notification permission check failed:", e);
      }
      queueMicrotask(() => {
        setNotificationPermission(perm);
        setIsOnline(navigator.onLine);
      });
      
      const handleOnline = () => {
        setIsOnline(true);
        setSyncing(true);
        api.syncOfflineChanges().then(res => {
          if (res.success > 0) {
            alert(`Back online! Successfully synced ${res.success} changes.`);
          }
        }).catch(err => {
          console.error("Online event sync failed:", err);
        }).finally(() => {
          setSyncing(false);
          updatePendingCount();
        });
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

  const requestNotificationPermission = async () => {
    // iOS Safari does not support the Notifications API — guard it.
    if (typeof window === "undefined" || !("Notification" in window)) {
      alert("Push notifications are not supported on this device or browser.");
      return;
    }
    const perm = await Notification.requestPermission();
    setNotificationPermission(perm);
    if (perm === "granted") {
      try {
        new Notification("H+H Hub", {
          body: "Push alerts successfully enabled for this device!",
          icon: "/hh-logo.png"
        });
      } catch {
        // Some browsers allow permission but block the constructor — ignore.
      }
      try {
        if ('serviceWorker' in navigator && 'PushManager' in window) {
          const registration = await navigator.serviceWorker.ready;
          const vapidKey = "BJC9vbn9P7m7-ux3LXC3Nf0A66PRdaFR3UFoekjeq8GTcI9SUja8dtKoICpcro7Ufl9F4FVGkR-fKZjYcpJh8Yo";
          const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey)
          });
          const subJson = subscription.toJSON();
          if (subJson.endpoint && subJson.keys?.p256dh && subJson.keys?.auth) {
            await api.subscribePush({
              endpoint: subJson.endpoint,
              keys: {
                p256dh: subJson.keys.p256dh,
                auth: subJson.keys.auth
              }
            });
          }
        }
      } catch (err) {
        console.error("Failed to subscribe device for Web Push notifications:", err);
      }
    }
  };

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const loggedIn = localStorage.getItem("hh_logged_in") === "true";
        
        if (typeof window !== "undefined" && !navigator.onLine) {
          // Offline mode check
          if (loggedIn) {
            const offlineRole = localStorage.getItem("hh_user_role");
            if (offlineRole !== "owner") clearFinancialCaches();
            setUserRole(offlineRole);
            setUserName(localStorage.getItem("hh_user_name"));
            setCheckingAuth(false);
            if (pathname === "/login") router.push("/");
          } else {
            if (pathname !== "/login") router.push("/login");
            else setCheckingAuth(false);
          }
          return;
        }

        // Online mode: verify/refresh session
        if (loggedIn) {
          try {
            const res = await api.refreshSession();
            if (res.role !== "owner") clearFinancialCaches();
            setUserRole(res.role);
            setUserName(res.username);
            setCheckingAuth(false);
            if (pathname === "/login") router.push("/");
          } catch (err) {
            console.error("Session refresh failed", err);
            try {
              localStorage.removeItem("hh_logged_in");
              localStorage.removeItem("hh_user_name");
              localStorage.removeItem("hh_user_role");
              clearFinancialCaches();
            } catch {}
            if (pathname !== "/login") router.push("/login");
            else setCheckingAuth(false);
          }
        } else {
          if (pathname !== "/login") router.push("/login");
          else setCheckingAuth(false);
        }
      } catch {
        if (pathname !== "/login") router.push("/login");
        else setCheckingAuth(false);
      }
    };
    
    checkAuth();
  }, [pathname, router]);

  const categories = [
    {
      title: "Overview",
      items: [
        { name: "Dashboard", path: "/", icon: LayoutDashboard }
      ]
    },
    {
      title: "Sales & Orders",
      items: [
        { name: "Consignment", path: "/consignment", icon: Truck },
        { name: "Wholesale POS", path: "/resellers", icon: Receipt },
        { name: "Market Events", path: "/market-events", icon: Store }
      ]
    },
    {
      title: "Kitchen Operations",
      items: [
        { name: "Production Planner", path: "/planner", icon: CalendarRange },
        { name: "Inventory", path: "/inventory", icon: Package },
        { name: "Facility Tasks", path: "/tasks", icon: ClipboardCheck }
      ]
    },
  ];

  if (userRole === "owner") {
    categories.push({
      title: "Product Catalog",
      items: [
        { name: "Recipes & Costing", path: "/recipes", icon: ChefHat }
      ]
    });
    categories.push({
      title: "Configuration",
      items: [
        { name: "Settings & Users", path: "/settings", icon: Settings }
      ]
    });
  }

  const getPageTitle = (path: string) => {
    if (path === "/") return "Dashboard";
    const found = categories
      .flatMap(c => c.items)
      .find(i => i.path === path);
    return found ? found.name : "System Details";
  };

  const navContent = (
    <div className="flex flex-col h-full justify-between bg-white select-none overflow-hidden">
      {/* Static container (Optimized height for zero-scroll on laptops & mobile) */}
      <div className="flex flex-col justify-start min-h-0 overflow-hidden">
        {/* Header Branding - Compact 64px height */}
        <div className="h-16 flex items-center px-6 border-b border-[#ece5da] gap-3 bg-white z-10 shadow-3xs shrink-0">
          <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0 shadow-md">
            <Image src="/hh-logo.png" alt="H+H Hub Logo" width={36} height={36} className="w-full h-full object-cover" />
          </div>
          <div className="flex flex-col">
            <span className="font-heading font-black text-xs tracking-wide text-[#2d1f0e] leading-none">H+H Operations Hub</span>
            <span className="text-[8px] text-accent font-bold tracking-[0.12em] mt-1">ERP PORTFOLIO DEMO</span>
          </div>
        </div>

        {/* Navigation Links Grouped Categorically - Tighter spacing */}
        <div className="px-4 py-3 space-y-3.5 overflow-hidden">
          {categories.map((cat, idx) => (
            <div key={idx} className="space-y-1">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.12em] px-3.5 block">
                {cat.title}
              </span>
              <div className="space-y-0.5 pt-0.5">
                {cat.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.path;
                  return (
                    <Link
                      key={item.name}
                      href={item.path}
                      onClick={() => setIsMobileOpen(false)}
                      className={`flex items-center gap-2.5 px-3.5 py-1.5 min-h-[38px] 2xl:py-2.5 2xl:min-h-11 rounded-xl text-xs 2xl:text-sm font-sans font-bold transition-colors relative touch-optimize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                        isActive
                          ? "bg-primary-light text-primary"
                          : "text-[#8a7560] hover:bg-[#f5f0e8] hover:text-[#2d1f0e]"
                      }`}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-2.5 bottom-2.5 w-1 bg-accent rounded-r-lg"></div>
                      )}
                      <Icon size={16} className={isActive ? "text-primary" : "text-[#b8a898]"} />
                      {item.name}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer / User Profile & Sign Out - Extremely compact */}
      <div className="p-3.5 2xl:p-5 border-t border-[#ece5da] bg-[#faf8f5]/70 flex flex-col gap-3 shrink-0">
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
        <div className="text-[10px] text-[#b8a898] text-center font-black tracking-widest uppercase mt-0.5">
          V2.1.2 • VERCEL CLOUD
        </div>
      </div>
    </div>
  );

  if (pathname === "/login") {
    return <>{children}</>;
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 text-slate-400">
        <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin mb-3"></div>
        <span className="text-xs font-heading font-bold tracking-widest uppercase">Securing Session...</span>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#faf8f5] text-[#2d1f0e] font-sans antialiased overflow-hidden print:h-auto print:bg-white print:overflow-visible">
      {/* 1. DESKTOP SIDEBAR (Keep the wider content drawer layout through laptop widths) */}
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-300 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-primary focus:shadow-lg">
        Skip to main content
      </a>
      <aside className="w-60 border-r border-[#ece5da] bg-white hidden md:flex flex-col select-none shrink-0 h-full print:hidden">
        {navContent}
      </aside>

      {/* 2. MOBILE MENU DRAWER OVERLAY (z-50 modal on mobile/tablets) */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden select-none">
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
            className="relative w-64 bg-white border-r border-[#ece5da] flex flex-col h-full animate-slide-in shadow-xl"
          >
            <button 
              ref={mobileCloseRef}
              onClick={() => setIsMobileOpen(false)}
              aria-label="Close navigation"
              className="absolute right-4 top-4 z-20 h-10 w-10 rounded-lg bg-white flex items-center justify-center text-slate-400 hover:text-slate-600 md:hidden cursor-pointer touch-optimize"
            >
              <X size={18} />
            </button>
            {navContent}
          </aside>
        </div>
      )}

      {/* 3. MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden print:h-auto print:overflow-visible">
        {isDemoMode && (
          <div className="bg-[#bc9037] text-white text-center py-2 px-4 text-xs font-heading font-black tracking-wide flex items-center justify-center gap-2 print:hidden shrink-0 shadow-xs z-30">
            <div className="w-2 h-2 rounded-full bg-white animate-pulse"></div>
            <span>Public Demo — Synthetic business information only. The sandbox resets regularly.</span>
          </div>
        )}
        {/* Header bar */}
        <header className="h-16 border-b border-[#ece5da] bg-white/95 backdrop-blur-sm flex items-center justify-between px-3 sm:px-6 shrink-0 print:hidden shadow-xs z-20">
          <div className="flex items-center gap-4">
            {/* Hamburger Button for mobile */}
            <button 
              onClick={() => setIsMobileOpen(true)}
              aria-label="Open navigation"
              className="md:hidden h-11 w-11 text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-xl transition-colors cursor-pointer flex items-center justify-center touch-optimize"
            >
              <Menu size={24} />
            </button>
            
            <h1 className="max-w-[13rem] truncate font-heading text-lg font-bold leading-none text-slate-900 sm:max-w-none sm:text-xl">
              {getPageTitle(pathname)}
            </h1>
          </div>
          
          <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
            <button
              onClick={requestNotificationPermission}
              aria-label="Configure device push alerts"
              className={`p-2.5 rounded-xl transition-all cursor-pointer border ${
                notificationPermission === "granted"
                  ? "bg-emerald-50/50 border-emerald-150 text-emerald-700 hover:text-emerald-800"
                  : "bg-slate-50 border-slate-200 text-slate-500 hover:text-primary hover:bg-primary-light"
              }`}
            >
              <Bell size={18} />
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
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between gap-2 text-xs font-semibold text-amber-750 select-none print:hidden shadow-inner">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
              <span>Offline mode active. Operations are saved locally and synced when online.</span>
            </div>
            {pendingActionsCount > 0 && (
              <span className="bg-amber-100 border border-amber-300 text-amber-800 px-2.5 py-0.5 rounded-lg text-[10px] font-bold">
                {pendingActionsCount} change(s) pending
              </span>
            )}
          </div>
        )}

        {isOnline && pendingActionsCount > 0 && (
          <div className="bg-[#fcf8f2] border-b border-[#ece5da] px-4 py-2 flex items-center justify-between gap-2 text-xs font-semibold text-[#7b3e19] select-none print:hidden">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse"></span>
              <span>You have {pendingActionsCount} pending offline changes.</span>
            </div>
            <button
              onClick={async () => {
                setSyncing(true);
                try {
                  const res = await api.syncOfflineChanges();
                  alert(`Successfully synced ${res.success} changes! (Failed: ${res.failed})`);
                } catch (error: unknown) {
                  alert(`Sync failed: ${error instanceof Error ? error.message : "Unknown error"}`);
                } finally {
                  setSyncing(false);
                  updatePendingCount();
                }
              }}
              disabled={syncing}
              className="bg-primary text-white hover:bg-primary/90 px-3 py-1 rounded-lg text-[10px] cursor-pointer disabled:opacity-50 flex items-center gap-1 font-bold shadow-xs"
            >
              {syncing ? "Syncing..." : "Sync Now"}
            </button>
          </div>
        )}

        <main id="main-content" className="flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-5 print:p-0 print:overflow-visible">
          <div className="max-w-7xl w-full mx-auto print:max-w-none print:w-full">
            {children}
          </div>
        </main>
      </div>

      {/* GLOBAL COMMAND PALETTE (CTRL+K) OVERLAY */}
      {isCmdOpen && (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs z-250 flex items-start justify-center pt-24 px-4">
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
