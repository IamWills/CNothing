import type { ChannelTab } from "@/lib/channel-tabs";

/** CNothing v4 user console */
export const userChannelTabs: ChannelTab[] = [
  { href: "/connect", label: "Connect", activePrefixes: ["/connect"] },
  { href: "/connections", label: "Connections", activePrefixes: ["/connections"] },
  { href: "/grants", label: "Grants", activePrefixes: ["/grants"] },
  { href: "/devices", label: "Devices", activePrefixes: ["/devices"] },
];

const adminOnlyTabs: ChannelTab[] = [
  { href: "/agents", label: "Agents", activePrefixes: ["/agents"] },
  { href: "/providers", label: "Providers", activePrefixes: ["/providers"] },
];

export const adminChannelTabs: ChannelTab[] = [...userChannelTabs, ...adminOnlyTabs];

export function consoleTabs(isAdmin: boolean): ChannelTab[] {
  return isAdmin ? adminChannelTabs : userChannelTabs;
}

/** @deprecated Prefer consoleTabs(isAdmin). Kept as the full admin set. */
export const v4ChannelTabs = adminChannelTabs;
export const dashboardTabs = adminChannelTabs;
