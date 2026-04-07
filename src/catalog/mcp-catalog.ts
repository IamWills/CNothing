import config from "../config";
import type { McpResourceDescriptor, McpToolDescriptor } from "./catalog.entity";

const MCP_TOOLS: McpToolDescriptor[] = [
  {
    name: "get_authai_public_key",
    description:
      "Return the CNothing AuthAI public key metadata used by a client backend to encrypt auth, data, and query envelopes toward CNothing without exposing its private key to the AI.",
    inputSchema: {
      type: "object",
      properties: {},
      examples: [{}],
    },
    useCases: [
      "Bootstrap an AI-safe client integration before registration.",
      "Refresh local knowledge of the active CNothing server key before envelope creation.",
    ],
    examples: [
      {
        request: {},
        next_step:
          "Give the returned public key to the trusted client backend so it can encrypt auth and payload envelopes.",
      },
    ],
  },
  {
    name: "authai_register",
    description:
      "Register a client public key and receive an encrypted one-time challenge for the client backend. The AI may forward the challenge ciphertext, but only the trusted backend should decrypt it.",
    inputSchema: {
      type: "object",
      properties: {
        client_public_key: {
          type: "string",
          description: "PEM-encoded public key generated and held by the client backend.",
          examples: ["-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"],
        },
        client_key_alg: {
          type: "string",
          description: "Client envelope algorithm profile. Defaults to RSA-OAEP-256/A256GCM when omitted.",
          examples: ["RSA-OAEP-256/A256GCM"],
        },
        client_key_id: {
          type: "string",
          description: "Optional client-chosen key identifier for rotation tracking.",
          examples: ["backend-main-2026-04"],
        },
        client_label: {
          type: "string",
          description: "Optional human label for the client identity.",
          examples: ["signup-control-plane"],
        },
        metadata: {
          type: "object",
          description: "Optional non-secret metadata describing the registering client.",
          examples: [{ team: "growth-ops", environment: "prod" }],
        },
      },
      required: ["client_public_key"],
      examples: [
        {
          client_public_key: "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
          client_key_alg: "RSA-OAEP-256/A256GCM",
          client_label: "signup-control-plane",
          metadata: { team: "growth-ops", environment: "prod" },
        },
      ],
    },
    useCases: [
      "Create a new CNothing client identity for a third-party backend.",
      "Re-register an existing public key to retrieve a fresh challenge.",
    ],
    examples: [
      {
        request: {
          client_public_key: "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
          client_label: "signup-control-plane",
        },
        next_step:
          "Send challenge_for_client to the trusted backend, then wait for auth_envelope and data/query envelopes.",
      },
    ],
  },
  {
    name: "authai_refresh",
    description:
      "Consume a valid auth envelope and issue the next encrypted challenge for the client backend. Use this when a workflow needs another operation without re-registering the client.",
    inputSchema: {
      type: "object",
      properties: {
        auth_envelope: {
          type: "object",
          description: "Opaque ciphertext envelope built by the trusted backend from the last valid challenge.",
        },
      },
      required: ["auth_envelope"],
      examples: [{ auth_envelope: { v: "ksp1", encrypted_key: "...", iv: "...", ciphertext: "...", tag: "..." } }],
    },
    useCases: [
      "Rotate to the next challenge between multiple protected operations.",
      "Keep a long-running AI workflow synchronized with the backend challenge lifecycle.",
    ],
  },
  {
    name: "kv_save",
    description:
      "Store one or more encrypted KV items for the authenticated client namespace. Recommended third-party integrations use private or blind mode so CNothing operators and AI layers do not see application plaintext.",
    inputSchema: {
      type: "object",
      properties: {
        auth_envelope: {
          type: "object",
          description: "Opaque action-bound auth envelope for kv.save.",
        },
        data_envelope: {
          type: "object",
          description: "Opaque ciphertext envelope containing the kv.save payload built by the trusted backend.",
        },
      },
      required: ["auth_envelope", "data_envelope"],
      examples: [
        {
          auth_envelope: { v: "ksp1", encrypted_key: "...", iv: "...", ciphertext: "...", tag: "..." },
          data_envelope: { v: "ksp1", encrypted_key: "...", iv: "...", ciphertext: "...", tag: "..." },
        },
      ],
    },
    useCases: [
      "Persist signup profiles, credential bundles, or recovery artifacts for a client.",
      "Write back newly issued credentials after an AI-assisted registration flow completes.",
    ],
  },
  {
    name: "kv_read",
    description:
      "Read encrypted KV items for the authenticated client namespace and return the result encrypted to the client public key. The AI should only relay the resulting ciphertext back to the trusted backend for decryption.",
    inputSchema: {
      type: "object",
      properties: {
        auth_envelope: {
          type: "object",
          description: "Opaque action-bound auth envelope for kv.read.",
        },
        query_envelope: {
          type: "object",
          description: "Opaque ciphertext envelope containing the kv.read query built by the trusted backend.",
        },
      },
      required: ["auth_envelope", "query_envelope"],
      examples: [
        {
          auth_envelope: { v: "ksp1", encrypted_key: "...", iv: "...", ciphertext: "...", tag: "..." },
          query_envelope: { v: "ksp1", encrypted_key: "...", iv: "...", ciphertext: "...", tag: "..." },
        },
      ],
    },
    useCases: [
      "Retrieve protected signup data during an AI-orchestrated registration step.",
      "Fetch encrypted credential bundles for later backend-side login or recovery flows.",
    ],
  },
];

const MCP_RESOURCES: McpResourceDescriptor[] = [
  {
    uri: "resource://keyservice/protocol",
    name: "Protocol Overview",
    description: "CNothing AuthAI + KV protocol endpoints and flow summary.",
    mimeType: "application/json",
  },
  {
    uri: "resource://keyservice/mcp-manifest",
    name: "MCP Manifest",
    description: "CNothing manifest metadata for MCP-compatible hosts.",
    mimeType: "application/json",
  },
  {
    uri: "resource://keyservice/openapi",
    name: "OpenAPI Summary",
    description: "Location of the published CNothing OpenAPI document.",
    mimeType: "application/json",
  },
  {
    uri: "resource://keyservice/getting-started",
    name: "Getting Started Guide",
    description: "Step-by-step quick start and demo flow for AI-safe CNothing integrations.",
    mimeType: "application/json",
  },
  {
    uri: "resource://keyservice/skills-index",
    name: "Public Skills Index",
    description: "Public paths for CNothing skills, markdown downloads, and AI entry documents.",
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

  if (uri === "resource://keyservice/getting-started") {
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(
        {
          getting_started_markdown: "/getting-started.md",
          recommended_flow: [
            "Fetch /v1/authai/public-key.",
            "Register a backend public key with /v1/authai/register.",
            "Let the trusted backend decrypt challenge_for_client.",
            "Use kv.save or kv.read only with backend-produced opaque envelopes.",
          ],
          demo_paths: {
            homepage: "/",
            skills_index: "/skills/index.json",
            standards: "/standards",
          },
        },
        null,
        2,
      ),
    };
  }

  if (uri === "resource://keyservice/skills-index") {
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(
        {
          skills_page: "/skills",
          skills_index_json: "/skills/index.json",
          getting_started_markdown: "/getting-started.md",
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
        skills_index: "/skills/index.json",
        getting_started_markdown: "/getting-started.md",
      },
      null,
      2,
    ),
  };
}
