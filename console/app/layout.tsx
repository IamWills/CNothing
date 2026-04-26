import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { brand } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://cnothing.com"),
  title: "CNothing",
  description: "CNothing console for browsing MCP capabilities, client registrations, and KV data.",
  applicationName: "CNothing",
  keywords: [
    "CNothing",
    "MCP",
    "AI agent",
    "skills",
    "encrypted KV",
    "AuthAI",
    "AI-safe registration",
    "AI-safe secrets",
  ],
  category: "developer tools",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: "/cnothing4.0.png", type: "image/png" },
      { url: brand.logoPath, type: "image/png" },
    ],
    apple: [{ url: "/cnothing4.0.png", type: "image/png" }],
    shortcut: ["/cnothing4.0.png"],
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
  other: {
    "ai:product": "CNothing",
    "ai:capabilities": "mcp,skills,authai,encrypted-kv,registration-hub",
    "ai:skills-index": "https://cnothing.com/skills/index.json",
    "ai:getting-started": "https://cnothing.com/getting-started.md",
    "ai:mcp-discovery": "https://cnothing.com/.well-known/mcp",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: "CNothing",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Web",
        url: "https://cnothing.com",
        description:
          "CNothing is an AI-safe control surface for MCP discovery, public skills, challenge-based client authentication, and encrypted KV storage.",
        sameAs: ["https://github.com/IamWills/CNothing", "https://www.npmjs.com/package/cnothing"],
        featureList: [
          "MCP discovery via /.well-known/mcp",
          "Public skills index via /skills/index.json",
          "AI-safe AuthAI registration and challenge flows",
          "Encrypted KV storage with private and blind modes",
          "Published authentication and registration-hub standards",
        ],
      },
      {
        "@type": "WebSite",
        name: "CNothing",
        url: "https://cnothing.com",
        potentialAction: {
          "@type": "SearchAction",
          target: "https://cnothing.com/skills#index={search_term_string}",
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };

  return (
    <html lang="en">
      <body>
        <Script
          id="cnothing-structured-data"
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(188,220,255,0.45),transparent_28%),radial-gradient(circle_at_top_right,rgba(15,23,42,0.08),transparent_24%),linear-gradient(180deg,#f7f8fa_0%,#eef2f6_100%)]">
          <SiteHeader />
          {children}
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
