import type { JsonObject } from "./v2.entity";
import {
  fetchSearchDocument,
  getSearchIndexStats,
  isSearchIntegrationEnabled,
  searchQuery,
} from "./search-api.client";
import { resolveSearchAuthContext, searchCredentialRequiredMessage } from "./search-credential.service";

export async function executeSearchCapability(input: {
  capability: string;
  input: JsonObject;
  user_id: string;
  agent_id: string;
}): Promise<unknown> {
  if (!isSearchIntegrationEnabled()) {
    throw new Error("Search integration is not enabled. Set KEYSERVICE_SEARCH_API_URL.");
  }

  if (!input.user_id?.trim()) {
    throw new Error("user_id is required for Search capabilities");
  }

  const auth = await resolveSearchAuthContext(input.user_id);

  switch (input.capability) {
    case "search.query": {
      const query = String(input.input.query ?? "").trim();
      if (!query) {
        throw new Error("input.query is required");
      }
      const limit =
        input.input.limit === undefined || input.input.limit === null
          ? undefined
          : Number(input.input.limit);
      const domain =
        typeof input.input.domain === "string" && input.input.domain.trim()
          ? input.input.domain.trim()
          : undefined;
      const after =
        typeof input.input.after === "string" && input.input.after.trim()
          ? input.input.after.trim()
          : undefined;

      return searchQuery({
        client_uuid: auth.clientUuid,
        auth_envelope: auth.authEnvelope,
        query,
        ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
        ...(domain ? { domain } : {}),
        ...(after ? { after } : {}),
      });
    }

    case "search.fetch_document": {
      const url = String(input.input.url ?? "").trim();
      if (!url) {
        throw new Error("input.url is required");
      }
      return fetchSearchDocument({
        client_uuid: auth.clientUuid,
        auth_envelope: auth.authEnvelope,
        url,
      });
    }

    case "search.get_index_stats":
      return getSearchIndexStats({
        client_uuid: auth.clientUuid,
        auth_envelope: auth.authEnvelope,
      });

    default:
      throw new Error(`Unsupported search capability: ${input.capability}`);
  }
}

export function listSearchCapabilityDefinitions(): Array<{
  name: string;
  description: string;
  capability_type: "ACTION" | "QUERY";
  risk_level: "PUBLIC" | "LOW" | "MEDIUM" | "HIGH";
  scopes: string[];
  input_schema: JsonObject;
}> {
  return [
    {
      name: "search.query",
      description: "Keyword search on search.morethinkings.com (CNothing auth, no KV)",
      capability_type: "QUERY",
      risk_level: "LOW",
      scopes: ["search.read"],
      input_schema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", description: "Search keywords or short phrase" },
          limit: { type: "number", description: "Max results (default 10, max 50)" },
          domain: { type: "string", description: "Optional source domain filter" },
          after: { type: "string", description: "Optional ISO 8601 time filter" },
        },
      },
    },
    {
      name: "search.fetch_document",
      description: "Fetch indexed Markdown document by URL from search.morethinkings.com",
      capability_type: "QUERY",
      risk_level: "LOW",
      scopes: ["search.read"],
      input_schema: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", description: "Document URL (must match indexed URL exactly)" },
        },
      },
    },
    {
      name: "search.get_index_stats",
      description: "Get search index size and freshness stats",
      capability_type: "QUERY",
      risk_level: "PUBLIC",
      scopes: ["search.read"],
      input_schema: { type: "object", properties: {} },
    },
  ];
}

export function isSearchCapabilityEnabled(): boolean {
  return isSearchIntegrationEnabled();
}

export { searchCredentialRequiredMessage };
