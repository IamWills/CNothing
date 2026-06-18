import { KeyService } from "../core/key-service";
import { ValidationError } from "../utils/errors";
import { parseJsonBody } from "../utils/http";
import { applyV1Deprecation } from "../v2/deprecation";

const service = new KeyService();

async function v1Json(data: unknown, baseUrl?: string, status = 200): Promise<Response> {
  return applyV1Deprecation(Response.json(data, { status }), baseUrl);
}

export async function handleKeyRequest(request: Request, baseUrl?: string): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/v1/authai/public-key") {
    return v1Json({ ok: true, authai_public_key: service.getAuthaiPublicKey() }, baseUrl);
  }

  if (request.method === "POST" && url.pathname === "/v1/authai/register") {
    const body = await parseJsonBody(request);
    return v1Json(await service.registerClient(body), baseUrl);
  }

  if (request.method === "POST" && url.pathname === "/v1/authai/refresh") {
    const body = await parseJsonBody(request);
    return v1Json(await service.refreshChallenge(body), baseUrl);
  }

  if (request.method === "POST" && url.pathname === "/v1/authai/rotate-key") {
    const body = await parseJsonBody(request);
    return v1Json(await service.rotateClientKey(body), baseUrl);
  }

  if (request.method === "POST" && url.pathname === "/v1/authai/key-holder/challenge") {
    const body = await parseJsonBody(request);
    return v1Json(await service.createKeyHolderChallenge(body), baseUrl);
  }

  if (request.method === "POST" && url.pathname === "/v1/authai/key-holder/verify") {
    const body = await parseJsonBody(request);
    return v1Json(await service.verifyKeyHolderChallenge(body), baseUrl);
  }

  if (request.method === "POST" && url.pathname === "/v1/authai/key-holder/sign-challenge") {
    const body = await parseJsonBody(request);
    return v1Json(await service.createKeyHolderSignChallenge(body), baseUrl);
  }

  if (request.method === "POST" && url.pathname === "/v1/authai/key-holder/verify-signature") {
    const body = await parseJsonBody(request);
    return v1Json(await service.verifyKeyHolderSignature(body), baseUrl);
  }

  if (request.method === "POST" && url.pathname === "/v1/kv/save") {
    const body = await parseJsonBody(request);
    return v1Json(await service.saveKv(body), baseUrl);
  }

  if (request.method === "POST" && url.pathname === "/v1/kv/read") {
    const body = await parseJsonBody(request);
    return v1Json(await service.readKv(body), baseUrl);
  }

  throw new ValidationError(`Unsupported route: ${request.method} ${url.pathname}`, {
    error_code: "route_not_found",
  });
}
