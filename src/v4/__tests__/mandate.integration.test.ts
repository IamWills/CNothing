import { beforeEach, expect, test } from "bun:test";

import { describeWithDb, resetDatabase } from "../../__tests__/helpers/db";
import { givenAgent, givenConnection, givenProvider } from "../../__tests__/helpers/fixtures";
import { pool } from "../../db";
import { proxyService } from "../proxy.service";
import { findProxyGrantById } from "../proxy.repository";

const API_BASE_URL = "http://127.0.0.1:3021";
const USER_ID = "github:alice";

describeWithDb("grant is stored as a mandate", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("approval persists principal, constraints, and empty actions", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const connection = await givenConnection({ providerId: provider.id, userId: USER_ID });
    const request = await proxyService.requestAccess({
      agent,
      provider: provider.slug,
      apiBaseUrl: API_BASE_URL,
    });

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const approved = await proxyService.approveAccess({
      accessRequestId: request.access_request_id,
      userId: USER_ID,
      connectionId: connection.id,
      allowedMethods: ["GET", "POST"],
      expiresAt,
    });

    expect(approved.grant.principal).toEqual({ type: "user", id: USER_ID });
    expect(approved.grant.constraints).toEqual({
      hosts: ["api.github.com"],
      methods: ["GET", "POST"],
      expires_at: expiresAt,
    });
    expect(approved.grant.actions).toEqual([]);
    expect(approved.grant.allowed_hosts).toEqual(["api.github.com"]);
    expect(approved.grant.revoked_at).toBeNull();

    const stored = await findProxyGrantById(approved.grant.id);
    expect(stored?.principal_id).toBe(USER_ID);
    expect(stored?.principal_type).toBe("user");
    expect(stored?.constraints).toMatchObject({
      hosts: ["api.github.com"],
      methods: ["GET", "POST"],
    });
  });

  test("list_grants keeps the v4 fields and adds the mandate envelope", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const connection = await givenConnection({ providerId: provider.id, userId: USER_ID });
    const request = await proxyService.requestAccess({
      agent,
      provider: provider.slug,
      apiBaseUrl: API_BASE_URL,
    });
    await proxyService.approveAccess({
      accessRequestId: request.access_request_id,
      userId: USER_ID,
      connectionId: connection.id,
    });

    const items = await proxyService.listGrants({ agentId: agent.id });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      agent_id: agent.id,
      provider_id: provider.id,
      allowed_hosts: ["api.github.com"],
      status: "active",
      principal: { type: "user", id: USER_ID },
      actions: [],
      revoked_at: null,
    });
    expect(items[0]?.constraints.hosts).toEqual(["api.github.com"]);
    expect(items[0]?.issued_at).toBe(items[0]?.created_at);
  });

  test("revoke records revoked_at", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const connection = await givenConnection({ providerId: provider.id, userId: USER_ID });
    const request = await proxyService.requestAccess({
      agent,
      provider: provider.slug,
      apiBaseUrl: API_BASE_URL,
    });
    const approved = await proxyService.approveAccess({
      accessRequestId: request.access_request_id,
      userId: USER_ID,
      connectionId: connection.id,
    });

    await proxyService.revokeGrant({ grantId: approved.grant.id, userId: USER_ID });
    const stored = await findProxyGrantById(approved.grant.id);
    expect(stored?.status).toBe("revoked");
    expect(stored?.revoked_at).toBeTruthy();
  });

  test("empty constraints still enforce the original host and method columns", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const connection = await givenConnection({ providerId: provider.id, userId: USER_ID });
    const request = await proxyService.requestAccess({
      agent,
      provider: provider.slug,
      apiBaseUrl: API_BASE_URL,
    });
    const approved = await proxyService.approveAccess({
      accessRequestId: request.access_request_id,
      userId: USER_ID,
      connectionId: connection.id,
      allowedMethods: ["GET"],
    });

    await pool.query(`UPDATE proxy_grants SET constraints = '{}'::jsonb WHERE id = $1`, [
      approved.grant.id,
    ]);

    await expect(
      proxyService.proxy({
        agent,
        grantId: approved.grant.id,
        method: "POST",
        url: "https://api.github.com/user",
      }),
    ).rejects.toThrow(/method not allowed/i);
  });
});
