import { Badge } from "./Badge";

type BadgeVariant = "success" | "warning" | "danger" | "info" | "neutral";

const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  active: "success",
  paid: "success",
  completed: "success",
  healthy: "success",
  synced: "success",
  "picked up": "success",
  pending: "warning",
  planned: "info",
  draft: "neutral",
  inactive: "neutral",
  unpaid: "danger",
  overdue: "danger",
  failed: "danger",
  conflict: "danger",
  "low stock": "warning",
  "out of stock": "danger",
};

type StatusBadgeProps = {
  status: string;
  label?: string;
  className?: string;
};

export function StatusBadge({ status, label, className = "" }: StatusBadgeProps) {
  const normalized = status.trim().toLowerCase();
  const variant = STATUS_VARIANTS[normalized] ?? "neutral";
  return <Badge variant={variant} className={className}>{label ?? status}</Badge>;
}
