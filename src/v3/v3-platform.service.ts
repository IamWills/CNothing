import { listOAuthProviders } from "../v2/oauth.repository";
import { getV25PlatformStatus } from "../v2/v2.5-bootstrap.service";
import { pool } from "../db";
import { V3_MODULES, V3_PRINCIPLES, V3_VERSION } from "./v3.entity";
import { countProviderProposals, countVaultSecrets } from "./v3.repository";

export async function getV3PlatformStatus() {
  const base = await getV25PlatformStatus();
  const capabilityCount = await pool.query(
    `SELECT COUNT(*)::int AS count FROM cap_capabilities WHERE status = 'active'`,
  );
  const grantCount = await pool.query(
    `SELECT COUNT(*)::int AS count FROM cap_grants WHERE revoked = FALSE`,
  );
  const auditCount = await pool.query(`SELECT COUNT(*)::int AS count FROM cap_trust_audit`);
  const providers = await listOAuthProviders();

  return {
    ...base,
    version: V3_VERSION,
    product: "CNothing Universal Trust Broker for AI Agents",
    tagline: "Secret stays in CNothing. Capability belongs to Agent.",
    principles: V3_MODULES.reduce(
      (acc, module) => {
        acc[module] = { status: "active" };
        return acc;
      },
      {} as Record<string, { status: string }>,
    ),
    system_principles: [...V3_PRINCIPLES],
    modules: Object.fromEntries(
      V3_MODULES.map((module) => [module, { status: "active", version: V3_VERSION }]),
    ),
    counts: {
      providers: providers.length,
      capabilities: Number(capabilityCount.rows[0]?.count ?? 0),
      grants: Number(grantCount.rows[0]?.count ?? 0),
      vault_secrets: await countVaultSecrets(),
      provider_proposals: await countProviderProposals(),
      trust_audit_events: Number(auditCount.rows[0]?.count ?? 0),
    },
    agent_rules: {
      allowed: [
        "submit_provider_proposal",
        "list_capabilities",
        "request_authorization",
        "invoke_capability",
        "submit_openapi_url",
        "submit_mcp_url",
      ],
      forbidden: [
        "read_secret",
        "read_token",
        "read_client_secret",
        "read_cookie",
        "read_password",
        "read_private_key",
        "read_api_key",
      ],
    },
    recommended_api_prefix: "/v3",
    predecessor_versions: ["v2.5", "v2.6"],
  };
}
