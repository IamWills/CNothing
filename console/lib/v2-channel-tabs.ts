import type { ChannelTab } from "@/lib/channel-tabs";

export const v2ChannelTabs: ChannelTab[] = [
  { href: "/connect", label: "Connect", activePrefixes: ["/connect"] },
  {
    href: "/providers",
    label: "Providers",
    activePrefixes: ["/providers", "/admin/oauth-providers", "/dashboard/providers"],
  },
  {
    href: "/connections",
    label: "Connections",
    activePrefixes: ["/connections", "/dashboard/connections"],
  },
  { href: "/import", label: "Import", activePrefixes: ["/import", "/admin/import-openapi"] },
  { href: "/agents", label: "Agents", activePrefixes: ["/agents"] },
  {
    href: "/capabilities",
    label: "Capabilities",
    activePrefixes: ["/capabilities", "/dashboard/capabilities"],
  },
  { href: "/grants", label: "Grants", activePrefixes: ["/grants"] },
  {
    href: "/dashboard/approvals",
    label: "Approvals",
    activePrefixes: ["/dashboard/approvals"],
  },
  {
    href: "/dashboard/policies",
    label: "Policies",
    activePrefixes: ["/dashboard/policies"],
  },
  { href: "/audit", label: "Audit", activePrefixes: ["/audit", "/dashboard/audit"] },
];

export const dashboardTabs: ChannelTab[] = [
  { href: "/agents", label: "Agents", activePrefixes: ["/agents"] },
  {
    href: "/dashboard/capabilities",
    label: "Capabilities",
    activePrefixes: ["/dashboard/capabilities"],
  },
  { href: "/dashboard/providers", label: "Providers", activePrefixes: ["/dashboard/providers"] },
  {
    href: "/dashboard/connections",
    label: "Connections",
    activePrefixes: ["/dashboard/connections"],
  },
  { href: "/dashboard/approvals", label: "Approvals", activePrefixes: ["/dashboard/approvals"] },
  {
    href: "/dashboard/executions",
    label: "Executions",
    activePrefixes: ["/dashboard/executions"],
  },
  { href: "/dashboard/policies", label: "Policies", activePrefixes: ["/dashboard/policies"] },
  {
    href: "/dashboard/secrets",
    label: "Secret Vault",
    activePrefixes: ["/dashboard/secrets"],
  },
  { href: "/dashboard/audit", label: "Audit", activePrefixes: ["/dashboard/audit"] },
];
