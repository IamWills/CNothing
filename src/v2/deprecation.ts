import config from "../config";

export const V1_SUCCESSOR_PATH = "/openapi-v4.json";
export const V1_MIGRATION_GUIDE = "/skill.md";

export function getV1SunsetDate(): string {
  return config.v1SunsetDate;
}

export function applyV1DeprecationHeaders(headers: Headers, baseUrl?: string): void {
  headers.set("Deprecation", "true");
  headers.set("Sunset", new Date(getV1SunsetDate()).toUTCString());
  if (baseUrl) {
    headers.set("Link", `<${baseUrl}${V1_SUCCESSOR_PATH}>; rel="successor-version"`);
  }
}

export function v1DeprecationMeta(baseUrl?: string) {
  return {
    deprecated: true,
    sunset_at: getV1SunsetDate(),
    successor_version: "v4",
    successor_openapi: baseUrl ? `${baseUrl}${V1_SUCCESSOR_PATH}` : V1_SUCCESSOR_PATH,
    migration_guide: baseUrl ? `${baseUrl}${V1_MIGRATION_GUIDE}` : V1_MIGRATION_GUIDE,
    replacement:
      "Use CNothing v4: POST /v4/agents/register → POST /v4/access-requests → human opens approval_url → POST /v4/proxy. See /skill.md. Do not use AuthAI/KV for GitHub or OAuth provider access.",
  };
}

export const V1_DEPRECATED_MCP_TOOLS = new Set([
  "get_authai_public_key",
  "authai_register",
  "authai_refresh",
  "authai_key_holder_sign_challenge",
  "authai_key_holder_verify_signature",
  "authai_key_holder_challenge",
  "authai_key_holder_verify",
  "kv_save",
  "kv_read",
]);

export function wrapV1JsonResponse(body: unknown, baseUrl?: string): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { value: body, _deprecation: v1DeprecationMeta(baseUrl) };
  }
  return {
    ...(body as Record<string, unknown>),
    _deprecation: v1DeprecationMeta(baseUrl),
  };
}

export async function applyV1Deprecation(response: Response, baseUrl?: string): Promise<Response> {
  const headers = new Headers(response.headers);
  applyV1DeprecationHeaders(headers, baseUrl);

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const text = await response.text();
    try {
      const payload = text ? (JSON.parse(text) as unknown) : null;
      return Response.json(wrapV1JsonResponse(payload, baseUrl), {
        status: response.status,
        headers,
      });
    } catch {
      return new Response(text, { status: response.status, headers });
    }
  }

  return new Response(response.body, { status: response.status, headers });
}
