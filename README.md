# CNothing

For Chinese documentation, see [README.CN.MD](./README.CN.MD).

`CNothing` implements a production-oriented `AuthAI + Encrypted KV` protocol for AI automation systems.

Goals:

- Keep plaintext secrets away from AI models
- Treat the client backend, which holds the private key, as the trusted boundary
- Use one-time challenges for authentication
- Isolate KV data by `client_uuid + namespace + key`
- Keep data encrypted at rest with envelope encryption
- Expose a consistent protocol across HTTP, MCP, and Skill entry points
- GitHub repository:
  - [https://github.com/IamWills/CNothing](https://github.com/IamWills/CNothing)

Detailed protocol references:

- [docs/protocol.md](./docs/protocol.md)
- [docs/mcp.md](./docs/mcp.md)

## Main Endpoints

- `GET /v1/authai/public-key`
  - Return the CNothing AuthAI public key
- `POST /v1/authai/register`
  - Register or reuse a client public key and return a one-time challenge encrypted for that client
- `POST /v1/authai/refresh`
  - Renew the next challenge with a valid auth envelope
- `POST /v1/kv/save`
  - Save KV items using `auth_envelope + data_envelope`
- `POST /v1/kv/read`
  - Read KV items using `auth_envelope + query_envelope`, then return the result encrypted to the client public key

## Console And Browse APIs

This repository also includes a standalone `CNothing Console` application:

- `console/`
  - A Next.js console for browsing MCP tools and resources, skills, clients, namespaces, key names, and values

The console relies on backend APIs that are also available to AI and automation systems:

- `GET /v1/catalog/mcp`
  - List MCP tools and resources
- `GET /v1/catalog/skills`
  - List bundled skills in the repository
- `GET /v1/admin/clients`
  - List registered clients
- `POST /v1/admin/clients/register`
  - Manually register a client by pasting in a public key
- `GET /v1/admin/clients/:client_uuid/namespaces`
  - List namespaces under a client
- `GET /v1/admin/clients/:client_uuid/kv?namespace=...`
  - List key names under a namespace
- `GET /v1/admin/clients/:client_uuid/kv/value?namespace=...&key=...`
  - View the decrypted value for a key
- `POST /v1/admin/clients/:client_uuid/kv/save`
  - Manually write JSON values through the admin API

Notes:

- The `catalog` APIs are public by default and work well for browsing and AI discovery
- The `admin` APIs reuse `KEYSERVICE_BEARER_TOKEN` for Bearer authentication
- If `KEYSERVICE_BEARER_TOKEN` is not configured, the console and admin APIs do not add extra blocking

## Security Model

- Clients only submit public keys during registration
- `challenge_for_client` is always encrypted to the client public key
- `auth_envelope` and `data/query_envelope` are always encrypted to `CNothing`
- Each challenge is single-use, with TTL controlled by environment variables and defaulting to 300 seconds
- Server-side records use per-record random DEKs wrapped by the master key

Important constraints:

- AI should never request private keys
- AI should never decrypt any envelope
- AI should only forward ciphertext envelopes and non-sensitive key names or namespaces
- If the key name itself is sensitive, the caller backend should add a mapping or hashing layer

## Environment

- `PORT`
  - Defaults to `3021`
- `DATABASE_URL`
  - PostgreSQL connection string
- `KEYSERVICE_MASTER_KEY`
  - A 32-byte master key encoded in Base64 or Base64URL
- `KEYSERVICE_AUTHAI_PRIVATE_KEY_PATH`
  - Path to the CNothing RSA private key used to decrypt auth, data, and query envelopes
- `KEYSERVICE_AUTHAI_PUBLIC_KEY_PATH`
  - Optional AuthAI public key path; if unset, the service derives the public key from the private key
- `KEYSERVICE_CHALLENGE_TTL_SECONDS`
  - Challenge TTL, default `300`
- `KEYSERVICE_BEARER_TOKEN`
  - Not required by the current protocol; retained for admin and compatibility scenarios

You can generate a master key and AuthAI RSA key pair explicitly instead of generating them automatically at service startup:

```bash
cd CNothing
bun run generate-secrets
```

This command creates the following files in `.local-keys/`:

- `authai-private-key.pem`
- `authai-public-key.pem`
- `generated.env`

That matches the preferred production pattern of explicit initialization: service identity does not silently change on restart, and key rotation stays intentional and operationally visible.

## Run

```bash
cd CNothing
bun install
bun run generate-secrets
bun run migrate
bun run dev
```

Start the console:

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

## Publish As Standalone Repo

`CNothing` works well as an independently published and deployed repository. For a public repository:

- Keep `.env.example`
- Do not commit `.env`
- Do not commit `.local-keys/`
- Provide production secrets through environment variables or a separate secrets directory in deployment

## Files

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
