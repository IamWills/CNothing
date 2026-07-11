-- CNothing Execution Trust Layer
-- Upgrades Policy Engine, Execution Lifecycle, Audit Chain, Worker Runs.

-- ---------------------------------------------------------------------------
-- 1. Independent Policy Engine table (beyond Grant / capability_permissions)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cap_trust_policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  capability_id TEXT REFERENCES cap_capabilities(id) ON DELETE CASCADE,
  capability_pattern TEXT,
  provider_pattern TEXT,
  agent_id TEXT REFERENCES cap_agents(id) ON DELETE CASCADE,
  agent_allowlist JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider_allowlist JSONB NOT NULL DEFAULT '[]'::jsonb,
  effect TEXT NOT NULL DEFAULT 'allow',
  risk_level TEXT NOT NULL DEFAULT 'medium',
  rate_limit_per_minute INT,
  time_window_start TEXT,
  time_window_end TEXT,
  time_window_tz TEXT NOT NULL DEFAULT 'UTC',
  resource_constraint JSONB NOT NULL DEFAULT '{}'::jsonb,
  scope_limit JSONB NOT NULL DEFAULT '[]'::jsonb,
  destructive_action_block BOOLEAN NOT NULL DEFAULT FALSE,
  require_reauth BOOLEAN NOT NULL DEFAULT FALSE,
  priority INT NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'active',
  tenant_id TEXT NOT NULL DEFAULT 'default',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT cap_trust_policies_effect_check CHECK (
    effect IN (
      'allow',
      'deny',
      'require_approval',
      'require_reauth',
      'scope_limit',
      'rate_limit',
      'destructive_action_block',
      'time_window',
      'resource_constraint',
      'agent_allowlist',
      'provider_allowlist'
    )
  ),
  CONSTRAINT cap_trust_policies_risk_check CHECK (
    risk_level IN ('low', 'medium', 'high', 'critical')
  ),
  CONSTRAINT cap_trust_policies_status_check CHECK (
    status IN ('active', 'disabled', 'archived')
  )
);

CREATE INDEX IF NOT EXISTS cap_trust_policies_lookup_idx
  ON cap_trust_policies(enabled, priority)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS cap_trust_policies_pattern_idx
  ON cap_trust_policies(capability_pattern, enabled)
  WHERE deleted_at IS NULL;

INSERT INTO cap_trust_policies (
  id, name, description, capability_pattern, effect, risk_level, priority, metadata
) VALUES (
  'policy-github-oauth-connect-allow',
  'Allow github.oauth.connect',
  'OAuth connect returns connect_url only; tokens never leave cnothing',
  'github.oauth.connect',
  'allow',
  'low',
  50,
  '{"reason":"Connect URL only; no secrets to agent"}'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- Seed GitHub demo policies (deny delete, require approval for create)
INSERT INTO cap_trust_policies (
  id, name, description, capability_pattern, effect, risk_level, priority, metadata
) VALUES (
  'policy-github-get-user-allow',
  'Allow github.get_user',
  'Read-only GitHub profile lookup',
  'github.get_user',
  'allow',
  'low',
  50,
  '{"reason":"Low-risk read capability"}'::jsonb
) ON CONFLICT (id) DO NOTHING;

INSERT INTO cap_trust_policies (
  id, name, description, capability_pattern, effect, risk_level, priority, metadata
) VALUES (
  'policy-github-list-repos-allow',
  'Allow github.list_repos',
  'List repositories (read)',
  'github.list_repos',
  'allow',
  'low',
  50,
  '{"reason":"Low-risk read capability"}'::jsonb
) ON CONFLICT (id) DO NOTHING;

INSERT INTO cap_trust_policies (
  id, name, description, capability_pattern, effect, risk_level, priority, metadata
) VALUES (
  'policy-github-list-repositories-allow',
  'Allow github.list_repositories',
  'List repositories (canonical name)',
  'github.list_repositories',
  'allow',
  'low',
  50,
  '{"reason":"Low-risk read capability"}'::jsonb
) ON CONFLICT (id) DO NOTHING;

INSERT INTO cap_trust_policies (
  id, name, description, capability_pattern, effect, risk_level, priority, metadata
) VALUES (
  'policy-github-create-repo-approval',
  'Require approval for github.create_repo',
  'Repository creation requires human approval',
  'github.create_repo',
  'require_approval',
  'high',
  20,
  '{"reason":"Repository creation requires human approval","approval_policy":"every_time"}'::jsonb
) ON CONFLICT (id) DO NOTHING;

INSERT INTO cap_trust_policies (
  id, name, description, capability_pattern, effect, risk_level, priority,
  destructive_action_block, metadata
) VALUES (
  'policy-github-delete-repo-deny',
  'Deny github.delete_repo',
  'Destructive delete denied by default',
  'github.delete_repo',
  'deny',
  'critical',
  10,
  TRUE,
  '{"reason":"Destructive actions denied by default"}'::jsonb
) ON CONFLICT (id) DO NOTHING;

INSERT INTO cap_trust_policies (
  id, name, description, capability_pattern, effect, risk_level, priority, metadata
) VALUES (
  'policy-gmail-send-approval',
  'Require approval for gmail.send_email',
  'Email send requires approval every time',
  'gmail.send_email',
  'require_approval',
  'high',
  20,
  '{"reason":"Outbound email requires human approval","approval_policy":"every_time"}'::jsonb
) ON CONFLICT (id) DO NOTHING;

INSERT INTO cap_trust_policies (
  id, name, description, capability_pattern, effect, risk_level, priority, metadata
) VALUES (
  'policy-browser-login-approval',
  'Require approval for browser.login',
  'Browser login requires approval every session',
  'browser.login*',
  'require_approval',
  'high',
  20,
  '{"reason":"Browser login requires human approval","approval_policy":"every_time"}'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Expand execution lifecycle statuses + audit_chain / worker fields
-- ---------------------------------------------------------------------------
ALTER TABLE cap_executions
  ADD COLUMN IF NOT EXISTS provider_id TEXT,
  ADD COLUMN IF NOT EXISTS connection_id TEXT,
  ADD COLUMN IF NOT EXISTS policy_decision JSONB,
  ADD COLUMN IF NOT EXISTS worker_type TEXT,
  ADD COLUMN IF NOT EXISTS safe_input JSONB,
  ADD COLUMN IF NOT EXISTS sanitized_output JSONB,
  ADD COLUMN IF NOT EXISTS audit_chain_id TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_legacy TEXT;

-- Drop old status check and recreate with full lifecycle
ALTER TABLE cap_executions DROP CONSTRAINT IF EXISTS cap_executions_status_check;

ALTER TABLE cap_executions
  ADD CONSTRAINT cap_executions_status_check CHECK (
    status IN (
      'created',
      'policy_checking',
      'pending_approval',
      'approved',
      'running',
      'completed',
      'failed',
      'denied',
      'cancelled',
      'timeout',
      'reconnect_required',
      -- legacy aliases kept for rows written before migration
      'pending'
    )
  );

UPDATE cap_executions SET status = 'created' WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS cap_executions_audit_chain_idx
  ON cap_executions(audit_chain_id)
  WHERE audit_chain_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cap_executions_lifecycle_idx
  ON cap_executions(status, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Approvals: execution_id, policy_id, cancelled
-- ---------------------------------------------------------------------------
ALTER TABLE cap_approvals
  ADD COLUMN IF NOT EXISTS execution_id TEXT,
  ADD COLUMN IF NOT EXISTS policy_id TEXT,
  ADD COLUMN IF NOT EXISTS safe_input_summary TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE cap_approvals DROP CONSTRAINT IF EXISTS cap_approvals_status_check;

ALTER TABLE cap_approvals
  ADD CONSTRAINT cap_approvals_status_check CHECK (
    status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled', 'consumed')
  );

UPDATE cap_approvals
SET safe_input_summary = input_summary
WHERE safe_input_summary IS NULL;

CREATE INDEX IF NOT EXISTS cap_approvals_execution_idx
  ON cap_approvals(execution_id)
  WHERE execution_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Audit Chain: hash-linked trust audit events
-- ---------------------------------------------------------------------------
ALTER TABLE cap_trust_audit
  ADD COLUMN IF NOT EXISTS audit_chain_id TEXT,
  ADD COLUMN IF NOT EXISTS prev_hash TEXT,
  ADD COLUMN IF NOT EXISTS chain_hash TEXT,
  ADD COLUMN IF NOT EXISTS sequence_no INT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'recorded';

CREATE INDEX IF NOT EXISTS cap_trust_audit_chain_idx
  ON cap_trust_audit(audit_chain_id, sequence_no)
  WHERE audit_chain_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cap_trust_audit_chain_hash_idx
  ON cap_trust_audit(chain_hash)
  WHERE chain_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Worker runs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cap_worker_runs (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES cap_executions(id) ON DELETE CASCADE,
  worker_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'started',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cap_worker_runs_status_check CHECK (
    status IN ('started', 'running', 'completed', 'failed', 'timeout', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS cap_worker_runs_execution_idx
  ON cap_worker_runs(execution_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 6. Capability permissions: expand effect for require_reauth alignment
-- ---------------------------------------------------------------------------
ALTER TABLE cap_capability_permissions DROP CONSTRAINT IF EXISTS cap_capability_permissions_effect_check;

ALTER TABLE cap_capability_permissions
  ADD CONSTRAINT cap_capability_permissions_effect_check CHECK (
    effect IN ('allow', 'deny', 'require_approval', 'require_reauth')
  );

ALTER TABLE cap_capability_permissions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- ---------------------------------------------------------------------------
-- 7. Ensure status + metadata on core tables (idempotent)
-- ---------------------------------------------------------------------------
ALTER TABLE cap_secret_vault
  ADD COLUMN IF NOT EXISTS status TEXT;

UPDATE cap_secret_vault SET status = 'active' WHERE status IS NULL;

ALTER TABLE cap_agents
  ADD COLUMN IF NOT EXISTS metadata JSONB;

UPDATE cap_agents SET metadata = '{}'::jsonb WHERE metadata IS NULL;
