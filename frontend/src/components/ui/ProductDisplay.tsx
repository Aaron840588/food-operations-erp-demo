import React from "react";
import Image from "next/image";
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
import { getFlavorTag, getProductBusinessCategory, toProductTitleCase } from "@/lib/utils";
import { ProductSizeBadge } from "./ProductSizeBadge";

export const PRODUCT_IMAGE_MAP: Record<string, string> = {
  // Spreads & Sauces
  "YP-SAM-SWT": "/products/yema spread with toasted pili nuts.png",
  "YP-IND-SWT": "/products/yema spread with toasted pili nuts.png",
  "ST-SAM-SWT": "/products/sweet tablea with peanut bits.png",
  "ST-IND-SWT": "/products/sweet tablea with peanut bits.png",
  "CM-SAM-SWT": "/products/Creamy Matcha with white chocolate.png",
  "CM-IND-SWT": "/products/Creamy Matcha with white chocolate.png",
  "WM-SAM-SWT": "/products/white mocha with macadamia nuts.png",
  "WM-IND-SWT": "/products/white mocha with macadamia nuts.png",
  "PP-SAM-SVR": "/products/pesto with pili.png",
  "PP-IND-SVR": "/products/pesto with pili.png",
  "CGO-SAM-SVR": "/products/chili-garlic-oil.png",
  "CGO-IND-SVR": "/products/chili-garlic-oil.png",

  // Sandwiches & Specialty Items
  "PTE-FL-SW-SVR": "/products/pesto-tomato-egg-sandwich.png",
  "PTE-HF-SW-SVR": "/products/pesto-tomato-egg-sandwich.png",
  "STS-FL-SW-SWT": "/products/sweet-tablea-smores.png",
  "STS-HF-SW-SWT": "/products/sweet-tablea-smores.png",
  "GCP-SL-SW-SVR": "/products/grilled-cheese-pesto-pili.png",
  "MHC-FL-SW-CK": "/products/macchiato-honeycomb-crunch.png",
  "MHC-HF-SW-CK": "/products/macchiato-honeycomb-crunch.png",
  "UYK-FL-SW-CK": "/products/ube-yema-pili-keso.png",
  "UYK-HF-SW-CK": "/products/ube-yema-pili-keso.png",
  "TBF-FL-SW-CK": "/products/tablea-black-forest.png",
  "TBF-HF-SW-CK": "/products/tablea-black-forest.png",
  "TRRD-SL-SW-SWT": "/products/tablea-rocky-road.png",
  "TRM-FL-SW-SWT": "/products/tiramisu-sandwich.png",
  "TRM-HF-SW-SWT": "/products/tiramisu-sandwich.png",
  "CMS-FL-SW-SWT": "/products/cookies-matcha-smores.png",
  "CMS-HF-SW-SWT": "/products/cookies-matcha-smores.png",
  "YMB-SL-SW-SWT": "/products/yema-brazo-sandwich.png",
  "CQM-FL-SW-SVR": "/products/pesto-croque-monsieur.png",
  "CQM-HF-SW-SVR": "/products/pesto-croque-monsieur.png",
  "CQMD-FL-SW-SVR": "/products/pesto-croque-madame.png",
  "CQMD-HF-SW-SVR": "/products/pesto-croque-madame.png",
  "SSS-SL-SW-SVR": "/products/spicy-smoked-salmon.png",
  "PCHXW-SL-SW-SVR": "/products/creamy-pesto-chicken.png",
  "PPZ-FL-SW-SVR": "/products/pesto-pepperoni-pizza.png",
  "PPZ-HF-SW-SVR": "/products/pesto-pepperoni-pizza.png",
};


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

  const flavorTag = getFlavorTag({ sku, product_name: productName, category });

  return (
    <div className={`flex min-w-0 items-center ${isCompact ? "gap-2" : "gap-3"} select-none ${className} ${!isActive ? "opacity-60" : ""}`}>
      {/* Deterministic Icon or Product Photo container */}
      {showIcon && (
        PRODUCT_IMAGE_MAP[sku.toUpperCase()] ? (
          <div className={`relative shrink-0 overflow-hidden rounded-lg border border-stone-200 bg-stone-50 shadow-3xs print:hidden ${isCompact ? "h-10 w-10" : "h-14 w-14"}`}>
            <Image
              src={PRODUCT_IMAGE_MAP[sku.toUpperCase()]}
              alt={productName}
              fill
              sizes="(max-width: 768px) 56px, 56px"
              className="object-cover"
            />
          </div>
        ) : (
          <div
            className={`flex shrink-0 items-center justify-center rounded-lg shadow-xs transition-colors print:hidden ${isCompact ? "h-10 w-10" : "h-14 w-14"}
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
            {React.createElement(Icon, { size: isCompact ? 18 : 24, strokeWidth: 2.5 })}
          </div>
        )
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

          {flavorTag && (
            <span className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 font-sans text-[10px] font-black uppercase tracking-wide ${flavorTag.style}`}>
              {flavorTag.label}
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
