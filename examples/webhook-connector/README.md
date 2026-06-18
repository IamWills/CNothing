# Webhook Connector

Generic v2 connector for outbound HTTP webhook calls. Useful for notifications, automation hooks, or bridging to services without a dedicated connector.

## Setup

```bash
CNOTHING_BASE_URL=http://127.0.0.1:3021 \
CNOTHING_ADMIN_TOKEN=... \
WEBHOOK_CONNECTOR_CALLBACK_URL=http://127.0.0.1:3033 \
bun run webhook:bootstrap
```

```bash
export WEBHOOK_CONNECTOR_ID=...
export WEBHOOK_DEFAULT_URL=https://hooks.example.com/your-endpoint
export CNOTHING_PUBLIC_KEY_PEM="$(curl -s http://127.0.0.1:3021/v1/authai/public-key | jq -r '.authai_public_key.public_key_pem')"
bun run webhook:connector
```

## Capabilities

- `webhook.post` — POST arbitrary JSON to a URL
- `webhook.notify` — POST a structured notification payload

No secrets are required unless the target webhook needs auth headers (pass via `input.headers`).
