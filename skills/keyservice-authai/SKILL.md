---
name: keyservice-authai
description: Use when an AI needs to register a client public key with keyservice, forward one-time challenges and encrypted auth/data/query envelopes, or safely read and write KV values without touching plaintext secrets.
---

# KeyService AuthAI

Use this skill when working with the `keyservice` repository root.

## Rules

- Never ask for or handle a client private key.
- Treat `challenge_for_client`, `auth_envelope`, `data_envelope`, `query_envelope`, and `result_envelope_for_client` as opaque ciphertext.
- Assume the client backend is the only trusted place that can decrypt client-directed envelopes.
- Prefer MCP tools when available; otherwise call the HTTP endpoints directly.

## Workflow

1. Get the authai public key from `get_authai_public_key` or `GET /v1/authai/public-key`.
2. Register the client public key with `authai_register` or `POST /v1/authai/register`.
3. Hand `challenge_for_client` to the client backend.
4. Wait for the backend to return:
   - `auth_envelope`
   - `data_envelope` for save, or `query_envelope` for read
5. Forward those envelopes with `kv_save` or `kv_read`.
6. Return `next_challenge_for_client` to the backend for the next operation.

## Third-Party Credential Flow (CNothing as Secret Store)

CNothing stores third-party API keys and tokens. Do not mix up the three public keys:

| Key | When to use |
| --- | --- |
| **CNothing AuthAI public key** | Encrypt protocol envelopes to CNothing; **give this to third parties** when they issue an API key encrypted for CNothing |
| **Client public key** | Register with `authai_register`; decrypt `challenge_for_client`; use as `recipient_public_key` only when the **client backend** consumes the secret |
| **Third-party service public key** | Use as `recipient_public_key` on `kv_read` when the **third-party service** must decrypt the API key for auth |

### Store a third-party API key

1. After CNothing registration, you already have the **CNothing AuthAI public key**.
2. When registering with a third party, provide the **CNothing AuthAI public key** (not the client public key).
3. The third party returns an API key ciphertext encrypted to CNothing.
4. Have the backend build `kv.save` envelopes and store the ciphertext with the third-party identifier (`namespace` / `key`). The stored `value` may be the full third-party `ksp1` api_key_envelope (encrypted to CNothing AuthAI public key).
5. CNothing decrypts the envelope's `encrypted_key`, unwraps the AES key, and persists the credential for later reads.

### Use a third-party API

1. Identify the third-party identifier and its **service public key**.
2. Have the backend build `kv_read` envelopes; set `recipient_public_key` to the **third-party service public key**.
3. Forward the read request; return `result_envelope_for_client` ciphertext to the third-party service. For ksp1-stored credentials, each item in the decrypted result is a **new ksp1 envelope** re-encrypted to the recipient—not plaintext.
4. The third party decrypts with its own private key and completes authentication.

**Never:** give third parties the client public key for credential delivery; use CNothing or client keys as `recipient_public_key` when the consumer is the third-party service; decrypt envelopes or API keys yourself.

## Save

Use `kv_save` only when you already have:

- `auth_envelope`
- `data_envelope`

Do not inspect the payload contents.

## Read

Use `kv_read` only when you already have:

- `auth_envelope`
- `query_envelope`
- `recipient_public_key` (PEM RSA public key of the reader; required so the server encrypts the result before AI sees it)

The response includes `result_envelope_for_client`, which must go back to the client backend for decryption.

## When To Read More

- Read [protocol.md](../../docs/protocol.md) when you need exact request/response field meanings.
- Read [mcp.md](../../docs/mcp.md) when wiring the service into an MCP-capable agent or host.
