-- Grant → Mandate.
--
-- proxy_grants remains the stored representation. A Grant is a Mandate whose
-- principal is currently always a User. These columns make the generalized
-- shape explicit without renaming the table, copying rows, or changing
-- /v4/grants and list_grants.
--
-- constraints is a simple JSON object, not a policy language. Phase 2 only
-- persists the fields the proxy already enforces: hosts, methods, expires_at.
-- Unknown keys are stored and ignored so later constraint types can be
-- introduced without another rewrite.

ALTER TABLE proxy_grants
  ADD COLUMN IF NOT EXISTS principal_type TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS principal_id TEXT,
  ADD COLUMN IF NOT EXISTS constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

UPDATE proxy_grants
SET principal_id = user_id
WHERE principal_id IS NULL;

ALTER TABLE proxy_grants
  ALTER COLUMN principal_id SET NOT NULL;

ALTER TABLE proxy_grants
  DROP CONSTRAINT IF EXISTS proxy_grants_principal_type_check;
ALTER TABLE proxy_grants
  ADD CONSTRAINT proxy_grants_principal_type_check
  CHECK (principal_type IN ('user', 'organization', 'service_account', 'team'));

UPDATE proxy_grants
SET constraints = jsonb_build_object(
  'hosts', allowed_hosts,
  'methods', allowed_methods,
  'expires_at', expires_at
)
WHERE constraints = '{}'::jsonb
   OR NOT (constraints ? 'hosts');

UPDATE proxy_grants
SET revoked_at = updated_at
WHERE status = 'revoked'
  AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS proxy_grants_principal_idx
  ON proxy_grants(principal_type, principal_id, status);

COMMENT ON COLUMN proxy_grants.principal_type IS
  'Kind of authority-granting principal. Currently always user.';
COMMENT ON COLUMN proxy_grants.principal_id IS
  'Identifier of the principal. For type=user this equals user_id.';
COMMENT ON COLUMN proxy_grants.constraints IS
  'Delegated-authority envelope. Phase 2 keys: hosts, methods, expires_at.';
COMMENT ON COLUMN proxy_grants.actions IS
  'Optional semantic actions this mandate covers. Empty until transaction intents exist.';
COMMENT ON COLUMN proxy_grants.revoked_at IS
  'Set when status becomes revoked. Null for active mandates.';
