-- v2.5 follow-up: system state, Microsoft revoke URL, replay audit support

CREATE TABLE IF NOT EXISTS cap_system_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

UPDATE cap_oauth_providers
SET revoke_url = 'https://oauth2.googleapis.com/revoke',
    updated_at = NOW()
WHERE slug = 'google'
  AND revoke_url IS NULL;

UPDATE cap_oauth_providers
SET revoke_url = 'https://login.microsoftonline.com/common/oauth2/v2.0/logout',
    updated_at = NOW()
WHERE slug = 'microsoft'
  AND revoke_url IS NULL;

CREATE INDEX IF NOT EXISTS cap_invoke_audit_request_id_idx
  ON cap_invoke_audit (request_id, created_at DESC)
  WHERE request_id IS NOT NULL;
