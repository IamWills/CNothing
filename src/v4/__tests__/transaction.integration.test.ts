import { afterEach, beforeEach, expect, test } from "bun:test";

import { describeWithDb, resetDatabase } from "../../__tests__/helpers/db";
import {
  givenAgent,
  givenConnection,
  givenProvider,
  stubUpstreamFetch,
} from "../../__tests__/helpers/fixtures";
import { pool } from "../../db";

const { proxyService } = await import("../proxy.service");
const { findTransactionByIdempotency } = await import("../transaction.repository");

const API_BASE_URL = "http://127.0.0.1:3021";
const USER_ID = "github:alice";
const ACCESS_TOKEN = "gho_supersecret_access_token_value";
const ISSUE_URL = "https://api.github.com/repos/acme/app/issues";

async function givenOptInGrant() {
  const { agent } = await givenAgent();
  const provider = await givenProvider({ slug: "github", apiHosts: ["api.github.com"] });
  const connection = await givenConnection({
    providerId: provider.id,
    userId: USER_ID,
    accessToken: ACCESS_TOKEN,
  });
  const request = await proxyService.requestAccess({
    agent,
    provider: provider.slug,
    apiBaseUrl: API_BASE_URL,
  });
  const approved = await proxyService.approveAccess({
    accessRequestId: request.access_request_id,
    userId: USER_ID,
    connectionId: connection.id,
    allowedMethods: ["GET", "POST"],
    requireApproval: true,
  });
  if (!("grant" in approved) || !approved.grant) {
    throw new Error("expected a delegation grant");
  }
  return { agent, grantId: approved.grant.id, mandateId: approved.grant.id };
}

describeWithDb("transaction intent via proxy_request", () => {
  let upstream: ReturnType<typeof stubUpstreamFetch>;

  beforeEach(async () => {
    await resetDatabase();
    upstream = stubUpstreamFetch((_url, init) => {
      const method = String(init.method ?? "GET").toUpperCase();
      if (method === "GET" || method === "HEAD") {
        return Response.json({ login: "alice" }, { status: 200 });
      }
      return Response.json(
        { html_url: "https://github.com/acme/app/issues/42", number: 42 },
        { status: 201 },
      );
    });
  });

  afterEach(() => {
    upstream.restore();
  });

  test("GET still executes immediately on an opted-in mandate", async () => {
    const { agent, grantId } = await givenOptInGrant();
    const result = await proxyService.proxy({
      agent,
      grantId,
      method: "GET",
      url: "https://api.github.com/user",
    });
    expect(result).toMatchObject({ ok: true, status: 200 });
    expect("approval_url" in result).toBe(false);
  });

  test("creating a GitHub issue requires a transaction approval then commits once", async () => {
    const { agent, grantId, mandateId } = await givenOptInGrant();
    const first = await proxyService.proxy({
      agent,
      grantId,
      method: "POST",
      url: ISSUE_URL,
      body: { title: "Hello from CNothing" },
      apiBaseUrl: API_BASE_URL,
    });

    expect(first).toMatchObject({
      ok: true,
      status: "approval_required",
      next_action: "wait_for_user",
    });
    if (first.status !== "approval_required") {
      throw new Error("expected approval_required");
    }
    expect(first.approval_url).toContain(`/approve-proxy/${first.request_id}`);
    expect(upstream.calls).toHaveLength(0);

    const status = await proxyService.getAccessStatus(first.request_id, agent);
    expect(status).toMatchObject({
      type: "transaction",
      action: "issues.create",
      status: "pending",
      grant_id: mandateId,
      mandate_id: mandateId,
    });

    const authorized = await proxyService.approveAccess({
      accessRequestId: first.request_id,
      userId: USER_ID,
    });
    expect(authorized).toMatchObject({
      ok: true,
      status: "approved",
      transaction_id: first.transaction_id,
      mandate_id: mandateId,
    });
    expect("grant" in authorized).toBe(false);

    const executed = await proxyService.proxy({
      agent,
      grantId,
      method: "POST",
      url: ISSUE_URL,
      body: { title: "Hello from CNothing" },
      apiBaseUrl: API_BASE_URL,
    });
    expect(executed).toMatchObject({
      ok: true,
      status: 201,
      transaction_id: first.transaction_id,
      external_reference: "https://github.com/acme/app/issues/42",
    });
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]?.init.headers).toMatchObject({
      authorization: `Bearer ${ACCESS_TOKEN}`,
    });

    const replayed = await proxyService.proxy({
      agent,
      grantId,
      method: "POST",
      url: ISSUE_URL,
      body: { title: "Hello from CNothing" },
      apiBaseUrl: API_BASE_URL,
    });
    expect(replayed).toMatchObject({
      ok: true,
      status: 201,
      transaction_id: first.transaction_id,
      external_reference: "https://github.com/acme/app/issues/42",
    });
    expect(upstream.calls).toHaveLength(1);

    const stored = await findTransactionByIdempotency(
      mandateId,
      (await import("../transaction.service")).deriveIdempotencyKey({
        mandateId,
        method: "POST",
        url: ISSUE_URL,
        body: { title: "Hello from CNothing" },
      }),
    );
    expect(stored?.status).toBe("committed");
  });

  test("denying the transaction blocks execution and is idempotent", async () => {
    const { agent, grantId } = await givenOptInGrant();
    const first = await proxyService.proxy({
      agent,
      grantId,
      method: "POST",
      url: ISSUE_URL,
      body: { title: "nope" },
      apiBaseUrl: API_BASE_URL,
    });
    if (first.status !== "approval_required") {
      throw new Error("expected approval_required");
    }
    await proxyService.denyAccess({ accessRequestId: first.request_id, userId: USER_ID });
    const again = await proxyService.proxy({
      agent,
      grantId,
      method: "POST",
      url: ISSUE_URL,
      body: { title: "nope" },
      apiBaseUrl: API_BASE_URL,
    });
    expect(again).toMatchObject({ ok: false, status: "denied", transaction_id: first.transaction_id });
    expect(upstream.calls).toHaveLength(0);
  });

  test("a write without require_approval still goes straight to the provider", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider({ apiHosts: ["api.github.com"] });
    const connection = await givenConnection({
      providerId: provider.id,
      userId: USER_ID,
      accessToken: ACCESS_TOKEN,
    });
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
    if (!("grant" in approved) || !approved.grant) {
      throw new Error("expected a delegation grant");
    }
    const result = await proxyService.proxy({
      agent,
      grantId: approved.grant.id,
      method: "POST",
      url: ISSUE_URL,
      body: { title: "legacy write" },
    });
    expect(result).toMatchObject({ ok: true, status: 201 });
    expect(upstream.calls).toHaveLength(1);
  });

  test("audit rows do not store the access token", async () => {
    const { agent, grantId } = await givenOptInGrant();
    const pending = await proxyService.proxy({
      agent,
      grantId,
      method: "POST",
      url: ISSUE_URL,
      body: { title: "audit" },
      apiBaseUrl: API_BASE_URL,
    });
    if (pending.status !== "approval_required") {
      throw new Error("expected approval_required");
    }
    await proxyService.approveAccess({ accessRequestId: pending.request_id, userId: USER_ID });
    await proxyService.proxy({
      agent,
      grantId,
      method: "POST",
      url: ISSUE_URL,
      body: { title: "audit" },
      apiBaseUrl: API_BASE_URL,
    });
    const { rows } = await pool.query(
      `SELECT encode(convert_to(coalesce(error_code,'') || coalesce(policy_decision,''), 'UTF8'), 'escape') AS blob
       FROM proxy_request_audit`,
    );
    for (const row of rows) {
      expect(String(row.blob)).not.toContain(ACCESS_TOKEN);
    }
  });
});
