CREATE TABLE IF NOT EXISTS authai_clients (
  client_uuid TEXT PRIMARY KEY,
  public_key_pem TEXT NOT NULL,
  public_key_fingerprint TEXT NOT NULL UNIQUE,
  key_alg TEXT NOT NULL,
  key_id TEXT,
  client_label TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS authai_challenges (
  challenge_id TEXT PRIMARY KEY,
  client_uuid TEXT NOT NULL REFERENCES authai_clients(client_uuid) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS authai_challenges_client_idx
  ON authai_challenges(client_uuid, status, expires_at);

CREATE TABLE IF NOT EXISTS authai_kv_records (
  id TEXT PRIMARY KEY,
  client_uuid TEXT NOT NULL REFERENCES authai_clients(client_uuid) ON DELETE CASCADE,
  namespace TEXT NOT NULL,
  record_key TEXT NOT NULL,
  cipher_alg TEXT NOT NULL,
  ciphertext BYTEA NOT NULL,
  cipher_iv BYTEA NOT NULL,
  cipher_tag BYTEA NOT NULL,
  wrapped_dek_alg TEXT NOT NULL,
  wrapped_dek BYTEA NOT NULL,
  wrapped_dek_iv BYTEA NOT NULL,
  wrapped_dek_tag BYTEA NOT NULL,
  value_fingerprint TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS authai_kv_records_scope_uidx
  ON authai_kv_records(client_uuid, namespace, record_key);

CREATE INDEX IF NOT EXISTS authai_kv_records_client_idx
  ON authai_kv_records(client_uuid, namespace, updated_at);

CREATE TABLE IF NOT EXISTS authai_audit_events (
  id TEXT PRIMARY KEY,
  client_uuid TEXT REFERENCES authai_clients(client_uuid) ON DELETE SET NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  request_id TEXT,
  error_code TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS authai_audit_events_client_idx
  ON authai_audit_events(client_uuid, created_at DESC);

CREATE OR REPLACE FUNCTION touch_authai_clients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS authai_clients_set_updated_at ON authai_clients;

CREATE TRIGGER authai_clients_set_updated_at
BEFORE UPDATE ON authai_clients
FOR EACH ROW
EXECUTE FUNCTION touch_authai_clients_updated_at();

CREATE OR REPLACE FUNCTION touch_authai_kv_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS authai_kv_records_set_updated_at ON authai_kv_records;

CREATE TRIGGER authai_kv_records_set_updated_at
BEFORE UPDATE ON authai_kv_records
FOR EACH ROW
EXECUTE FUNCTION touch_authai_kv_records_updated_at();
