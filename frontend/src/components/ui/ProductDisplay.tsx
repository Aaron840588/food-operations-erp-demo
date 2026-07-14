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
import { ProductSizeBadge } from "./ProductSizeBadge";

export interface ProductDisplayProps {
  sku: string;
  productName: string;
  category: string;
  size?: string | null;
  isActive?: boolean;
  className?: string;
  showCategory?: boolean;
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
}: ProductDisplayProps) {
  const Icon = getProductIcon(sku, productName, category);
  
  const hasSize = size && size.trim() !== "" && size.trim() !== "0" && size.trim() !== "0g";
  const isSandwich = (category || "").toLowerCase().includes("sandwich") || (productName || "").toLowerCase().includes("sandwich");
  
  // Clean name if it contains redundant size info
  const displayName = productName;
  
  // Portion determination
  let portionLabel = "";
  if (isSandwich) {
    const nameLower = productName.toLowerCase();
    const sizeLower = (size || "").toLowerCase();
    if (nameLower.includes("half") || sizeLower.includes("half") || sizeLower === "hf" || sku.includes("-HF-")) {
      portionLabel = "Half";
    } else if (nameLower.includes("full") || sizeLower.includes("full") || sizeLower === "fl" || sku.includes("-FL-")) {
      portionLabel = "Full";
    } else if (nameLower.includes("solo") || sizeLower.includes("solo") || sizeLower === "sl" || sku.includes("-SL-")) {
      portionLabel = "Solo";
    }
  }

  return (
    <div className={`flex items-center gap-3 select-none ${className} ${!isActive ? "opacity-60" : ""}`}>
      {/* Deterministic Icon container */}
      <div 
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-xs transition-colors
          ${!isActive 
            ? "bg-stone-150 text-stone-400" 
            : isSandwich 
              ? "bg-orange-50 text-orange-700" 
              : category.toLowerCase().includes("pastr") 
                ? "bg-amber-50 text-amber-700"
                : category.toLowerCase().includes("drink") 
                  ? "bg-rose-50 text-rose-700"
                  : "bg-emerald-50 text-emerald-700"
          }`}
      >
        {React.createElement(Icon, { size: 16, strokeWidth: 2.5 })}
      </div>

      {/* Details column */}
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-sans font-bold text-sm text-stone-900 truncate tracking-tight">
            {displayName}
          </span>
          {!isActive && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-stone-100 px-1.5 py-0.2 text-[9px] font-bold text-stone-600 border border-stone-200">
              <EyeOff size={8} /> Inactive
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-1.5 text-[10px] text-stone-500 flex-wrap mt-0.5">
          <span className="font-mono font-bold tracking-wide uppercase bg-stone-100 text-stone-700 px-1 rounded-sm border border-stone-200/60">
            {sku}
          </span>

          {showCategory && category && (
            <span className="text-stone-400 italic">
              {category}
            </span>
          )}
          
          {hasSize ? (
            <ProductSizeBadge size={size} sku={sku} />
          ) : (
            <span className="inline-flex items-center gap-0.5 rounded-md border border-red-200 bg-red-50 px-1.5 py-0.2 font-mono text-[9px] font-black uppercase text-red-700">
              <AlertCircle size={9} /> Missing Size
            </span>
          )}

          {portionLabel && (
            <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.2 font-mono text-[9px] font-bold uppercase text-amber-700">
              {portionLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
