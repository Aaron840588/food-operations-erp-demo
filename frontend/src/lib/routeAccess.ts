export const OWNER_HOME_PATH = "/";
export const STAFF_HOME_PATH = "/market-events";
const PUBLIC_ROUTE_PREFIXES = ["/login", "/preorder"] as const;

const STAFF_ALLOWED_ROUTE_PREFIXES = [
  "/market-events",
  "/inventory",
  "/preorders",
] as const;

function matchesRoutePrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTE_PREFIXES.some(prefix => matchesRoutePrefix(pathname, prefix));
}

export function getAuthenticatedHomePath(role: string | null | undefined): string {
  return role === "owner" ? OWNER_HOME_PATH : STAFF_HOME_PATH;
}

export function isRouteAllowedForRole(role: string | null | undefined, pathname: string): boolean {
  if (role === "owner") return true;
  if (role !== "staff") return false;

  return STAFF_ALLOWED_ROUTE_PREFIXES.some(prefix => matchesRoutePrefix(pathname, prefix));
}

export function getRoleRouteRedirect(role: string | null | undefined, pathname: string): string | null {
  return isRouteAllowedForRole(role, pathname) ? null : getAuthenticatedHomePath(role);
}
