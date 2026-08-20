-- AccessRequest → ApprovalRequest.
--
-- proxy_access_requests remains the stored representation. Today's rows are
-- approval_type = 'delegation': an agent asking a principal to mint a Mandate.
-- Future action/transaction approvals reuse this table, the same iOS pairing /
-- APNs / P-256 challenge path, and the same pending → approved|denied|expired
-- state machine. No second approval system is introduced.
--
-- grant_id continues to point at the minted Mandate (proxy_grants). The domain
-- exposes it as mandate_id without duplicating the column.

ALTER TABLE proxy_access_requests
  ADD COLUMN IF NOT EXISTS approval_type TEXT NOT NULL DEFAULT 'delegation',
  ADD COLUMN IF NOT EXISTS principal_type TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS principal_id TEXT,
  ADD COLUMN IF NOT EXISTS action TEXT,
  ADD COLUMN IF NOT EXISTS resource JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS context JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS risk TEXT,
  ADD COLUMN IF NOT EXISTS decision JSONB;

ALTER TABLE proxy_access_requests
  DROP CONSTRAINT IF EXISTS proxy_access_requests_approval_type_check;
ALTER TABLE proxy_access_requests
  ADD CONSTRAINT proxy_access_requests_approval_type_check
  CHECK (approval_type IN ('delegation', 'action', 'transaction'));

ALTER TABLE proxy_access_requests
  DROP CONSTRAINT IF EXISTS proxy_access_requests_principal_type_check;
ALTER TABLE proxy_access_requests
  ADD CONSTRAINT proxy_access_requests_principal_type_check
  CHECK (principal_type IN ('user', 'organization', 'service_account', 'team'));

UPDATE proxy_access_requests
SET principal_id = COALESCE(user_id, NULLIF(user_hint, ''))
WHERE principal_id IS NULL;

UPDATE proxy_access_requests
SET action = 'delegate'
WHERE action IS NULL
  AND approval_type = 'delegation';

UPDATE proxy_access_requests
SET resource = jsonb_build_object(
  'provider', provider_slug,
  'hosts', requested_hosts
)
WHERE resource = '{}'::jsonb;

UPDATE proxy_access_requests
SET decision = jsonb_strip_nulls(jsonb_build_object(
  'verdict', status,
  'decided_by', user_id,
  'decided_at', decided_at,
  'connection_id', connection_id,
  'mandate_id', grant_id
))
WHERE status IN ('approved', 'denied')
  AND decision IS NULL;

CREATE INDEX IF NOT EXISTS proxy_access_requests_principal_idx
  ON proxy_access_requests(principal_type, principal_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS proxy_access_requests_type_idx
  ON proxy_access_requests(approval_type, status);

COMMENT ON COLUMN proxy_access_requests.approval_type IS
  'Kind of approval. Phase 3 only writes delegation; action/transaction come later.';
COMMENT ON COLUMN proxy_access_requests.principal_id IS
  'Authority-granting principal. For type=user this equals user_id / user_hint.';
COMMENT ON COLUMN proxy_access_requests.action IS
  'Semantic action under review. Delegation uses delegate.';
COMMENT ON COLUMN proxy_access_requests.resource IS
  'What the approval covers. Delegation: {provider, hosts}.';
COMMENT ON COLUMN proxy_access_requests.decision IS
  'Recorded verdict. Null while pending.';
COMMENT ON COLUMN proxy_access_requests.grant_id IS
  'Minted Mandate id (proxy_grants) after a delegation is approved.';
