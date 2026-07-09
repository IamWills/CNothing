-- CNothing v3 Capability Gateway: Secretless Capability Execution Gateway
-- Extends existing cap_* tables; adds approvals, executions, capability_permissions.

-- ---------------------------------------------------------------------------
-- 1. cap_capabilities: execution_type, approval_policy, owner, soft-delete
-- ---------------------------------------------------------------------------
ALTER TABLE cap_capabilities
  ADD COLUMN IF NOT EXISTS execution_type TEXT NOT NULL DEFAULT 'oauth_api',
  ADD COLUMN IF NOT EXISTS approval_policy TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS owner_user_id TEXT,
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cap_capabilities_execution_type_check'
  ) THEN
    ALTER TABLE cap_capabilities
      ADD CONSTRAINT cap_capabilities_execution_type_check CHECK (
        execution_type IN (
          'oauth_api', 'api_key_api', 'browser', 'ssh', 'webhook', 'manual', 'hybrid'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cap_capabilities_approval_policy_check'
  ) THEN
    ALTER TABLE cap_capabilities
      ADD CONSTRAINT cap_capabilities_approval_policy_check CHECK (
        approval_policy IN (
          'none', 'once', 'once_per_scope', 'once_per_resource',
          'every_time', 'time_window', 'amount_threshold', 'manual_review'
        )
      );
  END IF;
END $$;

-- Backfill execution_type from invocation_type
UPDATE cap_capabilities
SET execution_type = CASE
  WHEN invocation_type IN ('builtin', 'http', 'mcp') THEN 'oauth_api'
  WHEN invocation_type = 'connector' THEN 'oauth_api'
  ELSE COALESCE(execution_type, 'oauth_api')
END
WHERE execution_type = 'oauth_api' OR execution_type IS NULL;

-- Backfill provider from name prefix
UPDATE cap_capabilities
SET provider = split_part(name, '.', 1)
WHERE provider IS NULL AND name LIKE '%.%';

-- Default approval policies for known high-risk / demo capabilities
UPDATE cap_capabilities SET approval_policy = 'every_time'
WHERE name IN ('github.delete_repo', 'gmail.send_email', 'slack.send_message')
  AND approval_policy = 'none';

UPDATE cap_capabilities SET approval_policy = 'once_per_resource'
WHERE name IN ('github.create_repo', 'github.create_issue')
  AND approval_policy = 'none';

CREATE INDEX IF NOT EXISTS cap_capabilities_execution_type_idx
  ON cap_capabilities(execution_type, status);
CREATE INDEX IF NOT EXISTS cap_capabilities_provider_idx
  ON cap_capabilities(provider, status);
CREATE INDEX IF NOT EXISTS cap_capabilities_deleted_idx
  ON cap_capabilities(deleted_at) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. cap_secret_vault: expanded secret types + secret_ref / bindings
-- ---------------------------------------------------------------------------
ALTER TABLE cap_secret_vault
  ADD COLUMN IF NOT EXISTS secret_ref TEXT,
  ADD COLUMN IF NOT EXISTS provider_id TEXT,
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ;

-- Drop old type check and recreate with expanded types (keep legacy aliases)
ALTER TABLE cap_secret_vault DROP CONSTRAINT IF EXISTS cap_secret_vault_type_check;

ALTER TABLE cap_secret_vault
  ADD CONSTRAINT cap_secret_vault_type_check CHECK (
    secret_type IN (
      'client_secret',
      'api_key',
      'oauth_code',
      'access_token',
      'refresh_token',
      'oauth_access_token',
      'oauth_refresh_token',
      'private_key',
      'ssh_private_key',
      'session_cookie',
      'cookie',
      'password',
      'recovery_code',
      'mfa_secret',
      'browser_session'
    )
  );

UPDATE cap_secret_vault
SET secret_ref = id
WHERE secret_ref IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cap_secret_vault_secret_ref_uidx
  ON cap_secret_vault(secret_ref) WHERE secret_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS cap_secret_vault_user_idx
  ON cap_secret_vault(user_id, status) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cap_secret_vault_provider_idx
  ON cap_secret_vault(provider_id, status) WHERE provider_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. cap_approvals: per-invocation human approval
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cap_approvals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES cap_agents(id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL REFERENCES cap_capabilities(id) ON DELETE CASCADE,
  requested_action TEXT NOT NULL DEFAULT '',
  input_summary TEXT NOT NULL DEFAULT '',
  input_hash TEXT,
  risk_level TEXT NOT NULL DEFAULT 'MEDIUM',
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  resource_key TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  decided_by TEXT,
  approval_token_hash TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cap_approvals_status_check CHECK (
    status IN ('pending', 'approved', 'rejected', 'expired', 'consumed')
  )
);

CREATE INDEX IF NOT EXISTS cap_approvals_agent_idx
  ON cap_approvals(agent_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS cap_approvals_user_idx
  ON cap_approvals(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS cap_approvals_capability_resource_idx
  ON cap_approvals(capability_id, resource_key, status)
  WHERE resource_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS cap_approvals_token_idx
  ON cap_approvals(approval_token_hash) WHERE approval_token_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. cap_executions: idempotent capability executions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cap_executions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES cap_agents(id) ON DELETE CASCADE,
  user_id TEXT,
  capability_id TEXT NOT NULL REFERENCES cap_capabilities(id) ON DELETE CASCADE,
  approval_id TEXT REFERENCES cap_approvals(id) ON DELETE SET NULL,
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  input_hash TEXT,
  result_hash TEXT,
  error_code TEXT,
  error_message TEXT,
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  result_payload JSONB,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cap_executions_status_check CHECK (
    status IN (
      'pending', 'pending_approval', 'running', 'completed', 'failed', 'cancelled'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS cap_executions_idempotency_uidx
  ON cap_executions(agent_id, capability_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS cap_executions_agent_idx
  ON cap_executions(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cap_executions_status_idx
  ON cap_executions(status, created_at DESC);

-- ---------------------------------------------------------------------------
-- 5. cap_capability_permissions: agent × capability allow/deny
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cap_capability_permissions (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES cap_agents(id) ON DELETE CASCADE,
  capability_id TEXT REFERENCES cap_capabilities(id) ON DELETE CASCADE,
  capability_pattern TEXT,
  provider_pattern TEXT,
  effect TEXT NOT NULL DEFAULT 'allow',
  max_risk_level TEXT,
  require_approval BOOLEAN,
  rate_limit_per_minute INT,
  spending_limit_cents BIGINT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  priority INT NOT NULL DEFAULT 100,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT cap_capability_permissions_effect_check CHECK (
    effect IN ('allow', 'deny', 'require_approval')
  ),
  CONSTRAINT cap_capability_permissions_target_check CHECK (
    agent_id IS NOT NULL
    OR capability_id IS NOT NULL
    OR capability_pattern IS NOT NULL
    OR provider_pattern IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS cap_capability_permissions_agent_idx
  ON cap_capability_permissions(agent_id, enabled, priority)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS cap_capability_permissions_lookup_idx
  ON cap_capability_permissions(enabled, priority)
  WHERE deleted_at IS NULL;

-- Seed: deny destructive github.delete_repo by default (can be overridden)
INSERT INTO cap_capability_permissions (
  id, capability_pattern, effect, priority, metadata
) VALUES (
  'perm-deny-github-delete-repo',
  'github.delete_repo',
  'deny',
  10,
  '{"reason":"Destructive actions denied by default"}'::jsonb
) ON CONFLICT (id) DO NOTHING;

INSERT INTO cap_capability_permissions (
  id, capability_pattern, effect, require_approval, priority, metadata
) VALUES (
  'perm-require-approval-create-repo',
  'github.create_repo',
  'require_approval',
  TRUE,
  20,
  '{"reason":"Repository creation requires human approval"}'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Audit extensions
-- ---------------------------------------------------------------------------
ALTER TABLE cap_trust_audit
  ADD COLUMN IF NOT EXISTS ip TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS approval_id TEXT,
  ADD COLUMN IF NOT EXISTS input_summary TEXT,
  ADD COLUMN IF NOT EXISTS risk_level TEXT,
  ADD COLUMN IF NOT EXISTS result TEXT;

ALTER TABLE cap_invoke_audit
  ADD COLUMN IF NOT EXISTS ip TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS approval_id TEXT,
  ADD COLUMN IF NOT EXISTS execution_id TEXT,
  ADD COLUMN IF NOT EXISTS input_summary TEXT;

-- Expand trust audit event types via soft convention (no CHECK constraint previously on event_type)
-- secret_decrypted is a new event written by vault retrieve

-- ---------------------------------------------------------------------------
-- 7. Rate-limit helper table (sliding window counters)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cap_rate_limit_buckets (
  id TEXT PRIMARY KEY,
  bucket_key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS cap_rate_limit_buckets_key_uidx
  ON cap_rate_limit_buckets(bucket_key, window_start);
