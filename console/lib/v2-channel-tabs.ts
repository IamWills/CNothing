import type { ChannelTab } from "@/lib/channel-tabs";

export const v2ChannelTabs: ChannelTab[] = [
  { href: "/connect", label: "Connect", activePrefixes: ["/connect"] },
  { href: "/providers", label: "Providers", activePrefixes: ["/providers", "/admin/oauth-providers"] },
  { href: "/connections", label: "Connections", activePrefixes: ["/connections"] },
  { href: "/import", label: "Import", activePrefixes: ["/import", "/admin/import-openapi"] },
  { href: "/agents", label: "Agents", activePrefixes: ["/agents"] },
  { href: "/capabilities", label: "Capabilities", activePrefixes: ["/capabilities"] },
  { href: "/grants", label: "Grants", activePrefixes: ["/grants"] },
  { href: "/audit", label: "Audit", activePrefixes: ["/audit"] },
];
