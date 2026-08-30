import { FileCredentialStore } from "./file-store";
import { asObject, asString } from "./json";
import { assertModelSafe, userVisibleEnrollment } from "./redaction";
import type {
  AgentError,
  AgentOptions,
  AgentToolName,
  CredentialStore,
  EnrollmentRequired,
  EnrollmentState,
  GetAccessStatusInput,
  Identity,
  JsonObject,
  ProxyRequestInput,
  RequestAccessInput,
  ToolResult,
} from "./types";

const DEFAULT_BASE_URL = "https://cnothing.com";
const BLOCKED_PROXY_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"]);

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function agentError(message: string): AgentError {
  return { ok: false, status: "error", next_action: "inspect_error", error: { message } };
}

function sanitizeProxyHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (BLOCKED_PROXY_HEADERS.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

type Session = { token: string } | { enrollment: EnrollmentRequired };

export class CNothingAgent {
  readonly baseUrl: string;
  readonly clientName: string;
  readonly softwareId: string;
  private readonly store: CredentialStore;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AgentOptions = {}) {
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl?.trim() || process.env.CNOTHING_BASE_URL?.trim() || DEFAULT_BASE_URL,
    );
    this.clientName = options.clientName?.trim() || process.env.CNOTHING_CLIENT_NAME?.trim() || "cnothing-agent";
    this.softwareId = options.softwareId?.trim() || "cnothing-agent";
    this.store = options.store ?? new FileCredentialStore();
    this.fetchImpl = options.fetch ?? fetch;
  }

  async ensureIdentity(): Promise<Identity> {
    const session = await this.session();
    if ("enrollment" in session) return session.enrollment;
    return { status: "ready" };
  }

  async listGrants(): Promise<ToolResult> {
    return this.invoke("list_grants");
  }

  async listProviders(): Promise<ToolResult> {
    return this.invoke("list_providers");
  }

  async requestAccess(input: RequestAccessInput): Promise<ToolResult> {
    return this.invoke("request_access", input);
  }

  async getAccessStatus(input: GetAccessStatusInput): Promise<ToolResult> {
    return this.invoke("get_access_status", input);
  }

  async proxyRequest(input: ProxyRequestInput): Promise<ToolResult> {
    return this.invoke("proxy_request", input);
  }

  async invoke(name: AgentToolName, args: Record<string, unknown> = {}): Promise<ToolResult> {
    try {
      const session = await this.session();
      if ("enrollment" in session) return session.enrollment;
      const data = await this.callTool(session.token, name, args);
      assertModelSafe(data);
      return data;
    } catch (error) {
      return agentError(error instanceof Error ? error.message : "Tool failed");
    }
  }

  private async session(): Promise<Session> {
    const existing = await this.store.readToken();
    if (existing) return { token: existing };

    let state = await this.store.readEnrollment();
    if (!state) {
      state = await this.startEnrollment();
      return { enrollment: userVisibleEnrollment(state) };
    }

    const claimed = await this.pollEnrollment(state);
    if (claimed) return { token: claimed };
    return { enrollment: userVisibleEnrollment(state) };
  }

  private async startEnrollment(): Promise<EnrollmentState> {
    const created = await this.requestJson("/v4/agent-enrollments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: this.clientName,
        software_id: this.softwareId,
      }),
    });
    const state: EnrollmentState = {
      enrollment_id: asString(created.enrollment_id),
      enrollment_secret: asString(created.enrollment_secret),
      approval_url: asString(created.approval_url),
      user_code: asString(created.user_code),
      expires_at: asString(created.expires_at),
    };
    if (!state.enrollment_id || !state.enrollment_secret) {
      throw new Error("CNothing enrollment did not return a host credential");
    }
    await this.store.writeEnrollment(state);
    return state;
  }

  private async pollEnrollment(state: EnrollmentState): Promise<string | null> {
    const result = await this.requestJson(`/v4/agent-enrollments/${encodeURIComponent(state.enrollment_id)}`, {
      headers: { authorization: `Bearer ${state.enrollment_secret}` },
    });
    if (result.status === "approved" && typeof result.access_token === "string" && result.access_token) {
      await this.store.writeToken(result.access_token);
      return result.access_token;
    }
    if (result.status === "denied" || result.status === "expired") {
      await this.store.writeEnrollment(null);
      throw new Error(`CNothing agent enrollment ${String(result.status)}`);
    }
    return null;
  }

  private async callTool(token: string, name: AgentToolName, args: Record<string, unknown>): Promise<JsonObject> {
    switch (name) {
      case "list_grants":
        return this.api(token, "GET", "/v4/grants");
      case "list_providers":
        return this.api(token, "GET", "/v4/providers");
      case "request_access":
        return this.api(token, "POST", "/v4/access-requests", args);
      case "get_access_status":
        return this.api(
          token,
          "GET",
          `/v4/access-requests/${encodeURIComponent(asString(args.access_request_id))}`,
        );
      case "proxy_request": {
        const { headers: rawHeaders, ...rest } = args;
        const headers = sanitizeProxyHeaders(
          rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)
            ? (rawHeaders as Record<string, string>)
            : undefined,
        );
        return this.api(token, "POST", "/v4/proxy", {
          ...rest,
          ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
        });
      }
    }
  }

  private async api(token: string, method: string, path: string, body?: unknown): Promise<JsonObject> {
    return this.requestJson(path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  private async requestJson(path: string, init?: RequestInit): Promise<JsonObject> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : {};
    const record = asObject(data);
    if (!response.ok) {
      const error = asObject(record.error);
      throw new Error(
        typeof error.message === "string" ? error.message : `CNothing API returned HTTP ${response.status}`,
      );
    }
    return record;
  }
}

export function createCNothingAgent(options: AgentOptions = {}): CNothingAgent {
  return new CNothingAgent(options);
}
