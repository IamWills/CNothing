import config from "../config";
import { MCP_SERVER_INSTRUCTIONS } from "../catalog/mcp-instructions";
import { MCP_V2_AUTH_WORKFLOW_URI } from "../catalog/mcp-v2-auth-workflow";
import { listMcpResources, listMcpTools, readMcpResource } from "../catalog/mcp-catalog";
import { KeyService } from "../core/key-service";
import { CapabilityService } from "../v2/capability-service";
import { AuthorizationService } from "../v2/authorization-service";
import { resolveAuthorizationUserId } from "../v2/authorization-user";
import { findAgentByAccessToken, listCapabilities } from "../v2/v2.repository";
import { V1_DEPRECATED_MCP_TOOLS, v1DeprecationMeta } from "../v2/deprecation";

const service = new KeyService();
const capabilityService = new CapabilityService();
const authorizationService = new AuthorizationService();

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

function wrapDeprecatedToolResult(toolName: string, result: unknown): unknown {
  if (!V1_DEPRECATED_MCP_TOOLS.has(toolName)) {
    return result;
  }

  const deprecation = {
    ...v1DeprecationMeta(),
    warning: `Tool "${toolName}" is deprecated. Prefer invoke_capability or request_authorization.`,
  };

  if (result && typeof result === "object" && !Array.isArray(result)) {
    return { ...(result as Record<string, unknown>), _deprecation: deprecation };
  }

  return { value: result, _deprecation: deprecation };
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
          serverInfo: { name: config.serviceName, version: "2.0.0" },
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
          contents: [
            readMcpResource(String(params.uri ?? "resource://keyservice/protocol")),
          ],
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
            const token =
              typeof args.agent_access_token === "string" ? args.agent_access_token.trim() : "";
            if (!token) {
              return jsonRpcError(
                id,
                -32000,
                "agent_access_token is required in arguments for invoke_capability",
              );
            }
            const agent = await findAgentByAccessToken(token);
            if (!agent) {
              return jsonRpcError(id, -32000, "Invalid agent access token");
            }
            result = await capabilityService.invoke({
              agent,
              body: {
                capability: String(args.capability ?? ""),
                input: args.input && typeof args.input === "object" && !Array.isArray(args.input)
                  ? (args.input as Record<string, unknown>)
                  : {},
                user_id: typeof args.user_id === "string" ? args.user_id : undefined,
                reason: typeof args.reason === "string" ? args.reason : undefined,
                confirmation_id: typeof args.confirmation_id === "string" ? args.confirmation_id : undefined,
              },
            });
            break;
          }
          case "list_capabilities":
            result = {
              ok: true,
              items: (await listCapabilities()).map((item) => ({
                name: item.name,
                description: item.description,
                capability_type: item.capability_type,
                risk_level: item.risk_level,
                scopes: item.scopes,
              })),
            };
            break;
          case "request_authorization": {
            const token =
              typeof args.agent_access_token === "string" ? args.agent_access_token.trim() : "";
            if (!token) {
              return jsonRpcError(id, -32000, "agent_access_token is required");
            }
            const agent = await findAgentByAccessToken(token);
            if (!agent) {
              return jsonRpcError(id, -32000, "Invalid agent access token");
            }
            const capabilities = Array.isArray(args.capabilities)
              ? args.capabilities.map(String)
              : [];
            if (capabilities.length === 0) {
              return jsonRpcError(id, -32000, "capabilities must be a non-empty array");
            }
            result = await authorizationService.createRequest({
              agentId: agent.id,
              userId: resolveAuthorizationUserId(
                typeof args.user_id === "string" ? args.user_id : undefined,
              ),
              capabilities,
              state: typeof args.state === "string" ? args.state : undefined,
              reason: typeof args.reason === "string" ? args.reason : undefined,
              consoleBaseUrl: config.consoleUrl,
              apiBaseUrl: "https://cnothing.com",
            });
            break;
          }
          case "get_authai_public_key":
            result = service.getAuthaiPublicKey();
            break;
          case "authai_register":
            result = await service.registerClient(args);
            break;
          case "authai_refresh":
            result = await service.refreshChallenge(args);
            break;
          case "authai_key_holder_challenge":
            result = await service.createKeyHolderChallenge(args);
            break;
          case "authai_key_holder_verify":
            result = await service.verifyKeyHolderChallenge(args);
            break;
          case "authai_key_holder_sign_challenge":
            result = await service.createKeyHolderSignChallenge(args);
            break;
          case "authai_key_holder_verify_signature":
            result = await service.verifyKeyHolderSignature(args);
            break;
          case "kv_save":
            result = await service.saveKv(args);
            break;
          case "kv_read":
            result = await service.readKv(args);
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
    version: "2.0.0",
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
      openapi_v2: `${baseUrl}/openapi-v2.json`,
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
