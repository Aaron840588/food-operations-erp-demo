"use client";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
const AuthenticatedLayout = dynamic(() => import("./AuthenticatedLayout"));
export default function LayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const path = usePathname();
  // The fictional workspace never mounts authentication, sync, or API effects.
  if (path === "/" || path === "/login" || path === "/demo")
    return <>{children}</>;
  return <AuthenticatedLayout>{children}</AuthenticatedLayout>;
}
