"use client";

import React from "react";
import { clearFinancialCaches } from "@/lib/api";
import Image from "next/image";
import { Sparkles, UserCheck } from "lucide-react";

export default function LoginPage() {
  const handleDemoAccess = (role: "owner" | "staff") => {
    try {
      clearFinancialCaches();
      localStorage.setItem("hh_logged_in", "true");
      localStorage.setItem("hh_user_name", role === "owner" ? "Portfolio Owner Guest" : "Staff Member");
      localStorage.setItem("hh_user_role", role);
    } catch {}
    window.location.href = role === "owner" ? "/" : "/market-events";
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#f4eee3] relative overflow-hidden font-sans">
      {/* Decorative Warm Accent Orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#885625]/5 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#bc9037]/5 rounded-full blur-[120px] pointer-events-none"></div>

      {/* Main Container */}
      <div className="w-full max-w-md px-6 z-10">
        
        {/* Brand Header */}
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="w-20 h-20 rounded-2xl overflow-hidden shadow-md mb-4 border border-[#dfd5c6]">
            <Image src="/hh-logo.png" alt="H+H Hub" width={80} height={80} className="w-full h-full object-cover" />
          </div>
          <h1 className="text-3xl font-heading font-black text-[#2d1f0e] tracking-tight">
            H+H Hub
          </h1>
          <p className="text-xs text-[#8a7560] mt-1 font-semibold tracking-wide uppercase">Operations &amp; ERP Platform Demo</p>
        </div>

        {/* Premium Sand Demo Access Card */}
        <div className="bg-white border-2 border-[#dfd5c6] rounded-3xl p-8 shadow-sm transition-all duration-300">
          <div className="mb-6 text-center">
            <div className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-900 px-3.5 py-1 rounded-full text-xs font-bold mb-3">
              <Sparkles size={13} className="text-amber-600" />
              Live Interactive Portfolio Demo
            </div>
            <h2 className="text-xl font-heading font-black text-slate-900">
              Select Demo View
            </h2>
            <p className="text-xs text-slate-500 mt-1.5 font-semibold leading-relaxed">
              Explore the full system instantly. Click a role below to launch the live platform.
            </p>
          </div>

          <div className="space-y-3.5">
            <button
              type="button"
              onClick={() => handleDemoAccess("owner")}
              className="w-full p-4 bg-[#885625] hover:bg-[#73471e] text-white rounded-2xl font-bold flex items-center justify-between shadow-md hover:shadow-lg active:scale-[0.98] transition-all cursor-pointer group"
            >
              <div className="flex items-center gap-3 text-left">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                  <Sparkles size={20} className="text-white" />
                </div>
                <div>
                  <div className="text-sm font-black tracking-wide">Owner View</div>
                  <div className="text-[11px] text-amber-100 font-medium">Full Financials, Costing, &amp; Management</div>
                </div>
              </div>
              <span className="text-xs font-black uppercase tracking-wider bg-white/20 px-2.5 py-1 rounded-lg">Launch &rarr;</span>
            </button>

            <button
              type="button"
              onClick={() => handleDemoAccess("staff")}
              className="w-full p-4 bg-slate-800 hover:bg-slate-900 text-white rounded-2xl font-bold flex items-center justify-between shadow-md hover:shadow-lg active:scale-[0.98] transition-all cursor-pointer group"
            >
              <div className="flex items-center gap-3 text-left">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                  <UserCheck size={20} className="text-slate-300" />
                </div>
                <div>
                  <div className="text-sm font-black tracking-wide">Staff View</div>
                  <div className="text-[11px] text-slate-300 font-medium">Market POS, Inventory, &amp; Tasks</div>
                </div>
              </div>
              <span className="text-xs font-black uppercase tracking-wider bg-white/10 px-2.5 py-1 rounded-lg">Launch &rarr;</span>
            </button>
          </div>
        </div>

        {/* Footer Info */}
        <p className="text-center text-[10px] text-slate-450 mt-8 font-black uppercase tracking-wider leading-relaxed">
          Public Demo Active &bull; No Passcode Required<br />
          &copy; {new Date().getFullYear()} H+H Hub &bull; Handmade+Homemade
        </p>

      </div>
    </div>
  );
}
