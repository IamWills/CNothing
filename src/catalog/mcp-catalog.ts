import config from "../config";
import type { McpResourceDescriptor, McpToolDescriptor } from "./catalog.entity";
import {
  MCP_V2_AUTH_WORKFLOW_MARKDOWN,
  MCP_V2_AUTH_WORKFLOW_URI,
} from "./mcp-v2-auth-workflow";

const V1_DEPRECATED_TOOL = {
  deprecated: true,
  successor: "invoke_capability",
} as const;

const MCP_TOOLS: McpToolDescriptor[] = [
  {
    name: "invoke_capability",
    description:
      "Primary v2 agent API. Invoke a registered capability by business name (e.g. github.list_repositories, search.query). Requires a prior user Grant from request_authorization — user approves in browser at approval_url (GitHub sign-in happens there, NOT via MCP). Agent never receives secrets. Omit user_id when this agent has a single active grant for the capability.",
    inputSchema: {
      type: "object",
      properties: {
        capability: {
          type: "string",
          description: "Capability name, e.g. github.list_repositories",
          examples: ["github.list_repositories", "search.query"],
        },
        input: {
          type: "object",
          description: "Business input for the capability.",
          examples: [{ per_page: 10 }, { query: "CNothing", limit: 5 }],
        },
        agent_access_token: {
          type: "string",
          description: "Agent bearer token from POST /v2/agents/register.",
        },
        user_id: {
          type: "string",
          description:
            "Optional. Only when multiple users granted the same capability to this agent. Do NOT ask the user for user_id — use request_authorization first.",
        },
        reason: {
          type: "string",
          description: "Required when policy demands explicit reason.",
        },
        confirmation_id: {
          type: "string",
          description: "Retry invoke after user approved a pending confirmation.",
        },
      },
      required: ["agent_access_token", "capability"],
    },
    useCases: [
      "After user approved capabilities at approval_url, call GitHub or Search without handling tokens.",
      "Retry a capability after user confirmation via confirmation_id.",
    ],
  },
  {
    name: "request_authorization",
    description:
      "Start OAuth-style capability authorization. Returns approval_url (https://cnothing.com/authorize/{id}). Send that URL to the human — they sign in with GitHub IN THE BROWSER on that page and click Allow. Agent cannot log in to GitHub via MCP. Omit user_id; identity binds at approve time. Read resource://cnothing/v2-user-authorization for full GitHub flow.",
    inputSchema: {
      type: "object",
      properties: {
        agent_access_token: { type: "string", description: "Agent bearer token." },
        capabilities: {
          type: "array",
          items: { type: "string" },
          description: "Capability names to request, e.g. github.list_repositories, search.query",
        },
        user_id: {
          type: "string",
          description: "Optional and usually omitted. Do NOT ask the user for user_id.",
        },
        reason: { type: "string", description: "Shown to the user on the approval page." },
        state: { type: "string" },
      },
      required: ["agent_access_token", "capabilities"],
    },
    useCases: [
      "Before first invoke when grant_not_found — send user approval_url for GitHub sign-in + Allow.",
    ],
  },
  {
    name: "list_capabilities",
    description: "List registered capabilities available for invocation.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    useCases: ["Discover what capabilities exist in the registry."],
  },
  {
    name: "get_authai_public_key",
    ...V1_DEPRECATED_TOOL,
    successor: "list_capabilities",
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
    ...V1_DEPRECATED_TOOL,
    successor: "request_authorization",
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
    ...V1_DEPRECATED_TOOL,
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
    ...V1_DEPRECATED_TOOL,
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
    ...V1_DEPRECATED_TOOL,
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
    ...V1_DEPRECATED_TOOL,
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
    ...V1_DEPRECATED_TOOL,
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
    ...V1_DEPRECATED_TOOL,
    description: [
      "Store one or more encrypted KV items for the authenticated client namespace.",
      "COMMON MISTAKE (Searchengine): do NOT save authenticate_agent api_key_envelope (reader-encrypted) as the value without backend decrypt — CNothing cannot unwrap reader keys; later kv_read + Searchengine auth will fail with Failed to decrypt encrypted_key.",
      "CORRECT: backend decrypts reader envelope first, then kv_save stores plaintext JSON { api_key, ... } inside data_envelope, or a ksp1 envelope encrypted to CNothing AuthAI public key.",
    ].join(" "),
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
    ...V1_DEPRECATED_TOOL,
    description: [
      "Read encrypted KV items for the authenticated client namespace. Requires recipient_public_key.",
      "recipient_public_key MUST be the PEM public key of whoever will decrypt the result — for third-party auth (e.g. Searchengine) use THAT service public key (GET /v1/auth/public-key), NOT CNothing AuthAI key and NOT client key unless the client backend consumes the secret.",
      "COMMON MISTAKES: (1) wrong recipient_public_key → third party returns Failed to decrypt encrypted_key; (2) passing entire result_envelope_for_client to Searchengine search as api_key_envelope → Decrypted envelope missing api_key — backend must decrypt result_envelope_for_client and pass items[<key>] inner ksp1 only.",
      "For ksp1-stored credentials each item value is re-encrypted to recipient_public_key; result_envelope_for_client wraps the full result and is also encrypted to recipient_public_key.",
    ].join(" "),
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
            "Required PEM RSA public key of the party that will decrypt the read result. For third-party service auth (e.g. Searchengine search), use that service public key from GET /v1/auth/public-key — NOT get_authai_public_key and NOT client_public_key unless the client backend consumes the credential. Wrong key causes Failed to decrypt encrypted_key at the third party.",
          examples: ["-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"],
        },
      },
      required: ["auth_envelope", "query_envelope", "recipient_public_key"],
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
    uri: MCP_V2_AUTH_WORKFLOW_URI,
    name: "v2 User Authorization & GitHub Sign-In",
    description:
      "REQUIRED READING: How humans sign in with GitHub on cnothing.com and authorize agents. MCP has no GitHub login tool — users open approval_url in a browser.",
    mimeType: "text/markdown",
  },
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
  return [...V25_AGENT_MCP_TOOLS, ...V3_AGENT_MCP_TOOLS];
}

export function listMcpInternalTools(): McpToolDescriptor[] {
  return MCP_TOOLS.filter((tool) => tool.deprecated);
}

const V25_AGENT_MCP_TOOLS: McpToolDescriptor[] = [
  {
    name: "list_capabilities",
    description:
      "List v2.5 capabilities with schemas and authorization status for this agent. Never returns OAuth tokens or invocation secrets.",
    inputSchema: {
      type: "object",
      required: ["agent_access_token"],
      properties: {
        agent_access_token: { type: "string" },
      },
    },
    useCases: ["Discover capabilities and whether this agent already has grants."],
  },
  {
    name: "request_authorization",
    description:
      "Request user approval for a single capability. Returns approval_url for the human browser. Do not pass user_id.",
    inputSchema: {
      type: "object",
      required: ["agent_access_token", "capability"],
      properties: {
        agent_access_token: { type: "string" },
        capability: { type: "string", description: "e.g. github.create_issue" },
        requested_scopes: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
      },
    },
    useCases: ["Start OAuth capability approval before invoke."],
  },
  {
    name: "get_authorization_status",
    description: "Poll authorization status after the user opens approval_url.",
    inputSchema: {
      type: "object",
      required: ["agent_access_token", "authorization_id"],
      properties: {
        agent_access_token: { type: "string" },
        authorization_id: { type: "string" },
      },
    },
    useCases: ["Wait until status becomes approved."],
  },
  {
    name: "invoke_capability",
    description:
      "Invoke an approved v2.5 capability. CNothing uses the user's OAuth connection server-side; agent never receives tokens.",
    inputSchema: {
      type: "object",
      required: ["agent_access_token", "capability"],
      properties: {
        agent_access_token: { type: "string" },
        capability: { type: "string" },
        input: { type: "object" },
        reason: { type: "string" },
        confirmation_id: { type: "string" },
      },
    },
    useCases: ["Execute github.*, google.*, slack.*, notion.* after grant approval."],
  },
  {
    name: "list_grants",
    description: "List capability grants bound to this agent.",
    inputSchema: {
      type: "object",
      required: ["agent_access_token"],
      properties: {
        agent_access_token: { type: "string" },
      },
    },
    useCases: ["Inspect active grants and connection bindings."],
  },
  {
    name: "revoke_grant",
    description: "Revoke a capability grant for this agent.",
    inputSchema: {
      type: "object",
      required: ["agent_access_token", "grant_id"],
      properties: {
        agent_access_token: { type: "string" },
        grant_id: { type: "string" },
      },
    },
    useCases: ["Remove agent access to a capability."],
  },
];

const V3_AGENT_MCP_TOOLS: McpToolDescriptor[] = [
  {
    name: "submit_provider_proposal",
    description:
      "Submit public OAuth/OpenAPI/MCP metadata to register a new provider. CNothing auto-discovers OIDC, validates URLs, and stores secrets in Vault — agent never receives client_secret or tokens.",
    inputSchema: {
      type: "object",
      required: ["agent_access_token", "provider_name"],
      properties: {
        agent_access_token: { type: "string" },
        provider_name: { type: "string" },
        discovery_url: { type: "string" },
        issuer_url: { type: "string" },
        authorization_url: { type: "string" },
        token_url: { type: "string" },
        registration_endpoint: { type: "string" },
        openapi_url: { type: "string" },
        mcp_url: { type: "string" },
        scopes: { type: "array", items: { type: "string" } },
        slug: { type: "string" },
      },
    },
    useCases: ["Auto-register GitHub-like providers without touching secrets."],
  },
  {
    name: "get_provider_proposal",
    description: "Poll provider proposal status after submit_provider_proposal.",
    inputSchema: {
      type: "object",
      required: ["agent_access_token", "proposal_id"],
      properties: {
        agent_access_token: { type: "string" },
        proposal_id: { type: "string" },
      },
    },
    useCases: ["Check whether provider is connectable or needs credential setup."],
  },
  {
    name: "list_providers",
    description: "List public provider metadata (no secrets).",
    inputSchema: {
      type: "object",
      required: ["agent_access_token"],
      properties: {
        agent_access_token: { type: "string" },
      },
    },
    useCases: ["Discover registered OAuth providers."],
  },
];

export function listMcpToolsLegacy(): McpToolDescriptor[] {
  return MCP_TOOLS;
}

export function listMcpResources(): McpResourceDescriptor[] {
  return MCP_RESOURCES;
}

export function readMcpResource(uri: string): { uri: string; mimeType: string; text: string } {
  if (uri === MCP_V2_AUTH_WORKFLOW_URI) {
    return {
      uri,
      mimeType: "text/markdown",
      text: MCP_V2_AUTH_WORKFLOW_MARKDOWN,
    };
  }

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
          v2_auth_workflow_resource: MCP_V2_AUTH_WORKFLOW_URI,
          v2_auth_workflow_markdown_path: "/skills/markdown/cnothing-v2-capabilities/SKILL.md",
          recommended_flow: [
            "READ resource://cnothing/v2-user-authorization — GitHub login is browser-only at approval_url.",
            "MCP request_authorization (omit user_id) → send user approval_url.",
            "User: open link → Sign in with GitHub → Allow capabilities.",
            "Agent: poll GET /v2/authorize/{id} until approved.",
            "MCP invoke_capability (omit user_id when single grant).",
          ],
          github_sign_in: {
            agent_must_not: [
              "Call GET /v2/auth/github/start (browser redirect only)",
              "Ask user for session_token, login_token, or user_id",
              "Use authai_register for user GitHub OAuth",
            ],
            user_must: [
              "Open approval_url in a web browser",
              "Click Sign in with GitHub on the authorize page",
              "Click Allow selected capabilities",
            ],
          },
          v1_legacy_flow: [
            "Deprecated: /v1/authai/register → kv.save/kv.read envelope flow.",
            "Migration guide: GET /v2/platform/migration",
          ],
          demo_paths: {
            homepage: "/",
            authorize_example: "/authorize/{authorization_request_id}",
            skills_index: "/skills/index.json",
            openapi_v2: "/openapi-v2.json",
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
        primary: "v2-capability-platform",
        v2_auth_workflow: MCP_V2_AUTH_WORKFLOW_URI,
        v2_endpoints: {
          invoke: "POST /v2/capabilities/invoke",
          authorize_request: "POST /v2/authorize/request",
          authorize_status: "GET /v2/authorize/{id}",
          capabilities: "GET /v2/capabilities",
          openapi: "/openapi-v2.json",
        },
        user_github_sign_in:
          "Browser only at https://cnothing.com/authorize/{id} — NOT via MCP tools. See v2_auth_workflow resource.",
        protocol_v1_legacy: "authai-kv",
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
