CREATE TABLE IF NOT EXISTS key_secrets (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  cipher_alg TEXT NOT NULL,
  ciphertext BYTEA NOT NULL,
  cipher_iv BYTEA NOT NULL,
  cipher_tag BYTEA NOT NULL,
  wrapped_dek_alg TEXT NOT NULL,
  wrapped_dek BYTEA NOT NULL,
  wrapped_dek_iv BYTEA NOT NULL,
  wrapped_dek_tag BYTEA NOT NULL,
  secret_fingerprint TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_issued_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS key_secrets_provider_name_uidx
  ON key_secrets(provider, name);

CREATE INDEX IF NOT EXISTS key_secrets_provider_idx
  ON key_secrets(provider);

CREATE OR REPLACE FUNCTION touch_key_secrets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS key_secrets_set_updated_at ON key_secrets;

CREATE TRIGGER key_secrets_set_updated_at
BEFORE UPDATE ON key_secrets
FOR EACH ROW
EXECUTE FUNCTION touch_key_secrets_updated_at();
