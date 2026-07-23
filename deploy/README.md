# CNothing Production Deployment

Production host layout (server5 example):

| Path | Purpose |
| --- | --- |
| `/var/www/keyservice` | Git checkout, API `.env`, migrations |
| `/var/www/keyservice/console` | Next.js Console (port 3022) |
| `keyservice.service` | Bun API on port 3021 |
| `keyservice-console.service` | Console on port 3022 |
| `keyservice-sync.timer` | Periodic `git pull` + migrate + restart |

## First-time setup

See [setup-cnothing-server.sh](./setup-cnothing-server.sh). Requires `DATABASE_URL`, `CERTBOT_EMAIL`, and DNS for `cnothing.com`.

## Deploy updates (manual)

After pushing to GitHub `main`:

```bash
ssh server5
sudo /var/www/keyservice/deploy/upgrade-env.sh /var/www/keyservice/.env
sudo /var/www/keyservice/deploy/keyservice-sync.sh
```

`keyservice-sync.sh` already runs `upgrade-env.sh`, `bun run migrate`, and restarts services when new commits are detected.

Force sync without waiting for the timer:

```bash
sudo systemctl start keyservice-sync.service
journalctl -u keyservice-sync.service -n 50 --no-pager
```

## OAuth providers (v2.5)

Built-in providers (GitHub, Google, Microsoft, Slack, Notion) read credentials from `.env` on startup and via admin sync.

Append credentials without overwriting existing values:

```bash
KEYSERVICE_GOOGLE_OAUTH_CLIENT_ID=... \
KEYSERVICE_GOOGLE_OAUTH_CLIENT_SECRET=... \
sudo /var/www/keyservice/deploy/configure-v2-oauth-providers.sh /var/www/keyservice/.env
sudo systemctl restart keyservice.service
```

Or use Console **Providers → Sync from .env** (`POST /v2/admin/oauth/sync-env`).

Optional platform lifecycle webhook:

```bash
KEYSERVICE_PLATFORM_WEBHOOK_URL=https://your-app.example/hooks/cnothing
```

Events: `oauth.connection.created`, `grant.approved`, `import.capabilities.activated`.

## Environment variables (v2)

Required (existing):

- `PORT` — default `3021`
- `DATABASE_URL` — PostgreSQL connection string
- `KEYSERVICE_MASTER_KEY` — 32-byte base64 master key
- `KEYSERVICE_AUTHAI_PRIVATE_KEY_PATH` — RSA private key for v1 envelopes and v2 grant signing

Added for v2 (auto-appended by [upgrade-env.sh](./upgrade-env.sh) if missing):

| Variable | Default | Purpose |
| --- | --- | --- |
| `KEYSERVICE_BEARER_TOKEN` | generated once | Admin API + Console admin operations |
| `KEYSERVICE_CONSOLE_URL` | `https://cnothing.com` | OAuth-style approval links |
| `KEYSERVICE_USER_SESSION_TTL_SECONDS` | `86400` | User session lifetime |
| `KEYSERVICE_USER_LOGIN_TOKEN_TTL_SECONDS` | `900` | One-time login token TTL |
| `KEYSERVICE_V1_SUNSET_DATE` | `2026-12-17` | v1 Deprecation/Sunset headers |

Never commit `.env` or `.local-keys/` to git.

## Database migrations

Migrations run automatically on sync:

```bash
cd /var/www/keyservice
sudo -u keyservice /usr/local/bin/bun run migrate
```

## Verify after deploy

```bash
curl -sS https://cnothing.com/health
curl -sS https://cnothing.com/openapi-v4.json | head
curl -sS https://cnothing.com/skill.md | head
curl -sS https://cnothing.com/.well-known/mcp | head
```

### Nginx (API + Console split)

Production uses API on `3021` and Console on `3022`. Ensure `/v4/`, `/mcp`, `/openapi-v4.json`, and `/skill.md` proxy to the API:

```bash
sudo cp /var/www/keyservice/deploy/nginx-cnothing-split.conf /etc/nginx/sites-available/cnothing.com
sudo nginx -t && sudo systemctl reload nginx
```

Template: [nginx-cnothing-split.conf](./nginx-cnothing-split.conf)

Local on server:

```bash
curl -sS http://127.0.0.1:3021/health
curl -sS http://127.0.0.1:3021/openapi-v4.json | head
systemctl status keyservice.service keyservice-console.service
journalctl -u keyservice.service -n 30 --no-pager
```

## CI

GitHub Actions workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every push/PR to `main`:

- `bun run typecheck`
- `bun run build`
- PostgreSQL + `bun run migrate`
- `bun run e2e:v4` against a live local API

## Low-memory servers

`keyservice-sync.sh` skips Console rebuild by default (`KEYSERVICE_LOW_MEMORY=1`). To rebuild Console after a frontend change:

```bash
KEYSERVICE_SYNC_CONSOLE_BUILD=1 sudo /var/www/keyservice/deploy/keyservice-sync.sh
```

## Logs

```bash
journalctl -u keyservice.service -f
journalctl -u keyservice-console.service -f
journalctl -u keyservice-sync.service -n 100 --no-pager
```
