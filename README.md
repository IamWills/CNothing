# CNothing v4

CNothing is authentication infrastructure for AI agents. A user connects an OAuth provider and approves an Agent grant; CNothing then injects the provider credential at the HTTP proxy boundary. The Agent never receives passwords, access tokens, refresh tokens, cookies, or provider client secrets.

A Grant is the current representation of a Mandate: delegated authority from a principal (today, a User) to an agent, constrained to hosts, methods, and an expiry. Agents keep calling `list_grants` and `proxy_request`; they do not need to know the Mandate name.

An AccessRequest is the current representation of an ApprovalRequest. Delegation mints a Mandate. When a Mandate opts into `constraints.require_approval` — from the Console approval checkbox, the Grants page toggle, or the approve API — a side-effecting `proxy_request` (for example creating a GitHub issue) becomes a Transaction Intent: the agent still calls `proxy_request`, receives `approval_required` with an `approval_url`, and retries the same call after the principal approves. GET traffic is never gated. Tokens never leave CNothing.

## Identity

CNothing has three principals. Their credentials are not interchangeable.

| Principal | Credential | Authorization |
| --- | --- | --- |
| Human | Browser/iOS session after `/login` (GitHub / OIDC / configured IdP) | `role=user` or `role=admin` on the server-side user row |
| Agent | One-time agent token (`agent_…`) | Mandate / Grant / Policy / Approval / Transaction Intent |
| Service | `KEYSERVICE_BEARER_TOKEN` (alias `CN_SERVICE_TOKEN`) | Bootstrap, recovery, trusted automation |

Admins and ordinary users share the same `/login`. There is no `/admin/login` and no second password system. Console navigation hides admin pages for `role=user`; every admin mutation is still enforced by `requireAdmin()` on the server.

The service bearer token is **not** a daily human admin login. After a fresh deploy, sign in normally, then promote the first admin:

```bash
curl -X POST "$CN_URL/v4/admin/bootstrap" \
  -H "Authorization: Bearer $KEYSERVICE_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"github:your-login"}'
```

Bootstrap is refused once any admin exists. Later promote/demote calls require a Human admin session (`POST /v4/admin/users/promote` and `/demote`). The last remaining admin cannot be demoted.

### Production upgrade from Admin Bearer Token

1. Deploy this version and run `bun run migrate` (`007_user_roles.sql` adds `cap_users.role`, default `user`).
2. Sign in at `/login` with the existing identity provider. Existing sessions keep working.
3. Call `POST /v4/admin/bootstrap` with the service token and that user's `user_id` (from `/v4/auth/me`).
4. Reload the Console; Agents and Providers appear only for `role=admin`.
5. Stop using the old Console Admin Token field. The Console no longer stores or sends it.

## Supported workflow

1. The host plugin either already has an agent token, or it calls `POST /v4/agent-enrollments` and the user approves the runtime at `/approve-agent/{id}`. The token is stored in the host secret store, never in the model context. Spec: `https://cnothing.com/plugin.md`.
2. The user signs in at `/login` and connects a provider at `/connect`.
3. The Agent calls `list_grants` and reuses a matching active grant when possible.
4. Otherwise the Agent calls `list_providers`, then `request_access`.
5. CNothing sends a push to a paired iOS device when the user identity is known. The returned `approval_url` is always the fallback.
6. The Agent checks `get_access_status`, then calls the third-party API with `proxy_request`. A write whose mandate set `require_approval` returns `approval_required`; after the user approves, the agent retries the same `proxy_request`.

## Provider registry

`cap_oauth_providers` is the single provider entity. One registry entry covers both roles a provider can play: the API an agent connects to through the credential proxy, and — when `login_enabled` is set — the identity provider a user signs in to the Console with. Rows record `source` (`manual` | `discovered` | `imported`) and a stored status of `active` | `unconfigured` | `disabled`. The Console maps those onto DISCOVERED / UNVERIFIED / REVIEWED / ACTIVE / DISABLED. Discovered metadata is untrusted and is fetched through the same SSRF checks as the proxy. Provider client secrets live in the Vault, never in the provider row.

Hosted MCP: `https://cnothing.com/mcp`

Agent skill: `https://cnothing.com/skill.md`

Plugin contract: `https://cnothing.com/plugin.md`

OpenAPI: `https://cnothing.com/openapi.json`

## Components

- `src/v4`: Agent identity and user-approved enrollment, Human users and roles, user sessions, the provider registry and connections, encrypted vault, access grants, transaction intents, credential-injecting proxy, APNs, device pairing, signed device approvals, and share codes.
- `src/mcp`: hosted MCP transport and tool execution.
- `packages/cnothing-mcp`: stdio MCP adapter. If `CNOTHING_AGENT_TOKEN` is missing, the adapter enrolls with the user and stores the claimed token locally.
- `console`: human sign-in, provider connection, role-aware Agent/provider administration, approval, grant, and device management.
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

Production OAuth callback URLs must use the exact v4 paths documented in `openapi-v4.json`. GitHub Console login also accepts the historically registered `https://cnothing.com/v2/auth/github/callback`; set `KEYSERVICE_GITHUB_OAUTH_REDIRECT_URI` to the Authorization callback URL on the GitHub OAuth App.
