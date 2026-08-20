-- Transaction Intent MVP.
--
-- Ordinary GET (and other calls whose mandate has not opted in) still go
-- straight through the credential proxy with no Transaction row.
-- When a mandate sets constraints.require_approval, a side-effect call is
-- recorded here, gated by an ApprovalRequest of type=transaction, then
-- executed with the same vaulted credential injection as /v4/proxy.

CREATE TABLE IF NOT EXISTS proxy_transactions (
  id TEXT PRIMARY KEY,
  principal_type TEXT NOT NULL DEFAULT 'user',
  principal_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  mandate_id TEXT NOT NULL REFERENCES proxy_grants(id) ON DELETE CASCADE,
  provider_id TEXT,
  action TEXT NOT NULL,
  method TEXT NOT NULL,
  url_host TEXT NOT NULL,
  url_path TEXT NOT NULL,
  amount NUMERIC,
  currency TEXT,
  counterparty TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'proposed',
  approval_request_id TEXT REFERENCES proxy_access_requests(id),
  external_reference TEXT,
  idempotency_key TEXT NOT NULL,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT proxy_transactions_status_check CHECK (
    status IN ('proposed', 'authorized', 'executing', 'committed', 'failed', 'denied', 'expired')
  ),
  CONSTRAINT proxy_transactions_principal_type_check CHECK (
    principal_type IN ('user', 'organization', 'service_account', 'team')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS proxy_transactions_idempotency_idx
  ON proxy_transactions (mandate_id, idempotency_key);

CREATE INDEX IF NOT EXISTS proxy_transactions_approval_idx
  ON proxy_transactions (approval_request_id);

CREATE INDEX IF NOT EXISTS proxy_transactions_agent_idx
  ON proxy_transactions (agent_id, created_at DESC);

ALTER TABLE proxy_request_audit
  ADD COLUMN IF NOT EXISTS transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS approval_request_id TEXT,
  ADD COLUMN IF NOT EXISTS policy_decision TEXT;

COMMENT ON TABLE proxy_transactions IS
  'Action/transaction intents. Created only when a mandate opts into require_approval.';
COMMENT ON COLUMN proxy_transactions.idempotency_key IS
  'Caller-supplied or derived key. Replays the same intent instead of executing twice.';
COMMENT ON COLUMN proxy_transactions.approval_request_id IS
  'ApprovalRequest of type=transaction. Same iOS pairing / challenge path as delegation.';
COMMENT ON COLUMN proxy_grants.constraints IS
  'Delegated-authority envelope. Known keys: hosts, methods, expires_at, require_approval.';
