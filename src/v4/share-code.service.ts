import { createHmac, randomBytes } from "node:crypto";

import config from "../config";
import {
  createShareCode,
  findActiveShareCodeUser,
  findLatestActiveShareCodeMeta,
  revokeActiveShareCodes,
  userIdentityExists,
} from "./share-code.repository";
import { normalizeShareCodeInput } from "./share-code.util";

export { normalizeShareCodeInput } from "./share-code.util";

/** 90 days — long enough for agents to reuse across sessions. */
const SHARE_CODE_TTL_SECONDS = 90 * 24 * 60 * 60;

function hashShareCode(code: string): string {
  return createHmac("sha256", config.masterKey)
    .update(`user-share:${code.trim().toUpperCase()}`)
    .digest("hex");
}

/** Human/agent-typable: u_ + 6 chars from unambiguous alphabet. */
function generateShareCodeBody(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let body = "";
  for (const byte of bytes) {
    body += alphabet[byte! % alphabet.length];
  }
  return body;
}

export class ShareCodeService {
  async issueShareCode(userId: string) {
    await revokeActiveShareCodes(userId);
    const body = generateShareCodeBody();
    const code = `u_${body}`;
    const record = await createShareCode({
      user_id: userId,
      code_hash: hashShareCode(code),
      ttl_seconds: SHARE_CODE_TTL_SECONDS,
    });
    return {
      ok: true as const,
      user_id: userId,
      share_code: code,
      expires_at: record.expires_at,
      share_with_agent: `My CNothing agent ID is ${userId}. Short code: ${code}. Use either as user_id in request_access so approvals push to my phone.`,
    };
  }

  async getShareCodeStatus(userId: string) {
    const meta = await findLatestActiveShareCodeMeta(userId);
    return {
      ok: true as const,
      user_id: userId,
      has_active_code: Boolean(meta),
      expires_at: meta?.expires_at ?? null,
    };
  }

  async resolveToUserId(raw: string): Promise<string | null> {
    const normalized = normalizeShareCodeInput(raw);
    if (!normalized.startsWith("U_")) {
      return null;
    }
    return findActiveShareCodeUser(hashShareCode(normalized));
  }
}

export const shareCodeService = new ShareCodeService();

/**
 * Resolve an agent-supplied identity hint to a canonical CNothing user_id.
 * Accepts: full id (github:alice), share code (u_XXXXXX), or github login (alice → github:alice if known).
 */
export async function resolveAgentUserHint(raw?: string): Promise<{
  userId?: string;
  unresolved?: string;
}> {
  const value = raw?.trim();
  if (!value) {
    return {};
  }

  // Explicit provider-prefixed id — always accept as targeting hint.
  if (value.includes(":")) {
    return { userId: value };
  }

  // Share code
  const fromCode = await shareCodeService.resolveToUserId(value);
  if (fromCode) {
    return { userId: fromCode };
  }

  // GitHub login alias (only if that account already exists on the platform)
  if (/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value)) {
    const githubId = `github:${value}`;
    if (await userIdentityExists(githubId)) {
      return { userId: githubId };
    }
  }

  return { unresolved: value };
}
