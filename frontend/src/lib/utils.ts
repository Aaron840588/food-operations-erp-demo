/**
 * Maps database product attributes to human-friendly business categories.
 */
const CURRENT_LINEUP_SOURCE_CATEGORIES = new Set(["sweet", "savory", "sandwich"]);

export function isCurrentLineupProduct(p: { category?: string }): boolean {
  return CURRENT_LINEUP_SOURCE_CATEGORIES.has((p.category || "").trim().toLowerCase());
}

export function getProductBusinessCategory(p: { sku?: string; product_name?: string; category?: string }): string {
  const sku = (p.sku || "").toUpperCase();
  const name = (p.product_name || "").toLowerCase();
  const cat = (p.category || "").toLowerCase();

  // Spreads & Sauces
  if (
    sku.startsWith("YP-") || 
    sku.startsWith("ST-") || 
    sku.startsWith("CM-") || 
    sku.startsWith("WM-") || 
    sku.startsWith("PP-") || 
    sku.startsWith("CGO-") ||
    sku.startsWith("CLS-") ||
    name.includes("spread") || 
    name.includes("sauce") || 
    name.includes("oil") ||
    cat.includes("sweet") ||
    cat.includes("savory")
  ) {
    return "Spreads & Sauces";
  }
  
  // Sandwiches & Salads (default)
  return "Sandwiches & Salads";
}

/**
 * Returns a sorted list of business categories for rendering consistency.
 */
export const BUSINESS_CATEGORIES = [
  "Spreads & Sauces",
  "Sandwiches & Salads"
];

/**
 * Returns Tailwind CSS class strings for a colored size badge.
 * Use this everywhere a size badge/chip is displayed so all sizes are
 * visually consistent across the whole app.
 *
 * Sizes detected (case-insensitive):
 *   SOLO / SL   → violet  (single portion)
 *   HALF / HF   → amber   (snack portion)
 *   FULL / FL / WHOLE → teal / emerald (double portion)
 *   SAMPLER / SAM → rose  (mini jars)
 *   INDULGE / IND → orange (large jars)
 *   SAVORY      → sky blue
 *   SWEET       → fuchsia/pink
 *   Other       → slate grey (default)
 */
export function getSizeBadgeStyle(size: string): string {
  const s = (size || "").toLowerCase().trim();
  if (/\b(solo|sl)\b/.test(s))
    return "border-violet-300 bg-violet-100 text-violet-800";
  if (/\b(half|hf)\b/.test(s))
    return "border-amber-300 bg-amber-100 text-amber-800";
  if (/\b(full|whole|fl)\b/.test(s))
    return "border-emerald-300 bg-emerald-100 text-emerald-800";
  if (/\b(sampler|sam)\b/.test(s))
    return "border-rose-300 bg-rose-100 text-rose-800";
  if (/\b(indulge|ind)\b/.test(s))
    return "border-orange-300 bg-orange-100 text-orange-800";
  if (s === "1s" || s.startsWith("1s"))
    return "border-stone-300 bg-stone-100 text-stone-700";
  if (s === "2s" || s.startsWith("2s"))
    return "border-teal-300 bg-teal-100 text-teal-800";
  if (s === "4s" || s.startsWith("4s"))
    return "border-indigo-300 bg-indigo-100 text-indigo-800";
  if (s === "5s" || s.startsWith("5s"))
    return "border-purple-300 bg-purple-100 text-purple-800";
  if (s === "standard")
    return "border-slate-300 bg-slate-100 text-slate-800";
  if (s.includes("savory") || s.includes("svr"))
    return "border-sky-300 bg-sky-100 text-sky-800";
  if (s.includes("sweet") || s.includes("swt"))
    return "border-fuchsia-300 bg-fuchsia-100 text-fuchsia-800";
  return "border-stone-300 bg-stone-100 text-stone-700";
}

/**
 * Returns a short uppercase label for a size string (mapping to exact physical values).
 */
export function getSizeLabel(size: string, sku?: string): string {
  const s = (size || "").toLowerCase().trim();
  const k = (sku || "").toUpperCase().trim();
  
  if (s === "indulge" || s === "ind") {
    // Savory spread (Pesto, Chili Garlic, Chicken Liver has SVR or starts with GCP, PP, CGO, CLS)
    if (k.includes("SVR") || k.startsWith("PP") || k.startsWith("CGO") || k.startsWith("CLS")) {
      return "200g";
    }
    return "240g";
  }
  if (s === "sampler" || s === "sam") {
    return "100g";
  }
  if (s === "solo" || s === "sl") {
    return "Solo";
  }
  if (s === "half" || s === "hf") {
    return "Half";
  }
  if (s === "full" || s === "fl" || s === "whole") {
    return "Full";
  }
  return (size || "").toUpperCase();
}
