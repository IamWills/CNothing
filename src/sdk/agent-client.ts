import type {
  AgentAuthorizationResponse,
  AgentAuthorizationStatusResponse,
  AgentCapabilityView,
  AgentGrantSummary,
  AuthorizationRequestResponse,
  AuthorizationRequestStatusResponse,
  CNothingAgentApiVersion,
  CNothingAgentClientConfig,
  InvokeCapabilityPending,
  InvokeCapabilityRequest,
  InvokeCapabilitySuccess,
  RequestAuthorizationV25Input,
  RequestAuthorizationV2Input,
} from "./agent-entity";
import { CNothingAgentError } from "./agent-entity";

const DEFAULT_BASE_URL = "https://cnothing.com";

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function parseJson(text: string): unknown {
  return text ? JSON.parse(text) : null;
}

function errorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    if ("message" in data && typeof (data as { message?: string }).message === "string") {
      return (data as { message: string }).message;
    }
    if ("error" in data) {
      const error = (data as { error?: { message?: string } }).error;
      if (error?.message) {
        return error.message;
      }
    }
  }
  return fallback;
}

async function requestJson<T>(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<{ status: number; data: T }> {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetchImpl(`${baseUrl}${path}`, { ...init, headers });
  const data = parseJson(await response.text()) as T;

  if (!response.ok) {
    throw new CNothingAgentError(errorMessage(data, `Request failed with status ${response.status}`), response.status, data);
  }

  return { status: response.status, data };
}

export class CNothingAgentClient {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly apiVersion: CNothingAgentApiVersion;

  constructor(config: CNothingAgentClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL);
    this.accessToken = config.accessToken.trim();
    this.fetchImpl = config.fetch ?? fetch;
    this.apiVersion = config.apiVersion ?? "v2.5";
    if (!this.accessToken) {
      throw new Error("CNothingAgentClient requires a non-empty accessToken");
    }
  }

  get version(): CNothingAgentApiVersion {
    return this.apiVersion;
  }

  private agentApiBase(): string {
    if (this.apiVersion === "v2.6") {
      return "/v2.6/agent";
    }
    if (this.apiVersion === "v2.5") {
      return "/v2/agent";
    }
    throw new CNothingAgentError("Agent capability API requires apiVersion v2.5 or v2.6", 400);
  }

  async listCapabilities(): Promise<AgentCapabilityView[]> {
    if (this.apiVersion === "v2") {
      const { data } = await requestJson<{ ok: true; items: AgentCapabilityView[] }>(
        this.fetchImpl,
        this.baseUrl,
        "/v2/capabilities",
        this.accessToken,
      );
      return data.items.map((item) => ({
        name: item.name,
        display_name: item.name,
        description: item.description,
        capability_type: item.capability_type,
        risk_level: item.risk_level,
        required_scopes: item.required_scopes ?? (item as { scopes?: string[] }).scopes ?? [],
        input_schema: item.input_schema,
        output_schema: item.output_schema,
        connection_required: false,
        authorized: false,
        grant_status: null,
      }));
    }

    const { data } = await requestJson<{ ok: true; items: AgentCapabilityView[] }>(
      this.fetchImpl,
      this.baseUrl,
      `${this.agentApiBase()}/capabilities`,
      this.accessToken,
    );
    return data.items;
  }

  async invoke(
    input: InvokeCapabilityRequest,
  ): Promise<InvokeCapabilitySuccess | InvokeCapabilityPending> {
    const path =
      this.apiVersion === "v2" ? "/v2/capabilities/invoke" : `${this.agentApiBase()}/invoke`;
    const body =
      this.apiVersion === "v2"
        ? JSON.stringify(input)
        : JSON.stringify({
            capability: input.capability,
            input: input.input,
            reason: input.reason,
            confirmation_id: input.confirmation_id,
            request_id: input.request_id,
          });

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        "content-type": "application/json",
      },
      body,
    });

    const data = parseJson(await response.text());

    if (response.status === 202 && data && typeof data === "object" && "pending" in data) {
      return data as InvokeCapabilityPending;
    }

    if (response.status === 403 && data && typeof data === "object") {
      const payload = data as { error_code?: string };
      if (payload.error_code === "authorization_required") {
        throw new CNothingAgentError(errorMessage(data, "Authorization required"), 403, data);
      }
    }

    if (!response.ok) {
      throw new CNothingAgentError(errorMessage(data, `Invoke failed with status ${response.status}`), response.status, data);
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

  async requestAuthorization(
    input: RequestAuthorizationV25Input | RequestAuthorizationV2Input,
  ): Promise<AgentAuthorizationResponse | AuthorizationRequestResponse> {
    if (this.apiVersion === "v2") {
      const legacy = input as RequestAuthorizationV2Input;
      if (!legacy.capabilities?.length) {
        throw new Error("capabilities is required for v2 requestAuthorization");
      }
      const { data } = await requestJson<AuthorizationRequestResponse>(
        this.fetchImpl,
        this.baseUrl,
        "/v2/authorize/request",
        this.accessToken,
        {
          method: "POST",
          body: JSON.stringify(legacy),
        },
      );
      return data;
    }

    const v25 = input as RequestAuthorizationV25Input;
    if (!v25.capability?.trim()) {
      if ("capabilities" in input && Array.isArray(input.capabilities) && input.capabilities[0]) {
        v25.capability = input.capabilities[0]!;
      } else {
        throw new Error("capability is required for v2.5 requestAuthorization");
      }
    }

    const { data } = await requestJson<AgentAuthorizationResponse>(
      this.fetchImpl,
      this.baseUrl,
      `${this.agentApiBase()}/authorizations`,
      this.accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          capability: v25.capability,
          reason: v25.reason,
          requested_scopes: v25.requested_scopes,
        }),
      },
    );
    return data;
  }

  async getAuthorizationStatus(
    authorizationId: string,
  ): Promise<AgentAuthorizationStatusResponse | AuthorizationRequestStatusResponse> {
    if (this.apiVersion === "v2") {
      const { data } = await requestJson<AuthorizationRequestStatusResponse>(
        this.fetchImpl,
        this.baseUrl,
        `/v2/authorize/${encodeURIComponent(authorizationId)}`,
        this.accessToken,
      );
      return data;
    }

    const { data } = await requestJson<AgentAuthorizationStatusResponse>(
      this.fetchImpl,
      this.baseUrl,
      `${this.agentApiBase()}/authorizations/${encodeURIComponent(authorizationId)}`,
      this.accessToken,
    );
    return data;
  }

  async waitForAuthorization(input: {
    requestId: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<AgentAuthorizationStatusResponse | AuthorizationRequestStatusResponse> {
    const timeoutMs = input.timeoutMs ?? 300_000;
    const pollIntervalMs = input.pollIntervalMs ?? 2_000;
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const status = await this.getAuthorizationStatus(input.requestId);
      const currentStatus =
        this.apiVersion === "v2"
          ? (status as AuthorizationRequestStatusResponse).authorization_request.status
          : (status as AgentAuthorizationStatusResponse).status;

      if (currentStatus === "approved") {
        return status;
      }
      if (currentStatus === "denied" || currentStatus === "expired") {
        throw new CNothingAgentError(`Authorization ${currentStatus}`, 409, status);
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new CNothingAgentError("Authorization timed out", 408);
  }

  async listGrants(): Promise<AgentGrantSummary[]> {
    if (this.apiVersion === "v2") {
      throw new CNothingAgentError("listGrants requires apiVersion v2.5 or v2.6", 400);
    }

    const { data } = await requestJson<{ ok: true; items: AgentGrantSummary[] }>(
      this.fetchImpl,
      this.baseUrl,
      `${this.agentApiBase()}/grants`,
      this.accessToken,
    );
    return data.items;
  }

  async revokeGrant(grantId: string): Promise<{ ok: true; grant_id: string; status: string }> {
    if (this.apiVersion === "v2") {
      throw new CNothingAgentError("revokeGrant requires apiVersion v2.5 or v2.6", 400);
    }

    const { data } = await requestJson<{ ok: true; grant_id: string; status: string }>(
      this.fetchImpl,
      this.baseUrl,
      `${this.agentApiBase()}/grants/revoke`,
      this.accessToken,
      {
        method: "POST",
        body: JSON.stringify({ grant_id: grantId }),
      },
    );
    return data;
  }
}

export function createCNothingAgentClient(config: CNothingAgentClientConfig): CNothingAgentClient {
  return new CNothingAgentClient(config);
}

export { CNothingAgentError } from "./agent-entity";
