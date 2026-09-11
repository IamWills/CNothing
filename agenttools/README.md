# Agent tools

CNothing currently provides OAuth API delegation, not browser login to arbitrary websites. Normally request access with only `provider` (from `list_providers`) and `reason`; the user chooses their connected account on the approval page. `user_id` is optional CNothing approval routing, not a website account selector. When the user provides their login account, pass `user_id: "google:createn@gmail.com"` (general form `provider:account`) to route approval to their paired phone. CNothing resolves the stored login identity; do not invent an account. Keep the same approval request while waiting.

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
