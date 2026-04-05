export type StandardSection = {
  id: string;
  title: string;
  summary: string;
  paragraphs?: string[];
  bullets?: string[];
  code?: string;
  children?: StandardSection[];
};

export const authStandard = {
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
  ] satisfies StandardSection[],
};

export const publishedStandards = [
  {
    id: "authentication-1.0",
    family: "Authentication",
    title: authStandard.title,
    version: authStandard.version,
    status: authStandard.status,
    publishedAt: authStandard.publishedAt,
    canonicalPath: authStandard.canonicalPath,
    summary: authStandard.intro,
    exports: {
      markdown: `${authStandard.canonicalPath}/markdown`,
      html: `${authStandard.canonicalPath}/html`,
    },
  },
] as const;

export function renderAuthStandardMarkdown(): string {
  const lines: string[] = [
    `# ${authStandard.title}`,
    "",
    `Status: ${authStandard.status}`,
    `Published: ${authStandard.publishedAt}`,
    `Canonical Path: ${authStandard.canonicalPath}`,
    "",
    authStandard.intro,
    "",
  ];

  for (const section of authStandard.sections) {
    appendSectionMarkdown(lines, section, 2);
  }

  return lines.join("\n");
}

export function renderAuthStandardHtmlDocument(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(authStandard.title)}</title>
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
      <h1>${escapeHtml(authStandard.title)}</h1>
      <p><strong>Status:</strong> ${escapeHtml(authStandard.status)}</p>
      <p><strong>Published:</strong> ${escapeHtml(authStandard.publishedAt)}</p>
      <p><strong>Canonical Path:</strong> ${escapeHtml(authStandard.canonicalPath)}</p>
      <p>${escapeHtml(authStandard.intro)}</p>
${authStandard.sections.map((section) => renderSectionHtml(section, 2)).join("\n")}
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
