import { beforeEach, expect, test, spyOn } from "bun:test";

import { describeWithDb, resetDatabase, warmConnectionPool } from "../../__tests__/helpers/db";
import { asPendingAccess, givenAgent, givenConnection, givenProvider, asMandateApproval } from "../../__tests__/helpers/fixtures";

import { ensureUser, upsertUserIdentity } from "../platform.repository";
import { createUserDevice, updateDevicePushToken, listActivePushDevices } from "../device.repository";
import { resolveAgentUserHint } from "../share-code.service";
import * as apns from "../apns.service";
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

  test("existing OIDC email identities resolve without inventing provider prefixes", async () => {
    await ensureUser("alice@example.com");
    expect(await resolveAgentUserHint("Alice@example.com")).toEqual({ userId: "alice@example.com" });
    expect(await resolveAgentUserHint("unknown@example.com")).toEqual({ unresolved: "unknown@example.com" });
  });

  test("provider:email routes the request to the phone owner's canonical identity", async () => {
    const { agent } = await givenAgent();
    const google = await givenProvider({ slug: "google" });
    const targetApi = await givenProvider({ slug: "calendar" });
    const owner = "createn@gmail.com";
    await ensureUser(owner);
    await upsertUserIdentity({ user_id: owner, provider_id: google.id, subject: "google-sub-123", email: owner });
    await createUserDevice({ id: "test-phone", user_id: owner, platform: "ios", device_name: "iPhone" });
    await updateDevicePushToken({ device_id: "test-phone", user_id: owner, push_token: "test-push-token", push_environment: "sandbox" });

    expect(await resolveAgentUserHint(" Google:Createn@gmail.com ")).toEqual({ userId: owner });
    expect(await resolveAgentUserHint("google:google-sub-123")).toEqual({ userId: owner });
    const push = spyOn(apns, "sendApprovalPush").mockResolvedValue({ sent: 1, failed: 0, skipped: false });
    let result;
    try {
      result = asPendingAccess(await proxyService.requestAccess({
        agent, provider: targetApi.slug, userId: "google:createn@gmail.com", apiBaseUrl: API_BASE_URL,
      }));
      expect(push).toHaveBeenCalledTimes(1);
      expect(push.mock.calls[0]?.[0]).toMatchObject({
        userId: owner, devices: [{ id: "test-phone", push_token: "test-push-token" }],
        accessRequestId: result.access_request_id,
      });
      expect(result.pushed_to_devices).toBe(1);
    } finally {
      push.mockRestore();
    }
    expect(result.resolved_user_id).toBe(owner);
    expect((await listActivePushDevices(result.resolved_user_id!)).map(device => device.id)).toEqual(["test-phone"]);
    expect((await proxyService.listPendingForUser(owner)).map(request => request.access_request_id)).toContain(result.access_request_id);
    const connection = await givenConnection({ providerId: targetApi.id, userId: owner });
    await expect(proxyService.approveAccess({
      accessRequestId: result.access_request_id, userId: "another-user", connectionId: connection.id,
    })).rejects.toThrow();
    await proxyService.approveAccess({ accessRequestId: result.access_request_id, userId: owner, connectionId: connection.id });
    expect(await proxyService.getAccessStatus(result.access_request_id, agent)).toMatchObject({ status: "approved", next_action: "call_proxy_request" });
  });

  test("provider account resolution cannot cross providers or choose an ambiguous owner", async () => {
    const google = await givenProvider({ slug: "google" });
    await givenProvider({ slug: "microsoft" });
    await upsertUserIdentity({ user_id: "owner-1", provider_id: google.id, subject: "sub-1", email: "same@example.com" });
    expect(await resolveAgentUserHint("microsoft:same@example.com")).toEqual({ unresolved: "microsoft:same@example.com" });
    expect(await resolveAgentUserHint("google:missing@example.com")).toEqual({ unresolved: "google:missing@example.com" });
    await upsertUserIdentity({ user_id: "owner-1", provider_id: google.id, subject: "sub-2", email: "same@example.com" });
    expect(await resolveAgentUserHint("google:same@example.com")).toEqual({ userId: "owner-1" });
    await upsertUserIdentity({ user_id: "owner-2", provider_id: google.id, subject: "sub-3", email: "same@example.com" });
    expect(await resolveAgentUserHint("google:same@example.com")).toEqual({ unresolved: "google:same@example.com" });
  });

  test("provider usernames resolve through stored login metadata", async () => {
    const provider = await givenProvider({ slug: "github" });
    await upsertUserIdentity({ user_id: "canonical-owner", provider_id: provider.id, subject: "123", metadata: { login: "Alice" } });
    expect(await resolveAgentUserHint("github:alice")).toEqual({ userId: "canonical-owner" });
    expect(await resolveAgentUserHint("google:")).toEqual({ unresolved: "google:" });
    expect(await resolveAgentUserHint(":alice")).toEqual({ unresolved: ":alice" });
  });

  test("unresolved email still produces one usable approval with polling guidance", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const result = asPendingAccess(await proxyService.requestAccess({
      agent, provider: provider.slug, userId: "unknown@example.com", apiBaseUrl: API_BASE_URL,
    }));
    expect(result.resolved_user_id).toBeNull();
    expect(result.next_action).toBe("wait_for_user");
    expect(result.retry_after_seconds).toBe(5);
    expect(result.user_action.approval_url).toBe(result.approval_url);
    expect(result.human_instruction).not.toContain("re-requesting");
    const claimed = await proxyService.getAccessRequestForApproval(result.access_request_id, USER_ID);
    expect(claimed.user_hint).toBe(USER_ID);
    expect(await proxyService.getAccessStatus(result.access_request_id, agent)).toMatchObject({
      status: "pending", next_action: "wait_for_user", retry_after_seconds: 5,
    });
  });

  test("expired pending requests tell the agent to stop polling", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const request = await createProxyAccessRequest({
      agent_id: agent.id, provider_slug: provider.slug, requested_hosts: ["api.github.com"], ttl_seconds: -60,
    });
    expect(await proxyService.getAccessStatus(request.id, agent)).toMatchObject({
      status: "expired", next_action: "none",
    });
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
