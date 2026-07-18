-- v4 mobile authenticator devices + agent callbacks
-- user_devices: iOS (and future) devices paired to a user, receiving push
-- notifications for pending proxy access requests (Microsoft Authenticator style).
-- device_pairing_codes: short-lived codes generated in the Console and redeemed
-- by the mobile app to bind a device to the user and mint a device session.

CREATE TABLE IF NOT EXISTS user_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'ios',
  device_name TEXT NOT NULL DEFAULT '',
  push_token TEXT,
  push_environment TEXT NOT NULL DEFAULT 'production',
  status TEXT NOT NULL DEFAULT 'active',
  last_seen_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_devices_user_idx
  ON user_devices(user_id, status);

CREATE TABLE IF NOT EXISTS device_pairing_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  device_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS device_pairing_codes_user_idx
  ON device_pairing_codes(user_id, expires_at DESC);

-- Agent may target a known CNothing user and register a completion callback.
ALTER TABLE proxy_access_requests
  ADD COLUMN IF NOT EXISTS user_hint TEXT,
  ADD COLUMN IF NOT EXISTS callback_url TEXT;

CREATE INDEX IF NOT EXISTS proxy_access_requests_user_hint_idx
  ON proxy_access_requests(user_hint, status, created_at DESC);
