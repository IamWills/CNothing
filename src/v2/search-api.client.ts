import config from "../config";
import type { HybridEnvelope } from "../crypto/hybrid-envelope";

const DEFAULT_SEARCH_API_BASE_URL = "https://search.morethinkings.com";

function searchApiBaseUrl(): string {
  return (config.searchApiBaseUrl ?? DEFAULT_SEARCH_API_BASE_URL).replace(/\/+$/, "");
}

async function searchRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${searchApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "message" in data
        ? String((data as { message?: string }).message ?? "Search API error")
        : data && typeof data === "object" && "error" in data
          ? String((data as { error?: { message?: string } }).error?.message ?? "Search API error")
          : `Search API returned ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

export type SearchApiPublicKey = {
  algorithm: string;
  key_id: string;
  public_key_pem: string;
};

export async function fetchSearchApiPublicKey(): Promise<SearchApiPublicKey> {
  const response = await searchRequest<{ ok: true; search_api_public_key: SearchApiPublicKey }>(
    "/v1/auth/public-key",
  );
  return response.search_api_public_key;
}

export async function enrollSearchAgent(input: {
  client_uuid: string;
  auth_envelope: HybridEnvelope;
  reader_public_key: string;
  label?: string;
}): Promise<Record<string, unknown>> {
  return searchRequest<Record<string, unknown>>("/auth/agent/enroll", {
    method: "POST",
    body: JSON.stringify({
      client_uuid: input.client_uuid,
      auth_envelope: input.auth_envelope,
      reader_public_key: input.reader_public_key,
      ...(input.label ? { label: input.label } : {}),
    }),
  });
}

export async function searchQuery(input: {
  client_uuid: string;
  auth_envelope: HybridEnvelope;
  query: string;
  limit?: number;
  domain?: string;
  after?: string;
}): Promise<unknown> {
  return searchRequest("/v1/search", {
    method: "POST",
    body: JSON.stringify({
      client_uuid: input.client_uuid,
      auth_envelope: input.auth_envelope,
      query: input.query,
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
      ...(input.domain ? { domain: input.domain } : {}),
      ...(input.after ? { after: input.after } : {}),
    }),
  });
}

export async function fetchSearchDocument(input: {
  client_uuid: string;
  auth_envelope: HybridEnvelope;
  url: string;
}): Promise<unknown> {
  return searchRequest("/v1/fetch", {
    method: "POST",
    body: JSON.stringify({
      client_uuid: input.client_uuid,
      auth_envelope: input.auth_envelope,
      url: input.url,
    }),
  });
}

export async function getSearchIndexStats(input: {
  client_uuid: string;
  auth_envelope: HybridEnvelope;
}): Promise<unknown> {
  return searchRequest("/v1/index/stats", {
    method: "POST",
    body: JSON.stringify({
      client_uuid: input.client_uuid,
      auth_envelope: input.auth_envelope,
    }),
  });
}

export function isSearchIntegrationEnabled(): boolean {
  return Boolean(config.searchApiBaseUrl);
}
