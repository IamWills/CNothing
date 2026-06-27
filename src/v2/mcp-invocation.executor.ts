import type { JsonObject } from "./v2.entity";

function resolveInvocationConfig(capability: {
  invocation_config: JsonObject;
  metadata: JsonObject;
}): JsonObject {
  if (Object.keys(capability.invocation_config).length > 0) {
    return capability.invocation_config;
  }
  const fromMetadata = capability.metadata.invocation_config;
  return fromMetadata && typeof fromMetadata === "object"
    ? (fromMetadata as JsonObject)
    : {};
}

export async function executeMcpCapability(input: {
  capability: {
    name: string;
    invocation_config: JsonObject;
    metadata: JsonObject;
  };
  payload: JsonObject;
  accessToken?: string;
}): Promise<unknown> {
  const config = resolveInvocationConfig(input.capability);
  const serverUrl = String(config.server_url ?? config.mcp_server_url ?? "").trim();
  const toolName = String(config.tool_name ?? "").trim();

  if (!serverUrl) {
    throw new Error(
      `MCP capability ${input.capability.name} missing invocation_config.server_url`,
    );
  }
  if (!toolName) {
    throw new Error(`MCP capability ${input.capability.name} missing invocation_config.tool_name`);
  }

  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };

  const authType = String(config.auth ?? "bearer");
  if (authType === "bearer") {
    if (!input.accessToken?.trim()) {
      throw new Error("OAuth connection required for this MCP capability");
    }
    headers.authorization = `Bearer ${input.accessToken}`;
  } else if (authType === "none") {
    // public MCP server
  }

  if (config.headers && typeof config.headers === "object") {
    Object.assign(headers, config.headers as Record<string, string>);
  }

  const response = await fetch(serverUrl.replace(/\/+$/, ""), {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `cnothing-${Date.now()}`,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: input.payload,
      },
    }),
  });

  const text = await response.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // keep raw text
  }

  if (!response.ok) {
    throw new Error(`MCP capability ${input.capability.name} returned ${response.status}`);
  }

  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: { message?: string } }).error;
    throw new Error(error?.message ?? "MCP tool call failed");
  }

  if (data && typeof data === "object" && "result" in data) {
    return (data as { result: unknown }).result;
  }

  return data;
}
