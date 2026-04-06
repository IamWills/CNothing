import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/layout/site-header";
import { brand } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://cnothing.com"),
  title: "CNothing",
  description: "CNothing console for browsing MCP capabilities, client registrations, and KV data.",
  icons: {
    icon: [
      { url: "/icon.png", type: "image/png" },
      { url: brand.logoPath, type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", type: "image/png" }],
    shortcut: ["/icon.png"],
  },
  openGraph: {
    title: "CNothing",
    description: "CNothing console for browsing MCP capabilities, client registrations, and KV data.",
    images: [{ url: brand.logoPath, alt: "CNothing logo" }],
  },
  twitter: {
    card: "summary",
    title: "CNothing",
    description: "CNothing console for browsing MCP capabilities, client registrations, and KV data.",
    images: [brand.logoPath],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(188,220,255,0.45),transparent_28%),radial-gradient(circle_at_top_right,rgba(15,23,42,0.08),transparent_24%),linear-gradient(180deg,#f7f8fa_0%,#eef2f6_100%)]">
          <SiteHeader />
          {children}
        </div>
      </body>
    </html>
  );
}
