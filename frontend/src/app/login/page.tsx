"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api, clearFinancialCaches } from "@/lib/api";
import Image from "next/image";
import { Lock, Eye, EyeOff, ShieldAlert, Sparkles } from "lucide-react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [demoCredentials, setDemoCredentials] = useState({
    ownerUser: "demo-owner",
    ownerPass: "owner123",
    staffUser: "demo-staff",
    staffPass: "staff123"
  });
  const router = useRouter();

  // Load demo mode state and redirect if already logged in
  useEffect(() => {
    try {
      const loggedIn = localStorage.getItem("hh_logged_in");
      if (loggedIn === "true") router.push("/");
    } catch {
      // localStorage unavailable (iOS Private Browsing) — stay on login
    }

    api.getHealth()
      .then(res => {
        if (res?.demo_mode) {
          setIsDemoMode(true);
          setDemoCredentials({
            ownerUser: res.demo_owner_username || "demo-owner",
            ownerPass: res.demo_owner_password || "owner123",
            staffUser: res.demo_staff_username || "demo-staff",
            staffPass: res.demo_staff_password || "staff123"
          });
        }
      })
      .catch(() => {});
  }, [router]);

  const handlePrefillAndLogin = async (role: "owner" | "staff") => {
    const user = role === "owner" ? demoCredentials.ownerUser : demoCredentials.staffUser;
    const pass = role === "owner" ? demoCredentials.ownerPass : demoCredentials.staffPass;
    
    setUsername(user);
    setPassword(pass);
    setLoading(true);
    setError("");

    try {
      const res = await api.login(user, pass);
      try {
        clearFinancialCaches();
        localStorage.setItem("hh_logged_in", "true");
        localStorage.setItem("hh_user_name", res.username);
        localStorage.setItem("hh_user_role", res.role);
      } catch {}
      router.replace("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Quick-access login failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Please enter username and passcode.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await api.login(username, password);
      try {
        clearFinancialCaches();
        localStorage.setItem("hh_logged_in", "true");
        localStorage.setItem("hh_user_name", res.username);
        localStorage.setItem("hh_user_role", res.role);
      } catch {
        // localStorage blocked (iOS Private Browsing) — session will be in-memory only
      }
      router.replace("/");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Login failed. Please check passcode and try again.");
    } finally {
      setLoading(false);
    }
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
          <p className="text-xs text-[#8a7560] mt-1 font-semibold tracking-wide uppercase">Operations &amp; ERP Platform</p>
        </div>

        {/* Premium Warm Sand Card */}
        <div className="bg-white border-2 border-[#dfd5c6] rounded-3xl p-8 shadow-sm transition-all duration-300">
          <div className="mb-6">
            <h2 className="text-lg font-heading font-black text-slate-900 flex items-center gap-2">
              <Lock className="text-[#bc9037]" size={18} />
              Unlock Dashboard
            </h2>
            <p className="text-xs text-slate-500 mt-1 font-semibold">Enter your authorized account username and passcode.</p>
          </div>

          {isDemoMode && (
            <div className="mb-6 p-4 bg-amber-50/80 border border-amber-200/60 rounded-2xl text-xs text-amber-900 font-semibold space-y-3.5">
              <div>
                <p className="text-amber-800 font-black flex items-center gap-1">
                  <Sparkles size={14} className="text-amber-600 animate-pulse" />
                  Public Portfolio Demo Sandbox
                </p>
                <p className="text-[11px] text-amber-700/90 font-medium mt-0.5">
                  Public portfolio sandbox using synthetic data. Changes may reset automatically.
                </p>
              </div>

              {/* Role Descriptions */}
              <div className="space-y-2 text-[11px] leading-relaxed border-t border-amber-200/40 pt-3">
                <p className="text-amber-850">
                  <strong className="font-bold text-amber-950">Owner Account:</strong> Full administrative control. View synthetic costing, recursive BOM analyses, net margin trends, and administrative settings.
                </p>
                <p className="text-amber-850">
                  <strong className="font-bold text-amber-950">Staff Account:</strong> Restricted operations view. Costing and margin panels are redacted. Focuses on checklists, schedules, and pop-up retail dispatches.
                </p>
              </div>

              {/* Quick-Access Buttons */}
              <div className="grid grid-cols-2 gap-2 border-t border-amber-200/40 pt-3">
                <button
                  type="button"
                  onClick={() => handlePrefillAndLogin("owner")}
                  disabled={loading}
                  className="py-2.5 px-3 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-[10px] text-center uppercase tracking-wide cursor-pointer transition-colors shadow-2xs border border-amber-700/20"
                >
                  Explore as Owner
                </button>
                <button
                  type="button"
                  onClick={() => handlePrefillAndLogin("staff")}
                  disabled={loading}
                  className="py-2.5 px-3 bg-[#885625] hover:bg-[#73471e] text-white font-bold rounded-xl text-[10px] text-center uppercase tracking-wide cursor-pointer transition-colors shadow-2xs border border-[#885625]/20"
                >
                  Explore as Staff
                </button>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            
            {/* Username Input Field */}
            <div className="space-y-2">
              <label htmlFor="username" className="text-xs text-[#6f5b48] font-bold block">Username</label>
              <input
                id="username"
                type="text"
                required
                autoComplete="username"
                placeholder="e.g. owner or staff_member"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all text-sm font-semibold h-11"
                disabled={loading}
              />
            </div>
            
            {/* Password Input Field */}
            <div className="space-y-2">
              <label htmlFor="password" className="text-xs text-[#6f5b48] font-bold block">Passcode</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  aria-describedby={error ? "login-error" : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all text-sm font-mono tracking-widest h-11"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide passcode" : "Show passcode"}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                  disabled={loading}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div id="login-error" role="alert" className="flex items-start gap-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-700 p-3.5 rounded-xl text-xs font-semibold animate-shake">
                <ShieldAlert className="shrink-0 mt-0.5" size={15} />
                <span>{error}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-[#885625] hover:bg-[#73471e] disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 shadow-xs active:scale-[0.98] transition-all cursor-pointer h-12"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <Sparkles size={14} />
                  Authorize Access
                </>
              )}
            </button>

          </form>
        </div>

        {/* Footer Info */}
        <p className="text-center text-[10px] text-slate-450 mt-8 font-black uppercase tracking-wider leading-relaxed">
          Confidential &bull; Authorized personnel only.<br />
          &copy; {new Date().getFullYear()} H+H Hub &bull; Handmade+Homemade
        </p>

      </div>
    </div>
  );
}
