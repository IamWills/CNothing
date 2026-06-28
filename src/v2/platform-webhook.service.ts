import config from "../config";
import type { JsonObject } from "./v2.entity";

export type PlatformWebhookEvent =
  | "oauth.connection.created"
  | "grant.approved"
  | "import.capabilities.activated";

export async function emitPlatformWebhook(input: {
  event: PlatformWebhookEvent;
  payload: JsonObject;
}): Promise<void> {
  const url = config.platformWebhookUrl;
  if (!url) {
    return;
  }

  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: input.event,
        payload: input.payload,
        emitted_at: new Date().toISOString(),
        service: config.serviceName,
      }),
    });
  } catch {
    /* webhook delivery is best-effort */
  }
}
