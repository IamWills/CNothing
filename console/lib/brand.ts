export const brand = {
  name: "CNothing",
  tagline: "Universal Credential-Injecting Proxy for AI Agents",
  logoPath: "/cnothing4.0.png",
  description:
    "One user approval per OAuth provider — then agents call any API of that provider without ever seeing tokens.",
  principles:
    "Agent thinks. CNothing injects credentials. Tokens never leave CNothing. Every proxied request is host-scoped, redacted, and audited.",
  recommendedPath: "/connect",
  recommendedInvoke: "POST /v4/proxy",
  openApiV4: "/openapi-v4.json",
} as const;
