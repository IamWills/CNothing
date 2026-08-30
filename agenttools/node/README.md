# cnothing-agent

Host SDK for CNothing v4. The runtime holds the agent token; the model never sees `enrollment_secret` or `agent_…` values. Spec: https://cnothing.com/plugin.md

```ts
import { createCNothingAgent } from "cnothing-agent";

const agent = createCNothingAgent({
  baseUrl: process.env.CNOTHING_BASE_URL,
  clientName: "my-runtime",
});

const identity = await agent.ensureIdentity();
if (identity.status === "enrollment_required") {
  // Show identity.user_action.approval_url and user_code only.
}

await agent.listGrants();
```

`createCNothingAgent` does not expose `getToken()`. Tokens live in `CNOTHING_AGENT_TOKEN`, or a `0600` file at `CNOTHING_AGENT_TOKEN_FILE` (default `~/.config/cnothing/agent.token`).
