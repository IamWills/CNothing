# Agent tools

Host-side adapters for CNothing v4. One core holds enrollment secrets and the agent token; Node, MCP, and DeepSeek Harness only show the model `approval_url` and `user_code` until a user approves. Spec: https://cnothing.com/plugin.md

```
agenttools/
  core/                 private workspace library
  node/                 npm package cnothing-agent
  mcp/                  stdio MCP (cnothing-mcp)
  deepseek-harness/     DeepSeek bundle (cnothing-deepseek)
```

## Rules

1. `enrollment_secret` and `agent_…` stay in the host store (`CNOTHING_AGENT_TOKEN` or a `0600` file).
2. Enrollment is not a model-facing tool.
3. `proxy_request` must not send `Authorization` or `Cookie`; CNothing injects the provider credential.

## Node

```ts
import { createCNothingAgent } from "cnothing-agent";

const agent = createCNothingAgent({ clientName: "my-runtime" });
const identity = await agent.ensureIdentity();
```

## MCP

```bash
bun run mcp:local
```

## DeepSeek Harness

```bash
dsh plugin add ./agenttools/deepseek-harness
```
