-- CNothing v3.0: Universal Trust Broker for AI Agents

CREATE TABLE IF NOT EXISTS cap_secret_vault (
  id TEXT PRIMARY KEY,
  secret_type TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  encrypted_payload BYTEA NOT NULL,
  secret_alg TEXT NOT NULL DEFAULT 'aes-256-gcm/master-key',
  key_version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  fingerprint TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  rotated_from_id TEXT REFERENCES cap_secret_vault(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT cap_secret_vault_type_check CHECK (
    secret_type IN (
      'client_secret',
      'api_key',
      'oauth_code',
      'access_token',
      'refresh_token',
      'private_key',
      'session_cookie'
    )
  ),
  CONSTRAINT cap_secret_vault_owner_check CHECK (
    owner_type IN ('provider', 'connection', 'user', 'agent', 'system')
  ),
  CONSTRAINT cap_secret_vault_status_check CHECK (
    status IN ('active', 'rotated', 'revoked', 'expired')
  )
);

CREATE INDEX IF NOT EXISTS cap_secret_vault_owner_idx
  ON cap_secret_vault(owner_type, owner_id, status);

CREATE INDEX IF NOT EXISTS cap_secret_vault_fingerprint_idx
  ON cap_secret_vault(fingerprint);

CREATE TABLE IF NOT EXISTS cap_provider_proposals (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES cap_agents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  provider_name TEXT NOT NULL,
  proposed_slug TEXT NOT NULL,
  issuer_url TEXT,
  discovery_url TEXT,
  authorization_url TEXT,
  token_url TEXT,
  jwks_url TEXT,
  userinfo_url TEXT,
  registration_endpoint TEXT,
  openapi_url TEXT,
  mcp_url TEXT,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_assessment JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider_id TEXT REFERENCES cap_oauth_providers(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cap_provider_proposals_status_check CHECK (
    status IN ('pending', 'validated', 'created', 'rejected', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS cap_provider_proposals_agent_idx
  ON cap_provider_proposals(agent_id, status);
CREATE INDEX IF NOT EXISTS cap_provider_proposals_slug_idx
  ON cap_provider_proposals(proposed_slug);

CREATE TABLE IF NOT EXISTS cap_trust_audit (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  agent_id TEXT,
  user_id TEXT,
  provider_id TEXT,
  capability_id TEXT,
  grant_id TEXT,
  policy_id TEXT,
  execution_id TEXT,
  latency_ms INT,
  result_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cap_trust_audit_agent_idx
  ON cap_trust_audit(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cap_trust_audit_execution_idx
  ON cap_trust_audit(execution_id);
CREATE INDEX IF NOT EXISTS cap_trust_audit_event_idx
  ON cap_trust_audit(event_type, created_at DESC);
