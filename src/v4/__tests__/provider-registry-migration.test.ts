import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

import { describeWithDb } from "../../__tests__/helpers/db";

/**
 * The provider registry merge is the only breaking change in this phase, so it is rehearsed
 * on a scratch database seeded with the legacy shapes it has to cope with:
 * a standalone login IdP, a shadow row written by the broker login flow, the GitHub shadow
 * row, and user identities pointing at all three.
 */
const SCRATCH_DATABASE = "cnothing_migration_rehearsal";

function adminUrl(): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = "/postgres";
  return url.toString();
}

function scratchUrl(): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${SCRATCH_DATABASE}`;
  return url.toString();
}

let db: Pool;

async function runMigration(file: string): Promise<void> {
  await db.query(await readFile(new URL(`../../../migrations/${file}`, import.meta.url), "utf8"));
}

describeWithDb("provider registry unification migration", () => {
  beforeAll(async () => {
    const admin = new Pool({ connectionString: adminUrl() });
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DATABASE}`);
    await admin.query(`CREATE DATABASE ${SCRATCH_DATABASE}`);
    await admin.end();

    db = new Pool({ connectionString: scratchUrl() });
    await runMigration("001_v4_baseline.sql");

    await db.query(`
      INSERT INTO cap_oidc_providers (id, name, display_name, issuer, client_id, client_secret_encrypted, scopes, enabled, metadata)
      VALUES
        ('legacy-okta', 'okta', 'Okta', 'https://okta.example.com', 'okta-client', '\\x00'::bytea,
         'openid profile email groups', TRUE, '{}'::jsonb),
        ('legacy-shadow-notion', 'notion', 'Notion', 'urn:cnothing:oauth:notion', 'notion-client', '\\x00'::bytea,
         'openid profile email', FALSE, '{"source":"oauth_provider_login"}'::jsonb),
        ('legacy-github', 'github', 'GitHub', 'https://github.com', 'github-login-client', '\\x00'::bytea,
         'read:user user:email', TRUE, '{"auth_type":"oauth2","provider":"github"}'::jsonb)
    `);

    await db.query(`
      INSERT INTO cap_user_identities (id, user_id, provider_id, subject, email)
      VALUES
        ('identity-okta', 'alice@example.com', 'legacy-okta', 'okta-sub-1', 'alice@example.com'),
        ('identity-notion', 'notion:bob', 'legacy-shadow-notion', 'notion-sub-1', NULL),
        ('identity-github', 'github:carol', 'legacy-github', '4242', 'carol@example.com')
    `);

    await runMigration("002_provider_registry_unification.sql");
  });

  afterAll(async () => {
    await db?.end().catch(() => undefined);
    const admin = new Pool({ connectionString: adminUrl() });
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DATABASE}`);
    await admin.end();
  });

  test("a standalone login IdP becomes a canonical provider under its original id", async () => {
    const { rows } = await db.query(
      `SELECT id, slug, auth_type, issuer, client_id, status, login_enabled, default_scopes, metadata
       FROM cap_oauth_providers WHERE slug = 'okta'`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "legacy-okta",
      auth_type: "oidc",
      issuer: "https://okta.example.com",
      client_id: "okta-client",
      status: "active",
      login_enabled: true,
    });
    expect(rows[0].default_scopes).toEqual(["openid", "profile", "email", "groups"]);
    expect(rows[0].metadata.migrated_from).toBe("cap_oidc_providers");
  });

  test("its identities keep resolving without being rewritten", async () => {
    const { rows } = await db.query(
      `SELECT provider_id FROM cap_user_identities WHERE id = 'identity-okta'`,
    );
    expect(rows[0].provider_id).toBe("legacy-okta");
  });

  test("a shadow row collapses into the broker provider it stood in for", async () => {
    const providers = await db.query(`SELECT id, login_enabled FROM cap_oauth_providers WHERE slug = 'notion'`);
    expect(providers.rows).toHaveLength(1);
    expect(providers.rows[0].id).toBe("provider-notion");
    // The shadow row was never a real login IdP, so it must not grant the capability.
    expect(providers.rows[0].login_enabled).toBe(false);

    const identity = await db.query(
      `SELECT provider_id FROM cap_user_identities WHERE id = 'identity-notion'`,
    );
    expect(identity.rows[0].provider_id).toBe("provider-notion");
  });

  test("the GitHub login row merges into the seeded GitHub provider", async () => {
    const providers = await db.query(
      `SELECT id, login_enabled, metadata FROM cap_oauth_providers WHERE slug = 'github'`,
    );
    expect(providers.rows).toHaveLength(1);
    expect(providers.rows[0].id).toBe("provider-github");
    expect(providers.rows[0].login_enabled).toBe(true);
    // Broker credentials win; the login client_id is kept only as a reconciliation hint.
    expect(providers.rows[0].metadata.legacy_login_client_id).toBe("github-login-client");

    const identity = await db.query(
      `SELECT provider_id FROM cap_user_identities WHERE id = 'identity-github'`,
    );
    expect(identity.rows[0].provider_id).toBe("provider-github");
  });

  test("no identity is orphaned and every one resolves to a canonical provider", async () => {
    const { rows } = await db.query(`
      SELECT COUNT(*)::int AS orphans
      FROM cap_user_identities i
      LEFT JOIN cap_oauth_providers p ON p.id = i.provider_id
      WHERE p.id IS NULL
    `);
    expect(rows[0].orphans).toBe(0);

    const total = await db.query(`SELECT COUNT(*)::int AS n FROM cap_user_identities`);
    expect(total.rows[0].n).toBe(3);
  });

  test("the deprecated table is left intact for rollback", async () => {
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM cap_oidc_providers`);
    expect(rows[0].n).toBe(3);
  });
});
