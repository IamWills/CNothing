-- CNothing v4 canonical schema.
--
-- This migration is intentionally idempotent. It supports both a fresh v4 install
-- and an upgrade from a database that previously ran the v1-v3 migration chain.

CREATE TABLE IF NOT EXISTS cap_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public_key_pem TEXT,
  owner_user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  access_token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cap_agents_status_check CHECK (status IN ('active', 'suspended', 'revoked'))
);

ALTER TABLE cap_agents ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS cap_agents_owner_idx ON cap_agents(owner_user_id, status);
CREATE INDEX IF NOT EXISTS cap_agents_tenant_idx ON cap_agents(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cap_user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cap_user_sessions_user_idx
  ON cap_user_sessions(user_id, revoked, expires_at DESC);

CREATE TABLE IF NOT EXISTS cap_oidc_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  issuer TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  client_secret_encrypted BYTEA NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'openid profile email',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cap_oidc_states (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES cap_oidc_providers(id) ON DELETE CASCADE,
  state TEXT NOT NULL UNIQUE,
  nonce TEXT NOT NULL,
  redirect_after TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cap_oidc_states_expiry_idx ON cap_oidc_states(expires_at);

CREATE TABLE IF NOT EXISTS cap_user_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES cap_oidc_providers(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  email TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_id, subject)
);

CREATE INDEX IF NOT EXISTS cap_user_identities_user_idx ON cap_user_identities(user_id);

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
  secret_ref TEXT,
  provider_id TEXT,
  user_id TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  rotated_from_id TEXT REFERENCES cap_secret_vault(id),
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cap_secret_vault_owner_check CHECK (
    owner_type IN ('provider', 'connection', 'user', 'agent', 'system')
  ),
  CONSTRAINT cap_secret_vault_status_check CHECK (
    status IN ('active', 'rotated', 'revoked', 'expired')
  )
);

ALTER TABLE cap_secret_vault ADD COLUMN IF NOT EXISTS secret_ref TEXT;
ALTER TABLE cap_secret_vault ADD COLUMN IF NOT EXISTS provider_id TEXT;
ALTER TABLE cap_secret_vault ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE cap_secret_vault ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE cap_secret_vault ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ;
UPDATE cap_secret_vault SET secret_ref = id WHERE secret_ref IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cap_secret_vault_secret_ref_uidx
  ON cap_secret_vault(secret_ref) WHERE secret_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS cap_secret_vault_owner_idx
  ON cap_secret_vault(owner_type, owner_id, status);
CREATE INDEX IF NOT EXISTS cap_secret_vault_tenant_idx
  ON cap_secret_vault(tenant_id, owner_type, owner_id, status);

CREATE TABLE IF NOT EXISTS cap_oauth_providers (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'oauth2',
  issuer TEXT,
  discovery_url TEXT,
  authorization_url TEXT,
  token_url TEXT,
  userinfo_url TEXT,
  revoke_url TEXT,
  jwks_url TEXT,
  client_id TEXT,
  encrypted_client_secret BYTEA,
  client_secret_vault_id TEXT REFERENCES cap_secret_vault(id),
  secret_alg TEXT DEFAULT 'aes-256-gcm/master-key',
  default_scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  supported_scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  pkce_required BOOLEAN NOT NULL DEFAULT TRUE,
  token_auth_method TEXT NOT NULL DEFAULT 'client_secret_post',
  status TEXT NOT NULL DEFAULT 'active',
  is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cap_oauth_providers_auth_type_check CHECK (
    auth_type IN ('oauth2', 'oidc', 'api_key', 'custom')
  ),
  CONSTRAINT cap_oauth_providers_token_auth_method_check CHECK (
    token_auth_method IN ('client_secret_basic', 'client_secret_post', 'none')
  )
);

ALTER TABLE cap_oauth_providers ADD COLUMN IF NOT EXISTS issuer TEXT;
ALTER TABLE cap_oauth_providers ADD COLUMN IF NOT EXISTS discovery_url TEXT;
ALTER TABLE cap_oauth_providers ADD COLUMN IF NOT EXISTS client_secret_vault_id TEXT REFERENCES cap_secret_vault(id);
ALTER TABLE cap_oauth_providers ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS cap_oauth_providers_slug_idx ON cap_oauth_providers(slug, status);

CREATE TABLE IF NOT EXISTS cap_oauth_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  provider_id TEXT NOT NULL REFERENCES cap_oauth_providers(id) ON DELETE CASCADE,
  provider_account_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  encrypted_access_token BYTEA,
  encrypted_refresh_token BYTEA,
  access_token_secret_id TEXT REFERENCES cap_secret_vault(id),
  refresh_token_secret_id TEXT REFERENCES cap_secret_vault(id),
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
    status IN ('active', 'expired', 'reconnect_required', 'revoked')
  )
);

ALTER TABLE cap_oauth_connections ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE cap_oauth_connections ADD COLUMN IF NOT EXISTS access_token_secret_id TEXT REFERENCES cap_secret_vault(id);
ALTER TABLE cap_oauth_connections ADD COLUMN IF NOT EXISTS refresh_token_secret_id TEXT REFERENCES cap_secret_vault(id);
ALTER TABLE cap_oauth_connections ALTER COLUMN encrypted_access_token DROP NOT NULL;
CREATE INDEX IF NOT EXISTS cap_oauth_connections_user_idx
  ON cap_oauth_connections(user_id, status);
CREATE INDEX IF NOT EXISTS cap_oauth_connections_tenant_idx
  ON cap_oauth_connections(tenant_id, user_id, status);

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

CREATE TABLE IF NOT EXISTS cap_system_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vault_audit (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  agent_id TEXT,
  user_id TEXT,
  provider_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vault_audit_created_idx ON vault_audit(created_at DESC);

CREATE TABLE IF NOT EXISTS proxy_access_requests (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES cap_agents(id) ON DELETE CASCADE,
  provider_slug TEXT NOT NULL,
  requested_hosts JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  user_id TEXT,
  user_hint TEXT,
  callback_url TEXT,
  connection_id TEXT REFERENCES cap_oauth_connections(id) ON DELETE SET NULL,
  grant_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour',
  decided_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT proxy_access_requests_status_check CHECK (
    status IN ('pending', 'approved', 'denied', 'expired')
  )
);

ALTER TABLE proxy_access_requests ADD COLUMN IF NOT EXISTS user_hint TEXT;
ALTER TABLE proxy_access_requests ADD COLUMN IF NOT EXISTS callback_url TEXT;
ALTER TABLE proxy_access_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS proxy_access_requests_agent_idx
  ON proxy_access_requests(agent_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS proxy_access_requests_user_hint_idx
  ON proxy_access_requests(user_hint, status, created_at DESC);

CREATE TABLE IF NOT EXISTS proxy_grants (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES cap_agents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES cap_oauth_connections(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES cap_oauth_providers(id) ON DELETE CASCADE,
  allowed_hosts JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_methods JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT proxy_grants_status_check CHECK (status IN ('active', 'revoked'))
);

CREATE INDEX IF NOT EXISTS proxy_grants_agent_idx ON proxy_grants(agent_id, status);
CREATE INDEX IF NOT EXISTS proxy_grants_user_idx ON proxy_grants(user_id, status);

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

CREATE TABLE IF NOT EXISTS user_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'ios',
  device_name TEXT NOT NULL DEFAULT '',
  push_token TEXT,
  push_environment TEXT NOT NULL DEFAULT 'production',
  public_key_jwk JSONB,
  status TEXT NOT NULL DEFAULT 'active',
  last_seen_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_devices_status_check CHECK (status IN ('active', 'revoked'))
);

ALTER TABLE user_devices ADD COLUMN IF NOT EXISTS public_key_jwk JSONB;
CREATE INDEX IF NOT EXISTS user_devices_user_idx ON user_devices(user_id, status);

CREATE TABLE IF NOT EXISTS device_pairing_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  device_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS device_pairing_codes_user_idx
  ON device_pairing_codes(user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS device_approval_challenges (
  id TEXT PRIMARY KEY,
  access_request_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS device_approval_challenges_device_idx
  ON device_approval_challenges(device_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS user_share_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  code_prefix TEXT NOT NULL DEFAULT 'u_',
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_share_codes_user_idx
  ON user_share_codes(user_id, expires_at DESC) WHERE revoked_at IS NULL;

INSERT INTO cap_oauth_providers (
  id, slug, display_name, auth_type, issuer, authorization_url, token_url,
  userinfo_url, revoke_url, default_scopes, supported_scopes, pkce_required,
  token_auth_method, status, is_builtin, metadata
) VALUES
  ('provider-github', 'github', 'GitHub', 'oauth2', NULL,
   'https://github.com/login/oauth/authorize', 'https://github.com/login/oauth/access_token',
   'https://api.github.com/user', NULL,
   '["repo","read:user","user:email"]'::jsonb,
   '["repo","read:user","user:email","repo:status","public_repo"]'::jsonb,
   FALSE, 'client_secret_post', 'unconfigured', TRUE,
   '{"template":"github","api_hosts":["api.github.com"]}'::jsonb),
  ('provider-google', 'google', 'Google', 'oidc', 'https://accounts.google.com',
   'https://accounts.google.com/o/oauth2/v2/auth', 'https://oauth2.googleapis.com/token',
   'https://openidconnect.googleapis.com/v1/userinfo', 'https://oauth2.googleapis.com/revoke',
   '["openid","email","profile"]'::jsonb,
   '["openid","email","profile"]'::jsonb,
   TRUE, 'client_secret_post', 'unconfigured', TRUE,
   '{"template":"google","api_hosts":["www.googleapis.com","gmail.googleapis.com"]}'::jsonb),
  ('provider-microsoft', 'microsoft', 'Microsoft', 'oidc',
   'https://login.microsoftonline.com/common/v2.0',
   'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
   'https://login.microsoftonline.com/common/oauth2/v2.0/token',
   'https://graph.microsoft.com/oidc/userinfo', NULL,
   '["openid","email","profile","offline_access","User.Read"]'::jsonb,
   '["openid","email","profile","offline_access","User.Read"]'::jsonb,
   TRUE, 'client_secret_post', 'unconfigured', TRUE,
   '{"template":"microsoft","api_hosts":["graph.microsoft.com"]}'::jsonb),
  ('provider-slack', 'slack', 'Slack', 'oauth2', NULL,
   'https://slack.com/oauth/v2/authorize', 'https://slack.com/api/oauth.v2.access',
   NULL, NULL,
   '["channels:read","chat:write","users:read"]'::jsonb,
   '["channels:read","chat:write","users:read","groups:read"]'::jsonb,
   FALSE, 'client_secret_post', 'unconfigured', TRUE,
   '{"template":"slack","api_hosts":["slack.com"]}'::jsonb),
  ('provider-notion', 'notion', 'Notion', 'oauth2', NULL,
   'https://api.notion.com/v1/oauth/authorize', 'https://api.notion.com/v1/oauth/token',
   NULL, NULL, '[]'::jsonb, '[]'::jsonb,
   FALSE, 'client_secret_basic', 'unconfigured', TRUE,
   '{"template":"notion","api_hosts":["api.notion.com"]}'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
  metadata = cap_oauth_providers.metadata || EXCLUDED.metadata,
  updated_at = NOW();
