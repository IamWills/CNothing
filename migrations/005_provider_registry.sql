-- Provider Registry Console: provenance on the existing canonical table.
--
-- cap_oauth_providers remains the only registry. Stored status stays
-- active | unconfigured | disabled. The Console maps those onto the
-- DISCOVERED / UNVERIFIED / REVIEWED / ACTIVE / DISABLED lifecycle without
-- renaming the column.

ALTER TABLE cap_oauth_providers
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cap_oauth_providers_source_check'
  ) THEN
    ALTER TABLE cap_oauth_providers
      ADD CONSTRAINT cap_oauth_providers_source_check
      CHECK (source IN ('manual', 'discovered', 'imported'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cap_oauth_providers_source_status_idx
  ON cap_oauth_providers (source, status);

COMMENT ON COLUMN cap_oauth_providers.source IS
  'How this registry row was introduced: manual operator entry, discovery, or import.';
COMMENT ON COLUMN cap_oauth_providers.reviewed_at IS
  'When an operator reviewed discovered/unverified metadata. Null means not yet reviewed.';
