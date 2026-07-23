import { parseJsonBody } from "../utils/http";
import { NotFoundError, ValidationError } from "../utils/errors";
import { readRequiredString, requireAgentFromRequest } from "../v2/agent-auth";
import { readUserSessionToken, requireUserSession } from "../v2/user-session";
import { listOAuthProviders, toProviderPublic } from "../v2/oauth.repository";
import { oauthConnectionService } from "../v2/oauth-connection.service";
import { proxyService } from "../v4/proxy.service";
import { sandboxService } from "../v4/sandbox.service";
import { deviceService } from "../v4/device.service";
import config from "../config";

function inferBaseUrl(request: Request): string {
  const requestUrl = new URL(request.url);
  const forwardedProto = request.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("X-Forwarded-Host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("Host") || requestUrl.host;
  const proto = forwardedProto || requestUrl.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

export async function handleV4Request(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const segments = path.split("/").filter(Boolean);

  // Browser approval page lives in the Console at /approve-proxy/{id}.
  // Agents often paste API paths into the browser instead of approval_url:
  //   GET /v4/approve/{id}
  //   GET /v4/access-requests/{id}/approve   (POST-only API; not a webpage)
  // Redirect both to the Console page.
  const isLegacyApprovePath =
    request.method === "GET" &&
    ((segments.length === 3 && segments[1] === "approve") ||
      (segments.length === 4 &&
        segments[1] === "access-requests" &&
        segments[3] === "approve"));
  if (isLegacyApprovePath) {
    const accessRequestId = decodeURIComponent(segments[2] ?? "");
    const consoleBase = (config.consoleUrl ?? inferBaseUrl(request)).replace(/\/+$/, "");
    return Response.redirect(
      `${consoleBase}/approve-proxy/${encodeURIComponent(accessRequestId)}`,
      302,
    );
  }

  // --- Sandbox (agent self-test without human approval) ---

  if (request.method === "POST" && path === "/v4/sandbox/start") {
    const agent = await requireAgentFromRequest(request);
    const result = await sandboxService.start({ agent, apiBaseUrl: inferBaseUrl(request) });
    return Response.json(result, { status: 201 });
  }

  if (path === "/v4/sandbox/echo") {
    return sandboxService.echo(request);
  }

  // --- Devices (iOS authenticator pairing) ---

  if (request.method === "POST" && path === "/v4/devices/pairing-codes") {
    const session = await requireUserSession(request);
    return Response.json(await deviceService.issuePairingCode(session.user_id), { status: 201 });
  }

  if (request.method === "POST" && path === "/v4/devices/pair") {
    const body = await parseJsonBody(request);
    const result = await deviceService.pairDevice({
      pairingCode: readRequiredString(body, "pairing_code"),
      deviceName: typeof body.device_name === "string" ? body.device_name : "",
      platform: typeof body.platform === "string" ? body.platform : undefined,
      publicKeyJwk: body.public_key_jwk,
    });
    return Response.json(result, { status: 201 });
  }

  if (
    request.method === "POST" &&
    segments.length === 4 &&
    segments[1] === "devices" &&
    segments[3] === "push-token"
  ) {
    const session = await requireUserSession(request);
    const body = await parseJsonBody(request);
    const result = await deviceService.registerPushToken({
      userId: session.user_id,
      deviceId: decodeURIComponent(segments[2] ?? ""),
      pushToken: readRequiredString(body, "push_token"),
      pushEnvironment:
        typeof body.push_environment === "string" ? body.push_environment : undefined,
    });
    return Response.json(result);
  }

  if (request.method === "GET" && path === "/v4/devices") {
    const session = await requireUserSession(request);
    return Response.json({ ok: true, items: await deviceService.listDevices(session.user_id) });
  }

  if (request.method === "DELETE" && segments.length === 3 && segments[1] === "devices") {
    const session = await requireUserSession(request);
    const result = await deviceService.revokeDevice({
      userId: session.user_id,
      deviceId: decodeURIComponent(segments[2] ?? ""),
    });
    return Response.json(result);
  }

  // --- Agent-facing ---

  if (request.method === "POST" && path === "/v4/access-requests") {
    const agent = await requireAgentFromRequest(request);
    const body = await parseJsonBody(request);
    const result = await proxyService.requestAccess({
      agent,
      provider: readRequiredString(body, "provider"),
      hosts: body.hosts,
      ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
      ...(typeof body.user_id === "string" ? { userId: body.user_id } : {}),
      ...(typeof body.callback_url === "string" ? { callbackUrl: body.callback_url } : {}),
      apiBaseUrl: inferBaseUrl(request),
    });
    return Response.json(result, { status: 201 });
  }

  // Pending approvals for the signed-in user (iOS authenticator polling).
  if (request.method === "GET" && path === "/v4/access-requests/pending") {
    const session = await requireUserSession(request);
    return Response.json({
      ok: true,
      items: await proxyService.listPendingForUser(session.user_id),
    });
  }

  if (
    request.method === "GET" &&
    segments.length === 3 &&
    segments[1] === "access-requests"
  ) {
    const id = decodeURIComponent(segments[2] ?? "");
    // Console approval page loads request details with a user session;
    // agents poll the same path with their bearer token.
    if (readUserSessionToken(request)) {
      const session = await requireUserSession(request);
      const record = await proxyService.getAccessRequestForApproval(id, session.user_id);
      return Response.json({
        ok: true,
        access_request_id: record.id,
        agent_id: record.agent_id,
        provider: record.provider_slug,
        requested_hosts: record.requested_hosts,
        reason: record.reason,
        status: record.status,
        user_hint: record.user_hint,
        expires_at: record.expires_at,
      });
    }
    const agent = await requireAgentFromRequest(request);
    const result = await proxyService.getAccessStatus(id, agent);
    return Response.json(result);
  }

  // Device approval challenge (Okta Verify-style proof of possession):
  // the phone requests a one-time nonce, signs it with its Secure Enclave key,
  // then sends the signature alongside approve/deny.
  if (
    request.method === "POST" &&
    segments.length === 4 &&
    segments[1] === "access-requests" &&
    segments[3] === "challenge"
  ) {
    const session = await requireUserSession(request);
    const deviceId = typeof session.metadata.device_id === "string" ? session.metadata.device_id : "";
    if (!deviceId) {
      throw new ValidationError("Approval challenges are only issued to paired devices", {
        error_code: "not_a_device_session",
      });
    }
    const result = await deviceService.issueApprovalChallenge({
      userId: session.user_id,
      deviceId,
      accessRequestId: decodeURIComponent(segments[2] ?? ""),
    });
    return Response.json(result, { status: 201 });
  }

  if (
    request.method === "POST" &&
    segments.length === 4 &&
    segments[1] === "access-requests" &&
    (segments[3] === "approve" || segments[3] === "deny")
  ) {
    const session = await requireUserSession(request);
    const id = decodeURIComponent(segments[2] ?? "");
    const verdict = segments[3] === "deny" ? ("denied" as const) : ("approved" as const);
    const body = await parseJsonBody(request);

    // Sessions minted by device pairing must prove key possession on every verdict.
    const deviceId = typeof session.metadata.device_id === "string" ? session.metadata.device_id : "";
    if (deviceId) {
      await deviceService.verifyDeviceApproval({
        userId: session.user_id,
        deviceId,
        accessRequestId: id,
        verdict,
        challengeId: typeof body.challenge_id === "string" ? body.challenge_id : "",
        signature: typeof body.signature === "string" ? body.signature : "",
      });
    }

    if (verdict === "denied") {
      const result = await proxyService.denyAccess({
        accessRequestId: id,
        userId: session.user_id,
      });
      return Response.json(result);
    }
    const result = await proxyService.approveAccess({
      accessRequestId: id,
      userId: session.user_id,
      connectionId: readRequiredString(body, "connection_id"),
      allowedHosts: body.allowed_hosts,
      allowedMethods: body.allowed_methods,
      ...(typeof body.expires_at === "string" ? { expiresAt: body.expires_at } : {}),
    });
    return Response.json(result, { status: 201 });
  }

  if (request.method === "POST" && path === "/v4/proxy") {
    const agent = await requireAgentFromRequest(request);
    const body = await parseJsonBody(request);
    const headers =
      body.headers && typeof body.headers === "object" && !Array.isArray(body.headers)
        ? (body.headers as Record<string, unknown>)
        : undefined;
    const result = await proxyService.proxy({
      agent,
      grantId: readRequiredString(body, "grant_id"),
      method: readRequiredString(body, "method"),
      url: readRequiredString(body, "url"),
      ...(headers ? { headers } : {}),
      ...(body.body !== undefined ? { body: body.body } : {}),
    });
    return Response.json(result);
  }

  if (request.method === "GET" && path === "/v4/grants") {
    if (readUserSessionToken(request)) {
      const session = await requireUserSession(request);
      const items = await proxyService.listGrants({ userId: session.user_id });
      return Response.json({ ok: true, items });
    }
    const agent = await requireAgentFromRequest(request);
    const items = await proxyService.listGrants({ agentId: agent.id });
    return Response.json({ ok: true, items });
  }

  if (
    request.method === "POST" &&
    segments.length === 4 &&
    segments[1] === "grants" &&
    segments[3] === "revoke"
  ) {
    const session = await requireUserSession(request);
    const result = await proxyService.revokeGrant({
      grantId: decodeURIComponent(segments[2] ?? ""),
      userId: session.user_id,
    });
    return Response.json(result);
  }

  // --- Discovery ---

  if (request.method === "GET" && path === "/v4/providers") {
    const providers = await listOAuthProviders();
    return Response.json({
      ok: true,
      items: providers
        .filter((provider) => provider.status === "active")
        .map(toProviderPublic),
    });
  }

  if (request.method === "GET" && path === "/v4/connections") {
    const session = await requireUserSession(request);
    const items = await oauthConnectionService.listConnections(session.user_id);
    return Response.json({ ok: true, items });
  }

  if (segments[0] === "v4") {
    throw new NotFoundError(`Route not found: ${path}`);
  }
  throw new ValidationError(`Unexpected path: ${path}`);
}
