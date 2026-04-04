import config from "../config";
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
        result = { resources: [] };
        break;

      case "resources/read":
        result = {
          contents: [
            {
              uri: String(params.uri ?? "resource://keyservice/protocol"),
              mimeType: "application/json",
              text: JSON.stringify(
                {
                  protocol: "authai-kv",
                  public_key_endpoint: "/v1/authai/public-key",
                  register_endpoint: "/v1/authai/register",
                  refresh_endpoint: "/v1/authai/refresh",
                  save_endpoint: "/v1/kv/save",
                  read_endpoint: "/v1/kv/read",
                },
                null,
                2,
              ),
            },
          ],
        };
        break;

      case "tools/list":
        result = {
          tools: [
            {
              name: "get_authai_public_key",
              description: "Return the keyservice authai public key metadata for encrypting auth and data envelopes.",
              inputSchema: { type: "object", properties: {} },
            },
            {
              name: "authai_register",
              description: "Register a client public key and receive an encrypted one-time challenge for the client backend.",
              inputSchema: {
                type: "object",
                properties: {
                  client_public_key: { type: "string" },
                  client_key_alg: { type: "string" },
                  client_key_id: { type: "string" },
                  client_label: { type: "string" },
                  metadata: { type: "object" },
                },
                required: ["client_public_key"],
              },
            },
            {
              name: "authai_refresh",
              description: "Consume a valid auth envelope and issue the next encrypted challenge for the client backend.",
              inputSchema: {
                type: "object",
                properties: {
                  auth_envelope: { type: "object" },
                },
                required: ["auth_envelope"],
              },
            },
            {
              name: "kv_save",
              description: "Store one or more encrypted KV items for the authenticated client namespace.",
              inputSchema: {
                type: "object",
                properties: {
                  auth_envelope: { type: "object" },
                  data_envelope: { type: "object" },
                },
                required: ["auth_envelope", "data_envelope"],
              },
            },
            {
              name: "kv_read",
              description: "Read encrypted KV items for the authenticated client namespace and return the result encrypted to the client public key.",
              inputSchema: {
                type: "object",
                properties: {
                  auth_envelope: { type: "object" },
                  query_envelope: { type: "object" },
                },
                required: ["auth_envelope", "query_envelope"],
              },
            },
          ],
        };
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
