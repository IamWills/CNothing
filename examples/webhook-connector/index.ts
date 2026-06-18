import { createConnectorHandler } from "../../src/connector-sdk/index";

const connectorId = process.env.WEBHOOK_CONNECTOR_ID ?? "";
const cnothingPublicKeyPem = process.env.CNOTHING_PUBLIC_KEY_PEM ?? "";
const defaultWebhookUrl = process.env.WEBHOOK_DEFAULT_URL ?? "";
const port = Number(process.env.PORT ?? "3033");

if (!connectorId) {
  throw new Error("WEBHOOK_CONNECTOR_ID is required");
}
if (!cnothingPublicKeyPem) {
  throw new Error("CNOTHING_PUBLIC_KEY_PEM is required");
}

async function postWebhook(url: string, payload: unknown, headers: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // keep raw text
  }

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "message" in data
        ? String((data as { message?: string }).message ?? `Webhook returned ${response.status}`)
        : `Webhook returned ${response.status}`;
    throw new Error(message);
  }

  return {
    status: response.status,
    body: data,
  };
}

const handler = createConnectorHandler({
  connectorId,
  cnothingPublicKeyPem,
  executeCapability: async (input) => {
    switch (input.capability) {
      case "webhook.post": {
        const url = String(input.input.url ?? defaultWebhookUrl);
        if (!url.trim()) {
          throw new Error("input.url or WEBHOOK_DEFAULT_URL is required");
        }

        const payload =
          input.input.payload && typeof input.input.payload === "object"
            ? input.input.payload
            : { message: String(input.input.message ?? "") };

        const extraHeaders =
          input.input.headers && typeof input.input.headers === "object" && !Array.isArray(input.input.headers)
            ? Object.fromEntries(
                Object.entries(input.input.headers as Record<string, unknown>).map(([key, value]) => [
                  key,
                  String(value),
                ]),
              )
            : {};

        return postWebhook(url, payload, extraHeaders);
      }

      case "webhook.notify": {
        const url = String(input.input.url ?? defaultWebhookUrl);
        if (!url.trim()) {
          throw new Error("input.url or WEBHOOK_DEFAULT_URL is required");
        }

        const title = String(input.input.title ?? "CNothing notification");
        const message = String(input.input.message ?? "");
        const severity = String(input.input.severity ?? "info");

        return postWebhook(url, {
          title,
          message,
          severity,
          source: "cnothing-webhook-connector",
          user_id: input.user_id,
          agent_id: input.agent_id,
          capability: input.capability,
          timestamp: new Date().toISOString(),
        });
      }

      default:
        throw new Error(`Unsupported capability: ${input.capability}`);
    }
  },
});

Bun.serve({ port, fetch: handler });

console.log(`Webhook connector listening on http://localhost:${port}`);
