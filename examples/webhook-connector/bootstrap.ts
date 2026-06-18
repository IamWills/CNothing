/**
 * Bootstrap the Webhook connector and capabilities against a running CNothing instance.
 *
 * Usage:
 *   CNOTHING_BASE_URL=http://127.0.0.1:3021 \
 *   CNOTHING_ADMIN_TOKEN=... \
 *   WEBHOOK_CONNECTOR_CALLBACK_URL=http://127.0.0.1:3033 \
 *   bun run examples/webhook-connector/bootstrap.ts
 */

const baseUrl = (process.env.CNOTHING_BASE_URL ?? "http://127.0.0.1:3021").replace(/\/+$/, "");
const adminToken = process.env.CNOTHING_ADMIN_TOKEN ?? "";
const callbackUrl = process.env.WEBHOOK_CONNECTOR_CALLBACK_URL ?? "http://127.0.0.1:3033";

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
    provider: "webhook",
    display_name: "Webhook Connector",
    callback_url: callbackUrl,
    metadata: { demo: true },
  },
);

const connectorId = connectorResponse.connector.id;

const capabilities = [
  {
    name: "webhook.post",
    description: "POST a JSON payload to a configured webhook URL",
    capability_type: "ACTION",
    risk_level: "MEDIUM",
    scopes: ["webhook.send"],
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        payload: { type: "object" },
        message: { type: "string" },
        headers: { type: "object" },
      },
    },
  },
  {
    name: "webhook.notify",
    description: "Send a structured notification to a webhook endpoint",
    capability_type: "ACTION",
    risk_level: "LOW",
    scopes: ["webhook.send"],
    input_schema: {
      type: "object",
      required: ["message"],
      properties: {
        url: { type: "string" },
        title: { type: "string" },
        message: { type: "string" },
        severity: { type: "string", enum: ["info", "warning", "error"] },
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
        `export WEBHOOK_CONNECTOR_ID=${connectorId}`,
        "export WEBHOOK_DEFAULT_URL=https://hooks.example.com/...",
        "curl -s http://127.0.0.1:3021/v1/authai/public-key | jq -r '.authai_public_key.public_key_pem' > /tmp/cnothing-public.pem",
        "export CNOTHING_PUBLIC_KEY_PEM=\"$(cat /tmp/cnothing-public.pem)\"",
        "bun run examples/webhook-connector/index.ts",
      ],
    },
    null,
    2,
  ),
);
