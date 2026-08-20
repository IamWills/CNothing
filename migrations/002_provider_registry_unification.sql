-- Provider Registry unification.
--
-- Before: two provider entities existed side by side.
--   cap_oauth_providers  = brokered API providers (agent connections, credential proxy)
--   cap_oidc_providers   = console login identity providers
-- The OAuth broker flow had to synthesise a shadow cap_oidc_providers row for every
-- provider used as a login IdP, because cap_user_identities.provider_id pointed there.
--
-- After: cap_oauth_providers is the single canonical Provider entity. Whether a provider
-- can also be used to sign in to the console is a capability flag (login_enabled), not a
-- separate table. cap_oidc_providers is retained read-only for rollback and then dropped
-- in a later release.

ALTER TABLE cap_oauth_providers
  ADD COLUMN IF NOT EXISTS login_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS cap_oauth_providers_login_idx
  ON cap_oauth_providers(login_enabled, status);

-- 1. Legacy IdPs with no broker counterpart become canonical providers.
--    The primary key is carried over so cap_user_identities rows stay valid untouched.
INSERT INTO cap_oauth_providers (
  id, slug, display_name, auth_type, issuer,
  client_id, encrypted_client_secret,
  default_scopes, supported_scopes,
  pkce_required, token_auth_method,
  status, is_builtin, login_enabled, metadata
)
SELECT
  legacy.id,
  legacy.name,
  legacy.display_name,
  'oidc',
  legacy.issuer,
  NULLIF(TRIM(legacy.client_id), ''),
  legacy.client_secret_encrypted,
  to_jsonb(ARRAY(
    SELECT scope
    FROM unnest(string_to_array(TRIM(legacy.scopes), ' ')) AS scope
    WHERE scope <> ''
  )),
  '[]'::jsonb,
  TRUE,
  'client_secret_post',
  CASE WHEN NULLIF(TRIM(legacy.client_id), '') IS NULL THEN 'unconfigured' ELSE 'active' END,
  FALSE,
  legacy.enabled,
  legacy.metadata || jsonb_build_object('migrated_from', 'cap_oidc_providers')
FROM cap_oidc_providers legacy
WHERE NOT EXISTS (
  SELECT 1 FROM cap_oauth_providers canonical WHERE canonical.slug = legacy.name
);

-- 2. Where both tables described the same provider, keep the broker row's credentials and
--    only lift the login capability across. Shadow rows written by the broker login flow
--    carry no real credentials, so they contribute nothing.
UPDATE cap_oauth_providers canonical
SET
  login_enabled = TRUE,
  metadata = CASE
    WHEN NULLIF(TRIM(legacy.client_id), '') IS DISTINCT FROM canonical.client_id
      THEN canonical.metadata || jsonb_build_object('legacy_login_client_id', legacy.client_id)
    ELSE canonical.metadata
  END,
  updated_at = NOW()
FROM cap_oidc_providers legacy
WHERE canonical.slug = legacy.name
  AND canonical.id <> legacy.id
  AND legacy.enabled
  AND COALESCE(legacy.metadata->>'source', '') <> 'oauth_provider_login';

-- 3. Release the identity foreign key before repointing, because the rows being moved
--    reference providers that only exist in the canonical table.
ALTER TABLE cap_user_identities
  DROP CONSTRAINT IF EXISTS cap_user_identities_provider_id_fkey;

-- 4. Repoint identities that referenced a merged-away legacy row.
UPDATE cap_user_identities identity
SET provider_id = canonical.id, updated_at = NOW()
FROM cap_oidc_providers legacy
JOIN cap_oauth_providers canonical ON canonical.slug = legacy.name
WHERE identity.provider_id = legacy.id
  AND legacy.id <> canonical.id
  AND NOT EXISTS (
    SELECT 1 FROM cap_user_identities existing
    WHERE existing.provider_id = canonical.id AND existing.subject = identity.subject
  );

-- Anything left over is the same subject already recorded against the canonical provider.
DELETE FROM cap_user_identities identity
USING cap_oidc_providers legacy
JOIN cap_oauth_providers canonical ON canonical.slug = legacy.name
WHERE identity.provider_id = legacy.id
  AND legacy.id <> canonical.id;

-- 5. Point the foreign keys at the canonical table.
ALTER TABLE cap_user_identities
  ADD CONSTRAINT cap_user_identities_provider_id_fkey
  FOREIGN KEY (provider_id) REFERENCES cap_oauth_providers(id) ON DELETE CASCADE;

-- Login states live for ten minutes; discarding in-flight ones is cheaper than remapping.
DELETE FROM cap_oidc_states;
ALTER TABLE cap_oidc_states
  DROP CONSTRAINT IF EXISTS cap_oidc_states_provider_id_fkey;
ALTER TABLE cap_oidc_states
  ADD CONSTRAINT cap_oidc_states_provider_id_fkey
  FOREIGN KEY (provider_id) REFERENCES cap_oauth_providers(id) ON DELETE CASCADE;

COMMENT ON TABLE cap_oidc_providers IS
  'DEPRECATED as of 002_provider_registry_unification. Superseded by cap_oauth_providers '
  '(login_enabled = TRUE). Retained for rollback only; no code reads or writes it.';

COMMENT ON COLUMN cap_oauth_providers.login_enabled IS
  'Provider may be used as a console login identity provider.';
