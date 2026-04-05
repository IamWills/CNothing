CREATE TABLE IF NOT EXISTS authai_client_key_rotations (
  id TEXT PRIMARY KEY,
  client_uuid TEXT NOT NULL REFERENCES authai_clients(client_uuid) ON DELETE CASCADE,
  old_public_key_fingerprint TEXT NOT NULL,
  new_public_key_fingerprint TEXT NOT NULL,
  old_key_id TEXT,
  new_key_id TEXT,
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS authai_client_key_rotations_client_idx
  ON authai_client_key_rotations(client_uuid, created_at DESC);
