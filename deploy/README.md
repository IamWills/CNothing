# CNothing V4 deployment

The production deployment has two required services:

- `keyservice.service`: V4 API, hosted MCP, OAuth callbacks, Vault proxy, and APNs delivery on port 3021.
- `cnothing-console.service`: browser login, approvals, device pairing, and the fallback UI on port 3022.

## First installation

After DNS is configured, export `DATABASE_URL`, `CERTBOT_EMAIL`, and `KEYSERVICE_REF` (an explicitly reviewed tag or commit), then run `setup-cnothing-server.sh` as root. Keep the APNs `.p8` key outside the repository with owner-only permissions.

The setup script checks out that revision in detached-HEAD mode, installs locked dependencies, builds both applications, applies the idempotent V4 schema, installs the two systemd units, and installs the V4-only Nginx config. It does not configure unattended Git pulls. After installation, add OAuth and all required APNs settings to `.env` before restarting the API.

`KEYSERVICE_BEARER_TOKEN` is a service/bootstrap credential, not a Console login. After the first Human signs in at `/login`, call `POST /v4/admin/bootstrap` with that token and the user's `user_id` to create the first admin. Later administrator access uses the Human session and `role=admin`.

## Controlled release

Use an immutable revision or reviewed Git commit. Before a database change, take and verify a PostgreSQL backup.

```bash
git fetch origin
git checkout <reviewed-commit>
bun install --frozen-lockfile
(cd console && bun install --frozen-lockfile && bun run build)
bun run typecheck
bun test src
bun run migrate
sudo systemctl restart keyservice.service cnothing-console.service
curl --fail https://cnothing.com/health
```

The normal migration runner only applies `migrations/*.sql`. The destructive legacy-table cleanup at `migrations/manual/cleanup_pre_v4.sql` is intentionally manual and refuses to run until OAuth secrets are confirmed in the V4 Vault.

## iOS/APNs verification

Verify all of these after a release:

```bash
curl --fail https://cnothing.com/.well-known/apple-app-site-association
curl --fail https://cnothing.com/openapi-v4.json
curl --fail https://cnothing.com/.well-known/mcp
journalctl -u keyservice.service -n 100 --no-pager
```

Then pair a real iOS device, rotate its APNs token, create a targeted access request, and confirm both push delivery and device-bound approve/deny. Polling at `/v4/access-requests/pending` must continue to work if APNs is unavailable.
