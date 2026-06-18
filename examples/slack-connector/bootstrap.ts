/**
 * Bootstrap the Slack connector and capabilities against a running CNothing instance.
 *
 * Usage:
 *   CNOTHING_BASE_URL=http://127.0.0.1:3021 \
 *   CNOTHING_ADMIN_TOKEN=... \
 *   SLACK_CONNECTOR_CALLBACK_URL=http://127.0.0.1:3032 \
 *   bun run examples/slack-connector/bootstrap.ts
 */

const baseUrl = (process.env.CNOTHING_BASE_URL ?? "http://127.0.0.1:3021").replace(/\/+$/, "");
const adminToken = process.env.CNOTHING_ADMIN_TOKEN ?? "";
const callbackUrl = process.env.SLACK_CONNECTOR_CALLBACK_URL ?? "http://127.0.0.1:3032";

if (!adminToken) {
  throw new Error("CNOTHING_ADMIN_TOKEN is required");
}

async function request<T>(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    throw new Error(
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: { message?: string } }).error?.message ?? "Request failed")
        : `Request failed: ${response.status}`,
    );
  }
  return data as T;
}

const connectorResponse = await request<{ ok: true; connector: { id: string } }>(
  "/v2/connectors/register",
  {
    provider: "slack",
    display_name: "Slack Connector",
    callback_url: callbackUrl,
    metadata: { demo: true },
  },
);

const connectorId = connectorResponse.connector.id;

const capabilities = [
  {
    name: "slack.post_message",
    description: "Post a message to a Slack channel",
    capability_type: "ACTION",
    risk_level: "MEDIUM",
    scopes: ["chat:write"],
    input_schema: {
      type: "object",
      required: ["text"],
      properties: {
        channel: { type: "string", description: "Channel ID or name" },
        text: { type: "string" },
        thread_ts: { type: "string" },
        blocks: { type: "array" },
      },
    },
  },
  {
    name: "slack.list_channels",
    description: "List Slack channels visible to the bot token",
    capability_type: "QUERY",
    risk_level: "LOW",
    scopes: ["channels:read"],
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        types: { type: "string" },
        exclude_archived: { type: "boolean" },
      },
    },
  },
];

for (const capability of capabilities) {
  await request("/v2/capabilities/register", {
    connector_id: connectorId,
    ...capability,
  });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      connector_id: connectorId,
      callback_url: callbackUrl,
      capabilities: capabilities.map((item) => item.name),
      next_steps: [
        `export SLACK_CONNECTOR_ID=${connectorId}`,
        "export SLACK_BOT_TOKEN=xoxb-...",
        "export SLACK_DEFAULT_CHANNEL=C0123456789",
        "curl -s http://127.0.0.1:3021/v1/authai/public-key | jq -r '.authai_public_key.public_key_pem' > /tmp/cnothing-public.pem",
        "export CNOTHING_PUBLIC_KEY_PEM=\"$(cat /tmp/cnothing-public.pem)\"",
        "bun run examples/slack-connector/index.ts",
      ],
    },
    null,
    2,
  ),
);
