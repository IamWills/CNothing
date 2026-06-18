import type {
  AuthorizationRequestResponse,
  AuthorizationRequestStatusResponse,
  CapabilitySummary,
  CNothingAgentClientConfig,
  InvokeCapabilityPending,
  InvokeCapabilityRequest,
  InvokeCapabilitySuccess,
} from "./agent-entity";
import { CNothingAgentError } from "./agent-entity";

const DEFAULT_BASE_URL = "https://cnothing.com";

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

async function requestJson<T>(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetchImpl(`${baseUrl}${path}`, {
    ...init,
    headers,
  });

  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: { message?: string } }).error?.message ?? "Request failed")
        : `Request failed with status ${response.status}`;
    const details =
      data && typeof data === "object" && "error" in data
        ? (data as { error?: { details?: unknown } }).error?.details
        : undefined;
    throw new CNothingAgentError(message, response.status, details);
  }

  return data as T;
}

export class CNothingAgentClient {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: CNothingAgentClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL);
    this.accessToken = config.accessToken.trim();
    this.fetchImpl = config.fetch ?? fetch;
    if (!this.accessToken) {
      throw new Error("CNothingAgentClient requires a non-empty accessToken");
    }
  }

  async listCapabilities(): Promise<CapabilitySummary[]> {
    const response = await requestJson<{ ok: true; items: CapabilitySummary[] }>(
      this.fetchImpl,
      this.baseUrl,
      "/v2/capabilities",
      this.accessToken,
    );
    return response.items;
  }

  async invoke(
    input: InvokeCapabilityRequest,
  ): Promise<InvokeCapabilitySuccess | InvokeCapabilityPending> {
    const response = await this.fetchImpl(`${this.baseUrl}/v2/capabilities/invoke`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });

    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : null;

    if (response.status === 202 && data && typeof data === "object" && "pending" in data) {
      return data as InvokeCapabilityPending;
    }

    if (!response.ok) {
      const message =
        data && typeof data === "object" && "error" in data
          ? String((data as { error?: { message?: string } }).error?.message ?? "Invoke failed")
          : `Invoke failed with status ${response.status}`;
      throw new CNothingAgentError(message, response.status);
    }

    return data as InvokeCapabilitySuccess;
  }

  async invokeAndWait(input: InvokeCapabilityRequest): Promise<InvokeCapabilitySuccess> {
    const first = await this.invoke(input);
    if ("pending" in first && first.pending) {
      throw new CNothingAgentError(
        "Capability requires user confirmation before execution",
        202,
        first,
      );
    }
    return first as InvokeCapabilitySuccess;
  }

  async requestAuthorization(input: {
    capabilities: string[];
    user_id?: string;
    redirect_uri?: string;
    state?: string;
    reason?: string;
  }): Promise<AuthorizationRequestResponse> {
    return requestJson<AuthorizationRequestResponse>(
      this.fetchImpl,
      this.baseUrl,
      "/v2/authorize/request",
      this.accessToken,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  async getAuthorizationStatus(requestId: string): Promise<AuthorizationRequestStatusResponse> {
    return requestJson<AuthorizationRequestStatusResponse>(
      this.fetchImpl,
      this.baseUrl,
      `/v2/authorize/${encodeURIComponent(requestId)}`,
      this.accessToken,
    );
  }

  async waitForAuthorization(input: {
    requestId: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<AuthorizationRequestStatusResponse> {
    const timeoutMs = input.timeoutMs ?? 300_000;
    const pollIntervalMs = input.pollIntervalMs ?? 2_000;
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const status = await this.getAuthorizationStatus(input.requestId);
      if (status.authorization_request.status === "approved") {
        return status;
      }
      if (
        status.authorization_request.status === "denied" ||
        status.authorization_request.status === "expired"
      ) {
        throw new CNothingAgentError(
          `Authorization ${status.authorization_request.status}`,
          409,
          status,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new CNothingAgentError("Authorization timed out", 408);
  }
}

export function createCNothingAgentClient(config: CNothingAgentClientConfig): CNothingAgentClient {
  return new CNothingAgentClient(config);
}

export { CNothingAgentError } from "./agent-entity";
