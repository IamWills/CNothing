import type { ChannelTab } from "@/lib/channel-tabs";

export const v2ChannelTabs: ChannelTab[] = [
  { href: "/agents", label: "Agents", activePrefixes: ["/agents"] },
  { href: "/capabilities", label: "Capabilities", activePrefixes: ["/capabilities"] },
  { href: "/grants", label: "Grants", activePrefixes: ["/grants"] },
  { href: "/audit", label: "Audit", activePrefixes: ["/audit"] },
];
