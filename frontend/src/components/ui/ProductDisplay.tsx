import React from "react";
import {
  Sparkles,
  Flame,
  Leaf,
  Coffee,
  Utensils,
  Cookie,
  HelpCircle,
  AlertCircle,
  EyeOff,
} from "lucide-react";
import { getProductBusinessCategory, toProductTitleCase } from "@/lib/utils";
import { ProductSizeBadge } from "./ProductSizeBadge";


export interface ProductDisplayProps {
  sku: string;
  productName: string;
  category: string;
  size?: string | null;
  isActive?: boolean;
  className?: string;
  showCategory?: boolean;
  showIcon?: boolean;
  showMissingSize?: boolean;
  variant?: "default" | "compact" | "selector";
}

// Stable, deterministic mapping of Lucide icons based on SKU and product name
export function getProductIcon(sku: string, name: string, category: string) {
  const s = (sku || "").toUpperCase();
  const n = (name || "").toLowerCase();
  const c = (category || "").toLowerCase();

  // Spreads & Sauces
  if (s.startsWith("YP-") || n.includes("yema")) return Sparkles;
  if (s.startsWith("ST-") || n.includes("tablea")) return Flame; // cocoa/warm tablea
  if (s.startsWith("CM-") || n.includes("matcha")) return Leaf;
  if (s.startsWith("WM-") || n.includes("mocha") || n.includes("macadamia")) return Coffee;
  if (s.startsWith("PP-") || n.includes("pesto") || n.includes("basil")) return Leaf;
  if (s.startsWith("CGO-") || n.includes("chili garlic") || n.includes("garlic oil")) return Flame;
  if (s.startsWith("CLS-") || n.includes("liver")) return Utensils; // Chicken liver spread

  // Pastries / Crinkles
  if (c.includes("pastr") || c.includes("bakery") || n.includes("crinkle") || n.includes("brazo") || n.includes("cookie") || n.includes("pastil")) {
    return Cookie;
  }

  // Drinks / Coffee / Cold Brew
  if (c.includes("drink") || c.includes("beverage") || n.includes("brew") || n.includes("cold brew") || n.includes("tsokolate") || n.includes("latte")) {
    return Coffee;
  }

  // Sandwiches / Pasta
  if (c.includes("sandwich") || n.includes("sandwich") || c.includes("pasta") || n.includes("pasta") || n.includes("rigatoni") || n.includes("mac and cheese")) {
    return Utensils;
  }

  return HelpCircle;
}

export function ProductDisplay({
  sku,
  productName,
  category,
  size,
  isActive = true,
  className = "",
  showCategory = false,
  showIcon = true,
  showMissingSize = true,
  variant = "default",
}: ProductDisplayProps) {
  const Icon = getProductIcon(sku, productName, category);
  const businessCategory = getProductBusinessCategory({ sku, product_name: productName, category });
  const hasSize = size && size.trim() !== "" && size.trim() !== "0" && size.trim() !== "0g";
  const isSandwich = businessCategory === "Sandwiches & Salads";
  const normalizedCategory = (category || "").toLowerCase();
  const isCompact = variant !== "default";

  // Clean name if it contains redundant size info
  const displayName = toProductTitleCase(productName);

  return (
    <div className={`flex min-w-0 items-center ${isCompact ? "gap-2" : "gap-3"} select-none ${className} ${!isActive ? "opacity-60" : ""}`}>
      {/* Deterministic Icon container */}
      {showIcon && (
        <div
          className={`flex shrink-0 items-center justify-center rounded-lg shadow-xs transition-colors ${isCompact ? "h-7 w-7" : "h-8 w-8"}
            ${!isActive
              ? "bg-stone-100 text-stone-400"
              : isSandwich
                ? "bg-orange-50 text-orange-700"
                : normalizedCategory.includes("pastr")
                  ? "bg-amber-50 text-amber-700"
                  : normalizedCategory.includes("drink")
                    ? "bg-rose-50 text-rose-700"
                    : "bg-emerald-50 text-emerald-700"
            }`}
        >
          {React.createElement(Icon, { size: isCompact ? 14 : 16, strokeWidth: 2.5 })}
        </div>
      )}

      {/* Details column */}
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`font-sans font-bold leading-tight text-stone-900 tracking-tight ${variant === "selector" ? "truncate text-xs" : "line-clamp-2 text-sm"}`}
            title={displayName}
          >
            {displayName}
          </span>
          {!isActive && (
            <span className="inline-flex items-center gap-0.5 rounded-full border border-stone-200 bg-stone-100 px-1.5 py-0.5 text-[9px] font-bold text-stone-600">
              <EyeOff size={8} /> Inactive
            </span>
          )}
        </div>
        
        <div className={`flex items-center gap-1.5 text-stone-500 flex-wrap ${isCompact ? "mt-0 text-[9px]" : "mt-0.5 text-[10px]"}`}>
          <span className="font-mono font-bold tracking-wide uppercase bg-stone-100 text-stone-700 px-1 rounded-sm border border-stone-200/60">
            {sku}
          </span>

          {showCategory && category && (
            <span className="text-stone-400">
              {businessCategory}
            </span>
          )}
          
          {hasSize ? (
            <ProductSizeBadge size={size} sku={sku} />
          ) : showMissingSize ? (
            <span className="inline-flex items-center gap-0.5 rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 font-mono text-[9px] font-black uppercase text-red-700">
              <AlertCircle size={9} /> Missing Size
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
