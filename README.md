# CNothing v4

CNothing is authentication infrastructure for AI agents. A user connects an OAuth provider and approves an Agent grant; CNothing then injects the provider credential at the HTTP proxy boundary. The Agent never receives passwords, access tokens, refresh tokens, cookies, or provider client secrets.

A Grant is the current representation of a Mandate: delegated authority from a principal (today, a User) to an agent, constrained to hosts, methods, and an expiry. Agents keep calling `list_grants` and `proxy_request`; they do not need to know the Mandate name.

## Supported workflow

1. An operator creates an Agent in the Console and configures its one-time token in the MCP client environment.
2. The user signs in at `/login` and connects a provider at `/connect`.
3. The Agent calls `list_grants` and reuses a matching active grant when possible.
4. Otherwise the Agent calls `list_providers`, then `request_access`.
5. CNothing sends a push to a paired iOS device when the user identity is known. The returned `approval_url` is always the fallback.
6. The Agent checks `get_access_status`, then calls the third-party API with `proxy_request`.

## Provider registry

`cap_oauth_providers` is the single provider entity. One registry entry covers both roles a provider can play: the API an agent connects to through the credential proxy, and — when `login_enabled` is set — the identity provider a user signs in to the Console with. Provider client secrets live in the Vault, never in the provider row.

Hosted MCP: `https://cnothing.com/mcp`

Agent skill: `https://cnothing.com/skill.md`

OpenAPI: `https://cnothing.com/openapi.json`

## Components

- `src/v4`: Agent identity, user sessions, the provider registry and connections, encrypted vault, access grants, credential-injecting proxy, APNs, device pairing, signed device approvals, and share codes.
- `src/mcp`: hosted MCP transport and tool execution.
- `packages/cnothing-mcp`: stdio MCP adapter. Credentials come from `CNOTHING_AGENT_TOKEN`.
- `console`: human sign-in, provider connection, Agent provisioning, approval, grant, and device management.
- `iOS`: CNothing authenticator app with account pairing, APNs, and Secure Enclave approval signatures.

## Local development

```bash
bun install
bun run generate-secrets
# Copy .local-keys/generated.env into your environment, then set DATABASE_URL.
bun run migrate
bun run dev
```

For an upgrade, first let V4 migrate OAuth credentials and verify a database backup. After the migration state is complete, an operator may explicitly run `migrations/manual/cleanup_pre_v4.sql`; normal migrations never execute this destructive cleanup.

Run verification:

```bash
bun test
bun run typecheck
bun run console:typecheck
```

The integration suites need Postgres. They create and migrate their own database, `cnothing_test` by default; override with `TEST_DATABASE_URL`. Without a reachable Postgres they are skipped, so set `CNOTHING_REQUIRE_DB_TESTS=1` in CI to make an unavailable database a failure instead.

Production OAuth callback URLs must use the exact v4 paths documented in `openapi-v4.json`.
