import { createSign } from "node:crypto";
import { connect } from "node:http2";

import config from "../config";

/**
 * Minimal APNs provider client (token-based auth, HTTP/2).
 * If KEYSERVICE_APNS_KEY_PATH / KEY_ID / TEAM_ID are not configured the service
 * degrades gracefully: sendPush() becomes a no-op and the iOS app falls back to
 * polling GET /v4/access-requests/pending.
 */

let cachedJwt: { token: string; issuedAt: number } | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function buildProviderJwt(apns: NonNullable<typeof config.apns>): string {
  // APNs allows reusing a provider token for 20–60 minutes; refresh at 40.
  if (cachedJwt && Date.now() - cachedJwt.issuedAt < 40 * 60 * 1000) {
    return cachedJwt.token;
  }
  const header = base64url(JSON.stringify({ alg: "ES256", kid: apns.keyId }));
  const claims = base64url(
    JSON.stringify({ iss: apns.teamId, iat: Math.floor(Date.now() / 1000) }),
  );
  const signer = createSign("SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign({ key: apns.keyPem, dsaEncoding: "ieee-p1363" });
  const token = `${header}.${claims}.${base64url(signature)}`;
  cachedJwt = { token, issuedAt: Date.now() };
  return token;
}

export type PushResult = { sent: number; failed: number; skipped: boolean };

export async function sendApprovalPush(input: {
  devices: Array<{ push_token: string | null; push_environment: string }>;
  accessRequestId: string;
  provider: string;
  agentName: string;
  reason?: string | null;
}): Promise<PushResult> {
  const apns = config.apns;
  const targets = input.devices.filter((device) => device.push_token);
  if (!apns || targets.length === 0) {
    return { sent: 0, failed: 0, skipped: true };
  }

  // loc-keys are resolved by the iOS app's Localizable.xcstrings, so the
  // notification follows each device's language (en / zh-Hans).
  const payload = JSON.stringify({
    aps: {
      alert: {
        "title-loc-key": "PUSH_APPROVAL_TITLE",
        subtitle: input.provider,
        "loc-key": input.reason ? "PUSH_APPROVAL_BODY_REASON" : "PUSH_APPROVAL_BODY",
        "loc-args": input.reason
          ? [input.agentName, input.reason]
          : [input.agentName, input.provider],
      },
      sound: "default",
      category: "CNOTHING_APPROVAL",
      "mutable-content": 1,
    },
    access_request_id: input.accessRequestId,
    provider: input.provider,
  });

  const jwt = buildProviderJwt(apns);
  let sent = 0;
  let failed = 0;

  // Group by environment; sandbox tokens must go to the sandbox host.
  const environments = new Map<string, string[]>();
  for (const device of targets) {
    const host =
      device.push_environment === "sandbox"
        ? "https://api.sandbox.push.apple.com"
        : "https://api.push.apple.com";
    const list = environments.get(host) ?? [];
    list.push(device.push_token!);
    environments.set(host, list);
  }

  for (const [host, tokens] of environments) {
    const session = connect(host);
    const sessionError = new Promise<never>((_, reject) => {
      session.on("error", reject);
    });
    try {
      for (const token of tokens) {
        const ok = await Promise.race([
          new Promise<boolean>((resolve) => {
            const stream = session.request({
              ":method": "POST",
              ":path": `/3/device/${token}`,
              authorization: `bearer ${jwt}`,
              "apns-topic": apns.bundleId,
              "apns-push-type": "alert",
              "apns-priority": "10",
              "content-type": "application/json",
            });
            let status = 0;
            stream.on("response", (headers) => {
              status = Number(headers[":status"] ?? 0);
            });
            stream.on("close", () => resolve(status === 200));
            stream.on("error", () => resolve(false));
            stream.setTimeout(10_000, () => {
              stream.close();
              resolve(false);
            });
            stream.end(payload);
          }),
          sessionError,
        ]).catch(() => false);
        if (ok) {
          sent += 1;
        } else {
          failed += 1;
        }
      }
    } finally {
      session.close();
    }
  }

  return { sent, failed, skipped: false };
}
