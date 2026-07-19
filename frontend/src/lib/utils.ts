/**
 * Maps database product attributes to human-friendly business categories.
 */
const CURRENT_LINEUP_SOURCE_CATEGORIES = new Set(["sweet", "savory", "sandwich"]);

export type ProductIdentity = {
  sku?: string;
  product_name?: string;
  name?: string;
  category?: string;
  size?: string | null;
};

export function isCurrentLineupProduct(p: { category?: string }): boolean {
  return CURRENT_LINEUP_SOURCE_CATEGORIES.has((p.category || "").trim().toLowerCase());
}

export function getProductBusinessCategory(p: ProductIdentity): string {
  const sku = (p.sku || "").toUpperCase();
  const name = (p.product_name || p.name || "").toLowerCase();
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
  
  if (
    sku.includes("-SW-") ||
    sku.includes("-SL-") ||
    name.includes("sandwich") ||
    name.includes("salad") ||
    cat.includes("sandwich") ||
    cat.includes("salad")
  ) {
    return "Sandwiches & Salads";
  }

  return UNCATEGORIZED_BUSINESS_CATEGORY;
}

/**
 * Returns a sorted list of business categories for rendering consistency.
 */
export const BUSINESS_CATEGORIES = [
  "Spreads & Sauces",
  "Sandwiches & Salads"
] as const;

export const UNCATEGORIZED_BUSINESS_CATEGORY = "Uncategorized";

export type ProductSizeGroup = {
  key: string;
  label: string;
  order: number;
};

const OTHER_SIZE_GROUP: ProductSizeGroup = {
  key: "other-sizes",
  label: "Other Sizes",
  order: 99,
};

/**
 * Returns the shared subgroup used by hierarchical product tables.
 * The commercial jar format remains useful in group headings, while the
 * canonical badge itself shows physical weight (for example Indulge / 240g).
 */
export function getProductSizeGroup(product: ProductIdentity): ProductSizeGroup {
  const businessCategory = getProductBusinessCategory(product);
  const sku = (product.sku || "").toUpperCase();
  const name = (product.product_name || product.name || "").toLowerCase();
  const sourceCategory = (product.category || "").toLowerCase();
  const size = (product.size || "").toLowerCase().trim();

  if (businessCategory === "Spreads & Sauces") {
    const isSweet = sourceCategory.includes("sweet") || sku.includes("SWT");
    const flavorLabel = isSweet ? "Sweet Spreads" : "Savory Spreads";
    const flavorOrder = isSweet ? 0 : 10;
    const isIndulge =
      size === "indulge" ||
      size === "ind" ||
      ["200g", "220g", "240g", "250g", "200", "220", "240", "250"].includes(size) ||
      sku.includes("-IND-");
    const isSampler =
      size === "sampler" ||
      size === "sam" ||
      ["100g", "110g", "100", "110"].includes(size) ||
      sku.includes("-SAM-");

    if (isIndulge) {
      return {
        key: `${isSweet ? "sweet" : "savory"}-indulge`,
        label: `${flavorLabel} (Indulge / ${getSizeLabel("Indulge", sku)})`,
        order: flavorOrder,
      };
    }

    if (isSampler) {
      return {
        key: `${isSweet ? "sweet" : "savory"}-sampler`,
        label: `${flavorLabel} (Sampler / ${getSizeLabel("Sampler", sku)})`,
        order: flavorOrder + 1,
      };
    }

    return {
      key: `${isSweet ? "sweet" : "savory"}-other`,
      label: `${flavorLabel} (Other Sizes)`,
      order: flavorOrder + 2,
    };
  }

  if (businessCategory === "Sandwiches & Salads") {
    const candidates = `${size} ${sku} ${name}`;
    if (/\b(full|whole|fl)\b|\-FL\-/.test(candidates)) {
      return { key: "full", label: "Full", order: 20 };
    }
    if (/\b(solo|sl)\b|\-SL\-/.test(candidates)) {
      return { key: "solo", label: "Solo", order: 21 };
    }
    if (/\b(half|hf)\b|\-HF\-/.test(candidates)) {
      return { key: "half", label: "Half", order: 22 };
    }
    return { key: "standard", label: "Standard", order: 23 };
  }

  return OTHER_SIZE_GROUP;
}

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

export function formatJars(count: number | string): string {
  const c = Number(count);
  return `${c} ${c === 1 ? "jar" : "jars"}`;
}

export function formatUnits(count: number | string): string {
  const c = Number(count);
  return `${c} ${c === 1 ? "unit" : "units"}`;
}

export function formatProductQuantity(product: ProductIdentity, count: number | string): string {
  return getProductBusinessCategory(product) === "Spreads & Sauces"
    ? formatJars(count)
    : formatUnits(count);
}

export function formatCurrency(value: number | string | null | undefined): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function toValidDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: string | Date | null | undefined): string {
  const date = toValidDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toValidDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function toProductTitleCase(name: string): string {
  if (!name) return "";
  
  const lowercaseWords = ["and", "with", "or", "but", "in", "on", "for", "the", "a", "an", "at", "to", "by", "of", "from"];
  const uppercaseWords = ["SKU", "BOM", "DR", "GCash", "Maya", "PWA", "POS", "VAT", "COGS", "AR", "BLT", "PCLB", "PCS", "CMS", "WM", "YP", "CGO", "PP", "ST", "CLS", "WMS", "WMS-HF-SW-SWT", "PCS-HF-SW-SVR", "PCLB-HF-SW-SVR"];

  return name
    .split(/\s+/)
    .map((word, index, arr) => {
      const cleanWord = word.replace(/[^a-zA-Z0-9']/g, "");
      const upperWord = cleanWord.toUpperCase();
      
      if (uppercaseWords.includes(upperWord)) {
        return word.toUpperCase();
      }
      
      if (lowercaseWords.includes(cleanWord.toLowerCase()) && index > 0 && index < arr.length - 1) {
        return word.toLowerCase();
      }
      
      if (word.length > 0) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      }
      return word;
    })
    .join(" ");
}
