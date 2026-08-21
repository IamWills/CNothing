-- Minimal Human role: user | admin.
-- There is no historical cap_users table; Human identity has been a user_id string
-- on sessions, identities, connections, agents, and devices. This migration
-- introduces the canonical user row so role can live server-side, defaulting
-- every existing account to the lowest privilege.

CREATE TABLE IF NOT EXISTS cap_users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cap_users_role_check CHECK (role IN ('user', 'admin'))
);

CREATE INDEX IF NOT EXISTS cap_users_role_idx ON cap_users(role);

INSERT INTO cap_users (id, role)
SELECT DISTINCT user_id, 'user'
FROM (
  SELECT user_id FROM cap_user_sessions
  UNION
  SELECT user_id FROM cap_user_identities
  UNION
  SELECT user_id FROM cap_oauth_connections
  UNION
  SELECT owner_user_id AS user_id FROM cap_agents
  UNION
  SELECT user_id FROM user_devices
  UNION
  SELECT user_id FROM proxy_access_requests WHERE user_id IS NOT NULL
) known_users
WHERE user_id IS NOT NULL AND btrim(user_id) <> ''
ON CONFLICT (id) DO NOTHING;
