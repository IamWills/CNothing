-- CNothing v2.5: Universal OAuth Broker + Capability Gateway

CREATE TABLE IF NOT EXISTS cap_oauth_providers (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'oauth2',
  authorization_url TEXT,
  token_url TEXT,
  userinfo_url TEXT,
  revoke_url TEXT,
  jwks_url TEXT,
  client_id TEXT,
  encrypted_client_secret BYTEA,
  secret_alg TEXT DEFAULT 'aes-256-gcm/master-key',
  default_scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  supported_scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  pkce_required BOOLEAN NOT NULL DEFAULT TRUE,
  token_auth_method TEXT NOT NULL DEFAULT 'client_secret_post',
  status TEXT NOT NULL DEFAULT 'active',
  is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cap_oauth_providers_auth_type_check CHECK (
    auth_type IN ('oauth2', 'oidc', 'api_key', 'custom')
  )
);

CREATE INDEX IF NOT EXISTS cap_oauth_providers_slug_idx ON cap_oauth_providers(slug, status);

CREATE TABLE IF NOT EXISTS cap_oauth_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES cap_oauth_providers(id) ON DELETE CASCADE,
  provider_account_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  encrypted_access_token BYTEA NOT NULL,
  encrypted_refresh_token BYTEA,
  token_alg TEXT NOT NULL DEFAULT 'aes-256-gcm/master-key',
  expires_at TIMESTAMPTZ,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  token_type TEXT NOT NULL DEFAULT 'Bearer',
  status TEXT NOT NULL DEFAULT 'active',
  last_used_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cap_oauth_connections_status_check CHECK (
    status IN ('active', 'reconnect_required', 'revoked')
  )
);

CREATE INDEX IF NOT EXISTS cap_oauth_connections_user_idx
  ON cap_oauth_connections(user_id, status);
CREATE INDEX IF NOT EXISTS cap_oauth_connections_provider_idx
  ON cap_oauth_connections(provider_id, user_id, status);

CREATE TABLE IF NOT EXISTS cap_oauth_connect_states (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES cap_oauth_providers(id) ON DELETE CASCADE,
  user_id TEXT,
  state TEXT NOT NULL UNIQUE,
  code_verifier TEXT,
  redirect_after TEXT,
  purpose TEXT NOT NULL DEFAULT 'connection',
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cap_oauth_connect_states_state_idx
  ON cap_oauth_connect_states(state, expires_at);

-- Extend capabilities for v2.5
ALTER TABLE cap_capabilities ADD COLUMN IF NOT EXISTS provider_id TEXT REFERENCES cap_oauth_providers(id) ON DELETE SET NULL;
ALTER TABLE cap_capabilities ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE cap_capabilities ADD COLUMN IF NOT EXISTS connection_required BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE cap_capabilities ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'built_in';
ALTER TABLE cap_capabilities ADD COLUMN IF NOT EXISTS invocation_type TEXT NOT NULL DEFAULT 'builtin';
ALTER TABLE cap_capabilities ADD COLUMN IF NOT EXISTS invocation_config JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE cap_capabilities ADD COLUMN IF NOT EXISTS policy_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Extend grants for v2.5 CapabilityGrant model
ALTER TABLE cap_grants ADD COLUMN IF NOT EXISTS provider_id TEXT REFERENCES cap_oauth_providers(id) ON DELETE SET NULL;
ALTER TABLE cap_grants ADD COLUMN IF NOT EXISTS connection_id TEXT REFERENCES cap_oauth_connections(id) ON DELETE SET NULL;
ALTER TABLE cap_grants ADD COLUMN IF NOT EXISTS grant_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE cap_grants ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

-- Extend audit log
ALTER TABLE cap_invoke_audit ADD COLUMN IF NOT EXISTS provider_id TEXT;
ALTER TABLE cap_invoke_audit ADD COLUMN IF NOT EXISTS connection_id TEXT;
ALTER TABLE cap_invoke_audit ADD COLUMN IF NOT EXISTS risk_level TEXT;
ALTER TABLE cap_invoke_audit ADD COLUMN IF NOT EXISTS input_hash TEXT;
ALTER TABLE cap_invoke_audit ADD COLUMN IF NOT EXISTS output_hash TEXT;
ALTER TABLE cap_invoke_audit ADD COLUMN IF NOT EXISTS success BOOLEAN;

-- Import jobs for OpenAPI / MCP
CREATE TABLE IF NOT EXISTS cap_import_jobs (
  id TEXT PRIMARY KEY,
  import_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  source_url TEXT,
  source_filename TEXT,
  provider_id TEXT REFERENCES cap_oauth_providers(id) ON DELETE SET NULL,
  candidate_count INT NOT NULL DEFAULT 0,
  candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cap_import_jobs_type_check CHECK (import_type IN ('openapi', 'mcp'))
);

CREATE INDEX IF NOT EXISTS cap_import_jobs_status_idx ON cap_import_jobs(status, created_at DESC);

-- OAuth audit events (connection lifecycle)
CREATE TABLE IF NOT EXISTS cap_oauth_audit (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  provider_id TEXT,
  connection_id TEXT,
  action TEXT NOT NULL,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error_code TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cap_oauth_audit_user_idx ON cap_oauth_audit(user_id, created_at DESC);

-- Extend policy actions
ALTER TABLE cap_policies DROP CONSTRAINT IF EXISTS cap_policies_action_check;
-- Note: PostgreSQL may not have action check; add new default policies

INSERT INTO cap_policies (id, capability_pattern, action, priority, metadata)
VALUES
  ('policy-delete-high', '*.delete_*', 'require_user_confirmation', 5, '{"reason":"delete operation"}'::jsonb),
  ('policy-payment-high', '*.payment_*', 'require_user_confirmation', 5, '{"reason":"payment operation"}'::jsonb),
  ('policy-transfer-high', '*.transfer_*', 'require_user_confirmation', 5, '{"reason":"transfer operation"}'::jsonb),
  ('policy-admin-high', '*.admin_*', 'require_user_confirmation', 5, '{"reason":"admin operation"}'::jsonb),
  ('policy-read-email-confidential', '*.read_*email*', 'require_user_confirmation', 8, '{"reason":"email content access"}'::jsonb),
  ('policy-read-message-confidential', 'gmail.read_message', 'require_user_confirmation', 8, '{"reason":"confidential message content"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Migrate existing revoked grants to grant_status
UPDATE cap_grants SET grant_status = 'revoked' WHERE revoked = TRUE AND grant_status = 'approved';
UPDATE cap_grants SET grant_status = 'approved' WHERE revoked = FALSE AND grant_status IS NULL;

-- Seed built-in OAuth provider templates (client_id configured at runtime)
INSERT INTO cap_oauth_providers (
  id, slug, display_name, auth_type,
  authorization_url, token_url, userinfo_url, revoke_url,
  default_scopes, supported_scopes, pkce_required, token_auth_method,
  status, is_builtin, metadata
) VALUES
  (
    'provider-github',
    'github',
    'GitHub',
    'oauth2',
    'https://github.com/login/oauth/authorize',
    'https://github.com/login/oauth/access_token',
    'https://api.github.com/user',
    NULL,
    '["repo","read:user","user:email"]'::jsonb,
    '["repo","read:user","user:email","repo:status","public_repo"]'::jsonb,
    FALSE,
    'client_secret_post',
    'unconfigured',
    TRUE,
    '{"template":"github"}'::jsonb
  ),
  (
    'provider-google',
    'google',
    'Google',
    'oidc',
    'https://accounts.google.com/o/oauth2/v2/auth',
    'https://oauth2.googleapis.com/token',
    'https://openidconnect.googleapis.com/v1/userinfo',
    'https://oauth2.googleapis.com/revoke',
    '["openid","email","profile"]'::jsonb,
    '["openid","email","profile","https://www.googleapis.com/auth/gmail.send","https://www.googleapis.com/auth/gmail.readonly"]'::jsonb,
    TRUE,
    'client_secret_post',
    'unconfigured',
    TRUE,
    '{"template":"google"}'::jsonb
  ),
  (
    'provider-microsoft',
    'microsoft',
    'Microsoft',
    'oidc',
    'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    'https://graph.microsoft.com/oidc/userinfo',
    NULL,
    '["openid","email","profile","offline_access"]'::jsonb,
    '["openid","email","profile","offline_access","User.Read"]'::jsonb,
    TRUE,
    'client_secret_post',
    'unconfigured',
    TRUE,
    '{"template":"microsoft"}'::jsonb
  ),
  (
    'provider-slack',
    'slack',
    'Slack',
    'oauth2',
    'https://slack.com/oauth/v2/authorize',
    'https://slack.com/api/oauth.v2.access',
    NULL,
    NULL,
    '["channels:read","chat:write","users:read"]'::jsonb,
    '["channels:read","chat:write","users:read","groups:read"]'::jsonb,
    FALSE,
    'client_secret_post',
    'unconfigured',
    TRUE,
    '{"template":"slack"}'::jsonb
  ),
  (
    'provider-notion',
    'notion',
    'Notion',
    'oauth2',
    'https://api.notion.com/v1/oauth/authorize',
    'https://api.notion.com/v1/oauth/token',
    NULL,
    NULL,
    '[]'::jsonb,
    '[]'::jsonb,
    FALSE,
    'client_secret_basic',
    'unconfigured',
    TRUE,
    '{"template":"notion"}'::jsonb
  )
ON CONFLICT (slug) DO NOTHING;
