import { afterEach, beforeEach, expect, test } from "bun:test";

import { PRIVATE_TEST_HOST } from "../../__tests__/helpers/dns-mock";
import { describeWithDb, resetDatabase } from "../../__tests__/helpers/db";
import { asPendingAccess, asExecutedProxy, asMandateApproval, givenAgent, givenConnection, givenProvider, stubUpstreamFetch } from "../../__tests__/helpers/fixtures";

import { pool } from "../../db";

const { proxyService } = await import("../proxy.service");

const API_BASE_URL = "http://127.0.0.1:3021";
const USER_ID = "github:alice";
const ACCESS_TOKEN = "gho_supersecret_access_token_value";

async function givenActiveGrant(options: { allowedHosts?: string[]; allowedMethods?: string[]; expiresAt?: string } = {}) {
  const { agent } = await givenAgent();
  const provider = await givenProvider({ apiHosts: options.allowedHosts ?? ["api.github.com"] });
  const connection = await givenConnection({
    providerId: provider.id,
    userId: USER_ID,
    accessToken: ACCESS_TOKEN,
  });
  const request = asPendingAccess(await proxyService.requestAccess({
    agent,
    provider: provider.slug,
    apiBaseUrl: API_BASE_URL,
  }));
  const approved = asMandateApproval(await proxyService.approveAccess({
    accessRequestId: request.access_request_id,
    userId: USER_ID,
    connectionId: connection.id,
    ...(options.allowedHosts ? { allowedHosts: options.allowedHosts } : {}),
    ...(options.allowedMethods ? { allowedMethods: options.allowedMethods } : {}),
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
  }));
  return { agent, provider, connection, grantId: approved.grant.id };
}

let upstream: ReturnType<typeof stubUpstreamFetch>;

describeWithDb("v4 credential-injecting proxy", () => {
  beforeEach(async () => {
    await resetDatabase();
    upstream = stubUpstreamFetch(() =>
      Response.json({ ok: true }, { status: 200, headers: { "x-ratelimit-remaining": "42" } }),
    );
  });

  afterEach(() => {
    upstream.restore();
  });

  test("injects the vaulted credential and returns the upstream response", async () => {
    const { agent, grantId } = await givenActiveGrant();

    const result = asExecutedProxy(await proxyService.proxy({
      agent,
      grantId,
      method: "GET",
      url: "https://api.github.com/user/repos",
    }));

    expect(result.status).toBe(200);
    expect(result.headers["x-ratelimit-remaining"]).toBe("42");
    expect(upstream.calls).toHaveLength(1);
    const sentHeaders = upstream.calls[0]!.init.headers as Record<string, string>;
    expect(sentHeaders.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  test("strips agent-supplied credential headers instead of forwarding them", async () => {
    const { agent, grantId } = await givenActiveGrant();

    await proxyService.proxy({
      agent,
      grantId,
      method: "GET",
      url: "https://api.github.com/user",
      headers: {
        Authorization: "Bearer attacker-controlled",
        Cookie: "session=stolen",
        "X-Forwarded-For": "10.0.0.1",
        Accept: "application/vnd.github+json",
      },
    });

    const sentHeaders = upstream.calls[0]!.init.headers as Record<string, string>;
    expect(sentHeaders.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(sentHeaders.cookie).toBeUndefined();
    expect(sentHeaders["x-forwarded-for"]).toBeUndefined();
    expect(sentHeaders.accept).toBe("application/vnd.github+json");
  });

  test("never echoes the access token back to the agent", async () => {
    upstream.restore();
    upstream = stubUpstreamFetch(() =>
      Response.json(
        { leaked: ACCESS_TOKEN, nested: { access_token: ACCESS_TOKEN } },
        { status: 200, headers: { "x-echo-token": ACCESS_TOKEN } },
      ),
    );
    const { agent, grantId } = await givenActiveGrant();

    const result = asExecutedProxy(await proxyService.proxy({
      agent,
      grantId,
      method: "GET",
      url: "https://api.github.com/user",
    }));

    expect(JSON.stringify(result)).not.toContain(ACCESS_TOKEN);
    expect(result.headers["x-echo-token"]).toBe("[REDACTED]");
  });

  test("drops cookie and auth-negotiation response headers", async () => {
    upstream.restore();
    upstream = stubUpstreamFetch(
      () =>
        new Response("{}", {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": "session=abc; HttpOnly",
            "www-authenticate": "Bearer realm=github",
          },
        }),
    );
    const { agent, grantId } = await givenActiveGrant();

    const result = asExecutedProxy(await proxyService.proxy({
      agent,
      grantId,
      method: "GET",
      url: "https://api.github.com/user",
    }));

    expect(result.headers["set-cookie"]).toBeUndefined();
    expect(result.headers["www-authenticate"]).toBeUndefined();
  });

  test("rejects a host outside the grant allowlist", async () => {
    const { agent, grantId } = await givenActiveGrant();

    await expect(
      proxyService.proxy({
        agent,
        grantId,
        method: "GET",
        url: "https://api.stripe.com/v1/charges",
      }),
    ).rejects.toThrow(/host not allowed/i);
    expect(upstream.calls).toHaveLength(0);
  });

  test("rejects suffix-forgery of an allowed host", async () => {
    const { agent, grantId } = await givenActiveGrant();

    await expect(
      proxyService.proxy({
        agent,
        grantId,
        method: "GET",
        url: "https://api.github.com.attacker.io/user",
      }),
    ).rejects.toThrow(/host not allowed/i);
  });

  test("honours wildcard hosts without allowing the bare domain", async () => {
    const { agent, grantId } = await givenActiveGrant({ allowedHosts: ["*.googleapis.com"] });

    await proxyService.proxy({
      agent,
      grantId,
      method: "GET",
      url: "https://sheets.googleapis.com/v4/spreadsheets",
    });
    expect(upstream.calls).toHaveLength(1);

    await expect(
      proxyService.proxy({
        agent,
        grantId,
        method: "GET",
        url: "https://googleapis.com/v4/spreadsheets",
      }),
    ).rejects.toThrow(/host not allowed/i);
  });

  test("rejects a method outside the grant allowlist", async () => {
    const { agent, grantId } = await givenActiveGrant({ allowedMethods: ["GET"] });

    await expect(
      proxyService.proxy({
        agent,
        grantId,
        method: "DELETE",
        url: "https://api.github.com/repos/acme/demo",
      }),
    ).rejects.toThrow(/method not allowed/i);
    expect(upstream.calls).toHaveLength(0);
  });

  test("requires https", async () => {
    const { agent, grantId } = await givenActiveGrant();

    await expect(
      proxyService.proxy({
        agent,
        grantId,
        method: "GET",
        url: "http://api.github.com/user",
      }),
    ).rejects.toThrow(/only https/i);
  });

  test("blocks loopback, link-local, and DNS-rebound private targets", async () => {
    const { agent, grantId } = await givenActiveGrant();

    for (const url of [
      "https://127.0.0.1/admin",
      "https://localhost/admin",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.5/internal",
      `https://${PRIVATE_TEST_HOST}/internal`,
    ]) {
      await expect(
        proxyService.proxy({ agent, grantId, method: "GET", url }),
      ).rejects.toThrow(/blocked|ssrf/i);
    }
    expect(upstream.calls).toHaveLength(0);
  });

  test("rejects a grant belonging to another agent", async () => {
    const { grantId } = await givenActiveGrant();
    const { agent: intruder } = await givenAgent();

    await expect(
      proxyService.proxy({
        agent: intruder,
        grantId,
        method: "GET",
        url: "https://api.github.com/user",
      }),
    ).rejects.toThrow(/grant not found/i);
  });

  test("rejects a revoked grant", async () => {
    const { agent, grantId } = await givenActiveGrant();
    await proxyService.revokeGrant({ grantId, userId: USER_ID });

    await expect(
      proxyService.proxy({
        agent,
        grantId,
        method: "GET",
        url: "https://api.github.com/user",
      }),
    ).rejects.toThrow(/revoked/i);
  });

  test("rejects an expired grant", async () => {
    const { agent, grantId } = await givenActiveGrant({
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await expect(
      proxyService.proxy({
        agent,
        grantId,
        method: "GET",
        url: "https://api.github.com/user",
      }),
    ).rejects.toThrow(/expired/i);
  });

  test("rejects an oversized request body", async () => {
    const { agent, grantId } = await givenActiveGrant();

    await expect(
      proxyService.proxy({
        agent,
        grantId,
        method: "POST",
        url: "https://api.github.com/repos/acme/demo/issues",
        body: "x".repeat(1024 * 1024 + 1),
      }),
    ).rejects.toThrow(/too large/i);
  });

  test("surfaces upstream failures without leaking the credential", async () => {
    upstream.restore();
    upstream = stubUpstreamFetch(() => {
      throw new Error(`connect ECONNREFUSED using ${ACCESS_TOKEN}`);
    });
    const { agent, grantId } = await givenActiveGrant();

    const failure = await proxyService
      .proxy({ agent, grantId, method: "GET", url: "https://api.github.com/user" })
      .catch((error: unknown) => error);

    expect(String(failure)).toContain("Upstream request failed");
  });

  test("writes an audit row for every proxied call", async () => {
    const { agent, grantId } = await givenActiveGrant();

    await proxyService.proxy({
      agent,
      grantId,
      method: "POST",
      url: "https://api.github.com/repos/acme/demo/issues",
      body: { title: "Hello" },
    });

    const audit = await pool.query(
      `SELECT method, url_host, url_path, status_code, success FROM proxy_request_audit WHERE grant_id = $1`,
      [grantId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      method: "POST",
      url_host: "api.github.com",
      url_path: "/repos/acme/demo/issues",
      status_code: 200,
      success: true,
    });
  });

  test("stores no plaintext credential in the audit trail", async () => {
    const { agent, grantId } = await givenActiveGrant();
    await proxyService.proxy({
      agent,
      grantId,
      method: "GET",
      url: "https://api.github.com/user",
    });

    const audit = await pool.query(`SELECT * FROM proxy_request_audit`);
    expect(JSON.stringify(audit.rows)).not.toContain(ACCESS_TOKEN);
  });
});
