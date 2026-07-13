-- Unified Approval first-class object: approval_type discriminator
-- capability_grant | execution_confirmation | reauthentication

ALTER TABLE cap_approvals
  ADD COLUMN IF NOT EXISTS approval_type TEXT NOT NULL DEFAULT 'execution_confirmation';

ALTER TABLE cap_approvals DROP CONSTRAINT IF EXISTS cap_approvals_type_check;
ALTER TABLE cap_approvals
  ADD CONSTRAINT cap_approvals_type_check CHECK (
    approval_type IN ('capability_grant', 'execution_confirmation', 'reauthentication')
  );

CREATE INDEX IF NOT EXISTS cap_approvals_type_idx
  ON cap_approvals(approval_type, status, created_at DESC);

COMMENT ON COLUMN cap_approvals.approval_type IS
  'Unified approval kind: capability_grant | execution_confirmation | reauthentication';
