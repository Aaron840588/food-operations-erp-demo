export type OfflineRequestClass =
  | "read"
  | "read_only_post"
  | "auth"
  | "financial"
  | "timesheet"
  | "sheet_sync"
  | "public_preorder"
  | "production"
  | "mutation";

function normalizedMethod(method: string): string {
  return method.trim().toUpperCase() || "GET";
}

export function classifyOfflineRequest(path: string, method: string): OfflineRequestClass {
  const verb = normalizedMethod(method);
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") return "read";
  if (
    (verb === "POST" && /^\/costing\/sku\/[^/]+\/preview$/.test(path))
    || (verb === "POST" && path === "/production/forecast")
  ) {
    return "read_only_post";
  }
  if (path === "/login" || path.startsWith("/auth/")) return "auth";
  if (
    (verb === "POST" && path === "/resellers/orders")
    || (verb === "POST" && /^\/market-events\/\d+\/sales$/.test(path))
  ) {
    return "financial";
  }
  if (verb === "POST" && path === "/timesheets/manual") return "timesheet";
  if (path.startsWith("/sheet-sync/")) return "sheet_sync";
  if (verb === "POST" && /^\/preorders\/public\/[^/]+$/.test(path)) return "public_preorder";
  if (path.startsWith("/production/plans")) return "production";
  return "mutation";
}

export function isReplayUnsafeMutation(path: string, method: string): boolean {
  const requestClass = classifyOfflineRequest(path, method);
  return requestClass !== "read" && requestClass !== "read_only_post";
}

/**
 * Generic request replay is deliberately disabled. Market Event POS has its
 * own idempotent, event-scoped offline database and is the only supported
 * offline write path.
 */
export function shouldPersistInGenericOfflineQueue(path: string, method: string): boolean {
  void path;
  void method;
  return false;
}

export function getUnconfirmedMutationMessage(path: string, method: string): string {
  switch (classifyOfflineRequest(path, method)) {
    case "auth":
      return "This sign-in request could not reach H+H. No credentials were saved. Reconnect and try again.";
    case "financial":
      return /^\/market-events\/\d+\/sales$/.test(path)
        ? "The Market POS sale could not be confirmed and was not added to the generic replay queue."
        : "The wholesale invoice could not be confirmed and was not queued. Check recent invoices before retrying; your cart has been kept.";
    case "timesheet":
      return "The manual timesheet could not be confirmed and was not queued. Reconnect, then submit it again; the request reference prevents duplicates.";
    case "sheet_sync":
      return "The Google Sheets review action could not be confirmed and was not queued. Reconnect and check the review queue before retrying.";
    case "public_preorder":
      return "Your pre-order could not be confirmed. Your form is still here; reconnect and retry with the same submission reference.";
    case "production":
      return "Production completion could not be confirmed and was not queued. Reconnect, then retry the same date and targets; completion is idempotent.";
    default:
      return "H+H could not confirm this change. It was not saved for automatic replay. Reconnect, refresh the record, and try again to avoid applying the change twice.";
  }
}
