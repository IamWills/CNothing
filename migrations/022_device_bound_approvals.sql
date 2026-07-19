-- Okta Verify-style device-bound approvals (proof of possession).
-- The phone registers a P-256 public key at pairing (private key stays in the
-- Secure Enclave). Every approve/deny from a device must sign a one-time
-- server-issued challenge, so a stolen device session token alone cannot
-- approve anything.

ALTER TABLE user_devices
  ADD COLUMN IF NOT EXISTS public_key_jwk JSONB;

CREATE TABLE IF NOT EXISTS device_approval_challenges (
  id TEXT PRIMARY KEY,
  access_request_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS device_approval_challenges_device_idx
  ON device_approval_challenges(device_id, expires_at DESC);
