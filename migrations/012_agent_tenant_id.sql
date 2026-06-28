-- Multi-tenant foundation: isolate agents (and OAuth connections) by tenant namespace.

ALTER TABLE cap_agents ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE cap_oauth_connections ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS cap_agents_tenant_idx ON cap_agents(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cap_oauth_connections_tenant_idx
  ON cap_oauth_connections(tenant_id, user_id, status);
