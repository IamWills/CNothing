import config from "../config";
import { requireAgentFromRequest } from "../v4/agent-auth";
import { oauthProviderService } from "../v4/oauth-connection.service";
import { sanitizeAgentResponse } from "../v4/secret-redaction";
import { proxyService } from "../v4/proxy.service";
import type { AgentRecord } from "../v4/platform.entity";
import {
  MCP_LEGACY_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INSTRUCTIONS,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  MCP_TOOLS,
  MCP_WORKFLOW_MARKDOWN,
  MCP_WORKFLOW_URI,
  type McpToolName,
} from "../../packages/cnothing-mcp/src/tools";
import { isAllowedBrowserOrigin } from "../utils/http";

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};
type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

const LEGACY_PROTOCOL_VERSIONS = new Set([MCP_LEGACY_PROTOCOL_VERSION, "2025-06-18", "2024-11-05"]);
const SUPPORTED_PROTOCOL_VERSIONS = [MCP_PROTOCOL_VERSION, ...LEGACY_PROTOCOL_VERSIONS];
const TOOL_NAMES = new Set<string>(MCP_TOOLS.map((tool) => tool.name));

const SERVER_CAPABILITIES = {
  resources: { subscribe: false, listChanged: false },
  tools: { listChanged: false },
};

function serverInfo() {
  return {
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
    description: "User-approved OAuth API proxy for AI agents",
  };
}

function result(id: JsonRpcId, value: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result: value };
}

function protocolError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function modernResult(value: Record<string, unknown>): Record<string, unknown> {
  return {
    ...value,
    resultType: "complete",
    _meta: {
      ...objectArgs(value._meta),
      "io.modelcontextprotocol/serverInfo": serverInfo(),
    },
  };
}

function enrollmentRequiredData() {
  const base = config.publicBaseUrl.replace(/\/+$/, "");
  return {
    status: "enrollment_required",
    next_action: "complete_host_enrollment",
    documentation: `${base}/plugin.md`,
    enrollment: `${base}/v4/agent-enrollments`,
    user_action: {
      message:
        "This host has no CNothing agent credential. The plugin must POST /v4/agent-enrollments, store enrollment_secret locally, and open approval_url. Never paste the agent token into chat or a tool argument.",
    },
  };
}

function objectArgs(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredString(args: Record<string, unknown>, field: string): string {
  const value = typeof args[field] === "string" ? args[field].trim() : "";
  if (!value) throw new Error(`${field} is required`);
  return value;
}

function callResult(value: unknown, isError = false) {
  const structuredContent = objectArgs(value);
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}

function decorateStatus(value: Record<string, unknown>): Record<string, unknown> {
  const status = typeof value.status === "string" ? value.status : "ok";
  if (value.next_action) return value;
  if (status === "pending") {
    return { ...value, next_action: "wait_for_user", retry_after_seconds: 5 };
  }
  if (status === "approved" && value.grant_id) {
    return { ...value, next_action: "call_proxy_request" };
  }
  return { ...value, next_action: "none" };
}

async function executeTool(name: McpToolName, args: Record<string, unknown>, agent: AgentRecord) {
  switch (name) {
    case "list_grants": {
      const items = await proxyService.listGrants({ agentId: agent.id });
      return { ok: true, status: "ok", next_action: items.some((item) => item.status === "active") ? "reuse_active_grant" : "call_list_providers", items };
    }
    case "list_providers": {
      const items = await oauthProviderService.listPublicProviders();
      return { ok: true, status: "ok", next_action: "call_request_access", items };
    }
    case "request_access": {
      const provider = requiredString(args, "provider");
      const response = await proxyService.requestAccess({
        agent,
        provider,
        reason: requiredString(args, "reason"),
        hosts: args.hosts,
        userId: typeof args.user_id === "string" ? args.user_id : undefined,
        callbackUrl: typeof args.callback_url === "string" ? args.callback_url : undefined,
        issuer: typeof args.issuer === "string" ? args.issuer : undefined,
        discoveryUrl: typeof args.discovery_url === "string" ? args.discovery_url : undefined,
        apiBaseUrl: config.publicBaseUrl.replace(/\/+$/, ""),
      });
      if (response.status === "provider_review_required") {
        return {
          ...response,
          user_action: {
            message: response.human_instruction,
            console_url: response.console_url,
          },
        };
      }
      return {
        ...response,
        next_action: "wait_for_user",
        retry_after_seconds: 5,
        user_action: {
          message: response.pushed_to_devices > 0
            ? "Approve the request from the CNothing iOS notification, or open this approval link."
            : "Open this CNothing approval link to continue.",
          approval_url: response.approval_url,
        },
      };
    }
    case "get_access_status": {
      const response = await proxyService.getAccessStatus(requiredString(args, "access_request_id"), agent);
      return decorateStatus(response as unknown as Record<string, unknown>);
    }
    case "proxy_request": {
      const response = await proxyService.proxy({
        agent,
        grantId: requiredString(args, "grant_id"),
        method: requiredString(args, "method"),
        url: requiredString(args, "url"),
        headers: objectArgs(args.headers),
        body: args.body,
        idempotencyKey: typeof args.idempotency_key === "string" ? args.idempotency_key : undefined,
        apiBaseUrl: config.publicBaseUrl.replace(/\/+$/, ""),
      });
      if (response.status === "approval_required") {
        return {
          ...response,
          user_action: {
            message: "Approve this action from the CNothing iOS notification, or open this approval link.",
            approval_url: response.approval_url,
          },
        };
      }
      if (response.status === "denied") {
        return { ...response, next_action: "none" };
      }
      return { ...response, status: "ok", http_status: response.status, next_action: "none" };
    }
  }
}

export async function processMcpRequest(
  rpc: JsonRpcRequest,
  agent?: AgentRecord,
): Promise<JsonRpcResponse | null> {
  if (rpc.jsonrpc !== "2.0" || !rpc.method) return protocolError(rpc.id ?? null, -32600, "Invalid Request");
  const isNotification = rpc.id === undefined;
  const id = rpc.id ?? null;
  const params = objectArgs(rpc.params);
  const requestMeta = objectArgs(params._meta);
  const isModern =
    requestMeta["io.modelcontextprotocol/protocolVersion"] === MCP_PROTOCOL_VERSION;
  const complete = (value: Record<string, unknown>) =>
    result(id, isModern ? modernResult(value) : value);

  if (rpc.method === "notifications/initialized" || rpc.method === "notifications/cancelled") return null;
  if (isModern && (rpc.method === "initialize" || rpc.method === "ping")) {
    return protocolError(id, -32601, "Method not found");
  }
  if (rpc.method === "server/discover") {
    return complete({
      supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
      capabilities: SERVER_CAPABILITIES,
      instructions: MCP_SERVER_INSTRUCTIONS,
      ttlMs: 300_000,
      cacheScope: "public",
    });
  }
  if (rpc.method === "ping") return isNotification ? null : result(id, {});
  if (rpc.method === "initialize") {
    const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : MCP_PROTOCOL_VERSION;
    const protocolVersion = LEGACY_PROTOCOL_VERSIONS.has(requested)
      ? requested
      : MCP_LEGACY_PROTOCOL_VERSION;
    return result(id, {
      protocolVersion,
      serverInfo: serverInfo(),
      instructions: MCP_SERVER_INSTRUCTIONS,
      capabilities: SERVER_CAPABILITIES,
    });
  }
  if (rpc.method === "resources/list") {
    return complete({
      resources: [{ uri: MCP_WORKFLOW_URI, name: "CNothing v4 workflow", description: "The required grant and proxy sequence, including iOS approval.", mimeType: "text/markdown" }],
      ...(isModern ? { ttlMs: 300_000, cacheScope: "public" } : {}),
    });
  }
  if (rpc.method === "resources/read") {
    if (String(params.uri ?? "") !== MCP_WORKFLOW_URI) {
      return protocolError(id, isModern ? -32602 : -32002, "Resource not found");
    }
    return complete({
      contents: [{ uri: MCP_WORKFLOW_URI, mimeType: "text/markdown", text: MCP_WORKFLOW_MARKDOWN }],
      ...(isModern ? { ttlMs: 300_000, cacheScope: "public" } : {}),
    });
  }
  if (rpc.method === "tools/list") {
    return complete({
      tools: MCP_TOOLS,
      ...(isModern ? { ttlMs: 300_000, cacheScope: "public" } : {}),
    });
  }
  if (rpc.method !== "tools/call") return isNotification ? null : protocolError(id, -32601, "Method not found");

  const name = typeof params.name === "string" ? params.name : "";
  if (!TOOL_NAMES.has(name)) return protocolError(id, -32602, "Unknown tool", { tool: name });
  if (!agent) {
    return protocolError(id, -32001, "Authenticated agent required", enrollmentRequiredData());
  }
  try {
    const value = sanitizeAgentResponse(await executeTool(name as McpToolName, objectArgs(params.arguments), agent));
    const toolResult = callResult(value);
    return result(id, isModern ? modernResult(toolResult) : toolResult);
  } catch (error) {
    const toolResult = callResult({ ok: false, status: "error", next_action: "inspect_error", error: { message: error instanceof Error ? error.message : "Tool failed" } }, true);
    return result(id, isModern ? modernResult(toolResult) : toolResult);
  }
}

export function handleMcpInfo(baseUrl: string) {
  return {
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
    protocolVersion: MCP_PROTOCOL_VERSION,
    instructions: MCP_SERVER_INSTRUCTIONS,
    endpoint: `${baseUrl}/mcp`,
    authorization: "Bearer agent token in the HTTP Authorization header",
    plugin: `${baseUrl}/plugin.md`,
    plugin_spec: `${baseUrl}/plugin.json`,
    enrollment: `${baseUrl}/v4/agent-enrollments`,
    tools: MCP_TOOLS.map((tool) => tool.name),
    workflow: MCP_WORKFLOW_URI,
  };
}

export async function handleMcpMessage(request: Request): Promise<Response> {
  const origin = request.headers.get("origin")?.trim();
  if (origin && !isAllowedBrowserOrigin(origin)) {
    return Response.json(protocolError(null, -32020, "Origin is not allowed"), { status: 403 });
  }
  const payload = await request.json().catch(() => null);
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return Response.json(protocolError(null, -32700, "Parse error"), { status: 400 });
  }
  const rpc = payload as JsonRpcRequest;
  const params = objectArgs(rpc.params);
  const requestMeta = objectArgs(params._meta);
  const bodyVersion = requestMeta["io.modelcontextprotocol/protocolVersion"];
  const headerVersion = request.headers.get("mcp-protocol-version")?.trim();
  const unsupportedVersion =
    (typeof bodyVersion === "string" && !SUPPORTED_PROTOCOL_VERSIONS.includes(bodyVersion))
    || (headerVersion && !SUPPORTED_PROTOCOL_VERSIONS.includes(headerVersion));
  if (unsupportedVersion) {
    return Response.json(
      protocolError(rpc.id ?? null, -32022, "Unsupported MCP protocol version", {
        supported: SUPPORTED_PROTOCOL_VERSIONS,
        requested: headerVersion ?? bodyVersion,
      }),
      { status: 400 },
    );
  }
  const isModern = bodyVersion === MCP_PROTOCOL_VERSION || headerVersion === MCP_PROTOCOL_VERSION;

  if (isModern) {
    if (bodyVersion !== MCP_PROTOCOL_VERSION || headerVersion !== MCP_PROTOCOL_VERSION) {
      return Response.json(protocolError(rpc.id ?? null, -32020, "MCP protocol header and request metadata must match"), { status: 400 });
    }
    const clientCapabilities = requestMeta["io.modelcontextprotocol/clientCapabilities"];
    if (!clientCapabilities || typeof clientCapabilities !== "object" || Array.isArray(clientCapabilities)) {
      return Response.json(protocolError(rpc.id ?? null, -32602, "Client capabilities metadata is required"), { status: 400 });
    }
    const methodHeader = request.headers.get("mcp-method")?.trim();
    if (methodHeader !== rpc.method) {
      return Response.json(protocolError(rpc.id ?? null, -32020, "Mcp-Method header does not match the request"), { status: 400 });
    }
    const expectedName =
      rpc.method === "tools/call"
        ? String(params.name ?? "")
        : rpc.method === "resources/read"
          ? String(params.uri ?? "")
          : "";
    if (expectedName && request.headers.get("mcp-name")?.trim() !== expectedName) {
      return Response.json(protocolError(rpc.id ?? null, -32020, "Mcp-Name header does not match the request"), { status: 400 });
    }
  }

  let agent: AgentRecord | undefined;
  if (rpc.method === "tools/call") {
    try {
      agent = await requireAgentFromRequest(request);
    } catch {
      return Response.json(
        protocolError(rpc.id ?? null, -32001, "Authenticated agent required", enrollmentRequiredData()),
        {
          status: 401,
          headers: { "MCP-Protocol-Version": MCP_PROTOCOL_VERSION },
        },
      );
    }
  }
  const response = await processMcpRequest(rpc, agent);
  if (!response) return new Response(null, { status: 204 });
  const status = isModern && response.error?.code === -32601 ? 404 : 200;
  return Response.json(response, {
    status,
    headers: { "MCP-Protocol-Version": isModern ? MCP_PROTOCOL_VERSION : MCP_LEGACY_PROTOCOL_VERSION },
  });
}
