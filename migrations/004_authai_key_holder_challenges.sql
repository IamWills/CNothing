CREATE TABLE IF NOT EXISTS authai_key_holder_challenges (
  verification_id TEXT PRIMARY KEY,
  target_public_key_fingerprint TEXT NOT NULL,
  purpose TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS authai_key_holder_challenges_scope_idx
  ON authai_key_holder_challenges(target_public_key_fingerprint, status, expires_at);
