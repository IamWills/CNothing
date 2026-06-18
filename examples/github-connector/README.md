# GitHub Connector (CNothing v2)

Production-style connector that keeps the GitHub token locally and executes capabilities after verifying CNothing Capability Grants.

## Capabilities

| Name | Type | Description |
| --- | --- | --- |
| `github.create_issue` | ACTION | Create an issue |
| `github.list_repositories` | QUERY | List repositories |
| `github.get_repository` | QUERY | Get repository metadata |

## Setup

```bash
# 1. Bootstrap connector + capabilities against CNothing
CNOTHING_BASE_URL=http://127.0.0.1:3021 \
CNOTHING_ADMIN_TOKEN=your-admin-token \
GITHUB_CONNECTOR_CALLBACK_URL=http://127.0.0.1:3031 \
bun run examples/github-connector/bootstrap.ts

# 2. Start connector
export GITHUB_CONNECTOR_ID=<from bootstrap output>
export GITHUB_TOKEN=ghp_...
export CNOTHING_PUBLIC_KEY_PEM="$(curl -s http://127.0.0.1:3021/v1/authai/public-key | jq -r '.authai_public_key.public_key_pem')"
bun run examples/github-connector/index.ts
```

## End-to-end agent flow

```bash
# Register agent + grant capability (admin)
# Agent requests authorization
# User approves at Console /authorize/:id using user session
# Agent invokes
curl -X POST http://127.0.0.1:3021/v2/capabilities/invoke \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "capability":"github.create_issue",
    "input":{"repo":"org/repo","title":"Bug from agent","body":"Created via CNothing v2"}
  }'
```

The agent never receives `GITHUB_TOKEN`. The connector verifies the grant JWT, then calls GitHub with its locally stored credential.
