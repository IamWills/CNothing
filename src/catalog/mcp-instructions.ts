/**
 * MCP initialize instructions — returned to AI agents on connect.
 * v2 capability platform is primary; v1 AuthAI/KV remains for backward compatibility only.
 */
export const MCP_SERVER_INSTRUCTIONS = `
# CNothing v2 — Agent Capability Authorization Platform

**Agent Never Owns Secrets. Agent Only Receives Permissions.**

CNothing v2 lets AI agents invoke **capabilities** (e.g. \`github.create_issue\`, \`slack.post_message\`) without ever seeing API keys or tokens. CNothing validates grants and policy, issues a short-lived grant JWT, and forwards the request to a **Connector** that holds credentials locally.

## Preferred v2 workflow

1. **Discover** — \`list_capabilities\` to see registered capabilities.
2. **Authorize** — \`request_authorization\` when the agent needs new permissions; the user approves in Console.
3. **Invoke** — \`invoke_capability\` with \`agent_access_token\`, \`capability\`, and business \`input\`.
4. **Confirm** — high-risk capabilities may require \`confirmation_id\` after user approval.

Example:

\`\`\`json
{
  "capability": "github.create_issue",
  "input": { "repo": "org/repo", "title": "Bug report" },
  "agent_access_token": "agent_..."
}
\`\`\`

REST equivalent: \`POST /v2/capabilities/invoke\` with \`Authorization: Bearer agent_...\`.

## v1 AuthAI/KV (deprecated)

Tools \`kv_save\`, \`kv_read\`, \`authai_register\`, and related AuthAI envelope tools are **deprecated** and sunset on the date in \`_deprecation.sunset_at\` on each response.

**Do not start new integrations on v1.** Migrate to v2 capabilities:

| v1 pattern | v2 replacement |
| --- | --- |
| Store credential in KV | Connector holds credential; grant scoped access |
| \`kv_read\` + recipient_public_key | \`invoke_capability\` with business input |
| \`authai_register\` client bootstrap | \`POST /v2/agents/register\` + user authorization |

Migration guide: \`GET /v2/platform/migration\`

## Common v1 mistakes (legacy integrations only)

If you must touch v1 temporarily:

- \`recipient_public_key\` on \`kv_read\` must be the **consumer's** public key (e.g. Searchengine), not CNothing AuthAI or client key.
- Do not save reader-encrypted \`api_key_envelope\` directly via \`kv_save\` — backend must decrypt first.
- Agents must never decrypt envelopes; forward ciphertext to trusted backends only.

Read \`/openapi-v2.json\`, \`/docs/mcp.md\`, and \`/standards/registration-hub\` for full details.
`.trim();
