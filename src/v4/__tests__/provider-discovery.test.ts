import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { PRIVATE_TEST_HOST } from "../../__tests__/helpers/dns-mock";
import { stubUpstreamFetch } from "../../__tests__/helpers/fixtures";

const { discoverOAuthProvider, mergeDiscoveredProviderInput } = await import(
  "../oidc-provider-discovery.service"
);

const ISSUER = "https://issuer.example.com";

function discoveryDocument(overrides: Record<string, unknown> = {}) {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    userinfo_endpoint: `${ISSUER}/userinfo`,
    jwks_uri: `${ISSUER}/jwks`,
    scopes_supported: ["openid", "email"],
    ...overrides,
  };
}

let upstream: ReturnType<typeof stubUpstreamFetch>;

function serve(document: unknown) {
  upstream.restore();
  upstream = stubUpstreamFetch(() => Response.json(document));
}

describe("provider discovery treats metadata as untrusted input", () => {
  beforeEach(() => {
    upstream = stubUpstreamFetch(() => Response.json(discoveryDocument()));
  });

  afterEach(() => {
    upstream.restore();
  });

  test("accepts a well-formed document and normalizes the endpoints", async () => {
    const discovered = await discoverOAuthProvider({ issuer: ISSUER });

    expect(discovered).toMatchObject({
      issuer: ISSUER,
      authorization_url: `${ISSUER}/authorize`,
      token_url: `${ISSUER}/token`,
      jwks_url: `${ISSUER}/jwks`,
    });
    expect(upstream.calls[0]!.url).toBe(`${ISSUER}/.well-known/openid-configuration`);
  });

  test("falls back to OAuth authorization-server metadata when OIDC discovery is missing", async () => {
    upstream.restore();
    upstream = stubUpstreamFetch((url) => {
      if (url.includes("openid-configuration")) {
        return new Response("missing", { status: 404 });
      }
      return Response.json(discoveryDocument());
    });

    const discovered = await discoverOAuthProvider({ issuer: ISSUER });
    expect(discovered.discovery_url).toBe(`${ISSUER}/.well-known/oauth-authorization-server`);
    expect(discovered.authorization_url).toBe(`${ISSUER}/authorize`);
    expect(upstream.calls.map((call) => call.url)).toEqual([
      `${ISSUER}/.well-known/openid-configuration`,
      `${ISSUER}/.well-known/oauth-authorization-server`,
    ]);
  });

  test("captures a public registration_endpoint for RFC 7591", async () => {
    serve(discoveryDocument({ registration_endpoint: `${ISSUER}/register` }));
    const discovered = await discoverOAuthProvider({ issuer: ISSUER });
    expect(discovered.registration_url).toBe(`${ISSUER}/register`);
  });

  test("ignores an internal registration_endpoint instead of failing discovery", async () => {
    serve(discoveryDocument({ registration_endpoint: "https://127.0.0.1/register" }));
    const discovered = await discoverOAuthProvider({ issuer: ISSUER });
    expect(discovered.registration_url).toBeNull();
    expect(discovered.authorization_url).toBe(`${ISSUER}/authorize`);
  });

  test("never follows a redirect away from the validated host", async () => {
    await discoverOAuthProvider({ issuer: ISSUER });
    expect(upstream.calls[0]!.init.redirect).toBe("error");
  });

  test("refuses to fetch discovery metadata from a private address", async () => {
    for (const issuer of [
      "https://127.0.0.1",
      "https://169.254.169.254",
      `https://${PRIVATE_TEST_HOST}`,
    ]) {
      await expect(discoverOAuthProvider({ issuer })).rejects.toThrow(/blocked/i);
    }
    expect(upstream.calls).toHaveLength(0);
  });

  test("requires https for the discovery endpoint", async () => {
    await expect(
      discoverOAuthProvider({ discovery_url: "http://issuer.example.com" }),
    ).rejects.toThrow(/https/i);
    expect(upstream.calls).toHaveLength(0);
  });

  test("rejects a document whose issuer does not match the lookup", async () => {
    serve(discoveryDocument({ issuer: "https://attacker.example.com" }));

    await expect(discoverOAuthProvider({ issuer: ISSUER })).rejects.toThrow(
      /issuer does not match/i,
    );
  });

  test("rejects a document that advertises an internal endpoint", async () => {
    serve(discoveryDocument({ token_endpoint: "https://169.254.169.254/token" }));
    await expect(discoverOAuthProvider({ issuer: ISSUER })).rejects.toThrow(/blocked/i);

    serve(discoveryDocument({ jwks_uri: `https://${PRIVATE_TEST_HOST}/jwks` }));
    await expect(discoverOAuthProvider({ issuer: ISSUER })).rejects.toThrow(/blocked/i);
  });

  test("rejects a document that advertises a non-https endpoint", async () => {
    serve(discoveryDocument({ authorization_endpoint: "http://issuer.example.com/authorize" }));
    await expect(discoverOAuthProvider({ issuer: ISSUER })).rejects.toThrow(/https/i);
  });

  test("rejects an incomplete document", async () => {
    serve(discoveryDocument({ token_endpoint: undefined }));
    await expect(discoverOAuthProvider({ issuer: ISSUER })).rejects.toThrow(/missing issuer/i);
  });

  test("rejects a non-JSON document", async () => {
    upstream.restore();
    upstream = stubUpstreamFetch(() => new Response("<html>login</html>", { status: 200 }));
    await expect(discoverOAuthProvider({ issuer: ISSUER })).rejects.toThrow(/valid JSON/i);
  });
});

describe("manually registered provider endpoints", () => {
  beforeEach(() => {
    upstream = stubUpstreamFetch(() => Response.json(discoveryDocument()));
  });

  afterEach(() => {
    upstream.restore();
  });

  test("passes through safe public endpoints", async () => {
    const merged = await mergeDiscoveredProviderInput({
      slug: "acme",
      display_name: "Acme",
      authorization_url: "https://acme.example.com/authorize",
      token_url: "https://acme.example.com/token",
    });

    expect(merged).toMatchObject({
      slug: "acme",
      auth_type: "oauth2",
      token_url: "https://acme.example.com/token",
    });
    expect(upstream.calls).toHaveLength(0);
  });

  test("blocks a hand-entered internal endpoint", async () => {
    await expect(
      mergeDiscoveredProviderInput({
        slug: "acme",
        display_name: "Acme",
        authorization_url: "https://acme.example.com/authorize",
        token_url: "https://127.0.0.1:9000/token",
      }),
    ).rejects.toThrow(/blocked/i);
  });

  test("blocks an operator override that points at an internal endpoint", async () => {
    await expect(
      mergeDiscoveredProviderInput({
        slug: "acme",
        display_name: "Acme",
        issuer: ISSUER,
        userinfo_url: `https://${PRIVATE_TEST_HOST}/userinfo`,
      }),
    ).rejects.toThrow(/blocked/i);
  });
});
