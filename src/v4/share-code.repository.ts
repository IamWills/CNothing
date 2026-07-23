import { randomUUID } from "node:crypto";
import { pool } from "../db";

export type UserShareCodeRecord = {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
};

function asIso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

export async function revokeActiveShareCodes(userId: string): Promise<void> {
  await pool.query(
    `
      UPDATE user_share_codes
      SET revoked_at = NOW()
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
    `,
    [userId],
  );
}

export async function createShareCode(input: {
  user_id: string;
  code_hash: string;
  ttl_seconds: number;
}): Promise<UserShareCodeRecord> {
  const id = randomUUID();
  const result = await pool.query(
    `
      INSERT INTO user_share_codes (id, user_id, code_hash, expires_at)
      VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::interval)
      RETURNING id, user_id, expires_at, created_at
    `,
    [id, input.user_id, input.code_hash, String(input.ttl_seconds)],
  );
  const row = result.rows[0]!;
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    expires_at: asIso(row.expires_at),
    created_at: asIso(row.created_at),
  };
}

export async function findActiveShareCodeUser(codeHash: string): Promise<string | null> {
  const result = await pool.query(
    `
      SELECT user_id FROM user_share_codes
      WHERE code_hash = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()
      LIMIT 1
    `,
    [codeHash],
  );
  const row = result.rows[0];
  return row ? String(row.user_id) : null;
}

export async function findLatestActiveShareCodeMeta(
  userId: string,
): Promise<{ expires_at: string; created_at: string } | null> {
  const result = await pool.query(
    `
      SELECT expires_at, created_at FROM user_share_codes
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { expires_at: asIso(row.expires_at), created_at: asIso(row.created_at) };
}

/** True if this user_id has appeared as a real account (device or OAuth connection). */
export async function userIdentityExists(userId: string): Promise<boolean> {
  const result = await pool.query(
    `
      SELECT 1 AS ok WHERE EXISTS (
        SELECT 1 FROM user_devices WHERE user_id = $1 AND status = 'active'
      ) OR EXISTS (
        SELECT 1 FROM cap_oauth_connections WHERE user_id = $1 AND status <> 'revoked'
      )
    `,
    [userId],
  );
  return Boolean(result.rows[0]);
}
