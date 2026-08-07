#!/usr/bin/env bun
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
} from "./tools";

const BASE_URL = (process.env.CNOTHING_BASE_URL ?? "https://cnothing.com").replace(/\/+$/, "");
const AGENT_TOKEN = process.env.CNOTHING_AGENT_TOKEN?.trim() ?? "";
const LEGACY_PROTOCOL_VERSIONS = new Set([MCP_LEGACY_PROTOCOL_VERSION, "2025-06-18", "2024-11-05"]);
const SUPPORTED_PROTOCOL_VERSIONS = [MCP_PROTOCOL_VERSION, ...LEGACY_PROTOCOL_VERSIONS];
const SERVER_CAPABILITIES = {
  tools: { listChanged: false },
  resources: { subscribe: false, listChanged: false },
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
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

function respond(id: string | number | null, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function respondError(id: string | number | null, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

async function api(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  if (!AGENT_TOKEN) {
    throw new Error(
      "CNOTHING_AGENT_TOKEN is not configured. Ask the user or operator to create an agent in the CNothing Console and configure its one-time token in this MCP server environment.",
    );
  }
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${AGENT_TOKEN}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) as unknown : {};
  if (!response.ok) {
    const record = objectArgs(data);
    const error = objectArgs(record.error);
    throw new Error(typeof error.message === "string" ? error.message : `CNothing API returned HTTP ${response.status}`);
  }
  return objectArgs(data);
}

async function callTool(name: McpToolName, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (name) {
    case "list_grants":
      return api("GET", "/v4/grants");
    case "list_providers":
      return api("GET", "/v4/providers");
    case "request_access":
      return api("POST", "/v4/access-requests", args);
    case "get_access_status":
      return api("GET", `/v4/access-requests/${encodeURIComponent(String(args.access_request_id ?? ""))}`);
    case "proxy_request":
      return api("POST", "/v4/proxy", args);
  }
}

async function handleMessage(rpc: JsonRpcRequest): Promise<void> {
  const id = rpc.id ?? null;
  const params = objectArgs(rpc.params);
  const isNotification = rpc.id === undefined;
  const requestMeta = objectArgs(params._meta);
  const isModern =
    requestMeta["io.modelcontextprotocol/protocolVersion"] === MCP_PROTOCOL_VERSION;
  const send = (value: Record<string, unknown>) =>
    respond(id, isModern ? modernResult(value) : value);
  if (rpc.method === "notifications/initialized" || rpc.method === "notifications/cancelled") return;

  try {
    switch (rpc.method) {
      case "server/discover":
        send({
          supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
          capabilities: SERVER_CAPABILITIES,
          instructions: MCP_SERVER_INSTRUCTIONS,
          ttlMs: 300_000,
          cacheScope: "public",
        });
        return;
      case "initialize": {
        if (isModern) {
          respondError(id, -32601, "Method not found");
          return;
        }
        const requestedProtocol =
          typeof params.protocolVersion === "string" ? params.protocolVersion : MCP_LEGACY_PROTOCOL_VERSION;
        respond(id, {
          protocolVersion: LEGACY_PROTOCOL_VERSIONS.has(requestedProtocol)
            ? requestedProtocol
            : MCP_LEGACY_PROTOCOL_VERSION,
          serverInfo: serverInfo(),
          capabilities: SERVER_CAPABILITIES,
          instructions: MCP_SERVER_INSTRUCTIONS,
        });
        return;
      }
      case "ping":
        if (!isNotification) {
          if (isModern) respondError(id, -32601, "Method not found");
          else respond(id, {});
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
          respondError(id, isModern ? -32602 : -32002, "Resource not found");
          return;
        }
        send({
          contents: [{ uri: MCP_WORKFLOW_URI, mimeType: "text/markdown", text: MCP_WORKFLOW_MARKDOWN }],
          ...(isModern ? { ttlMs: 300_000, cacheScope: "public" } : {}),
        });
        return;
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        if (!MCP_TOOLS.some((tool) => tool.name === name)) {
          respondError(id, -32602, `Unknown tool: ${name}`);
          return;
        }
        try {
          const data = await callTool(name as McpToolName, objectArgs(params.arguments));
          const toolResult = {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
            structuredContent: data,
          };
          respond(id, isModern ? modernResult(toolResult) : toolResult);
        } catch (error) {
          const data = { ok: false, status: "error", next_action: "inspect_error", error: { message: error instanceof Error ? error.message : "Tool failed" } };
          const toolResult = { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data, isError: true };
          respond(id, isModern ? modernResult(toolResult) : toolResult);
        }
        return;
      }
      default:
        if (!isNotification) respondError(id, -32601, `Method not found: ${rpc.method}`);
    }
  } catch (error) {
    if (!isNotification) respondError(id, -32000, error instanceof Error ? error.message : String(error));
  }
}

let buffer = "";
let queue: Promise<void> = Promise.resolve();
process.stdin.on("data", (chunk: Buffer) => {
  buffer += chunk.toString("utf8");
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) {
      try {
        const rpc = JSON.parse(line) as JsonRpcRequest;
        queue = queue.then(() => handleMessage(rpc));
      } catch {
        respondError(null, -32700, "Parse error");
      }
    }
    newline = buffer.indexOf("\n");
  }
});
process.stdin.on("end", () => void queue.then(() => process.exit(0)));
