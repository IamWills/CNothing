import { beforeEach, expect, test } from "bun:test";

import { describeWithDb, resetDatabase } from "../../__tests__/helpers/db";
import { givenUserSession } from "../../__tests__/helpers/fixtures";
import { handleV4PlatformRequest } from "../../api/v4-platform.api";
import { handleV4Request } from "../../api/v4.api";
import { toHttpResponse } from "../../utils/errors";
import { sanitizeAgentResponse } from "../secret-redaction";
import { pool } from "../../db";

async function dispatch(request: Request): Promise<Response> {
  try {
    return (await handleV4PlatformRequest(request)) ?? (await handleV4Request(request));
  } catch (error) {
    return toHttpResponse(error);
  }
}

function sessionRequest(path: string, token: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("cookie", `cnothing_user_session=${encodeURIComponent(token)}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(`https://cnothing.test${path}`, { ...init, headers });
}

describeWithDb("user-approved agent enrollment", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("plugin can start enrollment without minting an agent", async () => {
    const response = await dispatch(
      new Request("https://cnothing.test/v4/agent-enrollments", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
        body: JSON.stringify({ client_name: "cursor-plugin" }),
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.status).toBe("pending");
    expect(body.enrollment_secret).toMatch(/^enrs_/);
    expect(body.approval_url).toContain("/approve-agent/");
    expect(body.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(body.host_only).toBe(true);

    const agents = await pool.query(`SELECT id FROM cap_agents`);
    expect(agents.rows).toHaveLength(0);

    const publicStatus = await dispatch(
      new Request(`https://cnothing.test/v4/agent-enrollments/${body.enrollment_id}`),
    );
    expect(publicStatus.status).toBe(200);
    const publicBody = await publicStatus.json();
    expect(publicBody).toMatchObject({
      status: "pending",
      client_name: "cursor-plugin",
      user_code: body.user_code,
    });
    expect(JSON.stringify(publicBody)).not.toContain(body.enrollment_secret);
  });

  test("user approval issues a token only to the plugin poll, never to the console response", async () => {
    const created = await dispatch(
      new Request("https://cnothing.test/v4/agent-enrollments", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.11" },
        body: JSON.stringify({ client_name: "stdio-adapter" }),
      }),
    );
    const enrollment = await created.json();
    const { user, token } = await givenUserSession({ user_id: "github:alice" });

    const approved = await dispatch(
      sessionRequest(`/v4/agent-enrollments/${enrollment.enrollment_id}/approve`, token, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(approved.status).toBe(200);
    const approvalBody = await approved.json();
    expect(approvalBody).toMatchObject({ ok: true, status: "approved" });
    expect(approvalBody.access_token).toBeUndefined();
    expect(JSON.stringify(approvalBody)).not.toContain("enrs_");
    expect(JSON.stringify(approvalBody)).not.toMatch(/"access_token"/);

    const pendingPoll = await dispatch(
      new Request(`https://cnothing.test/v4/agent-enrollments/${enrollment.enrollment_id}`, {
        headers: { authorization: `Bearer ${enrollment.enrollment_secret}` },
      }),
    );
    const claimed = await pendingPoll.json();
    expect(claimed.status).toBe("approved");
    expect(claimed.access_token).toMatch(/^agent_/);
    expect(typeof claimed.agent_id).toBe("string");

    const stored = await pool.query(`SELECT owner_user_id, access_token_hash FROM cap_agents WHERE id = $1`, [
      claimed.agent_id,
    ]);
    expect(stored.rows[0].owner_user_id).toBe(user.id);
    expect(stored.rows[0].access_token_hash).not.toBe(claimed.access_token);

    const secondPoll = await dispatch(
      new Request(`https://cnothing.test/v4/agent-enrollments/${enrollment.enrollment_id}`, {
        headers: { authorization: `Bearer ${enrollment.enrollment_secret}` },
      }),
    );
    const delivered = await secondPoll.json();
    expect(delivered.token_delivered).toBe(true);
    expect(delivered.access_token).toBeUndefined();
  });

  test("poll without the enrollment secret cannot receive the token", async () => {
    const created = await dispatch(
      new Request("https://cnothing.test/v4/agent-enrollments", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.12" },
        body: JSON.stringify({ client_name: "bad-poller" }),
      }),
    );
    const enrollment = await created.json();
    const { token } = await givenUserSession({ user_id: "github:bob" });
    await dispatch(
      sessionRequest(`/v4/agent-enrollments/${enrollment.enrollment_id}/approve`, token, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    const publicAfter = await dispatch(
      new Request(`https://cnothing.test/v4/agent-enrollments/${enrollment.enrollment_id}`),
    );
    const body = await publicAfter.json();
    expect(body.status).toBe("approved");
    expect(body.access_token).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("enrs_");
    expect(JSON.stringify(body)).not.toMatch(/"access_token"/);

    const wrongSecret = await dispatch(
      new Request(`https://cnothing.test/v4/agent-enrollments/${enrollment.enrollment_id}`, {
        headers: { authorization: "Bearer enrs_not_the_secret" },
      }),
    );
    expect(wrongSecret.status).toBe(401);
  });

  test("model-visible sanitizer strips enrollment secrets and agent tokens", async () => {
    const leaked = sanitizeAgentResponse({
      approval_url: "https://cnothing.com/approve-agent/abc",
      user_code: "AB12-CD34",
      enrollment_secret: "enrs_should_not_leak",
      access_token: "agent_should_not_leak",
      note: "enrs_also_a_token_shape",
    });
    expect(leaked).toMatchObject({
      approval_url: "https://cnothing.com/approve-agent/abc",
      user_code: "AB12-CD34",
      enrollment_secret: "[REDACTED]",
      access_token: "[REDACTED]",
      note: "[REDACTED]",
    });
  });

  test("ordinary users can revoke only their own enrolled agent", async () => {
    const created = await dispatch(
      new Request("https://cnothing.test/v4/agent-enrollments", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.13" },
        body: JSON.stringify({ client_name: "alice-runtime" }),
      }),
    );
    const enrollment = await created.json();
    const alice = await givenUserSession({ user_id: "github:alice" });
    const bob = await givenUserSession({ user_id: "github:bob" });
    const approved = await dispatch(
      sessionRequest(`/v4/agent-enrollments/${enrollment.enrollment_id}/approve`, alice.token, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    const { agent_id: agentId } = (await approved.json()) as { agent_id: string };

    const denied = await dispatch(
      sessionRequest(`/v4/agents/${agentId}`, bob.token, { method: "DELETE" }),
    );
    expect(denied.status).toBe(404);

    const revoked = await dispatch(
      sessionRequest(`/v4/agents/${agentId}`, alice.token, { method: "DELETE" }),
    );
    expect(revoked.status).toBe(200);
  });
});
