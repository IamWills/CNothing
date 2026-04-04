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

## Save

Use `kv_save` only when you already have:

- `auth_envelope`
- `data_envelope`

Do not inspect the payload contents.

## Read

Use `kv_read` only when you already have:

- `auth_envelope`
- `query_envelope`

The response includes `result_envelope_for_client`, which must go back to the client backend for decryption.

## When To Read More

- Read [protocol.md](../../docs/protocol.md) when you need exact request/response field meanings.
- Read [mcp.md](../../docs/mcp.md) when wiring the service into an MCP-capable agent or host.
