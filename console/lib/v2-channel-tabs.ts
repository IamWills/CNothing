import type { ChannelTab } from "@/lib/channel-tabs";

/** Pre-v3 / parallel surfaces — shown with LegacyBanner */
export const v2ChannelTabs: ChannelTab[] = [
  { href: "/migration", label: "Legacy hub", activePrefixes: ["/migration"] },
  { href: "/connect", label: "Connect", activePrefixes: ["/connect"] },
  {
    href: "/providers",
    label: "Providers (legacy)",
    activePrefixes: ["/providers", "/admin/oauth-providers"],
  },
  {
    href: "/connections",
    label: "Connections (legacy)",
    activePrefixes: ["/connections"],
  },
  {
    href: "/import",
    label: "Import (legacy)",
    activePrefixes: ["/import", "/admin/import-openapi"],
  },
  {
    href: "/capabilities",
    label: "Capabilities (legacy)",
    activePrefixes: ["/capabilities"],
  },
  { href: "/grants", label: "Grants (legacy)", activePrefixes: ["/grants"] },
  { href: "/audit", label: "Audit (legacy)", activePrefixes: ["/audit"] },
];

/** Canonical Execution Trust Layer console */
export const dashboardTabs: ChannelTab[] = [
  {
    href: "/dashboard/capabilities",
    label: "Capabilities",
    activePrefixes: ["/dashboard/capabilities"],
  },
  {
    href: "/dashboard/agents",
    label: "Agents",
    activePrefixes: ["/dashboard/agents"],
  },
  {
    href: "/dashboard/providers",
    label: "Providers",
    activePrefixes: ["/dashboard/providers"],
  },
  {
    href: "/dashboard/connections",
    label: "Connections",
    activePrefixes: ["/dashboard/connections"],
  },
  {
    href: "/dashboard/approvals",
    label: "Approvals",
    activePrefixes: ["/dashboard/approvals"],
  },
  {
    href: "/dashboard/executions",
    label: "Executions",
    activePrefixes: ["/dashboard/executions"],
  },
  {
    href: "/dashboard/policies",
    label: "Policies",
    activePrefixes: ["/dashboard/policies"],
  },
  {
    href: "/dashboard/secrets",
    label: "Secret Vault",
    activePrefixes: ["/dashboard/secrets"],
  },
  { href: "/dashboard/audit", label: "Audit", activePrefixes: ["/dashboard/audit"] },
  { href: "/connect", label: "Connect", activePrefixes: ["/connect"] },
];
