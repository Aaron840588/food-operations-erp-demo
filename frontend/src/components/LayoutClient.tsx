"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { PUBLIC_DEMO, demoRole } from "@/lib/demoWorkspace";
const AuthenticatedLayout = dynamic(() => import("./AuthenticatedLayout"));
export default function LayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (PUBLIC_DEMO) {
      const role = demoRole();
      try {
      localStorage.setItem("hh_logged_in", "true");
      localStorage.setItem("hh_user_role", role);
      localStorage.setItem(
        "hh_user_name",
        role === "owner" ? "Sample Owner" : "Sample Staff",
      );
      if ("serviceWorker" in navigator)
        void navigator.serviceWorker
          .getRegistrations()
          .then((items) => Promise.all(items.map((item) => item.unregister())))
          .catch(() => undefined);
      for (const key of Object.keys(localStorage))
        if (
          key.startsWith("hh_") &&
          !["hh_logged_in", "hh_user_role", "hh_user_name"].includes(key)
        )
          localStorage.removeItem(key);
      } catch { /* Sample mode also works when browser storage is blocked. */ }
    }
    queueMicrotask(() => setReady(true));
  }, []);
  if (!ready) return <p className="p-8">Opening sample workspace...</p>;
  return <AuthenticatedLayout>{children}</AuthenticatedLayout>;
}
