export type StandardSection = {
  id: string;
  title: string;
  summary: string;
  paragraphs?: string[];
  bullets?: string[];
  code?: string;
  children?: StandardSection[];
};

export type StandardPublication = {
  id: string;
  family: string;
  title: string;
  shortTitle: string;
  status: string;
  version: string;
  publishedAt: string;
  canonicalPath: string;
  intro: string;
  sections: StandardSection[];
};

export const authStandard: StandardPublication = {
  id: "authentication-1.0",
  family: "Authentication",
  title: "CNothing Authentication Standard 1.0",
  shortTitle: "Auth Standard",
  status: "Public Implementation Profile",
  version: "1.0",
  publishedAt: "2026-04-05",
  canonicalPath: "/standards/authentication/1.0",
  intro:
    "This standard defines the authentication and operation-authorization rules used by CNothing for challenge-based client identity, envelope submission, replay prevention, and key rotation.",
  sections: [
    {
      id: "scope",
      title: "1. Scope and Objectives",
      summary: "Defines what this standard covers and what it intentionally leaves outside scope.",
      paragraphs: [
        "This standard specifies how a client backend authenticates to CNothing, how a one-time challenge is issued and consumed, how subsequent operations are bound to a validated identity, and how a client rotates its public key without changing its logical client identity.",
        "The standard is designed for environments in which an AI agent may orchestrate requests but must never obtain the client's private key or decrypt authenticated envelopes.",
        "This standard governs authentication, replay resistance, operation binding, and authenticated key rotation. It does not define the third party's inner application encryption model for payload confidentiality beyond the CNothing transport envelopes.",
      ],
      bullets: [
        "The standard applies to registration, challenge refresh, key rotation, KV save authorization, and KV read authorization.",
        "The standard assumes the client private key remains under exclusive control of the client backend.",
        "The standard assumes CNothing holds the server-side AuthAI private key used to decrypt submitted envelopes.",
      ],
    },
    {
      id: "conformance",
      title: "2. Conformance Language",
      summary: "Uses normative keywords in the RFC 2119 and RFC 8174 sense.",
      paragraphs: [
        "The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, NOT RECOMMENDED, MAY, and OPTIONAL in this document are to be interpreted as described in RFC 2119 and RFC 8174 when, and only when, they appear in all capitals.",
      ],
      bullets: [
        "A conforming CNothing server MUST implement every REQUIRED validation rule in this document.",
        "A conforming client implementation MUST preserve private-key custody and MUST NOT delegate envelope decryption to an AI intermediary.",
        "A conforming integrator SHOULD separately protect application-level payload meaning when namespace, key names, metadata, or values are sensitive.",
      ],
    },
    {
      id: "roles",
      title: "3. Roles, Trust Boundaries, and Threat Model",
      summary: "Defines system actors and the minimum trust separation expected by the protocol.",
      children: [
        {
          id: "roles-actors",
          title: "3.1 System Roles",
          summary: "Identifies the actors participating in the protocol.",
          bullets: [
            "Client Backend: the third-party server that owns the client private key and performs local challenge decryption.",
            "CNothing Server: the server that publishes the AuthAI public key, validates envelopes, enforces challenge semantics, and executes authorized operations.",
            "AI Orchestrator: an optional intermediary that may forward ciphertext envelopes and non-sensitive metadata but MUST NOT possess client private keys or decrypted challenge content.",
            "Data Store: the persistence layer used by CNothing for client records, challenges, and encrypted KV records.",
          ],
        },
        {
          id: "roles-boundaries",
          title: "3.2 Trust Boundaries",
          summary: "States what each actor may and may not learn.",
          bullets: [
            "The client backend MUST be the only actor that can decrypt `challenge_for_client`.",
            "CNothing MUST be the only actor that can decrypt `auth_envelope`, `data_envelope`, and `query_envelope`.",
            "The AI orchestrator MAY relay encrypted envelopes but MUST be treated as unable to access plaintext challenge material or client private keys.",
            "Replay by an intermediary or a network attacker MUST be rejected through one-time challenge semantics.",
          ],
        },
        {
          id: "roles-threats",
          title: "3.3 Threat Model",
          summary: "Lists the principal threats addressed by the standard.",
          bullets: [
            "Credential replay after a valid request is submitted.",
            "Envelope tampering or substitution across different operations.",
            "A stale challenge being reused after its intended lifetime.",
            "A client attempting to rotate to a public key already bound to another client identity.",
          ],
        },
      ],
    },
    {
      id: "crypto-profile",
      title: "4. Cryptographic Profile and Identifiers",
      summary: "Defines the envelope profile, identifiers, and versioning expected by conforming implementations.",
      paragraphs: [
        "All protocol envelopes in this version of the standard use version identifier `ksp1`, key agreement profile `RSA-OAEP-256`, and content encryption `A256GCM`.",
      ],
      bullets: [
        "Envelope version MUST be `ksp1`.",
        "Client key algorithm identifier MUST be `RSA-OAEP-256/A256GCM` unless a future profile is explicitly negotiated.",
        "Client identities MUST be represented by a stable `client_uuid` assigned by CNothing.",
        "Public keys MUST be fingerprinted using a SHA-256 based fingerprint derived from the normalized public key representation.",
      ],
      code: `{
  "v": "ksp1",
  "alg": "RSA-OAEP-256",
  "enc": "A256GCM",
  "key_id": "optional-key-id",
  "encrypted_key": "base64url",
  "iv": "base64url",
  "ciphertext": "base64url",
  "tag": "base64url",
  "aad": "optional-base64url"
}`,
    },
    {
      id: "registration",
      title: "5. Client Registration",
      summary: "Defines how a client is registered or re-associated with a previously known public key.",
      paragraphs: [
        "Registration creates or reuses a logical client record and returns a one-time challenge encrypted to the submitted client public key. The challenge is the only valid starting point for authenticated operations.",
      ],
      bullets: [
        "The client public key MUST be submitted in PEM form.",
        "CNothing MUST normalize and validate the public key before fingerprinting it.",
        "If the fingerprint already exists, CNothing MAY reuse the existing client identity associated with that fingerprint.",
        "A successful registration MUST return the CNothing AuthAI public key, a `client_uuid`, a `challenge_id`, and a `challenge_for_client` envelope.",
      ],
      code: `POST /v1/authai/register

{
  "client_public_key": "-----BEGIN PUBLIC KEY----- ...",
  "client_key_alg": "RSA-OAEP-256/A256GCM",
  "client_key_id": "optional-key-id",
  "client_label": "optional label",
  "metadata": {}
}`,
      children: [
        {
          id: "registration-challenge",
          title: "5.1 Challenge Issuance",
          summary: "Specifies the challenge object returned after registration.",
          bullets: [
            "The challenge MUST be bound to the returned `client_uuid`.",
            "The challenge MUST contain a server-generated nonce.",
            "The challenge MUST include `issued_at` and `expires_at` timestamps.",
            "The challenge MUST be encrypted to the client's submitted public key.",
          ],
          code: `{
  "v": "ksp1",
  "type": "challenge",
  "purpose": "authai.operation",
  "client_uuid": "uuid",
  "challenge_id": "uuid",
  "nonce": "base64url-32-bytes",
  "issued_at": "2026-04-05T12:00:00.000Z",
  "expires_at": "2026-04-05T12:05:00.000Z"
}`,
        },
      ],
    },
    {
      id: "challenge-lifecycle",
      title: "6. Challenge Lifecycle",
      summary: "Defines the validity and revocation state machine for one-time challenges.",
      bullets: [
        "Every active challenge MUST be short-lived and single-use.",
        "A challenge MUST be rejected if it is expired, unknown, already used, revoked, or bound to a different client.",
        "When CNothing issues a new active operation challenge for a client, other active operation challenges for that client SHOULD be revoked.",
        "Consuming a valid challenge MUST transition its server-side status from active to used before the requested operation is accepted as successful.",
      ],
      children: [
        {
          id: "challenge-refresh",
          title: "6.1 Challenge Refresh",
          summary: "Allows a client with a valid authentication envelope to receive a new operation challenge.",
          bullets: [
            "Refresh MUST require a valid `auth_envelope` with action `authai.refresh`.",
            "A successful refresh MUST return the next challenge encrypted to the currently active client public key.",
            "The returned challenge MUST become the client's next active challenge for subsequent operations.",
          ],
        },
      ],
    },
    {
      id: "auth-envelope",
      title: "7. Authentication Envelope Validation",
      summary: "Defines the canonical authentication payload and the required validation sequence.",
      paragraphs: [
        "The authentication envelope binds a validated challenge to a specific action and request identifier. It is the mandatory gate for every operation after registration.",
      ],
      code: `{
  "v": "ksp1",
  "type": "auth",
  "action": "kv.save",
  "client_uuid": "uuid",
  "challenge_id": "uuid",
  "nonce": "base64url-32-bytes",
  "issued_at": "2026-04-05T12:00:00.000Z",
  "expires_at": "2026-04-05T12:05:00.000Z",
  "request_id": "uuid"
}`,
      bullets: [
        "CNothing MUST decrypt the submitted authentication envelope with the server-side AuthAI private key.",
        "The payload version MUST equal `ksp1` and the payload type MUST equal `auth`.",
        "The payload action MUST exactly match the endpoint being executed.",
        "The `client_uuid` in the envelope MUST identify an existing registered client.",
        "The `challenge_id` MUST reference an active challenge bound to that client.",
        "The SHA-256 fingerprint of the submitted nonce MUST match the stored nonce hash.",
        "The challenge MUST be marked used before the operation completes successfully.",
      ],
      children: [
        {
          id: "auth-action-binding",
          title: "7.1 Action Binding",
          summary: "Prevents a challenge validated for one action from authorizing another.",
          bullets: [
            "The accepted actions in this version are `authai.refresh`, `authai.rotate_key`, `kv.save`, and `kv.read`.",
            "A server MUST reject any envelope whose action does not match the requested endpoint semantic.",
            "An implementation SHOULD treat action mismatch as a protocol validation failure, not as an authorization downgrade.",
          ],
        },
      ],
    },
    {
      id: "operations",
      title: "8. Authorized Operations",
      summary: "Defines how authenticated operations are paired with operation-specific encrypted payloads.",
      children: [
        {
          id: "operations-save",
          title: "8.1 Authorized Save",
          summary: "Persists one or more KV items after authentication succeeds.",
          bullets: [
            "The server MUST require both `auth_envelope` and `data_envelope`.",
            "The authentication action MUST be `kv.save`.",
            "The data envelope plaintext MUST declare type `kv.save` and include one normalized namespace plus one or more items.",
            "On success, CNothing MUST return a new challenge for the same client.",
          ],
          code: `POST /v1/kv/save

{
  "auth_envelope": { "...": "..." },
  "data_envelope": {
    "v": "ksp1",
    "type": "kv.save",
    "namespace": "thirdparty.example.prod",
    "items": [
      {
        "key": "user/123/profile-token",
        "value": { "access_token": "..." },
        "metadata": {}
      }
    ]
  }
}`,
        },
        {
          id: "operations-read",
          title: "8.2 Authorized Read",
          summary: "Reads one or more KV items and returns the result encrypted to the client.",
          bullets: [
            "The server MUST require both `auth_envelope` and `query_envelope`.",
            "The authentication action MUST be `kv.read`.",
            "The query envelope plaintext MUST declare type `kv.read` and include one normalized namespace plus one or more keys.",
            "The read result MUST be encrypted to the client's active public key before being returned.",
            "On success, CNothing MUST issue the next challenge for the same client identity.",
          ],
          code: `POST /v1/kv/read

{
  "auth_envelope": { "...": "..." },
  "query_envelope": {
    "v": "ksp1",
    "type": "kv.read",
    "namespace": "thirdparty.example.prod",
    "keys": ["user/123/profile-token"]
  }
}`,
        },
      ],
    },
    {
      id: "rotation",
      title: "9. Authenticated Key Rotation",
      summary: "Defines how a client rotates to a new public key without changing its logical client identity.",
      paragraphs: [
        "Key rotation is an authenticated mutation of an existing client identity. Rotation is not the same as new-client registration and MUST preserve `client_uuid` continuity for the rotated client.",
      ],
      bullets: [
        "The request MUST be authenticated with a valid envelope built from the currently active key material.",
        "The requested new public key MUST be normalized and fingerprinted before acceptance.",
        "The server MUST reject rotation if the new fingerprint is already bound to a different client identity.",
        "A successful rotation MUST update the client's active public key binding in place.",
        "After rotation, newly issued challenges MUST be encrypted to the new client public key.",
      ],
      code: `POST /v1/authai/rotate-key

{
  "auth_envelope": { "...": "..." },
  "new_client_public_key": "-----BEGIN PUBLIC KEY----- ...",
  "new_client_key_alg": "RSA-OAEP-256/A256GCM",
  "new_client_key_id": "optional-next-key-id",
  "new_client_label": "optional label",
  "metadata": {}
}`,
      children: [
        {
          id: "rotation-semantics",
          title: "9.1 Rotation Semantics",
          summary: "Clarifies the exact post-rotation server behavior.",
          bullets: [
            "The logical `client_uuid` MUST remain unchanged.",
            "Existing active operation challenges from the prior key generation MUST NOT remain valid for future authenticated use.",
            "The server SHOULD append an auditable rotation record containing old and new public-key fingerprints.",
            "The rotation response MUST include a next challenge encrypted to the new public key.",
          ],
        },
      ],
    },
    {
      id: "errors",
      title: "10. Error Semantics",
      summary: "Defines the minimum interoperable error categories exposed by the implementation profile.",
      bullets: [
        "`missing_field` for absent required input members.",
        "`invalid_field` for syntactically malformed or semantically invalid input members.",
        "`invalid_public_key` for client key material that fails normalization or parsing.",
        "`invalid_auth_envelope` for unreadable or structurally invalid authentication envelopes.",
        "`challenge_not_found` when the referenced challenge does not exist or is not bound to the client.",
        "`challenge_expired` when the challenge lifetime has elapsed.",
        "`challenge_already_used` when the challenge is no longer active.",
        "`challenge_nonce_mismatch` when the envelope nonce does not match the stored nonce hash.",
        "`challenge_purpose_mismatch` when the requested action does not match the envelope semantics.",
        "`public_key_already_registered` when a rotation attempts to reuse another client's public key.",
        "`payload_invalid` for operation-specific payloads that do not satisfy structural rules.",
      ],
    },
    {
      id: "security",
      title: "11. Security and Operational Requirements",
      summary: "Captures the non-negotiable operational practices required for safe deployment.",
      bullets: [
        "Client private keys MUST remain outside AI-visible memory, prompts, tool outputs, and logs.",
        "Servers MUST use a consistent trusted clock source when evaluating challenge expiry.",
        "Server implementations SHOULD record auditable registration, refresh, rotation, save, and read events.",
        "Operators SHOULD keep server private keys and master keys outside code-synchronized directories.",
        "Integrators SHOULD use an additional client-side confidentiality layer when CNothing operators must not see namespaces, keys, metadata, or values.",
      ],
    },
    {
      id: "checklist",
      title: "12. Conformance Checklist",
      summary: "Provides an implementation checklist for independent adopters.",
      bullets: [
        "Publishes the CNothing AuthAI public key over an authenticated channel.",
        "Accepts client registration and returns an encrypted one-time challenge.",
        "Requires a valid action-bound authentication envelope for refresh, rotation, save, and read.",
        "Marks challenges single-use and rejects replay.",
        "Issues a new challenge after each successful authenticated operation.",
        "Encrypts read results to the active client public key.",
        "Supports in-place authenticated key rotation with auditability.",
        "Returns interoperable error codes for failed validation conditions.",
      ],
    },
  ],
};

export const registrationHubStandard: StandardPublication = {
  id: "registration-hub-1.0",
  family: "AI Registration Hub",
  title: "CNothing AI Registration Hub Standard 1.0",
  shortTitle: "Registration Hub",
  status: "Public Architecture Standard",
  version: "1.0",
  publishedAt: "2026-04-06",
  canonicalPath: "/standards/registration-hub",
  intro:
    "This standard defines how CNothing is used as the authentication, credential-protection, and recovery center of an AI-operated website registration system in which agents can orchestrate signup flows without learning user secrets.",
  sections: [
    {
      id: "registration-hub-scope",
      title: "1. Scope and Purpose",
      summary: "Defines the architecture problem this standard solves for AI-operated signup systems.",
      paragraphs: [
        "This standard specifies how CNothing participates in an AI-driven website registration system as the central trust service for client identity, protected onboarding data, issued credentials, and recovery-safe state transitions.",
        "The purpose of the architecture is to let an AI agent coordinate user registration on third-party sites without exposing the user's raw secrets, recovery materials, or issued credentials to the AI orchestration layer.",
      ],
      bullets: [
        "The standard covers registration profiles, workflow orchestration boundaries, secret retrieval, credential write-back, and post-registration lifecycle handling.",
        "The standard does not replace browser automation, email handling, SMS handling, or anti-bot execution environments.",
      ],
    },
    {
      id: "registration-hub-roles",
      title: "2. Roles and Trust Boundaries",
      summary: "Defines the actors in the registration hub model and what each actor may learn.",
      bullets: [
        "User: the account owner whose onboarding profile, recovery data, and resulting credentials are being managed.",
        "Third-Party Integrator: the backend system that owns the CNothing client private key and decides which registration workflows are allowed to run.",
        "CNothing: the trust center that authenticates client requests, stores protected records, and returns encrypted data only to the authorized client backend.",
        "AI Agent: the orchestration layer that may decide next actions, navigate forms, and request protected records through CNothing-mediated flows, but MUST NOT possess decryptable user secrets.",
        "Execution Workers: browser, email, or verification workers that perform concrete actions under the policy decisions of the integrator.",
      ],
    },
    {
      id: "registration-hub-value",
      title: "3. Why CNothing Sits at the Center",
      summary: "Explains the operational value of CNothing in a registration control plane.",
      bullets: [
        "CNothing gives the integrator a single protected place to register client identity, rotate keys, and bind every sensitive action to one-time challenge validation.",
        "CNothing lets AI agents request signup data without receiving long-lived plaintext secrets when the integrator uses private or blind record storage.",
        "CNothing centralizes post-registration credential storage so subsequent login, token refresh, and recovery operations can reuse the same protocol boundary.",
        "CNothing makes registration automation auditable because registration, refresh, read, save, and key-rotation events all pass through a common authenticated service contract.",
      ],
    },
    {
      id: "registration-hub-model",
      title: "4. Canonical Data Model",
      summary: "Defines the minimum logical objects expected in a conforming deployment.",
      children: [
        {
          id: "registration-hub-profile",
          title: "4.1 Registration Profile",
          summary: "Represents the user-supplied onboarding material needed to complete signup.",
          bullets: [
            "A registration profile SHOULD include the intended target site identifier, account identity hints, preferred channel bindings, and any required human-supplied enrollment fields.",
            "Sensitive fields such as passwords, recovery answers, API keys, or invite tokens SHOULD be stored using `savePrivateJson()` or `saveBlindJson()`.",
          ],
        },
        {
          id: "registration-hub-target",
          title: "4.2 Signup Target",
          summary: "Represents the external website or application being registered.",
          bullets: [
            "A signup target SHOULD describe the registration entrypoint, required fields, expected verification channels, and any site-specific policy flags.",
            "A signup target MAY include reusable automation hints for browser or agent workers, but MUST NOT include user private key material.",
          ],
        },
        {
          id: "registration-hub-credential-bundle",
          title: "4.3 Credential Bundle",
          summary: "Represents the result of a successful registration flow.",
          bullets: [
            "A credential bundle SHOULD contain the issued username, email binding, password reference, recovery artifacts, API credentials, and session bootstrap material relevant to the target system.",
            "Credential bundles SHOULD be written back to CNothing immediately after successful registration so the integrator can continue lifecycle operations without replaying signup.",
          ],
        },
      ],
    },
    {
      id: "registration-hub-flow",
      title: "5. End-to-End Workflow",
      summary: "Specifies the recommended end-to-end orchestration flow for AI-assisted registration.",
      code: `1. Third-party backend registers or refreshes its CNothing client identity.
2. Backend stores onboarding records in CNothing using blind or private mode.
3. AI agent begins a signup run against a third-party website.
4. When sensitive fields are needed, the agent requests the backend to fetch the protected record through CNothing.
5. The backend decrypts the CNothing response locally and returns only the minimum next-step data to the execution worker.
6. Verification artifacts and issued credentials are written back to CNothing after each milestone.
7. Final credential bundle is sealed and retained for future login, recovery, or rotation flows.`,
      bullets: [
        "The AI layer SHOULD receive only the minimum action-scoped data required to complete the current step.",
        "A conforming deployment SHOULD treat email codes, SMS codes, CAPTCHAs, and recovery paths as separate worker concerns, not as direct CNothing protocol features.",
      ],
    },
    {
      id: "registration-hub-patterns",
      title: "6. Recommended Storage Patterns",
      summary: "Defines how integrators should map onboarding artifacts into CNothing records.",
      bullets: [
        "Use separate namespaces for signup profiles, active runs, credential bundles, and recovery records.",
        "Use `saveBlindJson()` for namespaces, keys, metadata, and values that should remain opaque to CNothing operators.",
        "Use `savePrivateJson()` when only the value and metadata need to be hidden from CNothing operators while namespace and key names remain operationally visible.",
        "Store run-local state independently from long-lived credentials so a failed workflow does not force credential record churn.",
      ],
    },
    {
      id: "registration-hub-agent-contract",
      title: "7. AI Agent Contract",
      summary: "Defines how the AI orchestration layer participates without becoming a secret holder.",
      bullets: [
        "The AI agent MAY decide which workflow step should execute next.",
        "The AI agent MAY request that the third-party backend fetch protected records from CNothing.",
        "The AI agent MUST NOT be treated as a holder of client private keys, recovery bundles, or reusable login credentials.",
        "The AI agent SHOULD receive redacted or step-scoped values instead of full credential bundles whenever possible.",
      ],
    },
    {
      id: "registration-hub-lifecycle",
      title: "8. Post-Registration Lifecycle",
      summary: "Defines how CNothing continues to serve after account creation succeeds.",
      bullets: [
        "The same CNothing client identity SHOULD be reused for subsequent login, password rotation, token refresh, and recovery workflows.",
        "Key rotation SHOULD be performed through the authenticated `rotateKey()` workflow instead of registering a replacement client identity.",
        "Integrators SHOULD preserve a durable mapping between their local user identity and the CNothing record set that stores the resulting credentials.",
      ],
    },
    {
      id: "registration-hub-security",
      title: "9. Security Requirements",
      summary: "Captures the minimum security posture required for a conforming registration hub deployment.",
      bullets: [
        "Client private keys MUST remain under third-party backend control only.",
        "Blind mode SHOULD be the default for values whose names, metadata, and payloads are all sensitive.",
        "Execution logs SHOULD avoid storing raw user passwords, recovery codes, or decrypted credential bundles.",
        "Workers that touch verification channels SHOULD operate with the least privilege required for the current step.",
        "The integrator SHOULD maintain explicit operator approval or policy rules before an AI agent can initiate a new third-party signup run.",
      ],
    },
    {
      id: "registration-hub-conformance",
      title: "10. Conformance Checklist",
      summary: "Provides a quick checklist for independent implementers.",
      bullets: [
        "Uses CNothing as the authenticated storage and retrieval boundary for signup-sensitive records.",
        "Keeps the client private key outside the AI orchestration layer.",
        "Stores onboarding secrets and resulting credentials in private or blind mode.",
        "Writes back issued credentials and recovery artifacts immediately after each successful step.",
        "Separates browser, email, SMS, and recovery workers from CNothing protocol responsibilities.",
        "Uses authenticated key rotation instead of replacing client identities when key material changes.",
      ],
    },
  ],
};

function toPublishedStandard(standard: StandardPublication) {
  return {
    id: standard.id,
    family: standard.family,
    title: standard.title,
    version: standard.version,
    status: standard.status,
    publishedAt: standard.publishedAt,
    canonicalPath: standard.canonicalPath,
    summary: standard.intro,
    exports: {
      markdown: `${standard.canonicalPath}/markdown`,
      html: `${standard.canonicalPath}/html`,
    },
  };
}

export const publishedStandards = [
  toPublishedStandard(authStandard),
  toPublishedStandard(registrationHubStandard),
] as const;

export function renderAuthStandardMarkdown(): string {
  return renderStandardMarkdown(authStandard);
}

export function renderAuthStandardHtmlDocument(): string {
  return renderStandardHtmlDocument(authStandard);
}

export function renderRegistrationHubStandardMarkdown(): string {
  return renderStandardMarkdown(registrationHubStandard);
}

export function renderRegistrationHubStandardHtmlDocument(): string {
  return renderStandardHtmlDocument(registrationHubStandard);
}

export function renderStandardMarkdown(standard: StandardPublication): string {
  const lines: string[] = [
    `# ${standard.title}`,
    "",
    `Status: ${standard.status}`,
    `Published: ${standard.publishedAt}`,
    `Canonical Path: ${standard.canonicalPath}`,
    "",
    standard.intro,
    "",
  ];

  for (const section of standard.sections) {
    appendSectionMarkdown(lines, section, 2);
  }

  return lines.join("\n");
}

export function renderStandardHtmlDocument(standard: StandardPublication): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(standard.title)}</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        padding: 40px 24px 80px;
        background: #f6f7fb;
        color: #0f172a;
        font: 16px/1.7 "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
      }
      main {
        max-width: 920px;
        margin: 0 auto;
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 28px;
        padding: 40px;
        box-shadow: 0 24px 70px rgba(15, 23, 42, 0.08);
      }
      h1, h2, h3, h4 { line-height: 1.2; margin: 1.6em 0 0.6em; }
      h1 { margin-top: 0; font-size: 2.4rem; }
      h2 { font-size: 1.55rem; }
      h3 { font-size: 1.2rem; }
      h4 { font-size: 1rem; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; }
      p, li { color: #334155; }
      pre {
        overflow: auto;
        padding: 16px;
        border-radius: 20px;
        background: #020617;
        color: #e2e8f0;
        font: 13px/1.65 "SF Mono", Menlo, monospace;
      }
      ul { padding-left: 1.4rem; }
      section.section {
        border-top: 1px solid #e2e8f0;
        margin-top: 24px;
        padding-top: 24px;
      }
      .summary {
        color: #64748b;
        font-size: 0.95rem;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(standard.title)}</h1>
      <p><strong>Status:</strong> ${escapeHtml(standard.status)}</p>
      <p><strong>Published:</strong> ${escapeHtml(standard.publishedAt)}</p>
      <p><strong>Canonical Path:</strong> ${escapeHtml(standard.canonicalPath)}</p>
      <p>${escapeHtml(standard.intro)}</p>
${standard.sections.map((section) => renderSectionHtml(section, 2)).join("\n")}
    </main>
  </body>
</html>`;
}

function appendSectionMarkdown(lines: string[], section: StandardSection, level: number) {
  lines.push(`${"#".repeat(level)} ${section.title}`);
  lines.push("");
  lines.push(section.summary);
  lines.push("");

  for (const paragraph of section.paragraphs ?? []) {
    lines.push(paragraph);
    lines.push("");
  }

  if (section.bullets?.length) {
    for (const bullet of section.bullets) {
      lines.push(`- ${bullet}`);
    }
    lines.push("");
  }

  if (section.code) {
    lines.push("```text");
    lines.push(section.code);
    lines.push("```");
    lines.push("");
  }

  for (const child of section.children ?? []) {
    appendSectionMarkdown(lines, child, Math.min(level + 1, 4));
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderSectionHtml(section: StandardSection, level: number): string {
  const headingTag = `h${Math.min(level, 4)}`;
  const paragraphs = (section.paragraphs ?? [])
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("\n");
  const bullets = section.bullets?.length
    ? `<ul>${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>`
    : "";
  const code = section.code
    ? `<pre><code>${escapeHtml(section.code)}</code></pre>`
    : "";
  const children = (section.children ?? [])
    .map((child) => renderSectionHtml(child, level + 1))
    .join("\n");

  return `<section class="section" id="${escapeHtml(section.id)}">
    <${headingTag}>${escapeHtml(section.title)}</${headingTag}>
    <p class="summary">${escapeHtml(section.summary)}</p>
    ${paragraphs}
    ${bullets}
    ${code}
    ${children}
  </section>`;
}
