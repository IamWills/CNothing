import config from "../config";
import { MCP_SERVER_INSTRUCTIONS } from "../catalog/mcp-instructions";
import {
  MCP_V4_WORKFLOW_URI,
  listMcpResources,
  listMcpTools,
  readMcpResource,
} from "../catalog/mcp-catalog";
import { oauthProviderService } from "../v2/oauth-connection.service";
import { sanitizeAgentResponse } from "../v2/secret-redaction";
import { findAgentByAccessToken } from "../v2/v2.repository";
import { providerProposalService } from "../v3/provider-proposal.service";
import { proxyService } from "../v4/proxy.service";
import { sandboxService } from "../v4/sandbox.service";

const V4_AGENT_MCP_TOOLS = new Set([
  "register_agent",
  "start_sandbox",
  "list_providers",
  "request_access",
  "get_access_status",
  "proxy_request",
  "list_grants",
  "submit_provider_proposal",
  "get_provider_proposal",
]);

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
          serverInfo: { name: config.serviceName, version: "4.0.0" },
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
          contents: [readMcpResource(String(params.uri ?? MCP_V4_WORKFLOW_URI))],
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

        if (!V4_AGENT_MCP_TOOLS.has(name)) {
          return jsonRpcError(id, -32601, "Tool not available on public MCP surface", {
            tool: name,
            allowed_tools: [...V4_AGENT_MCP_TOOLS],
          });
        }

        switch (name) {
          case "register_agent": {
            const agentName = typeof args.name === "string" ? args.name.trim() : "";
            if (!agentName) {
              return jsonRpcError(id, -32000, "name is required");
            }
            const { createAgent } = await import("../v2/v2.repository");
            const created = await createAgent({
              name: agentName,
              owner_user_id: "self-registered",
              metadata:
                args.metadata && typeof args.metadata === "object" && !Array.isArray(args.metadata)
                  ? (args.metadata as Record<string, unknown>)
                  : {},
            });
            result = {
              ok: true,
              agent: {
                id: created.agent.id,
                name: created.agent.name,
                status: created.agent.status,
              },
              agent_access_token: created.access_token,
              note: "Store this token securely; it is shown only once.",
            };
            break;
          }

          case "start_sandbox": {
            const agent = await requireAgentFromMcpArgs(args);
            result = sanitizeAgentResponse(
              await sandboxService.start({ agent, apiBaseUrl: apiBaseUrl() }),
            );
            break;
          }

          case "list_providers": {
            await requireAgentFromMcpArgs(args);
            const items = await oauthProviderService.listPublicProviders();
            result = sanitizeAgentResponse({ ok: true, items });
            break;
          }

          case "request_access": {
            const agent = await requireAgentFromMcpArgs(args);
            const provider = typeof args.provider === "string" ? args.provider.trim() : "";
            if (!provider) {
              return jsonRpcError(id, -32000, "provider is required");
            }
            result = sanitizeAgentResponse(
              await proxyService.requestAccess({
                agent,
                provider,
                hosts: args.hosts,
                reason: typeof args.reason === "string" ? args.reason : undefined,
                userId: typeof args.user_id === "string" ? args.user_id : undefined,
                callbackUrl:
                  typeof args.callback_url === "string" ? args.callback_url : undefined,
                apiBaseUrl: apiBaseUrl(),
              }),
            );
            break;
          }

          case "get_access_status": {
            const agent = await requireAgentFromMcpArgs(args);
            const accessRequestId =
              typeof args.access_request_id === "string" ? args.access_request_id.trim() : "";
            if (!accessRequestId) {
              return jsonRpcError(id, -32000, "access_request_id is required");
            }
            result = sanitizeAgentResponse(
              await proxyService.getAccessStatus(accessRequestId, agent),
            );
            break;
          }

          case "proxy_request": {
            const agent = await requireAgentFromMcpArgs(args);
            const grantId = typeof args.grant_id === "string" ? args.grant_id.trim() : "";
            const method = typeof args.method === "string" ? args.method.trim() : "";
            const targetUrl = typeof args.url === "string" ? args.url.trim() : "";
            if (!grantId || !method || !targetUrl) {
              return jsonRpcError(id, -32000, "grant_id, method and url are required");
            }
            result = await proxyService.proxy({
              agent,
              grantId,
              method,
              url: targetUrl,
              headers:
                args.headers && typeof args.headers === "object" && !Array.isArray(args.headers)
                  ? (args.headers as Record<string, unknown>)
                  : undefined,
              body: args.body,
            });
            break;
          }

          case "list_grants": {
            const agent = await requireAgentFromMcpArgs(args);
            const items = await proxyService.listGrants({ agentId: agent.id });
            result = sanitizeAgentResponse({ ok: true, items });
            break;
          }

          case "submit_provider_proposal": {
            const agent = await requireAgentFromMcpArgs(args);
            const providerName =
              typeof args.provider_name === "string" ? args.provider_name.trim() : "";
            if (!providerName) {
              return jsonRpcError(id, -32000, "provider_name is required");
            }
            result = sanitizeAgentResponse({
              ok: true,
              proposal: await providerProposalService.submitProposal({
                agent,
                apiBaseUrl: apiBaseUrl(),
                body: {
                  provider_name: providerName,
                  discovery_url:
                    typeof args.discovery_url === "string" ? args.discovery_url : undefined,
                  issuer_url: typeof args.issuer_url === "string" ? args.issuer_url : undefined,
                  authorization_url:
                    typeof args.authorization_url === "string" ? args.authorization_url : undefined,
                  token_url: typeof args.token_url === "string" ? args.token_url : undefined,
                  registration_endpoint:
                    typeof args.registration_endpoint === "string"
                      ? args.registration_endpoint
                      : undefined,
                  scopes: Array.isArray(args.scopes) ? args.scopes.map(String) : undefined,
                  slug: typeof args.slug === "string" ? args.slug : undefined,
                },
              }),
            });
            break;
          }

          case "get_provider_proposal": {
            const agent = await requireAgentFromMcpArgs(args);
            const proposalId =
              typeof args.proposal_id === "string" ? args.proposal_id.trim() : "";
            if (!proposalId) {
              return jsonRpcError(id, -32000, "proposal_id is required");
            }
            result = sanitizeAgentResponse({
              ok: true,
              proposal: await providerProposalService.getProposal({ agent, proposalId }),
            });
            break;
          }

          default:
            return jsonRpcError(id, -32601, "Method not found", { tool: name });
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
    version: "4.0.0",
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
      v4_workflow: MCP_V4_WORKFLOW_URI,
      openapi_v4: `${baseUrl}/openapi-v4.json`,
      primary_skill: `${baseUrl}/skill.md`,
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
