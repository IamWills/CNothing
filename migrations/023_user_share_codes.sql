-- Share codes: short agent-facing aliases for a CNothing user_id (e.g. u_7K2M9P → github:alice).
-- Generated on the Devices page so humans can paste a short code instead of their full user_id.

CREATE TABLE IF NOT EXISTS user_share_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  code_prefix TEXT NOT NULL DEFAULT 'u_',
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_share_codes_user_idx
  ON user_share_codes(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS user_share_codes_active_hash_idx
  ON user_share_codes(code_hash)
  WHERE revoked_at IS NULL;
