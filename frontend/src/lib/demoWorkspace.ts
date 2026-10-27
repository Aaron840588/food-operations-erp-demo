// Public demo transport for the existing ERP screens. Snapshots live only in
// this document's memory; requests are serialized to prevent lost updates.
export const PUBLIC_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
let state: string | null = null;
let queue: Promise<unknown> = Promise.resolve();

export function demoRole(): "owner" | "staff" {
  try { return typeof window !== 'undefined' && localStorage.getItem('hh_user_role') === 'staff' ? 'staff' : 'owner'; }
  catch { return 'owner'; }
}

export async function demoRequest(
  path: string,
  options?: RequestInit,
): Promise<unknown> {
  const run = async () => {
    if (path === '/auth/me') {
      const role = demoRole();
      return { id: role === 'owner' ? 1 : 2, username: role === 'owner' ? 'Sample Owner' : 'Sample Staff', role, is_active: true, hourly_rate: role === 'owner' ? 100 : 85 };
    }
    if (path === "/version")
      return { version: "2.9.0-demo", update_timestamp: "demo-session" };
    if (path === "/auth/logout") return { message: "Sample session closed." };
    if (path === "/admin/reset-test-data") {
      state = null;
      return { message: "Sample data restored. Refresh the page." };
    }
    if (path === "/admin/force-refresh")
      return {
        message: "This sample runs only in your tab.",
        update_timestamp: "demo-session",
      };
    if (path === "/sheet-sync/status")
      return {
        configured: false,
        auto_apply_prices_enabled: false,
        auto_check_interval_minutes: 30,
        sources: [],
        warning: "Public sample: no Google account is connected.",
      };
    if (path.startsWith("/sheet-sync/runs")) return [];
    if (path.startsWith("/sheet-sync/changes"))
      return {
        counts: {
          pending: 0,
          accepted: 0,
          rejected: 0,
          ignored: 0,
          applied: 0,
          failed: 0,
          conflict: 0,
        },
        changes: [],
      };
    if (path.startsWith("/sheet-sync"))
      throw new Error(
        "Google account connections are not part of the public demo. No cloud credentials are configured.",
      );
    if (options?.body instanceof FormData)
      throw new Error(
        "Private file uploads are disabled in the public demo. Use the fictional sample records.",
      );
    const response = await fetch("/api/demo-workspace", {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path,
        method: options?.method ?? "GET",
        payload:
          typeof options?.body === "string" ? JSON.parse(options.body) : null,
        state,
        role: demoRole(),
      }),
    });
    const envelope = await response.json();
    if (!response.ok)
      throw new Error(
        envelope.detail ??
          "The sample service is temporarily unavailable. Please retry.",
      );
    if (envelope.state) state = envelope.state;
    if (envelope.status >= 400) {
      const detail = envelope.data?.detail;
      throw new Error(
        typeof detail === "string"
          ? detail
          : "Check the form fields and try again.",
      );
    }
    return envelope.data;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

export function resetDemo() {
  state = null;
}
