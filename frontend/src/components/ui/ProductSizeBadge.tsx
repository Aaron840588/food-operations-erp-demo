import { getSizeBadgeStyle, getSizeLabel } from "@/lib/utils";

type ProductSizeBadgeProps = {
  size?: string | null;
  sku?: string | null;
  className?: string;
};

export function ProductSizeBadge({ size, sku, className = "" }: ProductSizeBadgeProps) {
  const label = size?.trim() || "Standard";
  const displayLabel = getSizeLabel(label, sku || "");

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 font-mono text-[10px] font-black uppercase tracking-wide ${getSizeBadgeStyle(label)} ${className}`}
    >
      {displayLabel}
    </span>
  );
}
