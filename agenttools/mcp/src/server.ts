import {
  AGENT_INSTRUCTIONS,
  AGENT_WORKFLOW,
  CNothingAgent,
  createCNothingAgent,
  renderModelJson,
  type AgentToolName,
} from "cnothing-agent";

import {
  MCP_LEGACY_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  MCP_TOOLS,
  MCP_WORKFLOW_URI,
} from "./tools";

export const LEGACY_PROTOCOL_VERSIONS = new Set([MCP_LEGACY_PROTOCOL_VERSION, "2025-06-18", "2024-11-05"]);
export const SUPPORTED_PROTOCOL_VERSIONS = [MCP_PROTOCOL_VERSION, ...LEGACY_PROTOCOL_VERSIONS];
const SERVER_CAPABILITIES = {
  tools: { listChanged: false },
  resources: { subscribe: false, listChanged: false },
};

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

export type McpRuntime = {
  agent: CNothingAgent;
  write: (line: string) => void;
};

function objectArgs(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function serverInfo() {
  return {
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
    description: "User-approved OAuth API proxy for AI agents",
  };
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

export function createMcpAgent(): CNothingAgent {
  return createCNothingAgent({
    clientName: process.env.CNOTHING_CLIENT_NAME?.trim() || "cnothing-mcp",
    softwareId: "cnothing-mcp",
  });
}

export async function handleMcpMessage(rpc: JsonRpcRequest, runtime: McpRuntime): Promise<void> {
  const id = rpc.id ?? null;
  const params = objectArgs(rpc.params);
  const isNotification = rpc.id === undefined;
  const requestMeta = objectArgs(params._meta);
  const isModern = requestMeta["io.modelcontextprotocol/protocolVersion"] === MCP_PROTOCOL_VERSION;

  const respond = (result: unknown) => {
    runtime.write(JSON.stringify({ jsonrpc: "2.0", id, result }));
  };
  const respondError = (code: number, message: string) => {
    runtime.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));
  };
  const send = (value: Record<string, unknown>) => respond(isModern ? modernResult(value) : value);

  if (rpc.method === "notifications/initialized" || rpc.method === "notifications/cancelled") return;

  try {
    switch (rpc.method) {
      case "server/discover":
        send({
          supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
          capabilities: SERVER_CAPABILITIES,
          instructions: AGENT_INSTRUCTIONS,
          ttlMs: 300_000,
          cacheScope: "public",
        });
        return;
      case "initialize": {
        if (isModern) {
          respondError(-32601, "Method not found");
          return;
        }
        const requestedProtocol =
          typeof params.protocolVersion === "string" ? params.protocolVersion : MCP_LEGACY_PROTOCOL_VERSION;
        respond({
          protocolVersion: LEGACY_PROTOCOL_VERSIONS.has(requestedProtocol)
            ? requestedProtocol
            : MCP_LEGACY_PROTOCOL_VERSION,
          serverInfo: serverInfo(),
          capabilities: SERVER_CAPABILITIES,
          instructions: AGENT_INSTRUCTIONS,
        });
        return;
      }
      case "ping":
        if (!isNotification) {
          if (isModern) respondError(-32601, "Method not found");
          else respond({});
        }
        return;
      case "tools/list":
        send({ tools: MCP_TOOLS, ...(isModern ? { ttlMs: 300_000, cacheScope: "public" } : {}) });
        return;
      case "resources/list":
        send({
          resources: [{ uri: MCP_WORKFLOW_URI, name: "CNothing v4 workflow", mimeType: "text/markdown" }],
          ...(isModern ? { ttlMs: 300_000, cacheScope: "public" } : {}),
        });
        return;
      case "resources/read":
        if (String(params.uri ?? "") !== MCP_WORKFLOW_URI) {
          respondError(isModern ? -32602 : -32002, "Resource not found");
          return;
        }
        send({
          contents: [{ uri: MCP_WORKFLOW_URI, mimeType: "text/markdown", text: AGENT_WORKFLOW }],
          ...(isModern ? { ttlMs: 300_000, cacheScope: "public" } : {}),
        });
        return;
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        if (!MCP_TOOLS.some((tool) => tool.name === name)) {
          respondError(-32602, `Unknown tool: ${name}`);
          return;
        }
        const data = await runtime.agent.invoke(name as AgentToolName, objectArgs(params.arguments));
        const isError = data && typeof data === "object" && "status" in data && data.status === "error";
        const toolResult = {
          content: [{ type: "text", text: renderModelJson(data) }],
          structuredContent: data,
          ...(isError ? { isError: true } : {}),
        };
        respond(isModern ? modernResult(toolResult) : toolResult);
        return;
      }
      default:
        if (!isNotification) respondError(-32601, `Method not found: ${rpc.method}`);
    }
  } catch (error) {
    if (!isNotification) respondError(-32000, error instanceof Error ? error.message : String(error));
  }
}
