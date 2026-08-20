import { beforeEach, expect, test } from "bun:test";

import { describeWithDb, resetDatabase, warmConnectionPool } from "../../__tests__/helpers/db";
import { asPendingAccess, givenAgent, givenConnection, givenProvider, asMandateApproval } from "../../__tests__/helpers/fixtures";

import { proxyService } from "../proxy.service";
import {
  createProxyAccessRequest,
  findProxyAccessRequest,
  listProxyGrantsForUser,
} from "../proxy.repository";
import { revokeOAuthConnection } from "../oauth.repository";

const API_BASE_URL = "http://127.0.0.1:3021";
const USER_ID = "github:alice";

describeWithDb("v4 access request → grant lifecycle", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("request_access falls back to the provider's default API hosts", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider({ apiHosts: ["api.github.com"] });

    const result = asPendingAccess(await proxyService.requestAccess({
      agent,
      provider: provider.slug,
      reason: "Create an issue",
      userId: USER_ID,
      apiBaseUrl: API_BASE_URL,
    }));

    expect(result.status).toBe("pending");
    expect(result.requested_hosts).toEqual(["api.github.com"]);
    expect(result.resolved_user_id).toBe(USER_ID);
    expect(result.approval_url).toContain(`/approve-proxy/${result.access_request_id}`);
  });

  test("request_access rejects an unknown provider", async () => {
    const { agent } = await givenAgent();
    await expect(
      proxyService.requestAccess({
        agent,
        provider: "does-not-exist",
        apiBaseUrl: API_BASE_URL,
      }),
    ).rejects.toThrow(/provider not found/i);
  });

  test("approval mints a grant scoped to the requested hosts and methods", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const connection = await givenConnection({ providerId: provider.id, userId: USER_ID });

    const request = asPendingAccess(await proxyService.requestAccess({
      agent,
      provider: provider.slug,
      apiBaseUrl: API_BASE_URL,
    }));

    const approved = asMandateApproval(await proxyService.approveAccess({
      accessRequestId: request.access_request_id,
      userId: USER_ID,
      connectionId: connection.id,
      allowedMethods: ["GET", "POST"],
    }));

    expect(approved.grant.allowed_hosts).toEqual(["api.github.com"]);
    expect(approved.grant.allowed_methods).toEqual(["GET", "POST"]);
    expect(approved.grant.status).toBe("active");

    const status = await proxyService.getAccessStatus(request.access_request_id, agent);
    expect(status.status).toBe("approved");
    expect(status.grant_id).toBe(approved.grant.id);
  });

  test("a second approval is rejected and never creates a duplicate grant", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const connection = await givenConnection({ providerId: provider.id, userId: USER_ID });
    const request = asPendingAccess(await proxyService.requestAccess({
      agent,
      provider: provider.slug,
      apiBaseUrl: API_BASE_URL,
    }));

    await proxyService.approveAccess({
      accessRequestId: request.access_request_id,
      userId: USER_ID,
      connectionId: connection.id,
    });

    await expect(
      proxyService.approveAccess({
        accessRequestId: request.access_request_id,
        userId: USER_ID,
        connectionId: connection.id,
      }),
    ).rejects.toThrow(/already approved/i);

    expect(await listProxyGrantsForUser(USER_ID)).toHaveLength(1);
  });

  test("concurrent approvals of one request yield exactly one grant", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const connection = await givenConnection({ providerId: provider.id, userId: USER_ID });
    const request = asPendingAccess(await proxyService.requestAccess({
      agent,
      provider: provider.slug,
      apiBaseUrl: API_BASE_URL,
    }));
    await warmConnectionPool();

    const outcomes = await Promise.allSettled([
      proxyService.approveAccess({
        accessRequestId: request.access_request_id,
        userId: USER_ID,
        connectionId: connection.id,
      }),
      proxyService.approveAccess({
        accessRequestId: request.access_request_id,
        userId: USER_ID,
        connectionId: connection.id,
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(await listProxyGrantsForUser(USER_ID)).toHaveLength(1);
  });

  test("approval requires a connection owned by the approving user", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const connection = await givenConnection({ providerId: provider.id, userId: "github:mallory" });
    const request = asPendingAccess(await proxyService.requestAccess({
      agent,
      provider: provider.slug,
      apiBaseUrl: API_BASE_URL,
    }));

    await expect(
      proxyService.approveAccess({
        accessRequestId: request.access_request_id,
        userId: USER_ID,
        connectionId: connection.id,
      }),
    ).rejects.toThrow(/not owned by this user/i);

    expect(await listProxyGrantsForUser(USER_ID)).toHaveLength(0);
  });

  test("approval rejects a connection from a different provider", async () => {
    const { agent } = await givenAgent();
    const requested = await givenProvider();
    const other = await givenProvider();
    const connection = await givenConnection({ providerId: other.id, userId: USER_ID });
    const request = asPendingAccess(await proxyService.requestAccess({
      agent,
      provider: requested.slug,
      apiBaseUrl: API_BASE_URL,
    }));

    await expect(
      proxyService.approveAccess({
        accessRequestId: request.access_request_id,
        userId: USER_ID,
        connectionId: connection.id,
      }),
    ).rejects.toThrow(/does not match/i);
  });

  test("approval rejects a revoked connection", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const connection = await givenConnection({ providerId: provider.id, userId: USER_ID });
    await revokeOAuthConnection(connection.id, USER_ID);
    const request = asPendingAccess(await proxyService.requestAccess({
      agent,
      provider: provider.slug,
      apiBaseUrl: API_BASE_URL,
    }));

    await expect(
      proxyService.approveAccess({
        accessRequestId: request.access_request_id,
        userId: USER_ID,
        connectionId: connection.id,
      }),
    ).rejects.toThrow(/not active/i);
  });

  test("an expired access request can no longer be approved", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const connection = await givenConnection({ providerId: provider.id, userId: USER_ID });
    const expired = await createProxyAccessRequest({
      agent_id: agent.id,
      provider_slug: provider.slug,
      requested_hosts: ["api.github.com"],
      ttl_seconds: -60,
    });

    await expect(
      proxyService.approveAccess({
        accessRequestId: expired.id,
        userId: USER_ID,
        connectionId: connection.id,
      }),
    ).rejects.toThrow(/expired/i);
  });

  test("denial records the verdict without minting a grant", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const request = asPendingAccess(await proxyService.requestAccess({
      agent,
      provider: provider.slug,
      apiBaseUrl: API_BASE_URL,
    }));

    expect(await proxyService.denyAccess({
      accessRequestId: request.access_request_id,
      userId: USER_ID,
    })).toMatchObject({ status: "denied" });

    const stored = await findProxyAccessRequest(request.access_request_id);
    expect(stored?.status).toBe("denied");
    expect(stored?.grant_id).toBeNull();
    expect(await listProxyGrantsForUser(USER_ID)).toHaveLength(0);
  });

  test("an agent cannot read another agent's access request", async () => {
    const { agent } = await givenAgent();
    const { agent: intruder } = await givenAgent();
    const provider = await givenProvider();
    const request = asPendingAccess(await proxyService.requestAccess({
      agent,
      provider: provider.slug,
      apiBaseUrl: API_BASE_URL,
    }));

    await expect(
      proxyService.getAccessStatus(request.access_request_id, intruder),
    ).rejects.toThrow(/not found/i);
  });

  test("only the granting user can revoke a grant", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const connection = await givenConnection({ providerId: provider.id, userId: USER_ID });
    const request = asPendingAccess(await proxyService.requestAccess({
      agent,
      provider: provider.slug,
      apiBaseUrl: API_BASE_URL,
    }));
    const approved = asMandateApproval(await proxyService.approveAccess({
      accessRequestId: request.access_request_id,
      userId: USER_ID,
      connectionId: connection.id,
    }));

    await expect(
      proxyService.revokeGrant({ grantId: approved.grant.id, userId: "github:mallory" }),
    ).rejects.toThrow(/not found/i);

    expect(
      await proxyService.revokeGrant({ grantId: approved.grant.id, userId: USER_ID }),
    ).toMatchObject({ status: "revoked" });

    const grants = await proxyService.listGrants({ agentId: agent.id });
    expect(grants[0]?.status).toBe("revoked");
  });

  test("opening the approval page claims an unassigned request for the viewer", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const request = asPendingAccess(await proxyService.requestAccess({
      agent,
      provider: provider.slug,
      apiBaseUrl: API_BASE_URL,
    }));
    expect(request.resolved_user_id).toBeNull();

    const claimed = await proxyService.getAccessRequestForApproval(
      request.access_request_id,
      USER_ID,
    );
    expect(claimed.user_hint).toBe(USER_ID);

    const pending = await proxyService.listPendingForUser(USER_ID);
    expect(pending.map((item) => item.access_request_id)).toContain(request.access_request_id);
  });
});
