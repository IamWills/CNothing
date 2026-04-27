import config from "../config";
import { listMcpResources, listMcpTools, readMcpResource } from "../catalog/mcp-catalog";
import { KeyService } from "../core/key-service";

const service = new KeyService();

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
          case "kv_save":
            result = await service.saveKv(args);
            break;
          case "kv_read":
            result = await service.readKv(args);
            break;
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
    version: "2.0.0",
    protocolVersion: config.protocolVersion,
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
