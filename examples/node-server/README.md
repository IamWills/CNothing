# Node.js Example (legacy AuthAI / KV)

This example uses the published `cnothing` npm package for the **deprecated v1 AuthAI + Encrypted KV** flow.

**AI agents that need GitHub or other OAuth APIs must use v4 instead:**

- Skill: https://cnothing.com/skill.md
- MCP: https://cnothing.com/mcp
- OpenAPI: https://cnothing.com/openapi-v4.json

Do not use this example to “log into GitHub.”

## Install

```bash
cd examples/node-server
npm install
```

## Run

```bash
CNOTHING_PRIVACY_KEY=replace-me \
node index.mjs
```

Optional environment variables:

- `CNOTHING_BASE_URL`
- `CNOTHING_CLIENT_PRIVATE_KEY_PEM`
- `CNOTHING_CLIENT_PUBLIC_KEY_PEM`
- `CNOTHING_CLIENT_LABEL`
- `CNOTHING_NAMESPACE`
- `CNOTHING_KEY`
- `CNOTHING_SECRET_VALUE`

If you do not provide a key pair, the example generates one locally for the process.
