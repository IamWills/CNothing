# CNothing v2.5 E2E

Tests v2.5 OAuth broker + agent gateway against a running server.

## Prerequisites

- PostgreSQL with migrations applied (`bun run migrate`)
- Server running (`bun run dev`)
- `KEYSERVICE_BEARER_TOKEN` configured

## Run

```bash
CNOTHING_BASE_URL=http://127.0.0.1:3021 \
CNOTHING_ADMIN_TOKEN=your-admin-token \
bun run e2e:v2.5
```

## Automated checks

The script verifies:

1. `GET /v2/platform/v2.5/status` returns `2.5.0`
2. Built-in OAuth providers include `github`
3. Agent registration and capability listing
4. Unauthorized invoke returns `authorization_required` (403)
5. Authorization request returns `approval_url` without leaking tokens
6. **Scenario C**: with an admin-created grant for `github.delete_repo`, invoke returns **202** with `pending: true` and `confirmation_id` (high-risk policy)
7. **Scenario A** (when server has `KEYSERVICE_E2E_INTERNAL=1` and `KEYSERVICE_GITHUB_API_BASE_URL` pointing at mock): seed OAuth connection → approve grant → invoke `github.create_issue` successfully without token leak

Server env for full scenario A in CI/local:

```bash
KEYSERVICE_E2E_INTERNAL=1
KEYSERVICE_GITHUB_API_BASE_URL=http://127.0.0.1:3199
CNOTHING_E2E_SCENARIO_A=1 bun run e2e:v2.5
```

## GitHub full happy path (manual, scenario A)

1. Configure `KEYSERVICE_GITHUB_OAUTH_CLIENT_ID` and `KEYSERVICE_GITHUB_OAUTH_CLIENT_SECRET`
2. Open Console `/connect` and connect GitHub
3. Register an agent and call `POST /v2/agent/authorizations` for `github.create_issue`
4. Open `approval_url`, select GitHub connection, approve
5. Call `POST /v2/agent/invoke` — issue is created without agent seeing tokens
6. Verify `/audit` shows hashed invocation record
