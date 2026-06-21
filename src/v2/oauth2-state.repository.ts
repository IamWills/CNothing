import { randomUUID } from "node:crypto";
import { pool } from "../db";

export type OAuth2StateRecord = {
  id: string;
  provider: string;
  state: string;
  redirect_after: string | null;
  expires_at: string;
  consumed_at: string | null;
};

function asIso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

export async function createOAuth2State(input: {
  provider: string;
  state: string;
  redirect_after?: string;
  ttl_seconds?: number;
}): Promise<void> {
  await pool.query(
    `
      INSERT INTO cap_oauth2_states (id, provider, state, redirect_after, expires_at)
      VALUES ($1, $2, $3, $4, NOW() + ($5 || ' seconds')::interval)
    `,
    [
      randomUUID(),
      input.provider,
      input.state,
      input.redirect_after ?? null,
      String(input.ttl_seconds ?? 600),
    ],
  );
}

export async function consumeOAuth2State(state: string): Promise<OAuth2StateRecord | null> {
  const result = await pool.query(
    `
      UPDATE cap_oauth2_states
      SET consumed_at = NOW()
      WHERE state = $1
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING *
    `,
    [state],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: String(row.id),
    provider: String(row.provider),
    state: String(row.state),
    redirect_after: row.redirect_after ? String(row.redirect_after) : null,
    expires_at: asIso(row.expires_at),
    consumed_at: row.consumed_at ? asIso(row.consumed_at) : null,
  };
}
