import type { Metadata, Viewport } from "next";
import "./globals.css";
import LayoutClient from "@/components/LayoutClient";
import { ToastProvider } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: "H+H Hub",
  description: "H+H Hub — Operations management platform for Handmade+Homemade. Recipe costing, kitchen planning, B2B consignment tracking, and inventory control.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "H+H Hub",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#faf8f5",
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
