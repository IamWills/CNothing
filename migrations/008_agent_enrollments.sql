-- User-approved Agent enrollment.
-- A plugin may create a pending enrollment without a credential. No Agent row
-- or access token exists until a signed-in user approves it. The plaintext
-- token is encrypted on the enrollment row only until the plugin claims it.

CREATE TABLE IF NOT EXISTS cap_agent_enrollments (
  id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  client_uri TEXT,
  software_id TEXT,
  user_code TEXT NOT NULL,
  enrollment_secret_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  owner_user_id TEXT,
  agent_id TEXT REFERENCES cap_agents(id),
  access_token_encrypted BYTEA,
  issued_ip TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  denied_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cap_agent_enrollments_status_check
    CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  CONSTRAINT cap_agent_enrollments_client_name_check
    CHECK (char_length(client_name) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS cap_agent_enrollments_status_idx
  ON cap_agent_enrollments(status, expires_at);
CREATE INDEX IF NOT EXISTS cap_agent_enrollments_ip_idx
  ON cap_agent_enrollments(issued_ip, created_at DESC);
CREATE INDEX IF NOT EXISTS cap_agent_enrollments_owner_idx
  ON cap_agent_enrollments(owner_user_id, created_at DESC);
