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
