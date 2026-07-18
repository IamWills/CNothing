#!/usr/bin/env bun
/**
 * cnothing-mcp — local stdio MCP server for the CNothing v4 universal proxy.
 *
 * Once configured in an agent's MCP client (Cursor, Claude Desktop, ...), this
 * server becomes the agent's callable tool for registering/logging in to OAuth
 * 2.0 sites through CNothing. The agent authenticates to CNothing with
 * CNOTHING_AGENT_TOKEN; end users approve access once in the browser; tokens
 * never reach the agent.
 *
 * Env:
 *   CNOTHING_BASE_URL     e.g. https://cnothing.com (default)
 *   CNOTHING_AGENT_TOKEN  agent bearer token (required)
 */

const BASE_URL = (process.env.CNOTHING_BASE_URL ?? "https://cnothing.com").replace(/\/+$/, "");
// Mutable: register_agent can fill it in at runtime if not preconfigured.
let AGENT_TOKEN = process.env.CNOTHING_AGENT_TOKEN ?? "";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

const TOOLS = [
  {
    name: "register_agent",
    description:
      "Self-register this agent with CNothing and receive an agent access token (no admin needed; a token alone grants nothing until a human approves access). The token is applied to this MCP session automatically — also store it as CNOTHING_AGENT_TOKEN for future sessions.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Human-readable agent name" },
        metadata: { type: "object", description: "Optional metadata" },
      },
      required: ["name"],
    },
  },
  {
    name: "start_sandbox",
    description:
      "Provision an auto-approved sandbox grant to self-test the full v4 flow (grant + credential-injecting proxy + redaction) without human approval or a real OAuth provider. Returns grant_id and echo_url for proxy_request.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_providers",
    description:
      "List OAuth 2.0 providers configured on CNothing. Use the returned slug with request_access.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "request_access",
    description:
      "Request connection-level access to an OAuth provider. Returns access_request_id and approval_url. Show approval_url to the human user; they approve once in the browser (this is where OAuth registration/login to the target site happens — the agent must not attempt it).",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", description: "Provider slug, e.g. github" },
        hosts: {
          type: "array",
          items: { type: "string" },
          description: "Optional host allowlist, e.g. [\"api.github.com\"]",
        },
        reason: { type: "string", description: "Shown to the user on the approval page" },
        user_id: {
          type: "string",
          description:
            "Optional CNothing user id. When set, the approval is pushed to the user's paired iOS authenticator devices.",
        },
        callback_url: {
          type: "string",
          description:
            "Optional https URL that receives a POST when the user approves/denies (no polling needed).",
        },
      },
      required: ["provider"],
    },
  },
  {
    name: "get_access_status",
    description:
      "Poll an access request. When status is approved, the response contains grant_id.",
    inputSchema: {
      type: "object",
      properties: { access_request_id: { type: "string" } },
      required: ["access_request_id"],
    },
  },
  {
    name: "proxy_request",
    description:
      "Call any https API of the granted provider through CNothing. The user's OAuth token is injected server-side and auto-refreshed; responses are redacted so tokens can never leak.",
    inputSchema: {
      type: "object",
      properties: {
        grant_id: { type: "string" },
        method: { type: "string", description: "GET / POST / PATCH / DELETE ..." },
        url: { type: "string", description: "Full https URL on a granted host" },
        headers: { type: "object", description: "Optional extra headers (auth headers are ignored)" },
        body: { description: "Optional JSON body" },
      },
      required: ["grant_id", "method", "url"],
    },
  },
  {
    name: "list_grants",
    description: "List this agent's connection-level grants.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "submit_provider_proposal",
    description:
      "Onboard a new OAuth 2.0 / OIDC provider by discovery URL. Providers supporting RFC 7591 Dynamic Client Registration are activated automatically.",
    inputSchema: {
      type: "object",
      properties: {
        provider_name: { type: "string" },
        discovery_url: { type: "string" },
        issuer_url: { type: "string" },
        authorization_url: { type: "string" },
        token_url: { type: "string" },
        registration_endpoint: { type: "string" },
        scopes: { type: "array", items: { type: "string" } },
        slug: { type: "string" },
      },
      required: ["provider_name"],
    },
  },
  {
    name: "get_provider_proposal",
    description: "Check the status of a provider proposal.",
    inputSchema: {
      type: "object",
      properties: { proposal_id: { type: "string" } },
      required: ["proposal_id"],
    },
  },
];

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${AGENT_TOKEN}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: response.status, data };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "register_agent") {
    const { status, data } = await api("POST", "/v4/agents/register", {
      name: args.name,
      metadata: args.metadata,
    });
    if (status < 400 && data && typeof data === "object") {
      const token = (data as Record<string, unknown>).access_token;
      if (typeof token === "string" && token) {
        AGENT_TOKEN = token;
      }
    }
    return data;
  }

  if (!AGENT_TOKEN) {
    throw new Error(
      "CNOTHING_AGENT_TOKEN is not set. Call the register_agent tool first (self-service), or set the token in the MCP server env.",
    );
  }

  switch (name) {
    case "start_sandbox": {
      const { data } = await api("POST", "/v4/sandbox/start", {});
      return data;
    }
    case "list_providers": {
      const { data } = await api("GET", "/v4/providers");
      return data;
    }
    case "request_access": {
      const { data } = await api("POST", "/v4/access-requests", {
        provider: args.provider,
        hosts: args.hosts,
        reason: args.reason,
        user_id: args.user_id,
        callback_url: args.callback_url,
      });
      return data;
    }
    case "get_access_status": {
      const { data } = await api(
        "GET",
        `/v4/access-requests/${encodeURIComponent(String(args.access_request_id ?? ""))}`,
      );
      return data;
    }
    case "proxy_request": {
      const { data } = await api("POST", "/v4/proxy", {
        grant_id: args.grant_id,
        method: args.method,
        url: args.url,
        headers: args.headers,
        body: args.body,
      });
      return data;
    }
    case "list_grants": {
      const { data } = await api("GET", "/v4/grants");
      return data;
    }
    case "submit_provider_proposal": {
      const { data } = await api("POST", "/v4/providers/proposals", args);
      return data;
    }
    case "get_provider_proposal": {
      const { data } = await api(
        "GET",
        `/v4/providers/proposals/${encodeURIComponent(String(args.proposal_id ?? ""))}`,
      );
      return data;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function respond(id: string | number | null, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function respondError(id: string | number | null, code: number, message: string): void {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`,
  );
}

async function handleMessage(rpc: JsonRpcRequest): Promise<void> {
  const id = rpc.id ?? null;
  const params = rpc.params ?? {};

  try {
    switch (rpc.method) {
      case "initialize":
        respond(id, {
          protocolVersion:
            typeof params.protocolVersion === "string" ? params.protocolVersion : "2024-11-05",
          serverInfo: { name: "cnothing-mcp", version: "0.1.0" },
          capabilities: { tools: { listChanged: false } },
          instructions:
            "CNothing v4 tools: list_providers -> request_access (show approval_url to the human) -> get_access_status (poll for grant_id) -> proxy_request (call any https API on granted hosts). The agent never sees OAuth tokens.",
        });
        return;

      case "notifications/initialized":
      case "notifications/cancelled":
        return; // notifications get no response

      case "ping":
        respond(id, {});
        return;

      case "tools/list":
        respond(id, { tools: TOOLS });
        return;

      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        const args =
          params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
            ? (params.arguments as Record<string, unknown>)
            : {};
        const result = await callTool(name, args);
        respond(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
        return;
      }

      default:
        if (id !== null) {
          respondError(id, -32601, `Method not found: ${rpc.method}`);
        }
    }
  } catch (error) {
    respondError(id, -32000, error instanceof Error ? error.message : String(error));
  }
}

let buffer = "";
// Process messages strictly in order: register_agent must finish (and set
// AGENT_TOKEN) before any subsequent tool call runs.
let queue: Promise<void> = Promise.resolve();

process.stdin.on("data", (chunk: Buffer) => {
  buffer += chunk.toString("utf8");
  let newlineIndex = buffer.indexOf("\n");
  while (newlineIndex >= 0) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (line) {
      try {
        const rpc = JSON.parse(line) as JsonRpcRequest;
        queue = queue.then(() => handleMessage(rpc));
      } catch {
        respondError(null, -32700, "Parse error");
      }
    }
    newlineIndex = buffer.indexOf("\n");
  }
});

process.stdin.on("end", () => {
  void queue.then(() => process.exit(0));
});
