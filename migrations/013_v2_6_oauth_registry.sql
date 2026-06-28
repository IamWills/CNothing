-- CNothing v2.6: Universal OAuth Provider Registry enhancements

ALTER TABLE cap_oauth_providers ADD COLUMN IF NOT EXISTS issuer TEXT;
ALTER TABLE cap_oauth_providers ADD COLUMN IF NOT EXISTS discovery_url TEXT;

CREATE INDEX IF NOT EXISTS cap_oauth_providers_issuer_idx ON cap_oauth_providers(issuer);

-- Allow public OAuth clients (PKCE-only) without client_secret
ALTER TABLE cap_oauth_providers DROP CONSTRAINT IF EXISTS cap_oauth_providers_token_auth_method_check;
ALTER TABLE cap_oauth_providers ADD CONSTRAINT cap_oauth_providers_token_auth_method_check CHECK (
  token_auth_method IN ('client_secret_basic', 'client_secret_post', 'none')
);

-- Connection lifecycle: explicit expired state
ALTER TABLE cap_oauth_connections DROP CONSTRAINT IF EXISTS cap_oauth_connections_status_check;
ALTER TABLE cap_oauth_connections ADD CONSTRAINT cap_oauth_connections_status_check CHECK (
  status IN ('active', 'expired', 'reconnect_required', 'revoked')
);
