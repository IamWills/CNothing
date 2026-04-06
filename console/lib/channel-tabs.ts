export type ChannelTab = {
  href: string;
  label: string;
  activePrefixes?: string[];
  match?: "exact" | "prefix";
};

export const homeChannelTabs: ChannelTab[] = [
  { href: "/", label: "Home", activePrefixes: ["/"] },
  { href: "/readme", label: "Readme", activePrefixes: ["/readme"] },
];

export const clientChannelTabs: ChannelTab[] = [
  { href: "/clients", label: "Clients", activePrefixes: ["/clients"] },
  { href: "/kv", label: "KV", activePrefixes: ["/kv"] },
];

export const standardsChannelTabs: ChannelTab[] = [
  { href: "/standards", label: "Standards", activePrefixes: ["/standards"], match: "exact" },
  {
    href: "/standards/authentication/1.0",
    label: "Authentication",
    activePrefixes: ["/standards/authentication/1.0", "/standard"],
  },
  {
    href: "/standards/registration-hub",
    label: "Registration Hub",
    activePrefixes: ["/standards/registration-hub"],
  },
];
