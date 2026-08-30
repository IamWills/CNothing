import { AGENT_INSTRUCTIONS, AGENT_TOOLS, AGENT_WORKFLOW, type AgentToolName } from "cnothing-agent";

export const MCP_PROTOCOL_VERSION = "2026-07-28";
export const MCP_LEGACY_PROTOCOL_VERSION = "2025-11-25";
export const MCP_SERVER_NAME = "cnothing-v4";
export const MCP_SERVER_VERSION = "4.0.0";
export const MCP_WORKFLOW_URI = "resource://cnothing/v4-workflow";

const emptyInput = { type: "object", properties: {}, additionalProperties: false } as const;
const standardOutput = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    status: { type: "string" },
    next_action: { type: "string" },
  },
  additionalProperties: true,
} as const;

const jsonSchemas: Record<AgentToolName, Record<string, unknown>> = {
  list_grants: emptyInput,
  list_providers: emptyInput,
  request_access: {
    type: "object",
    properties: {
      provider: { type: "string", minLength: 1, description: AGENT_TOOLS[2].parameters.provider.description },
      reason: { type: "string", minLength: 1, maxLength: 500, description: AGENT_TOOLS[2].parameters.reason.description },
      user_id: { type: "string", minLength: 1, description: AGENT_TOOLS[2].parameters.user_id?.description },
      hosts: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true, description: AGENT_TOOLS[2].parameters.hosts?.description },
      callback_url: { type: "string", format: "uri", description: AGENT_TOOLS[2].parameters.callback_url?.description },
      issuer: { type: "string", format: "uri", description: AGENT_TOOLS[2].parameters.issuer?.description },
      discovery_url: { type: "string", format: "uri", description: AGENT_TOOLS[2].parameters.discovery_url?.description },
    },
    required: ["provider", "reason"],
    additionalProperties: false,
  },
  get_access_status: {
    type: "object",
    properties: { access_request_id: { type: "string", minLength: 1 } },
    required: ["access_request_id"],
    additionalProperties: false,
  },
  proxy_request: {
    type: "object",
    properties: {
      grant_id: { type: "string", minLength: 1 },
      method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] },
      url: { type: "string", format: "uri", pattern: "^https://" },
      headers: { type: "object", additionalProperties: { type: "string" }, description: "Optional non-credential request headers." },
      body: { description: "Optional JSON value or string request body." },
      idempotency_key: { type: "string", minLength: 1, maxLength: 128, description: "Optional key so retries of a write do not execute twice." },
    },
    required: ["grant_id", "method", "url"],
    additionalProperties: false,
  },
};

export const MCP_TOOLS = AGENT_TOOLS.map((tool) => ({
  name: tool.name,
  title: tool.title,
  description: tool.description,
  inputSchema: jsonSchemas[tool.name],
  outputSchema: standardOutput,
  annotations: tool.annotations,
}));

export type McpToolName = AgentToolName;

export const MCP_SERVER_INSTRUCTIONS = AGENT_INSTRUCTIONS;
export const MCP_WORKFLOW_MARKDOWN = AGENT_WORKFLOW;
