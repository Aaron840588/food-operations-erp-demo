"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    
    // Auto-remove after 4 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Intercept window.alert globally and redirect to use showToast
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.alert = (message: string) => {
        const msgLower = message.toLowerCase();
        const isSuccess = msgLower.includes("success") || 
                          msgLower.includes("complete") || 
                          msgLower.includes("registered") ||
                          msgLower.includes("intaked") ||
                          msgLower.includes("configured") ||
                          msgLower.includes("transferred");
        const isWarning = msgLower.includes("select") || 
                          msgLower.includes("enter") || 
                          msgLower.includes("fill in") ||
                          msgLower.includes("must be");
        
        let type: ToastType = "error";
        if (isSuccess) type = "success";
        else if (isWarning) type = "warning";
        
        showToast(message, type);
      };
    }
  }, [showToast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast container */}
      <div aria-live="polite" aria-atomic="false" className="fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:max-w-sm sm:w-full pointer-events-none">
        {toasts.map((toast) => {
          let bgColor = "bg-white border-slate-200 text-slate-800 shadow-lg";
          let icon = <AlertCircle className="text-slate-500 flex-shrink-0" size={16} />;
          
          if (toast.type === "success") {
            bgColor = "bg-emerald-50 border-emerald-250 text-emerald-900 shadow-md";
            icon = <CheckCircle2 className="text-emerald-650 flex-shrink-0" size={16} />;
          } else if (toast.type === "error") {
            bgColor = "bg-rose-50 border-rose-250 text-rose-900 shadow-md";
            icon = <AlertCircle className="text-rose-650 flex-shrink-0" size={16} />;
          } else if (toast.type === "warning") {
            bgColor = "bg-amber-50 border-amber-250 text-amber-900 shadow-md";
            icon = <AlertCircle className="text-amber-650 flex-shrink-0" size={16} />;
          }

          return (
            <div
              key={toast.id}
              className={`flex items-start gap-3 p-3.5 rounded-xl border pointer-events-auto animate-slide-in-right ${bgColor}`}
            >
              {icon}
              <span className="text-xs font-semibold flex-1 leading-snug">{toast.message}</span>
              <button
                onClick={() => removeToast(toast.id)}
                aria-label="Dismiss notification"
                className="text-slate-400 hover:text-slate-600 cursor-pointer flex-shrink-0"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
