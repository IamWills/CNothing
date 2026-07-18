import config from "../config";
import { ValidationError } from "../utils/errors";
import { assertSafePublicUrlWithDns } from "../v3/url-safety.service";

/**
 * Agent completion callbacks: when the user approves/denies an access request,
 * CNothing POSTs the outcome to the callback_url the agent registered, so the
 * agent doesn't need to poll get_access_status.
 */

export async function validateCallbackUrl(rawUrl: string): Promise<string> {
  const trimmed = rawUrl.trim();
  if (config.e2eInternalEnabled) {
    try {
      return new URL(trimmed).toString();
    } catch {
      throw new ValidationError("Invalid callback_url", { error_code: "invalid_callback_url" });
    }
  }
  const parsed = await assertSafePublicUrlWithDns(trimmed, "callback_url");
  if (parsed.protocol !== "https:") {
    throw new ValidationError("callback_url must be https", {
      error_code: "callback_url_https_required",
    });
  }
  return parsed.toString();
}

export function dispatchAccessRequestCallback(input: {
  callbackUrl: string;
  accessRequestId: string;
  status: "approved" | "denied";
  provider: string;
  grantId?: string | null;
  agentId: string;
}): void {
  const payload = JSON.stringify({
    event: "access_request.decided",
    access_request_id: input.accessRequestId,
    status: input.status,
    provider: input.provider,
    grant_id: input.grantId ?? null,
    agent_id: input.agentId,
    decided_at: new Date().toISOString(),
  });

  // Fire-and-forget: the approval flow must not block on the agent's endpoint.
  void fetch(input.callbackUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "CNothing-Callback/1.0",
    },
    body: payload,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  }).catch((error) => {
    console.warn(
      `[v4-callback] delivery failed for ${input.accessRequestId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
}
