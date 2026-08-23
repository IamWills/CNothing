import { beforeEach, expect, test } from "bun:test";

import { describeWithDb, resetDatabase, warmConnectionPool } from "../../__tests__/helpers/db";
import { givenAgent, givenUser, givenUserSession } from "../../__tests__/helpers/fixtures";
import { handleV4PlatformRequest } from "../../api/v4-platform.api";
import { handleV4Request } from "../../api/v4.api";
import { toHttpResponse } from "../../utils/errors";
import { pool } from "../../db";
import config from "../../config";

const SERVICE_TOKEN = config.bearerToken;

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

function bearerRequest(path: string, token: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(`https://cnothing.test${path}`, { ...init, headers });
}

describeWithDb("human admin identity and bootstrap", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("unauthenticated request to a user resource is 401", async () => {
    const response = await dispatch(new Request("https://cnothing.test/v4/auth/me"));
    expect(response.status).toBe(401);
  });

  test("authenticated user can read their own session", async () => {
    const { user, token } = await givenUserSession({ user_id: "github:alice" });
    const response = await dispatch(sessionRequest("/v4/auth/me", token));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, user_id: user.id, role: "user", email: null, display_name: null });
  });

  test("authenticated admin can access admin APIs", async () => {
    const { token } = await givenUserSession({ user_id: "github:admin", role: "admin" });
    const response = await dispatch(sessionRequest("/v4/agents", token));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, items: [] });
  });

  test("normal user accessing admin API is 403", async () => {
    const { token } = await givenUserSession({ user_id: "github:alice" });
    const response = await dispatch(sessionRequest("/v4/providers/admin", token));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.details.error_code).toBe("admin_required");
  });

  test("authenticated user can list their own agents", async () => {
    const { token } = await givenUserSession({ user_id: "github:alice" });
    const response = await dispatch(sessionRequest("/v4/agents", token));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, items: [] });
  });

  test("service credential is not accepted as human admin on operator APIs", async () => {
    const response = await dispatch(bearerRequest("/v4/agents", SERVICE_TOKEN));
    expect(response.status).toBe(401);
  });

  test("bootstrap with valid service credential and no admin succeeds", async () => {
    const user = await givenUser({ user_id: "github:alice" });
    const response = await dispatch(
      bearerRequest("/v4/admin/bootstrap", SERVICE_TOKEN, {
        method: "POST",
        body: JSON.stringify({ user_id: user.id }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, user_id: user.id, role: "admin" });

    const audit = await pool.query(
      `SELECT action, user_id, metadata FROM cap_oauth_audit WHERE action = 'admin.bootstrap'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].user_id).toBe(user.id);
    expect(JSON.stringify(audit.rows)).not.toContain(SERVICE_TOKEN);
  });

  test("bootstrap with invalid service credential is rejected", async () => {
    const user = await givenUser({ user_id: "github:alice" });
    const response = await dispatch(
      bearerRequest("/v4/admin/bootstrap", "not-the-service-token", {
        method: "POST",
        body: JSON.stringify({ user_id: user.id }),
      }),
    );
    expect(response.status).toBe(401);
  });

  test("bootstrap is disabled after an admin exists", async () => {
    await givenUser({ user_id: "github:first", role: "admin" });
    const second = await givenUser({ user_id: "github:second" });
    const response = await dispatch(
      bearerRequest("/v4/admin/bootstrap", SERVICE_TOKEN, {
        method: "POST",
        body: JSON.stringify({ user_id: second.id }),
      }),
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.details.error_code).toBe("bootstrap_disabled");
  });

  test("bootstrap rejects a missing target user", async () => {
    const response = await dispatch(
      bearerRequest("/v4/admin/bootstrap", SERVICE_TOKEN, {
        method: "POST",
        body: JSON.stringify({ user_id: "github:nobody" }),
      }),
    );
    expect(response.status).toBe(404);
  });

  test("concurrent bootstrap attempts produce a single admin", async () => {
    const user = await givenUser({ user_id: "github:alice" });
    await warmConnectionPool();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        dispatch(
          bearerRequest("/v4/admin/bootstrap", SERVICE_TOKEN, {
            method: "POST",
            body: JSON.stringify({ user_id: user.id }),
          }),
        ),
      ),
    );
    const statuses = results.map((response) => response.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409).length).toBeGreaterThan(0);

    const admins = await pool.query(`SELECT id FROM cap_users WHERE role = 'admin'`);
    expect(admins.rows).toHaveLength(1);
    expect(admins.rows[0].id).toBe(user.id);
  });

  test("agent credential cannot impersonate a human admin", async () => {
    const { accessToken } = await givenAgent();
    const response = await dispatch(bearerRequest("/v4/agents", accessToken));
    expect(response.status).toBe(401);
  });

  test("human session cannot act as an agent credential", async () => {
    const { token } = await givenUserSession({ user_id: "github:alice" });
    const response = await dispatch(
      sessionRequest("/v4/access-requests", token, {
        method: "POST",
        body: JSON.stringify({ provider: "github", reason: "test" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  test("service credential does not mint a human session", async () => {
    const user = await givenUser({ user_id: "github:alice" });
    const bootstrap = await dispatch(
      bearerRequest("/v4/admin/bootstrap", SERVICE_TOKEN, {
        method: "POST",
        body: JSON.stringify({ user_id: user.id }),
      }),
    );
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.headers.get("set-cookie")).toBeNull();

    const me = await dispatch(bearerRequest("/v4/auth/me", SERVICE_TOKEN));
    expect(me.status).toBe(401);
  });

  test("human admin can promote and cannot demote the last admin", async () => {
    const { user: admin, token } = await givenUserSession({
      user_id: "github:admin",
      role: "admin",
    });
    const target = await givenUser({ user_id: "github:bob" });

    const promoted = await dispatch(
      sessionRequest("/v4/admin/users/promote", token, {
        method: "POST",
        body: JSON.stringify({ user_id: target.id }),
      }),
    );
    expect(promoted.status).toBe(200);
    expect(await promoted.json()).toMatchObject({ ok: true, user_id: target.id, role: "admin" });

    const demoted = await dispatch(
      sessionRequest("/v4/admin/users/demote", token, {
        method: "POST",
        body: JSON.stringify({ user_id: target.id }),
      }),
    );
    expect(demoted.status).toBe(200);

    const last = await dispatch(
      sessionRequest("/v4/admin/users/demote", token, {
        method: "POST",
        body: JSON.stringify({ user_id: admin.id }),
      }),
    );
    expect(last.status).toBe(409);
    const body = await last.json();
    expect(body.error.details.error_code).toBe("last_admin");
  });

  test("new users default to the user role", async () => {
    const user = await givenUser({ user_id: "github:fresh" });
    expect(user.role).toBe("user");
  });

  test("existing user session still authorizes user resources after the role migration", async () => {
    const { token } = await givenUserSession({ user_id: "github:alice" });
    const response = await dispatch(sessionRequest("/v4/connections", token));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, items: [] });
  });
});
