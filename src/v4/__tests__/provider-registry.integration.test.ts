import { afterEach, beforeEach, expect, test } from "bun:test";

import "../../__tests__/helpers/dns-mock";
import { describeWithDb, resetDatabase } from "../../__tests__/helpers/db";
import { givenProvider, stubUpstreamFetch } from "../../__tests__/helpers/fixtures";
import { pool } from "../../db";

const { listAuthProviders } = await import("../auth-providers.service");
const { oidcService } = await import("../oidc.service");
const { resolveGitHubLoginProviderId } = await import("../login-provider.service");
const { findOAuthProviderBySlug, updateOAuthProviderCredentials } = await import("../oauth.repository");
const { upsertUserIdentity } = await import("../platform.repository");

const API_BASE = "https://cnothing.example.com";
const ISSUER = "https://issuer.example.com";

function discoveryDocument() {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/jwks`,
  };
}

async function countProviders(): Promise<number> {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM cap_oauth_providers`);
  return rows[0].n as number;
}

async function countLegacyProviders(): Promise<number> {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM cap_oidc_providers`);
  return rows[0].n as number;
}

describeWithDb("unified provider registry", () => {
  let upstream: ReturnType<typeof stubUpstreamFetch>;

  beforeEach(async () => {
    await resetDatabase();
    upstream = stubUpstreamFetch(() => Response.json(discoveryDocument()));
  });

  afterEach(() => {
    upstream.restore();
  });

  test("registering a login identity provider creates one canonical provider", async () => {
    const result = await oidcService.registerProvider({
      name: "okta",
      display_name: "Okta",
      issuer: ISSUER,
      client_id: "okta-client",
      client_secret: "okta-secret",
      scopes: "openid profile email groups",
    });

    expect(result.provider).toMatchObject({
      name: "okta",
      display_name: "Okta",
      issuer: ISSUER,
      scopes: "openid profile email groups",
    });

    const provider = await findOAuthProviderBySlug("okta");
    expect(provider).toMatchObject({
      auth_type: "oidc",
      login_enabled: true,
      status: "active",
      client_id: "okta-client",
      authorization_url: `${ISSUER}/authorize`,
      token_url: `${ISSUER}/token`,
      jwks_url: `${ISSUER}/jwks`,
    });
    expect(await countProviders()).toBe(1);
    expect(await countLegacyProviders()).toBe(0);
  });

  test("the client secret is stored in the vault, never in the provider row", async () => {
    await oidcService.registerProvider({
      name: "okta",
      display_name: "Okta",
      issuer: ISSUER,
      client_id: "okta-client",
      client_secret: "okta-secret",
    });

    const provider = (await findOAuthProviderBySlug("okta"))!;
    expect(provider.encrypted_client_secret).toBeNull();
    expect(provider.client_secret_vault_id).not.toBeNull();

    const { rows } = await pool.query(
      `SELECT encode(encrypted_payload, 'escape') AS payload FROM cap_secret_vault`,
    );
    for (const row of rows) {
      expect(String(row.payload)).not.toContain("okta-secret");
    }
  });

  test("registering login on an existing provider upgrades it instead of duplicating", async () => {
    const broker = await givenProvider({ slug: "acme" });

    await oidcService.registerProvider({
      name: "acme",
      display_name: "Acme",
      issuer: ISSUER,
      client_id: "acme-login-client",
      client_secret: "acme-login-secret",
    });

    expect(await countProviders()).toBe(1);
    const provider = (await findOAuthProviderBySlug("acme"))!;
    expect(provider.id).toBe(broker.id);
    expect(provider.login_enabled).toBe(true);
    expect(provider.client_id).toBe("acme-login-client");
  });

  test("login providers are listed in the legacy response shape", async () => {
    await oidcService.registerProvider({
      name: "okta",
      display_name: "Okta",
      issuer: ISSUER,
      client_id: "okta-client",
      client_secret: "okta-secret",
    });

    const listed = await oidcService.listPublicProviders();
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({ name: "okta", display_name: "Okta", issuer: ISSUER });
  });

  test("an unconfigured provider is not offered as a login option", async () => {
    await givenProvider({ slug: "unconfigured", client_id: "", client_secret: "" });

    const { items } = await listAuthProviders(API_BASE);
    expect(items).toHaveLength(0);
  });

  test("a connectable broker is offered as a broker login", async () => {
    await givenProvider({ slug: "acme" });

    const { items } = await listAuthProviders(API_BASE);
    expect(items).toEqual([
      {
        type: "oauth",
        name: "acme",
        display_name: "acme",
        start_path: `${API_BASE}/v4/auth/oauth/acme/start`,
      },
    ]);
  });

  test("a provider registered for login is offered through the id_token flow", async () => {
    await oidcService.registerProvider({
      name: "okta",
      display_name: "Okta",
      issuer: ISSUER,
      client_id: "okta-client",
      client_secret: "okta-secret",
    });

    const { items } = await listAuthProviders(API_BASE);
    expect(items).toEqual([
      {
        type: "oidc",
        name: "okta",
        display_name: "Okta",
        start_path: `${API_BASE}/v4/auth/oidc/okta/start`,
      },
    ]);
  });

  test("each provider is offered exactly once", async () => {
    await givenProvider({ slug: "acme" });
    await oidcService.registerProvider({
      name: "acme",
      display_name: "Acme",
      issuer: ISSUER,
      client_id: "acme-login-client",
      client_secret: "acme-login-secret",
    });

    const { items } = await listAuthProviders(API_BASE);
    expect(items.map((item) => item.name)).toEqual(["acme"]);
  });

  test("starting a login for a provider that is not a login IdP is rejected", async () => {
    await givenProvider({ slug: "acme" });

    await expect(
      oidcService.startAuthorization({ providerName: "acme", apiBaseUrl: API_BASE }),
    ).rejects.toThrow(/not found/i);
  });

  test("GitHub console login resolves to a provider identities can reference", async () => {
    const providerId = await resolveGitHubLoginProviderId();
    expect(await resolveGitHubLoginProviderId()).toBe(providerId);

    const identity = await upsertUserIdentity({
      user_id: "github:carol",
      provider_id: providerId,
      subject: "4242",
      email: "carol@example.com",
    });
    expect(identity.provider_id).toBe(providerId);

    const provider = (await findOAuthProviderBySlug("github"))!;
    expect(provider.id).toBe(providerId);
  });

  test("credential updates keep the provider connectable", async () => {
    const provider = await givenProvider({ slug: "acme", client_id: "", client_secret: "" });
    expect(provider.status).toBe("unconfigured");

    const updated = await updateOAuthProviderCredentials({
      id: provider.id,
      client_id: "acme-client",
      client_secret: "acme-secret",
    });
    expect(updated).toMatchObject({ status: "active", client_id: "acme-client" });
  });
});
