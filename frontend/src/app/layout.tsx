import type { Metadata } from "next";
import "./globals.css";
import LayoutClient from "@/components/LayoutClient";
import { ToastProvider } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: "H+H Hub",
  description: "H+H Hub — Operations management platform for Handmade+Homemade. Recipe costing, kitchen planning, B2B consignment tracking, and inventory control.",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full bg-[#faf8f5] text-[#2d1f0e] font-sans">
        <ToastProvider>
          <LayoutClient>{children}</LayoutClient>
        </ToastProvider>
      </body>
    </html>
  );
}
