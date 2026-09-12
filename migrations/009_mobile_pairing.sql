-- Bind browser-to-app pairing codes to the originating app session.
ALTER TABLE device_pairing_codes ADD COLUMN IF NOT EXISTS code_challenge TEXT;
CREATE INDEX IF NOT EXISTS proxy_access_requests_history_principal_idx
  ON proxy_access_requests (principal_id, created_at DESC, id DESC);
