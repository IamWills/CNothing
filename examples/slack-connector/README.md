# Slack Connector

Example v2 connector that posts messages and lists channels via the Slack Web API.

## Setup

1. Start CNothing and run migrations.
2. Bootstrap connector registration:

```bash
CNOTHING_BASE_URL=http://127.0.0.1:3021 \
CNOTHING_ADMIN_TOKEN=... \
SLACK_CONNECTOR_CALLBACK_URL=http://127.0.0.1:3032 \
bun run slack:bootstrap
```

3. Start the connector:

```bash
export SLACK_CONNECTOR_ID=...
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_DEFAULT_CHANNEL=C0123456789
export CNOTHING_PUBLIC_KEY_PEM="$(curl -s http://127.0.0.1:3021/v1/authai/public-key | jq -r '.authai_public_key.public_key_pem')"
bun run slack:connector
```

## Capabilities

- `slack.post_message` — post text (and optional blocks) to a channel
- `slack.list_channels` — list channels visible to the bot

Credentials (`SLACK_BOT_TOKEN`) stay in the connector process — agents only receive scoped grants.
