import { createConnectorHandler } from "../../src/connector-sdk/index";

const connectorId = process.env.SLACK_CONNECTOR_ID ?? "";
const cnothingPublicKeyPem = process.env.CNOTHING_PUBLIC_KEY_PEM ?? "";
const slackBotToken = process.env.SLACK_BOT_TOKEN ?? "";
const defaultChannel = process.env.SLACK_DEFAULT_CHANNEL ?? "";
const port = Number(process.env.PORT ?? "3032");

if (!connectorId) {
  throw new Error("SLACK_CONNECTOR_ID is required");
}
if (!cnothingPublicKeyPem) {
  throw new Error("CNOTHING_PUBLIC_KEY_PEM is required");
}
if (!slackBotToken) {
  throw new Error("SLACK_BOT_TOKEN is required");
}

async function slackRequest(method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${slackBotToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as { ok?: boolean; error?: string; [key: string]: unknown };
  if (!response.ok || !data.ok) {
    throw new Error(data.error ?? `Slack API returned ${response.status}`);
  }
  return data;
}

const handler = createConnectorHandler({
  connectorId,
  cnothingPublicKeyPem,
  executeCapability: async (input) => {
    switch (input.capability) {
      case "slack.post_message": {
        const channel = String(input.input.channel ?? defaultChannel);
        const text = String(input.input.text ?? "");
        if (!channel.trim()) {
          throw new Error("input.channel or SLACK_DEFAULT_CHANNEL is required");
        }
        if (!text.trim()) {
          throw new Error("input.text is required");
        }
        const data = await slackRequest("chat.postMessage", {
          channel,
          text,
          thread_ts: typeof input.input.thread_ts === "string" ? input.input.thread_ts : undefined,
          blocks: Array.isArray(input.input.blocks) ? input.input.blocks : undefined,
        });
        return {
          channel: data.channel,
          ts: data.ts,
          message: data.message,
        };
      }

      case "slack.list_channels": {
        const limit = Number(input.input.limit ?? 100);
        const data = await slackRequest("conversations.list", {
          limit: Math.min(Math.max(limit, 1), 200),
          types: String(input.input.types ?? "public_channel,private_channel"),
          exclude_archived: input.input.exclude_archived !== false,
        });
        return { channels: data.channels };
      }

      default:
        throw new Error(`Unsupported capability: ${input.capability}`);
    }
  },
});

Bun.serve({ port, fetch: handler });

console.log(`Slack connector listening on http://localhost:${port}`);
