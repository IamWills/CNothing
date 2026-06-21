-- OAuth2 authorization states (GitHub and other non-OIDC providers)

CREATE TABLE IF NOT EXISTS cap_oauth2_states (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  state TEXT NOT NULL UNIQUE,
  redirect_after TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cap_oauth2_states_expiry_idx ON cap_oauth2_states(expires_at);
CREATE INDEX IF NOT EXISTS cap_oauth2_states_provider_idx ON cap_oauth2_states(provider, expires_at);
