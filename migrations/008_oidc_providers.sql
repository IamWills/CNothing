CREATE TABLE IF NOT EXISTS cap_oidc_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  issuer TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  client_secret_encrypted BYTEA NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'openid profile email',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cap_oidc_states (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES cap_oidc_providers(id) ON DELETE CASCADE,
  state TEXT NOT NULL UNIQUE,
  nonce TEXT NOT NULL,
  redirect_after TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cap_oidc_states_expiry_idx ON cap_oidc_states(expires_at);

CREATE TABLE IF NOT EXISTS cap_user_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES cap_oidc_providers(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  email TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_id, subject)
);

CREATE INDEX IF NOT EXISTS cap_user_identities_user_idx ON cap_user_identities(user_id);
