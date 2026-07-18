import type { ChannelTab } from "@/lib/channel-tabs";

/** CNothing v4 universal proxy console */
export const v4ChannelTabs: ChannelTab[] = [
  { href: "/connect", label: "Connect", activePrefixes: ["/connect"] },
  { href: "/connections", label: "Connections", activePrefixes: ["/connections"] },
  { href: "/grants", label: "Grants", activePrefixes: ["/grants"] },
  { href: "/devices", label: "Devices", activePrefixes: ["/devices"] },
  { href: "/agents", label: "Agents", activePrefixes: ["/agents"] },
  { href: "/providers", label: "Providers", activePrefixes: ["/providers"] },
];

// Backwards-compatible aliases used by existing pages.
export const v2ChannelTabs = v4ChannelTabs;
export const dashboardTabs = v4ChannelTabs;
