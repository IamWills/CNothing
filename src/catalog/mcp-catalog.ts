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
    name: "authai_key_holder_sign_challenge",
    description:
      "Recommended: create a signature-based key-holder challenge. The target should sign challenge_text with its private key and return a base64/base64url signature.",
    inputSchema: {
      type: "object",
      properties: {
        target_public_key: {
          type: "string",
          description: "PEM-encoded target public key to verify holder identity.",
          examples: ["-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"],
        },
        target_key_id: {
          type: "string",
          description: "Optional target key identifier.",
          examples: ["partner-key-2026-04"],
        },
        metadata: {
          type: "object",
          description: "Optional non-secret metadata for tracing.",
          examples: [{ channel: "partner-onboarding", environment: "prod" }],
        },
      },
      required: ["target_public_key"],
      examples: [
        {
          target_public_key: "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
          target_key_id: "partner-key-2026-04",
        },
      ],
    },
    useCases: [
      "Preferred production proof-of-possession flow based on signatures.",
      "Interoperate with external systems that already expose signing APIs or HSM/KMS signing.",
    ],
  },
  {
    name: "authai_key_holder_verify_signature",
    description:
      "Recommended: verify signature proof by checking target public key fingerprint, challenge_text hash, and RSA-SHA256 signature validity.",
    inputSchema: {
      type: "object",
      properties: {
        verification_id: {
          type: "string",
          description: "Challenge id returned by authai_key_holder_sign_challenge.",
        },
        challenge_text: {
          type: "string",
          description: "The exact challenge_text returned by authai_key_holder_sign_challenge.",
        },
        signature: {
          type: "string",
          description: "Base64 or base64url signature over challenge_text.",
        },
        target_public_key: {
          type: "string",
          description: "PEM-encoded target public key used for signature verification.",
          examples: ["-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"],
        },
      },
      required: ["verification_id", "challenge_text", "signature", "target_public_key"],
      examples: [
        {
          verification_id: "4f2f4048-b9e8-4d65-aa71-d500f0ef8578",
          challenge_text: "cnothing-key-holder-signature-challenge\n...",
          signature: "base64-or-base64url-signature",
          target_public_key: "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
        },
      ],
    },
    useCases: [
      "Finalize the recommended signature-based key-holder verification.",
      "Return verified=true/false with auditable result status.",
    ],
  },
  {
    name: "authai_key_holder_challenge",
    description:
      "Compatibility flow: create a two-ciphertext key-holder verification challenge. Prefer signature-based verification for new integrations.",
    inputSchema: {
      type: "object",
      properties: {
        target_public_key: {
          type: "string",
          description: "PEM-encoded target public key to be challenged for private-key possession.",
          examples: ["-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"],
        },
        target_key_id: {
          type: "string",
          description: "Optional target-side key identifier.",
          examples: ["partner-key-2026-04"],
        },
        metadata: {
          type: "object",
          description: "Optional non-secret challenge metadata for tracing.",
          examples: [{ channel: "partner-onboarding", environment: "prod" }],
        },
      },
      required: ["target_public_key"],
      examples: [
        {
          target_public_key: "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
          target_key_id: "partner-key-2026-04",
        },
      ],
    },
    useCases: [
      "Verify that a partner really controls the private key for a provided public key.",
      "Issue cross-system cryptographic possession proof without exposing S1 plaintext to AI.",
    ],
  },
  {
    name: "authai_key_holder_verify",
    description:
      "Compatibility flow: compare responder_secret (S2) against S1 decrypted from challenge_for_authai. Prefer authai_key_holder_verify_signature for new integrations.",
    inputSchema: {
      type: "object",
      properties: {
        verification_id: {
          type: "string",
          description: "Verification challenge identifier returned from authai_key_holder_challenge.",
        },
        responder_secret: {
          type: "string",
          description: "S2 provided by the challenged party after decrypting challenge_for_target.",
        },
        challenge_for_authai: {
          type: "object",
          description: "Opaque ciphertext B that CNothing decrypts to recover S1 for comparison.",
        },
      },
      required: ["verification_id", "responder_secret", "challenge_for_authai"],
      examples: [
        {
          verification_id: "c14f04a1-0a17-4b70-83df-df4f0c09e303",
          responder_secret: "base64url-secret-from-target",
          challenge_for_authai: {
            v: "ksp1",
            encrypted_key: "...",
            iv: "...",
            ciphertext: "...",
            tag: "...",
          },
        },
      ],
    },
    useCases: [
      "Complete the S1/S2 compare step for key-holder proof.",
      "Return a deterministic verified boolean and immutable audit trace.",
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
      "Read encrypted KV items for the authenticated client namespace and return ciphertext encrypted to the client public key by default, or to a provided recipient_public_key.",
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
        recipient_public_key: {
          type: "string",
          description:
            "Optional PEM public key. When set, result_envelope_for_client is encrypted to this key instead of the registered client key.",
          examples: ["-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"],
        },
      },
      required: ["auth_envelope", "query_envelope"],
      examples: [
        {
          auth_envelope: { v: "ksp1", encrypted_key: "...", iv: "...", ciphertext: "...", tag: "..." },
          query_envelope: { v: "ksp1", encrypted_key: "...", iv: "...", ciphertext: "...", tag: "..." },
          recipient_public_key: "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
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
        key_holder_sign_challenge_endpoint: "/v1/authai/key-holder/sign-challenge",
        key_holder_verify_signature_endpoint: "/v1/authai/key-holder/verify-signature",
        key_holder_challenge_endpoint: "/v1/authai/key-holder/challenge",
        key_holder_verify_endpoint: "/v1/authai/key-holder/verify",
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
