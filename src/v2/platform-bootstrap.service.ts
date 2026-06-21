import config from "../config";
import {
  createAgent,
  createCapability,
  createConnector,
  createGrant,
  findActiveGrant,
  findAgentByName,
  findCapabilityByName,
  findConnectorByProvider,
  listCapabilities,
  updateConnectorCallbackUrl,
} from "./v2.repository";
import {
  executePlatformCapability,
  listPlatformCapabilityDefinitions,
  PLATFORM_CONNECTOR_PROVIDER,
} from "./platform-connector.executor";
import { ensureGitHubIdentityProvider } from "./github-identity.provider";
import { githubOAuthService } from "./github-oauth.service";
import { oidcService } from "./oidc.service";

export type PlatformBootstrapResult = {
  ok: true;
  connector_id: string;
  capabilities: string[];
  agent: {
    id: string;
    name: string;
    created: boolean;
    access_token?: string;
  };
  auth: {
    github_oauth: boolean;
    oidc_providers: number;
  };
};

const LOW_RISK_AUTO_GRANT = new Set([
  "platform.echo",
  "platform.ping",
  "github.list_repositories",
  "github.get_repository",
  "webhook.notify",
]);

export async function ensurePlatformGrantsForUser(userId: string): Promise<string[]> {
  if (!config.autoGrantLowRiskCapabilities) {
    return [];
  }

  const agent = await findAgentByName(config.platformAgentName);
  if (!agent) {
    return [];
  }

  const granted: string[] = [];
  const capabilities = await listCapabilities();

  for (const capability of capabilities) {
    if (!LOW_RISK_AUTO_GRANT.has(capability.name)) {
      continue;
    }
    if (capability.risk_level !== "PUBLIC" && capability.risk_level !== "LOW") {
      continue;
    }

    const existing = await findActiveGrant({
      user_id: userId,
      agent_id: agent.id,
      capability_id: capability.id,
    });
    if (existing) {
      continue;
    }

    await createGrant({
      user_id: userId,
      agent_id: agent.id,
      capability_id: capability.id,
      scopes: capability.scopes,
      metadata: { source: "auto_grant_low_risk" },
    });
    granted.push(capability.name);
  }

  return granted;
}

export async function bootstrapV2Platform(input: {
  apiBaseUrl: string;
  force?: boolean;
}): Promise<PlatformBootstrapResult> {
  const normalizedBase = input.apiBaseUrl.replace(/\/+$/, "");
  const callbackUrl = `${normalizedBase}/v2/internal/connectors/platform`;

  let connector = await findConnectorByProvider(PLATFORM_CONNECTOR_PROVIDER);
  if (!connector) {
    connector = await createConnector({
      provider: PLATFORM_CONNECTOR_PROVIDER,
      display_name: "CNothing Platform Connector",
      callback_url: callbackUrl,
      metadata: { built_in: true, version: "1" },
    });
  } else if (connector.callback_url !== callbackUrl) {
    connector =
      (await updateConnectorCallbackUrl(connector.id, callbackUrl)) ?? connector;
  }

  const capabilityNames: string[] = [];
  for (const definition of listPlatformCapabilityDefinitions()) {
    const existing = await findCapabilityByName(definition.name);
    if (!existing) {
      await createCapability({
        connector_id: connector.id,
        name: definition.name,
        description: definition.description,
        capability_type: definition.capability_type,
        risk_level: definition.risk_level,
        scopes: definition.scopes,
        input_schema: definition.input_schema,
      });
    }
    capabilityNames.push(definition.name);
  }

  let agent = await findAgentByName(config.platformAgentName);
  let createdAgent = false;
  let accessToken: string | undefined;

  if (!agent) {
    const created = await createAgent({
      name: config.platformAgentName,
      owner_user_id: "platform",
      metadata: {
        built_in: true,
        description: "Default CNothing platform agent for Console and MCP demos",
      },
    });
    agent = created.agent;
    accessToken = created.access_token;
    createdAgent = true;
  }

  if (config.autoGrantLowRiskCapabilities) {
    await ensurePlatformGrantsForUser(agent.owner_user_id);
  }

  if (githubOAuthService.isEnabled()) {
    await ensureGitHubIdentityProvider();
  }

  const oidcProviders = await oidcService.listPublicProviders();

  return {
    ok: true,
    connector_id: connector.id,
    capabilities: capabilityNames,
    agent: {
      id: agent.id,
      name: agent.name,
      created: createdAgent,
      ...(accessToken ? { access_token: accessToken } : {}),
    },
    auth: {
      github_oauth: githubOAuthService.isEnabled(),
      oidc_providers: oidcProviders.items.length,
    },
  };
}

export async function runStartupBootstrap(): Promise<void> {
  if (!config.v2AutoBootstrap) {
    return;
  }

  try {
    const result = await bootstrapV2Platform({ apiBaseUrl: config.publicBaseUrl });
    // eslint-disable-next-line no-console
    console.log(
      `[v2 bootstrap] connector=${result.connector_id} capabilities=${result.capabilities.length} agent=${result.agent.name}${result.agent.access_token ? " (new agent token issued)" : ""}`,
    );
    if (result.agent.access_token) {
      // eslint-disable-next-line no-console
      console.warn(
        "[v2 bootstrap] Save the platform agent access token now — it will not be shown again:",
        result.agent.access_token,
      );
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[v2 bootstrap] failed:", error instanceof Error ? error.message : error);
  }
}
