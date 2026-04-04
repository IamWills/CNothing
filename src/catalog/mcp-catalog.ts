import config from "../config";
import type { McpResourceDescriptor, McpToolDescriptor } from "./catalog.entity";

const MCP_TOOLS: McpToolDescriptor[] = [
  {
    name: "get_authai_public_key",
    description:
      "Return the keyservice authai public key metadata for encrypting auth and data envelopes.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "authai_register",
    description:
      "Register a client public key and receive an encrypted one-time challenge for the client backend.",
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
    description:
      "Consume a valid auth envelope and issue the next encrypted challenge for the client backend.",
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
    description:
      "Read encrypted KV items for the authenticated client namespace and return the result encrypted to the client public key.",
    inputSchema: {
      type: "object",
      properties: {
        auth_envelope: { type: "object" },
        query_envelope: { type: "object" },
      },
      required: ["auth_envelope", "query_envelope"],
    },
  },
];

const MCP_RESOURCES: McpResourceDescriptor[] = [
  {
    uri: "resource://keyservice/protocol",
    name: "Protocol Overview",
    description: "AuthAI + KV protocol endpoints and flow summary.",
    mimeType: "application/json",
  },
  {
    uri: "resource://keyservice/mcp-manifest",
    name: "MCP Manifest",
    description: "Manifest metadata for MCP-compatible hosts.",
    mimeType: "application/json",
  },
  {
    uri: "resource://keyservice/openapi",
    name: "OpenAPI Summary",
    description: "Location of the published OpenAPI document.",
    mimeType: "application/json",
  },
];

export function listMcpTools(): McpToolDescriptor[] {
  return MCP_TOOLS;
}

export function listMcpResources(): McpResourceDescriptor[] {
  return MCP_RESOURCES;
}

export function readMcpResource(uri: string): { uri: string; mimeType: string; text: string } {
  if (uri === "resource://keyservice/mcp-manifest") {
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(
        {
          name: config.serviceName,
          manifest_path: "/mcp/manifest",
          openapi_path: "/openapi.json",
        },
        null,
        2,
      ),
    };
  }

  if (uri === "resource://keyservice/openapi") {
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(
        {
          openapi_path: "/openapi.json",
          docs_hint: "Fetch /openapi.json for the full schema document.",
        },
        null,
        2,
      ),
    };
  }

  return {
    uri: "resource://keyservice/protocol",
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
  };
}
