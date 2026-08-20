import { beforeEach, expect, test } from "bun:test";

import { describeWithDb, resetDatabase } from "../../__tests__/helpers/db";
import { givenAgent, givenConnection, givenProvider } from "../../__tests__/helpers/fixtures";
import { approvalService } from "../approval.service";
import { proxyService } from "../proxy.service";
import { findProxyAccessRequest } from "../proxy.repository";

const API_BASE_URL = "http://127.0.0.1:3021";
const USER_ID = "github:alice";

describeWithDb("access request is stored as an approval request", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("request_access writes a delegation approval", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const result = await proxyService.requestAccess({
      agent,
      provider: provider.slug,
      reason: "Create an issue",
      userId: USER_ID,
      apiBaseUrl: API_BASE_URL,
    });

    const stored = await findProxyAccessRequest(result.access_request_id);
    expect(stored).toMatchObject({
      approval_type: "delegation",
      principal_type: "user",
      principal_id: USER_ID,
      action: "delegate",
      status: "pending",
    });
    expect(stored?.resource).toEqual({
      provider: provider.slug,
      hosts: ["api.github.com"],
    });
    expect(stored?.decision).toBeNull();
  });

  test("pending list and status expose the approval envelope without dropping v4 fields", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const created = await proxyService.requestAccess({
      agent,
      provider: provider.slug,
      userId: USER_ID,
      apiBaseUrl: API_BASE_URL,
    });

    const pending = await proxyService.listPendingForUser(USER_ID);
    expect(pending[0]).toMatchObject({
      access_request_id: created.access_request_id,
      provider: provider.slug,
      type: "delegation",
      action: "delegate",
      principal: { type: "user", id: USER_ID },
    });

    const status = await proxyService.getAccessStatus(created.access_request_id, agent);
    expect(status.type).toBe("delegation");
    expect(status.grant_id).toBeNull();
    expect(status.mandate_id).toBeNull();
  });

  test("approval records a decision pointing at the minted mandate", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const connection = await givenConnection({ providerId: provider.id, userId: USER_ID });
    const created = await proxyService.requestAccess({
      agent,
      provider: provider.slug,
      userId: USER_ID,
      apiBaseUrl: API_BASE_URL,
    });

    const approved = await proxyService.approveAccess({
      accessRequestId: created.access_request_id,
      userId: USER_ID,
      connectionId: connection.id,
    });

    const stored = await findProxyAccessRequest(created.access_request_id);
    expect(stored?.status).toBe("approved");
    expect(stored?.decision).toMatchObject({
      verdict: "approved",
      decided_by: USER_ID,
      mandate_id: approved.grant.id,
      connection_id: connection.id,
    });

    const status = await proxyService.getAccessStatus(created.access_request_id, agent);
    expect(status.mandate_id).toBe(approved.grant.id);
    expect(status.grant_id).toBe(approved.grant.id);
  });

  test("a device challenge is refused once the approval is no longer pending", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const created = await proxyService.requestAccess({
      agent,
      provider: provider.slug,
      userId: USER_ID,
      apiBaseUrl: API_BASE_URL,
    });
    await proxyService.denyAccess({
      accessRequestId: created.access_request_id,
      userId: USER_ID,
    });

    await expect(
      approvalService.requirePending(created.access_request_id, USER_ID),
    ).rejects.toThrow(/already denied/i);
  });

  test("another principal cannot decide a targeted approval", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const created = await proxyService.requestAccess({
      agent,
      provider: provider.slug,
      userId: USER_ID,
      apiBaseUrl: API_BASE_URL,
    });

    await expect(
      proxyService.denyAccess({
        accessRequestId: created.access_request_id,
        userId: "github:mallory",
      }),
    ).rejects.toThrow(/another principal/i);
  });
});
