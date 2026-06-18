CREATE TABLE IF NOT EXISTS cap_authorization_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES cap_agents(id) ON DELETE CASCADE,
  requested_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  granted_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  redirect_uri TEXT,
  state TEXT,
  reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  denied_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cap_authorization_requests_user_idx
  ON cap_authorization_requests(user_id, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS cap_authorization_requests_agent_idx
  ON cap_authorization_requests(agent_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS cap_invoke_audit_created_idx
  ON cap_invoke_audit(created_at DESC);
