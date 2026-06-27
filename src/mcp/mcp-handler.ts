import config from "../config";
import { MCP_SERVER_INSTRUCTIONS } from "../catalog/mcp-instructions";
import { MCP_V2_AUTH_WORKFLOW_URI } from "../catalog/mcp-v2-auth-workflow";
import { listMcpInternalTools, listMcpResources, listMcpTools, readMcpResource } from "../catalog/mcp-catalog";
import { KeyService } from "../core/key-service";
import { ForbiddenError } from "../utils/errors";
import { agentAuthorizationV25Service } from "../v2/agent-authorization-v25.service";
import { invocationGatewayService } from "../v2/invocation-gateway.service";
import { sanitizeAgentResponse } from "../v2/secret-redaction";
import { V1_DEPRECATED_MCP_TOOLS, v1DeprecationMeta } from "../v2/deprecation";
import { findAgentByAccessToken, revokeGrant } from "../v2/v2.repository";

const legacyService = new KeyService();

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

function jsonRpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function apiBaseUrl(): string {
  return config.publicBaseUrl.replace(/\/+$/, "");
}

async function requireAgentFromMcpArgs(args: Record<string, unknown>) {
  const token =
    typeof args.agent_access_token === "string" ? args.agent_access_token.trim() : "";
  if (!token) {
    throw new Error("agent_access_token is required");
  }
  const agent = await findAgentByAccessToken(token);
  if (!agent) {
    throw new Error("Invalid agent access token");
  }
  return agent;
}

function wrapDeprecatedToolResult(toolName: string, result: unknown): unknown {
  if (!V1_DEPRECATED_MCP_TOOLS.has(toolName)) {
    return result;
  }
  const deprecation = {
    ...v1DeprecationMeta(apiBaseUrl()),
    warning: `Tool "${toolName}" is deprecated internal API. Use v2.5 agent tools instead.`,
  };
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return { ...(result as Record<string, unknown>), _deprecation: deprecation };
  }
  return { value: result, _deprecation: deprecation };
}

function readCapabilityName(args: Record<string, unknown>): string {
  if (typeof args.capability === "string" && args.capability.trim()) {
    return args.capability.trim();
  }
  if (Array.isArray(args.capabilities) && args.capabilities[0]) {
    return String(args.capabilities[0]);
  }
  return "";
}

export async function processMcpRequest(rpc: JsonRpcRequest): Promise<JsonRpcResponse> {
  if (rpc.jsonrpc !== "2.0" || !rpc.method) {
    return jsonRpcError(rpc.id ?? null, -32600, "Invalid Request");
  }
  const id = rpc.id ?? null;
  const params = (rpc.params ?? {}) as Record<string, unknown>;

  try {
    let result: unknown;
    switch (rpc.method) {
      case "notifications/initialized":
        return jsonRpcResult(id, null);

      case "initialize":
        result = {
          protocolVersion: config.protocolVersion,
          serverInfo: { name: config.serviceName, version: "2.5.0" },
          instructions: MCP_SERVER_INSTRUCTIONS,
          capabilities: {
            resources: { subscribe: false, listChanged: false },
            tools: { listChanged: false },
          },
        };
        break;

      case "resources/list":
        result = { resources: listMcpResources() };
        break;

      case "resources/read":
        result = {
          contents: [readMcpResource(String(params.uri ?? "resource://keyservice/protocol"))],
        };
        break;

      case "tools/list":
        result = { tools: listMcpTools() };
        break;

      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        const args =
          params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
            ? (params.arguments as Record<string, unknown>)
            : {};

        switch (name) {
          case "invoke_capability": {
            const agent = await requireAgentFromMcpArgs(args);
            try {
              result = await invocationGatewayService.invoke({
                agent,
                body: {
                  capability: readCapabilityName(args),
                  input:
                    args.input && typeof args.input === "object" && !Array.isArray(args.input)
                      ? (args.input as Record<string, unknown>)
                      : {},
                  reason: typeof args.reason === "string" ? args.reason : undefined,
                  confirmation_id:
                    typeof args.confirmation_id === "string" ? args.confirmation_id : undefined,
                },
              });
            } catch (error) {
              if (error instanceof ForbiddenError) {
                result = sanitizeAgentResponse({
                  ok: false,
                  error_code:
                    (error.details as { error_code?: string } | undefined)?.error_code ??
                    "forbidden",
                  message: error.message,
                  ...(typeof error.details === "object" && error.details
                    ? (error.details as Record<string, unknown>)
                    : {}),
                });
                break;
              }
              throw error;
            }
            break;
          }

          case "list_capabilities": {
            const agent = await requireAgentFromMcpArgs(args);
            const items = await agentAuthorizationV25Service.listCapabilitiesForAgent(agent);
            result = sanitizeAgentResponse({ ok: true, items });
            break;
          }

          case "request_authorization": {
            const agent = await requireAgentFromMcpArgs(args);
            const capability = readCapabilityName(args);
            if (!capability) {
              return jsonRpcError(id, -32000, "capability is required");
            }
            result = await agentAuthorizationV25Service.requestAuthorization({
              agent,
              body: {
                capability,
                requested_scopes: Array.isArray(args.requested_scopes)
                  ? args.requested_scopes.map(String)
                  : undefined,
                reason: typeof args.reason === "string" ? args.reason : undefined,
              },
              apiBaseUrl: apiBaseUrl(),
            });
            break;
          }

          case "get_authorization_status": {
            const agent = await requireAgentFromMcpArgs(args);
            const authorizationId =
              typeof args.authorization_id === "string" ? args.authorization_id.trim() : "";
            if (!authorizationId) {
              return jsonRpcError(id, -32000, "authorization_id is required");
            }
            result = await agentAuthorizationV25Service.getAuthorizationStatus(
              authorizationId,
              agent,
            );
            break;
          }

          case "list_grants": {
            const agent = await requireAgentFromMcpArgs(args);
            const items = await agentAuthorizationV25Service.listGrantsForAgent(agent.id);
            result = sanitizeAgentResponse({ ok: true, items });
            break;
          }

          case "revoke_grant": {
            const agent = await requireAgentFromMcpArgs(args);
            const grantId = typeof args.grant_id === "string" ? args.grant_id.trim() : "";
            if (!grantId) {
              return jsonRpcError(id, -32000, "grant_id is required");
            }
            const revoked = await revokeGrant(grantId);
            if (!revoked || revoked.agent_id !== agent.id) {
              return jsonRpcError(id, -32000, "Grant not found for this agent");
            }
            result = sanitizeAgentResponse({ ok: true, grant_id: grantId, status: "revoked" });
            break;
          }

          case "get_authai_public_key":
            result = legacyService.getAuthaiPublicKey();
            break;
          case "authai_register":
            result = await legacyService.registerClient(args);
            break;
          case "authai_refresh":
            result = await legacyService.refreshChallenge(args);
            break;
          case "authai_key_holder_challenge":
            result = await legacyService.createKeyHolderChallenge(args);
            break;
          case "authai_key_holder_verify":
            result = await legacyService.verifyKeyHolderChallenge(args);
            break;
          case "authai_key_holder_sign_challenge":
            result = await legacyService.createKeyHolderSignChallenge(args);
            break;
          case "authai_key_holder_verify_signature":
            result = await legacyService.verifyKeyHolderSignature(args);
            break;
          case "kv_save":
            result = await legacyService.saveKv(args);
            break;
          case "kv_read":
            result = await legacyService.readKv(args);
            break;
          default:
            return jsonRpcError(id, -32601, "Method not found", { tool: name });
        }

        if (typeof result !== "undefined") {
          result = wrapDeprecatedToolResult(name, result);
        }
        break;
      }

      default:
        return jsonRpcError(id, -32601, "Method not found");
    }

    return jsonRpcResult(id, result);
  } catch (error) {
    return jsonRpcError(
      id,
      -32000,
      error instanceof Error ? error.message : "Internal error",
      error instanceof Error ? { name: error.name } : undefined,
    );
  }
}

export function handleMcpInfo(baseUrl: string) {
  return {
    name: config.serviceName,
    version: "2.5.0",
    protocolVersion: config.protocolVersion,
    instructions: MCP_SERVER_INSTRUCTIONS,
    capabilities: {
      resources: { subscribe: false, listChanged: false },
      tools: { listChanged: false },
    },
    endpoints: {
      mcp: `${baseUrl}/mcp`,
      sse: `${baseUrl}/mcp/sse`,
      message: `${baseUrl}/mcp/message`,
    },
    discovery: {
      manifest: `${baseUrl}/mcp/manifest`,
      v2_auth_workflow: MCP_V2_AUTH_WORKFLOW_URI,
      openapi_v25: `${baseUrl}/openapi-v2.5.json`,
      openapi_v2: `${baseUrl}/openapi-v2.json`,
      internal_tools: listMcpInternalTools().map((tool) => tool.name),
      skills_index: `${baseUrl}/skills/index.json`,
      skills_text: `${baseUrl}/skills.txt`,
      getting_started: `${baseUrl}/getting-started.md`,
      primary_skill: `${baseUrl}/skill.md`,
      standards: `${baseUrl}/standards`,
      authentication_standard: `${baseUrl}/standards/authentication/1.0`,
      registration_hub_standard: `${baseUrl}/standards/registration-hub`,
    },
  };
}

export function handleMcpSse(baseUrl: string, messagePath: string): Response {
  const body = new ReadableStream({
    start(controller) {
      const payload = {
        jsonrpc: "2.0",
        method: "endpoint",
        params: {
          messagePath: `${baseUrl}${messagePath}`,
        },
      };
      controller.enqueue(`event: endpoint\ndata: ${JSON.stringify(payload)}\n\n`);
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function handleMcpMessage(request: Request): Promise<Response> {
  const rpc = (await request.json().catch(() => null)) as JsonRpcRequest | null;
  if (!rpc) {
    return Response.json(jsonRpcError(null, -32700, "Parse error"), { status: 400 });
  }
  const response = await processMcpRequest(rpc);
  return Response.json(response);
}
