import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { encryptOidcClientSecret } from "./oidc-crypto";
import type { OAuthProviderRecord } from "./oauth.entity";

/**
 * cap_user_identities.provider_id FK points at cap_oidc_providers.
 * For OAuth-broker providers used as login IdPs, upsert a lightweight row keyed by slug.
 * enabled=false so it does not appear as a separate OIDC login button.
 */
export async function ensureOAuthIdentityProvider(provider: OAuthProviderRecord): Promise<string> {
  const existing = await pool.query(`SELECT id FROM cap_oidc_providers WHERE name = $1 LIMIT 1`, [
    provider.slug,
  ]);
  if (existing.rows[0]?.id) {
    return String(existing.rows[0].id);
  }

  const id = randomUUID();
  const clientId = provider.client_id?.trim() || "oauth2";
  const scopes =
    provider.default_scopes.length > 0 ? provider.default_scopes.join(" ") : "openid profile email";
  const metadata = JSON.stringify({
    auth_type: provider.auth_type,
    source: "oauth_provider_login",
    oauth_provider_id: provider.id,
  });

  // issuer is UNIQUE — prefer real issuer, fall back to a per-slug URN on conflict.
  const issuers = [
    provider.issuer?.trim(),
    `urn:cnothing:oauth:${provider.slug}`,
  ].filter((value): value is string => Boolean(value));

  for (const issuer of issuers) {
    try {
      await pool.query(
        `
          INSERT INTO cap_oidc_providers (
            id, name, display_name, issuer, client_id, client_secret_encrypted, scopes, enabled, metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8::jsonb)
          ON CONFLICT (name) DO NOTHING
        `,
        [
          id,
          provider.slug,
          provider.display_name,
          issuer,
          clientId,
          encryptOidcClientSecret("unset"),
          scopes,
          metadata,
        ],
      );
      break;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: string }).code)
          : "";
      if (code !== "23505") {
        throw error;
      }
      // Unique issuer conflict — try next issuer candidate.
    }
  }

  const row = await pool.query(`SELECT id FROM cap_oidc_providers WHERE name = $1 LIMIT 1`, [
    provider.slug,
  ]);
  if (!row.rows[0]?.id) {
    throw new Error(`Failed to ensure identity provider for ${provider.slug}`);
  }
  return String(row.rows[0].id);
}
