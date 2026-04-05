import { KeyService } from "../core/key-service";
import { ValidationError } from "../utils/errors";
import { parseJsonBody } from "../utils/http";

const service = new KeyService();

export async function handleKeyRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/v1/authai/public-key") {
    return Response.json({ ok: true, authai_public_key: service.getAuthaiPublicKey() });
  }

  if (request.method === "POST" && url.pathname === "/v1/authai/register") {
    const body = await parseJsonBody(request);
    return Response.json(await service.registerClient(body));
  }

  if (request.method === "POST" && url.pathname === "/v1/authai/refresh") {
    const body = await parseJsonBody(request);
    return Response.json(await service.refreshChallenge(body));
  }

  if (request.method === "POST" && url.pathname === "/v1/authai/rotate-key") {
    const body = await parseJsonBody(request);
    return Response.json(await service.rotateClientKey(body));
  }

  if (request.method === "POST" && url.pathname === "/v1/kv/save") {
    const body = await parseJsonBody(request);
    return Response.json(await service.saveKv(body));
  }

  if (request.method === "POST" && url.pathname === "/v1/kv/read") {
    const body = await parseJsonBody(request);
    return Response.json(await service.readKv(body));
  }

  throw new ValidationError(`Unsupported route: ${request.method} ${url.pathname}`, {
    error_code: "route_not_found",
  });
}
