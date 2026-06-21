import config from "../config";
import {
  createCapability,
  createConnector,
  createGrant,
  findActiveGrant,
  findAgentByName,
  findCapabilityByName,
  findConnectorByProvider,
  updateConnectorCallbackUrl,
} from "./v2.repository";
import {
  listSearchCapabilityDefinitions,
} from "./search-connector.executor";
import { SEARCH_CONNECTOR_PROVIDER } from "./search-credential.service";

export type SearchBootstrapResult = {
  ok: true;
  connector_id: string;
  capabilities: string[];
};

const SEARCH_LOW_RISK_AUTO_GRANT = new Set([
  "search.query",
  "search.fetch_document",
  "search.get_index_stats",
]);

export async function ensureSearchGrantsForUser(userId: string): Promise<string[]> {
  if (!config.autoGrantLowRiskCapabilities || !config.searchApiBaseUrl) {
    return [];
  }

  const agent = await findAgentByName(config.platformAgentName);
  if (!agent) {
    return [];
  }

  const granted: string[] = [];
  for (const capabilityName of SEARCH_LOW_RISK_AUTO_GRANT) {
    const capability = await findCapabilityByName(capabilityName);
    if (!capability) {
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
      metadata: { source: "auto_grant_low_risk_search" },
    });
    granted.push(capability.name);
  }

  return granted;
}

export async function bootstrapSearchConnector(input: {
  apiBaseUrl: string;
}): Promise<SearchBootstrapResult> {
  if (!config.searchApiBaseUrl) {
    throw new Error("KEYSERVICE_SEARCH_API_URL is not configured");
  }

  const normalizedBase = input.apiBaseUrl.replace(/\/+$/, "");
  const callbackUrl = `${normalizedBase}/v2/internal/connectors/search`;

  let connector = await findConnectorByProvider(SEARCH_CONNECTOR_PROVIDER);
  if (!connector) {
    connector = await createConnector({
      provider: SEARCH_CONNECTOR_PROVIDER,
      display_name: "Searchengine Connector",
      callback_url: callbackUrl,
      metadata: {
        built_in: true,
        search_api_url: config.searchApiBaseUrl,
        version: "1",
      },
    });
  } else if (connector.callback_url !== callbackUrl) {
    connector = (await updateConnectorCallbackUrl(connector.id, callbackUrl)) ?? connector;
  }

  const capabilityNames: string[] = [];
  for (const definition of listSearchCapabilityDefinitions()) {
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

  return {
    ok: true,
    connector_id: connector.id,
    capabilities: capabilityNames,
  };
}

export async function runSearchStartupBootstrap(): Promise<void> {
  if (!config.searchAutoBootstrap || !config.searchApiBaseUrl) {
    return;
  }

  try {
    const result = await bootstrapSearchConnector({ apiBaseUrl: config.publicBaseUrl });
    // eslint-disable-next-line no-console
    console.log(
      `[v2 search bootstrap] connector=${result.connector_id} capabilities=${result.capabilities.length}`,
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      "[v2 search bootstrap] failed:",
      error instanceof Error ? error.message : error,
    );
  }
}
