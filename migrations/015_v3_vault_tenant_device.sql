-- CNothing v3.0 phase 2: Vault-backed OAuth tokens, tenant isolation, device flow

ALTER TABLE cap_oauth_connections
  ADD COLUMN IF NOT EXISTS access_token_secret_id TEXT REFERENCES cap_secret_vault(id),
  ADD COLUMN IF NOT EXISTS refresh_token_secret_id TEXT REFERENCES cap_secret_vault(id);

ALTER TABLE cap_oauth_connections
  ALTER COLUMN encrypted_access_token DROP NOT NULL;

ALTER TABLE cap_oauth_providers
  ADD COLUMN IF NOT EXISTS client_secret_vault_id TEXT REFERENCES cap_secret_vault(id),
  ADD COLUMN IF NOT EXISTS device_authorization_endpoint TEXT,
  ADD COLUMN IF NOT EXISTS registration_endpoint TEXT;

ALTER TABLE cap_grants ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE cap_provider_proposals ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE cap_trust_audit ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE cap_secret_vault ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS cap_grants_tenant_idx ON cap_grants(tenant_id, agent_id);
CREATE INDEX IF NOT EXISTS cap_provider_proposals_tenant_idx
  ON cap_provider_proposals(tenant_id, agent_id);
CREATE INDEX IF NOT EXISTS cap_secret_vault_tenant_idx
  ON cap_secret_vault(tenant_id, owner_type, owner_id, status);

CREATE TABLE IF NOT EXISTS cap_oauth_device_sessions (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES cap_oauth_providers(id) ON DELETE CASCADE,
  user_id TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  device_code TEXT NOT NULL UNIQUE,
  user_code TEXT NOT NULL,
  verification_uri TEXT NOT NULL,
  verification_uri_complete TEXT,
  poll_interval_seconds INT NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  connection_id TEXT REFERENCES cap_oauth_connections(id) ON DELETE SET NULL,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cap_oauth_device_sessions_status_check CHECK (
    status IN ('pending', 'authorized', 'expired', 'denied', 'completed')
  )
);

CREATE INDEX IF NOT EXISTS cap_oauth_device_sessions_device_code_idx
  ON cap_oauth_device_sessions(device_code, status);
CREATE INDEX IF NOT EXISTS cap_oauth_device_sessions_user_code_idx
  ON cap_oauth_device_sessions(user_code);
