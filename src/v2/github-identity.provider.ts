import config from "../config";
import { encryptOidcClientSecret } from "./oidc-crypto";
import { pool } from "../db";

const GITHUB_OAUTH_SCOPES = "read:user user:email";
import { randomUUID } from "node:crypto";

const GITHUB_PROVIDER_NAME = "github";

export async function ensureGitHubIdentityProvider(): Promise<string> {
  const existing = await pool.query(
    `SELECT id FROM cap_oidc_providers WHERE name = $1 LIMIT 1`,
    [GITHUB_PROVIDER_NAME],
  );
  if (existing.rows[0]?.id) {
    return String(existing.rows[0].id);
  }

  const clientId = config.githubOAuth?.clientId ?? "oauth2";
  const clientSecret = config.githubOAuth?.clientSecret ?? "unset";
  const id = randomUUID();

  await pool.query(
    `
      INSERT INTO cap_oidc_providers (
        id, name, display_name, issuer, client_id, client_secret_encrypted, scopes, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    `,
    [
      id,
      GITHUB_PROVIDER_NAME,
      "GitHub",
      "https://github.com",
      clientId,
      encryptOidcClientSecret(clientSecret),
      GITHUB_OAUTH_SCOPES,
      JSON.stringify({ auth_type: "oauth2", provider: "github" }),
    ],
  );

  return id;
}

export { GITHUB_PROVIDER_NAME };
