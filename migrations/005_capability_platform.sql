-- CNothing v2: Agent Capability Authorization Platform

CREATE TABLE IF NOT EXISTS cap_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public_key_pem TEXT,
  owner_user_id TEXT NOT NULL,
  access_token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cap_agents_owner_idx ON cap_agents(owner_user_id, status);

CREATE TABLE IF NOT EXISTS cap_connectors (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  public_key_pem TEXT,
  callback_url TEXT NOT NULL,
  jwks_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cap_connectors_provider_idx ON cap_connectors(provider, status);

CREATE TABLE IF NOT EXISTS cap_credentials (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL REFERENCES cap_connectors(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL,
  encrypted_secret BYTEA NOT NULL,
  secret_alg TEXT NOT NULL DEFAULT 'aes-256-gcm/master-key',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cap_credentials_connector_owner_idx
  ON cap_credentials(connector_id, owner_user_id);

CREATE TABLE IF NOT EXISTS cap_capabilities (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL REFERENCES cap_connectors(id) ON DELETE CASCADE,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  capability_type TEXT NOT NULL DEFAULT 'ACTION',
  input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_level TEXT NOT NULL DEFAULT 'LOW',
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cap_capabilities_connector_idx ON cap_capabilities(connector_id, status);

CREATE TABLE IF NOT EXISTS cap_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES cap_agents(id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL REFERENCES cap_capabilities(id) ON DELETE CASCADE,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS cap_grants_active_uidx
  ON cap_grants(user_id, agent_id, capability_id)
  WHERE revoked = FALSE;

CREATE INDEX IF NOT EXISTS cap_grants_agent_idx ON cap_grants(agent_id, revoked, expires_at);

CREATE TABLE IF NOT EXISTS cap_policies (
  id TEXT PRIMARY KEY,
  capability_id TEXT REFERENCES cap_capabilities(id) ON DELETE CASCADE,
  capability_pattern TEXT,
  risk_level TEXT,
  capability_type TEXT,
  action TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cap_policies_target_check CHECK (
    capability_id IS NOT NULL
    OR capability_pattern IS NOT NULL
    OR risk_level IS NOT NULL
    OR capability_type IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS cap_policies_lookup_idx
  ON cap_policies(enabled, priority, capability_id);

CREATE TABLE IF NOT EXISTS cap_invoke_audit (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  agent_id TEXT REFERENCES cap_agents(id) ON DELETE SET NULL,
  capability_id TEXT REFERENCES cap_capabilities(id) ON DELETE SET NULL,
  capability_name TEXT NOT NULL,
  connector_id TEXT REFERENCES cap_connectors(id) ON DELETE SET NULL,
  policy_decision TEXT NOT NULL,
  status TEXT NOT NULL,
  request_id TEXT,
  error_code TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cap_invoke_audit_agent_idx
  ON cap_invoke_audit(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS cap_invoke_audit_user_idx
  ON cap_invoke_audit(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cap_pending_confirmations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES cap_agents(id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL REFERENCES cap_capabilities(id) ON DELETE CASCADE,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cap_pending_confirmations_user_idx
  ON cap_pending_confirmations(user_id, expires_at);

-- Default policy rules
INSERT INTO cap_policies (id, capability_type, action, priority, metadata)
VALUES
  ('policy-confidential-query-confirm', 'CONFIDENTIAL_QUERY', 'require_user_confirmation', 10, '{"reason":"confidential data access"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO cap_policies (id, risk_level, action, priority, metadata)
VALUES
  ('policy-high-risk-confirm', 'HIGH', 'require_user_confirmation', 20, '{"reason":"high risk capability"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
