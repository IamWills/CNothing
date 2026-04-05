# CNothing

For Chinese documentation, see [README.CN.MD](./README.CN.MD).

`CNothing` is a production-oriented `AuthAI + Encrypted KV` service for AI automation systems that need to use secrets without exposing plaintext to the model.

It is designed for a specific problem: an AI agent needs to help orchestrate work, choose tools, and route requests, but the sensitive values used by that workflow must stay inside a trusted backend boundary. CNothing gives you a way to let the AI participate in the flow while keeping private keys and decrypted secrets out of the model.

## Why CNothing

CNothing is valuable when you want all of the following at the same time:

- The AI can coordinate a workflow that depends on secrets
- The AI never sees secret plaintext
- The client backend remains the trust boundary because it holds the private key
- Secret reads and writes can still be standardized through HTTP, MCP, and Skill interfaces
- Stored data remains encrypted at rest with per-record envelope encryption

In practice, CNothing sits between an AI-facing orchestration layer and a backend that is allowed to handle cryptographic material. The model can discover available capabilities, forward ciphertext envelopes, and work with non-sensitive routing metadata, while the backend performs decryption and signing-sensitive operations.

GitHub repository:

- [https://github.com/IamWills/CNothing](https://github.com/IamWills/CNothing)

## When To Use It

CNothing is a strong fit when:

- You are building AI agents or copilots that need to trigger authenticated integrations
- You want AI to drive flow control, but not directly hold API tokens, access tokens, or user secrets
- You need a reusable secret-access protocol instead of one custom backend adapter per tool
- You want both human operators and AI systems to browse capabilities through a shared control plane

CNothing is probably not the right primary abstraction when:

- AI is not involved in the workflow at all
- Your backend can talk directly to upstream systems without any AI-facing layer
- A standard secrets manager alone already solves your problem because you do not need challenge-based client authentication or encrypted envelope forwarding

## Core Model

CNothing is built around a few simple roles:

- `CNothing`
  - Holds the AuthAI private key, validates challenge usage, and stores encrypted KV records
- `Client backend`
  - Holds the client private key and acts as the trusted cryptographic boundary
- `AI`
  - Orchestrates the workflow, calls HTTP or MCP APIs, and forwards ciphertext envelopes without decrypting them

That split is the main value proposition: the AI is operationally useful, but cryptographically blind.

## End-To-End Flow

The shortest mental model for CNothing is:

1. The client registers a public key with `CNothing`.
2. `CNothing` returns a one-time challenge encrypted to that client public key.
3. The client backend decrypts the challenge locally.
4. The client backend creates an `auth_envelope` plus either a `data_envelope` or `query_envelope`, then encrypts them to `CNothing`.
5. The AI forwards those ciphertext envelopes to CNothing using HTTP or MCP.
6. CNothing validates the challenge, performs the read or write, and returns the next challenge.
7. For reads, the result is encrypted back to the client public key so only the client backend can decrypt it.

This means:

- The AI never receives plaintext secrets
- The AI never needs a private key
- Challenge replay is limited because challenges are single-use and short-lived

For deeper protocol details, see:

- [docs/protocol.md](./docs/protocol.md)
- [docs/mcp.md](./docs/mcp.md)

## Main Endpoints

- `GET /v1/authai/public-key`
  - Return the CNothing AuthAI public key metadata
- `POST /v1/authai/register`
  - Register or reuse a client public key and return an encrypted one-time challenge
- `POST /v1/authai/refresh`
  - Issue the next challenge using a valid auth envelope
- `POST /v1/kv/save`
  - Save KV items using `auth_envelope + data_envelope`
- `POST /v1/kv/read`
  - Read KV items using `auth_envelope + query_envelope`, then return the result encrypted to the client public key

## Console And Browse APIs

This repository also includes a standalone `CNothing Console`:

- `console/`
  - A Next.js console for browsing MCP tools and resources, skills, clients, namespaces, key names, and decrypted values through backend APIs

Browsable APIs:

- `GET /v1/catalog/mcp`
  - List MCP tools and resources
- `GET /v1/catalog/skills`
  - List bundled skills in the repository

Admin APIs:

- `GET /v1/admin/clients`
  - List registered clients
- `POST /v1/admin/clients/register`
  - Manually register a client by pasting a public key
- `GET /v1/admin/clients/:client_uuid/namespaces`
  - List namespaces under a client
- `GET /v1/admin/clients/:client_uuid/kv?namespace=...`
  - List key names under a namespace
- `GET /v1/admin/clients/:client_uuid/kv/value?namespace=...&key=...`
  - View a decrypted value
- `POST /v1/admin/clients/:client_uuid/kv/save`
  - Manually write JSON values through the admin API

Notes:

- The `catalog` APIs are public by default and are suitable for discovery
- The `admin` APIs reuse `KEYSERVICE_BEARER_TOKEN` for Bearer authentication
- If `KEYSERVICE_BEARER_TOKEN` is unset, the console and admin APIs do not add extra blocking

## Third-Party Server SDK

This repository now also includes a reusable Node.js and Bun SDK so third-party backends can integrate with `https://cnothing.com` without reimplementing the protocol by hand.

Install it from npm:

```bash
npm install cnothing
```

or:

```bash
bun add cnothing
```

The SDK is designed for backend use. A third-party service can:

- Generate or load its own client key pair
- Register its public key with `CNothing`
- Keep its private key local
- Save and read encrypted KV values through `https://cnothing.com`
- Let AI use the CNothing protocol without ever seeing plaintext secrets

Minimal example:

```ts
import { CNothingClient, generateClientKeyPair } from "cnothing";

const { privateKeyPem, publicKeyPem } = generateClientKeyPair();

const client = new CNothingClient({
  baseUrl: "https://cnothing.com",
  clientPrivateKeyPem: privateKeyPem,
  clientPublicKeyPem: publicKeyPem,
  clientLabel: "third-party-service",
});

await client.register();

await client.saveJson({
  namespace: "thirdparty.example.production",
  items: [
    {
      key: "provider/openai/api-key",
      value: { apiKey: "sk-..." },
    },
  ],
});

const readResult = await client.readJson({
  namespace: "thirdparty.example.production",
  keys: ["provider/openai/api-key"],
});

console.log(readResult.result.items["provider/openai/api-key"]);
```

The SDK exports:

- `CNothingClient`
  - High-level register / refresh / save / read workflow client
- `generateClientKeyPair()`
  - Generate a local RSA key pair for development or first-time setup
- Envelope helpers
  - For teams that want lower-level control over how requests are built

## Why Third-Party Users Do Not Need To Fear AI Leaking Their Secrets

When a third-party backend uses `https://cnothing.com` correctly, the AI still does not gain access to the third-party's sensitive plaintext values.

That is because:

- The third-party backend keeps the client private key locally
- `CNothing` encrypts challenges to the third-party public key
- The backend decrypts those challenges locally and creates ciphertext envelopes for CNothing
- AI only forwards ciphertext envelopes and non-sensitive metadata
- Read results are encrypted back to the third-party public key, so only that backend can decrypt them

In other words, the AI may participate in orchestration, but it does not become the holder of third-party plaintext secrets. The trust boundary remains the third-party backend and the CNothing protocol, not the model context.

## Security Properties

- Clients only submit public keys during registration
- `challenge_for_client` is always encrypted to the client public key
- `auth_envelope` and `data/query_envelope` are always encrypted to `CNothing`
- Challenges are single-use and short-lived
- Server-side records use per-record random DEKs wrapped by the master key

Important constraints:

- AI should never request private keys
- AI should never decrypt envelopes
- AI should only forward ciphertext envelopes and non-sensitive metadata
- If key names are sensitive, the caller backend should add a mapping or hashing layer

## Quick Start

### 1. Prepare infrastructure

You need:

- Bun
- PostgreSQL
- A `.env` file with the required CNothing settings

Required environment variables:

- `DATABASE_URL`
- `KEYSERVICE_MASTER_KEY`
- `KEYSERVICE_AUTHAI_PRIVATE_KEY_PATH`
- `KEYSERVICE_AUTHAI_PUBLIC_KEY_PATH` (optional if derived from the private key)

Optional but commonly useful:

- `PORT`
- `KEYSERVICE_CHALLENGE_TTL_SECONDS`
- `KEYSERVICE_BEARER_TOKEN`
- `KEYSERVICE_CONSOLE_URL`

### 2. Generate local secrets for development

```bash
cd CNothing
bun install
bun run generate-secrets
```

This creates:

- `.local-keys/authai-private-key.pem`
- `.local-keys/authai-public-key.pem`
- `.local-keys/generated.env`

That explicit initialization step is intentional: service identity does not silently change on restart, and key rotation remains operationally visible.

If you are integrating from a separate third-party backend instead of deploying CNothing itself, install the SDK there and point it at `https://cnothing.com`:

```ts
import { CNothingClient } from "cnothing";

const client = new CNothingClient({
  baseUrl: "https://cnothing.com",
  clientPrivateKeyPem: process.env.CNOTHING_CLIENT_PRIVATE_KEY_PEM!,
  clientPublicKeyPem: process.env.CNOTHING_CLIENT_PUBLIC_KEY_PEM!,
  clientLabel: "my-service",
});

await client.register();
```

### 3. Configure the environment

Create a `.env` file and set at least:

```env
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/cnothing
KEYSERVICE_MASTER_KEY=...
KEYSERVICE_AUTHAI_PRIVATE_KEY_PATH=./.local-keys/authai-private-key.pem
KEYSERVICE_AUTHAI_PUBLIC_KEY_PATH=./.local-keys/authai-public-key.pem
PORT=3021
```

### 4. Run migrations and start the API

```bash
cd CNothing
bun run migrate
bun run dev
```

### 5. Start the console

```bash
cd CNothing/console
bun install
bun run dev
```

Or from the repository root:

```bash
cd CNothing
bun run console:dev
```

### 6. Verify the deployment

Once the service is running, verify:

- `GET /health`
- `GET /v1/authai/public-key`
- `GET /mcp`
- `GET /skill.md`

On a default local setup, that usually means:

```bash
curl http://127.0.0.1:3021/health
curl http://127.0.0.1:3021/v1/authai/public-key
curl http://127.0.0.1:3021/mcp
```

## Deployment Notes

`CNothing` works well as an independently published and deployed repository. For a public repository:

- Keep `.env.example`
- Do not commit `.env`
- Do not commit `.local-keys/`
- Provide production secrets through environment variables or a separate secrets directory
- Keep production private keys outside paths that may be overwritten by code sync

This repository already includes deployment helpers under [deploy/](./deploy).

## File Guide

- [src/core/key-service.ts](./src/core/key-service.ts)
  - Core protocol orchestration
- [src/core/key-service.repository.ts](./src/core/key-service.repository.ts)
  - PostgreSQL repository layer
- [src/crypto/hybrid-envelope.ts](./src/crypto/hybrid-envelope.ts)
  - `RSA-OAEP-256 + AES-256-GCM` hybrid encryption
- [migrations/002_authai_kv.sql](./migrations/002_authai_kv.sql)
  - `clients/challenges/kv/audit` schema
- [skills/keyservice-authai/SKILL.md](./skills/keyservice-authai/SKILL.md)
  - AI usage conventions
