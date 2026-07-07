import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "../db";
import { NotFoundError, ValidationError } from "../utils/errors";
import {
  createOAuthConnection,
  findOAuthProviderById,
  findOAuthProviderBySlug,
  getProviderClientSecret,
  updateOAuthConnectionTokens,
} from "../v2/oauth.repository";
import type { OAuthProviderRecord } from "../v2/v2.5.entity";
import { oauthConnectionService } from "../v2/oauth-connection.service";
import { resolveConnectionTenant } from "./tenant-context.service";

type DeviceSessionRecord = {
  id: string;
  provider_id: string;
  user_id: string | null;
  tenant_id: string;
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string | null;
  poll_interval_seconds: number;
  expires_at: string;
  status: string;
  connection_id: string | null;
  scopes: string[];
};

function mapDeviceRow(row: Record<string, unknown>): DeviceSessionRecord {
  return {
    id: String(row.id),
    provider_id: String(row.provider_id),
    user_id: row.user_id ? String(row.user_id) : null,
    tenant_id: String(row.tenant_id ?? "default"),
    device_code: String(row.device_code),
    user_code: String(row.user_code),
    verification_uri: String(row.verification_uri),
    verification_uri_complete: row.verification_uri_complete
      ? String(row.verification_uri_complete)
      : null,
    poll_interval_seconds: Number(row.poll_interval_seconds ?? 5),
    expires_at: new Date(String(row.expires_at)).toISOString(),
    status: String(row.status),
    connection_id: row.connection_id ? String(row.connection_id) : null,
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
  };
}

function generateUserCode(): string {
  const alphabet = "BCDFGHJKLMNPQRSTVWXZ23456789";
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    if (i === 4) code += "-";
    code += alphabet[randomBytes(1)[0]! % alphabet.length];
  }
  return code;
}

export class DeviceFlowService {
  async startDeviceFlow(input: {
    request: Request;
    providerId?: string;
    providerSlug?: string;
    userId: string;
    scopes?: string[];
    tenantId?: string;
  }) {
    const provider = input.providerId
      ? await findOAuthProviderById(input.providerId)
      : input.providerSlug
        ? await findOAuthProviderBySlug(input.providerSlug)
        : null;

    if (!provider) {
      throw new NotFoundError("OAuth provider not found");
    }

    const deviceEndpoint =
      provider.device_authorization_endpoint ||
      (typeof provider.metadata?.device_authorization_endpoint === "string"
        ? String(provider.metadata.device_authorization_endpoint)
        : null);

    if (!deviceEndpoint) {
      throw new ValidationError("Provider does not support OAuth device flow", {
        error_code: "device_flow_unsupported",
      });
    }

    if (!provider.client_id) {
      throw new ValidationError("Provider client_id is not configured", {
        error_code: "provider_unconfigured",
      });
    }

    const tenantId = input.tenantId ?? resolveConnectionTenant({ request: input.request });
    const scopes =
      input.scopes && input.scopes.length > 0 ? input.scopes : provider.default_scopes;
    const clientSecret = await getProviderClientSecret(provider);

    const body = new URLSearchParams({
      client_id: provider.client_id,
      scope: scopes.join(" "),
    });

    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    };

    if (clientSecret && provider.token_auth_method === "client_secret_basic") {
      headers.authorization = `Basic ${Buffer.from(`${provider.client_id}:${clientSecret}`).toString("base64")}`;
    } else if (clientSecret) {
      body.set("client_secret", clientSecret);
    }

    const response = await fetch(deviceEndpoint, { method: "POST", headers, body });
    const payload = (await response.json().catch(() => null)) as {
      device_code?: string;
      user_code?: string;
      verification_uri?: string;
      verification_uri_complete?: string;
      expires_in?: number;
      interval?: number;
      error?: string;
    } | null;

    if (!response.ok || !payload?.device_code || !payload.user_code || !payload.verification_uri) {
      throw new ValidationError(payload?.error ?? "Device authorization request failed", {
        error_code: "device_flow_start_failed",
      });
    }

    const id = randomUUID();
    const expiresAt = new Date(
      Date.now() + (payload.expires_in ?? 900) * 1000,
    ).toISOString();

    await pool.query(
      `
        INSERT INTO cap_oauth_device_sessions (
          id, provider_id, user_id, tenant_id, device_code, user_code,
          verification_uri, verification_uri_complete, poll_interval_seconds,
          expires_at, status, scopes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11)
      `,
      [
        id,
        provider.id,
        input.userId,
        tenantId,
        payload.device_code,
        payload.user_code,
        payload.verification_uri,
        payload.verification_uri_complete ?? null,
        payload.interval ?? 5,
        expiresAt,
        JSON.stringify(scopes),
      ],
    );

    return {
      ok: true as const,
      session_id: id,
      user_code: payload.user_code,
      verification_uri: payload.verification_uri,
      verification_uri_complete: payload.verification_uri_complete ?? null,
      expires_at: expiresAt,
      poll_interval_seconds: payload.interval ?? 5,
    };
  }

  async pollDeviceFlow(input: {
    sessionId: string;
    userId: string;
    apiBaseUrl: string;
  }) {
    const result = await pool.query(
      `SELECT * FROM cap_oauth_device_sessions WHERE id = $1`,
      [input.sessionId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError("Device flow session not found");
    }

    const session = mapDeviceRow(row);
    if (session.user_id !== input.userId) {
      throw new NotFoundError("Device flow session not found");
    }

    if (session.status === "completed" && session.connection_id) {
      return {
        ok: true as const,
        status: "completed" as const,
        connection_id: session.connection_id,
      };
    }

    if (new Date(session.expires_at).getTime() < Date.now()) {
      await pool.query(
        `UPDATE cap_oauth_device_sessions SET status = 'expired', updated_at = NOW() WHERE id = $1`,
        [session.id],
      );
      return { ok: true as const, status: "expired" as const };
    }

    const provider = await findOAuthProviderById(session.provider_id);
    if (!provider?.token_url || !provider.client_id) {
      throw new ValidationError("Provider token endpoint unavailable");
    }

    const clientSecret = await getProviderClientSecret(provider);
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: session.device_code,
      client_id: provider.client_id,
    });

    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    };

    if (clientSecret && provider.token_auth_method === "client_secret_basic") {
      headers.authorization = `Basic ${Buffer.from(`${provider.client_id}:${clientSecret}`).toString("base64")}`;
    } else if (clientSecret) {
      body.set("client_secret", clientSecret);
    }

    const response = await fetch(provider.token_url, { method: "POST", headers, body });
    const payload = (await response.json().catch(() => null)) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
      error?: string;
    } | null;

    if (payload?.error === "authorization_pending") {
      return { ok: true as const, status: "pending" as const };
    }

    if (payload?.error === "slow_down") {
      return {
        ok: true as const,
        status: "pending" as const,
        poll_interval_seconds: session.poll_interval_seconds + 5,
      };
    }

    if (!response.ok || !payload?.access_token) {
      if (payload?.error === "access_denied") {
        await pool.query(
          `UPDATE cap_oauth_device_sessions SET status = 'denied', updated_at = NOW() WHERE id = $1`,
          [session.id],
        );
        return { ok: true as const, status: "denied" as const };
      }
      return { ok: true as const, status: "pending" as const };
    }

    const profile = await oauthConnectionService.fetchConnectionProfile(
      provider,
      payload.access_token,
    );
    const connection = await createOAuthConnection({
      user_id: input.userId,
      tenant_id: session.tenant_id,
      provider_id: provider.id,
      provider_account_id: profile.accountId,
      display_name: profile.displayName,
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expires_at:
        typeof payload.expires_in === "number"
          ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
          : undefined,
      scopes: payload.scope ? payload.scope.split(/[\s,]+/).filter(Boolean) : session.scopes,
      token_type: payload.token_type ?? "Bearer",
      metadata: { ...profile.metadata, auth_flow: "device" },
    });

    await pool.query(
      `
        UPDATE cap_oauth_device_sessions
        SET status = 'completed', connection_id = $2, updated_at = NOW()
        WHERE id = $1
      `,
      [session.id, connection.id],
    );

    return {
      ok: true as const,
      status: "completed" as const,
      connection_id: connection.id,
    };
  }

}

export const deviceFlowService = new DeviceFlowService();
