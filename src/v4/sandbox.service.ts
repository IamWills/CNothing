import { randomBytes } from "node:crypto";

import type { AgentRecord } from "../v2/v2.entity";
import {
  createOAuthConnection,
  createOAuthProvider,
  findOAuthProviderBySlug,
} from "../v2/oauth.repository";
import { createProxyAccessRequest, createProxyGrant, decideProxyAccessRequest } from "./proxy.repository";
import { DEFAULT_ALLOWED_METHODS } from "./proxy.rules";

export const SANDBOX_PROVIDER_SLUG = "cnothing-sandbox";
const SANDBOX_GRANT_TTL_MS = 60 * 60 * 1000;

/**
 * The sandbox lets an agent exercise the ENTIRE v4 mechanics (access request,
 * grant, credential-injecting proxy, response redaction) without a human in
 * the loop. It is safe to auto-approve because the grant only allows calling
 * CNothing's own echo endpoint with a throwaway token — no real third-party
 * credentials are involved.
 */
export class SandboxService {
  private async ensureSandboxProvider(apiBaseUrl: string) {
    const existing = await findOAuthProviderBySlug(SANDBOX_PROVIDER_SLUG);
    if (existing) {
      return existing;
    }
    const base = apiBaseUrl.replace(/\/+$/, "");
    return createOAuthProvider({
      slug: SANDBOX_PROVIDER_SLUG,
      display_name: "CNothing Sandbox (self-test)",
      auth_type: "oauth2",
      authorization_url: `${base}/v4/sandbox/echo`,
      token_url: `${base}/v4/sandbox/echo`,
      userinfo_url: `${base}/v4/sandbox/echo`,
      client_id: "sandbox",
      client_secret: "sandbox",
      default_scopes: ["sandbox"],
      supported_scopes: ["sandbox"],
      pkce_required: false,
      metadata: { sandbox: true, api_hosts: [new URL(base).hostname.toLowerCase()] },
    });
  }

  async start(input: { agent: AgentRecord; apiBaseUrl: string }) {
    const base = input.apiBaseUrl.replace(/\/+$/, "");
    const host = new URL(base).hostname.toLowerCase();
    const provider = await this.ensureSandboxProvider(base);

    const sandboxUserId = `sandbox:${input.agent.id}`;
    const sandboxToken = `sandbox_${randomBytes(24).toString("base64url")}`;

    const connection = await createOAuthConnection({
      user_id: sandboxUserId,
      provider_id: provider.id,
      provider_account_id: sandboxUserId,
      display_name: `Sandbox connection for agent ${input.agent.name}`,
      access_token: sandboxToken,
      scopes: ["sandbox"],
      metadata: { sandbox: true, agent_id: input.agent.id },
    });

    const accessRequest = await createProxyAccessRequest({
      agent_id: input.agent.id,
      provider_slug: provider.slug,
      requested_hosts: [host],
      reason: "Sandbox self-test (auto-approved)",
      metadata: { sandbox: true, provider_id: provider.id },
    });

    const expiresAt = new Date(Date.now() + SANDBOX_GRANT_TTL_MS).toISOString();
    const grant = await createProxyGrant({
      agent_id: input.agent.id,
      user_id: sandboxUserId,
      connection_id: connection.id,
      provider_id: provider.id,
      allowed_hosts: [host],
      allowed_methods: DEFAULT_ALLOWED_METHODS,
      expires_at: expiresAt,
      metadata: { sandbox: true, access_request_id: accessRequest.id },
    });

    await decideProxyAccessRequest({
      id: accessRequest.id,
      status: "approved",
      user_id: sandboxUserId,
      connection_id: connection.id,
      grant_id: grant.id,
    });

    return {
      ok: true as const,
      sandbox: true as const,
      access_request_id: accessRequest.id,
      grant_id: grant.id,
      echo_url: `${base}/v4/sandbox/echo`,
      expires_at: expiresAt,
      next_step: {
        description:
          "Call POST /v4/proxy with this grant_id and the echo_url. The echo response " +
          "shows the request CNothing forwarded upstream; the injected Authorization " +
          "token appears as [REDACTED], proving the agent never sees credentials.",
        example: {
          method: "POST",
          path: "/v4/proxy",
          body: {
            grant_id: grant.id,
            method: "GET",
            url: `${base}/v4/sandbox/echo?hello=world`,
          },
        },
      },
    };
  }

  /** Mock upstream API: echoes the request so agents can see what the proxy sent. */
  async echo(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    let body: unknown = null;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const text = await request.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
    }

    const authorization = headers.authorization ?? null;
    return Response.json({
      ok: true,
      sandbox_echo: {
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        // The proxy's response redaction replaces the injected token with
        // [REDACTED] before the agent sees this echo.
        authorization_received: Boolean(authorization),
        authorization,
        body,
      },
    });
  }
}

export const sandboxService = new SandboxService();
