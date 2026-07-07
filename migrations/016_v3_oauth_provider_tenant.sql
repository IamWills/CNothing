-- v3: provider-level tenant for Vault migration

ALTER TABLE cap_oauth_providers
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS cap_oauth_providers_tenant_idx
  ON cap_oauth_providers(tenant_id, status);
