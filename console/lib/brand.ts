export const brand = {
  name: "CNothing",
  tagline: "Execution Trust Layer for AI Agents",
  logoPath: "/cnothing4.0.png",
  description:
    "Secure execution of real-world capabilities without exposing secrets to AI agents.",
  principles:
    "Agent thinks. cnothing executes. Secrets never leave cnothing. Every risky action is approved, executed, and audited.",
  recommendedPath: "/dashboard/capabilities",
  recommendedInvoke: "POST /api/v3/capabilities/{capabilityId}/invoke",
  openApiV3: "/openapi-v3.json",
} as const;
