---
name: cnothing-getting-started
description: Use when an AI or developer is integrating with CNothing for the first time and needs a safe quick start, public discovery links, and a minimal demo flow without handling plaintext secrets.
---

# CNothing Getting Started

Use this skill when you are new to CNothing and need the shortest safe path to a working integration.

## Discovery Links

- MCP info: `/mcp`
- MCP manifest: `/mcp/manifest`
- MCP discovery: `/.well-known/mcp`
- Skills index: `/skills/index.json`
- Primary skill: `/skill.md`
- Getting started: `/getting-started.md`

## Rules

- Never ask for or handle a client private key.
- Only the trusted backend may decrypt `challenge_for_client` or `result_envelope_for_client`.
- Treat all envelopes as opaque ciphertext.
- Prefer private mode or blind mode when third-party application data is sensitive.

## Minimal Flow

1. Fetch the AuthAI public key from `/v1/authai/public-key`.
2. Generate a backend keypair locally.
3. Register the backend public key with `/v1/authai/register`.
4. Hand `challenge_for_client` to the trusted backend only.
5. Have the backend return `auth_envelope` and `data_envelope` or `query_envelope`.
6. Forward those envelopes with `kv.save` or `kv.read`.
7. Return `next_challenge_for_client` or `result_envelope_for_client` to the backend.

## Demo Mode

Use demo mode when you want to validate that routing and discovery work before real secrets are involved.

- Browse `/skills/index.json` to locate skills and markdown URLs.
- Browse `/standards/authentication/1.0` for the protocol contract.
- Browse `/standards/registration-hub` for the AI website registration architecture.
- Use synthetic test data only, and never use a production private key or real credentials.

## Read More

- Read [protocol.md](../../docs/protocol.md) for the envelope protocol.
- Read [mcp.md](../../docs/mcp.md) for MCP integration details.
