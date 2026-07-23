import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { brand } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://cnothing.com"),
  title: "CNothing — Universal Credential-Injecting Proxy for AI Agents",
  description:
    "v4 proxy: one human approval per OAuth provider, then agents call any API without seeing tokens. Skill: /skill.md · MCP: /mcp",
  applicationName: "CNothing",
  keywords: [
    "CNothing",
    "AI agent",
    "OAuth proxy",
    "credential-injecting proxy",
    "MCP",
    "GitHub agent auth",
    "v4",
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
    title: "CNothing — Universal Credential-Injecting Proxy for AI Agents",
    description:
      "v4 proxy: one human approval per OAuth provider, then agents call any API without seeing tokens.",
    images: [{ url: brand.logoPath, alt: "CNothing logo" }],
  },
  twitter: {
    card: "summary",
    title: "CNothing — Universal Credential-Injecting Proxy for AI Agents",
    description:
      "v4 proxy: one human approval per OAuth provider, then agents call any API without seeing tokens.",
    images: [brand.logoPath],
  },
  other: {
    "ai:product": "CNothing",
    "ai:version": "v4",
    "ai:capabilities": "universal-proxy,mcp,skills,oauth-broker,approvals",
    "ai:skills-index": "https://cnothing.com/skills/index.json",
    "ai:getting-started": "https://cnothing.com/getting-started.md",
    "ai:primary-skill": "https://cnothing.com/skill.md",
    "ai:mcp-discovery": "https://cnothing.com/.well-known/mcp",
    "ai:openapi": "https://cnothing.com/openapi-v4.json",
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
          "CNothing v4: universal credential-injecting proxy for AI agents. One human approval per OAuth provider; agents call any HTTPS API without seeing tokens.",
        sameAs: ["https://github.com/IamWills/CNothing", "https://www.npmjs.com/package/cnothing"],
        featureList: [
          "POST /v4/proxy credential-injecting proxy",
          "Self-service agent register and access requests",
          "MCP discovery via /.well-known/mcp",
          "Primary skill at /skill.md",
          "OpenAPI at /openapi-v4.json",
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
