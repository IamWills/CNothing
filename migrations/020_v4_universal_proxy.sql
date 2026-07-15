-- v4 Universal Credential-Injecting Proxy
-- Replaces the per-capability model with connection-level grants:
-- one user approval covers every API of an OAuth connection (host/method scoped).

CREATE TABLE IF NOT EXISTS proxy_access_requests (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES cap_agents(id) ON DELETE CASCADE,
  provider_slug TEXT NOT NULL,
  requested_hosts JSONB NOT NULL DEFAULT '[]',
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  user_id TEXT,
  connection_id TEXT REFERENCES cap_oauth_connections(id) ON DELETE SET NULL,
  grant_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour',
  decided_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS proxy_access_requests_agent_idx
  ON proxy_access_requests(agent_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS proxy_grants (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES cap_agents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES cap_oauth_connections(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES cap_oauth_providers(id) ON DELETE CASCADE,
  allowed_hosts JSONB NOT NULL DEFAULT '[]',
  allowed_methods JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS proxy_grants_agent_idx
  ON proxy_grants(agent_id, status);

CREATE INDEX IF NOT EXISTS proxy_grants_user_idx
  ON proxy_grants(user_id, status);

CREATE TABLE IF NOT EXISTS proxy_request_audit (
  id TEXT PRIMARY KEY,
  grant_id TEXT,
  agent_id TEXT,
  connection_id TEXT,
  method TEXT NOT NULL,
  url_host TEXT NOT NULL,
  url_path TEXT NOT NULL,
  status_code INTEGER,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error_code TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS proxy_request_audit_grant_idx
  ON proxy_request_audit(grant_id, created_at DESC);
