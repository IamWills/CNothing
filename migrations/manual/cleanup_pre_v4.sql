-- MANUAL, DESTRUCTIVE maintenance script for upgraded installations only.
--
-- 1. Take and verify a PostgreSQL backup.
-- 2. Deploy v4 and let startup finish the OAuth-to-Vault migration.
-- 3. Run this file explicitly with psql. The normal migration runner ignores
--    the manual/ directory by design.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cap_system_state
    WHERE key = 'oauth_tokens_to_vault_v1' AND value = 'completed'
  ) THEN
    RAISE EXCEPTION 'Refusing legacy cleanup: OAuth secrets have not been migrated to the v4 Vault';
  END IF;
END $$;

DROP TABLE IF EXISTS cap_worker_runs;
DROP TABLE IF EXISTS cap_approvals;
DROP TABLE IF EXISTS cap_executions;
DROP TABLE IF EXISTS cap_capability_permissions;
DROP TABLE IF EXISTS cap_trust_policies;
DROP TABLE IF EXISTS cap_rate_limit_buckets;
DROP TABLE IF EXISTS cap_pending_confirmations;
DROP TABLE IF EXISTS cap_authorization_requests;
DROP TABLE IF EXISTS cap_grants;
DROP TABLE IF EXISTS cap_policies;
DROP TABLE IF EXISTS cap_invoke_audit;
DROP TABLE IF EXISTS cap_trust_audit;
DROP TABLE IF EXISTS cap_provider_proposals;
DROP TABLE IF EXISTS cap_import_jobs;
DROP TABLE IF EXISTS cap_capabilities;
DROP TABLE IF EXISTS cap_credentials;
DROP TABLE IF EXISTS cap_connectors;
DROP TABLE IF EXISTS cap_oauth_device_sessions;

DROP TABLE IF EXISTS authai_client_key_rotations;
DROP TABLE IF EXISTS authai_key_holder_challenges;
DROP TABLE IF EXISTS authai_challenges;
DROP TABLE IF EXISTS authai_kv_records;
DROP TABLE IF EXISTS authai_audit_events;
DROP TABLE IF EXISTS authai_clients;
DROP TABLE IF EXISTS key_secrets;

ALTER TABLE cap_oauth_providers
  DROP COLUMN IF EXISTS device_authorization_endpoint,
  DROP COLUMN IF EXISTS registration_endpoint;

COMMIT;
