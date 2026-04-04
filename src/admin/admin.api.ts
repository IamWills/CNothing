import { requireAdminAccess } from "./admin-auth";
import { KeyServiceAdminService } from "./keyservice-admin.service";
import { ValidationError } from "../utils/errors";
import { parseJsonBody } from "../utils/http";

const adminService = new KeyServiceAdminService();

function readRequiredQuery(url: URL, name: string): string {
  const value = url.searchParams.get(name)?.trim();
  if (!value) {
    throw new ValidationError(`${name} is required`, {
      error_code: "missing_field",
      field: name,
    });
  }
  return value;
}

export async function handleAdminRequest(request: Request): Promise<Response> {
  requireAdminAccess(request);

  const url = new URL(request.url);
  const path = url.pathname;
  const segments = path.split("/").filter(Boolean);

  if (request.method === "GET" && path === "/v1/admin/clients") {
    return Response.json({
      ok: true,
      items: await adminService.listClients(),
    });
  }

  if (request.method === "POST" && path === "/v1/admin/clients/register") {
    return Response.json(await adminService.registerClient(await parseJsonBody(request)));
  }

  if (
    request.method === "GET" &&
    segments.length === 5 &&
    segments[0] === "v1" &&
    segments[1] === "admin" &&
    segments[2] === "clients" &&
    segments[4] === "namespaces"
  ) {
    return Response.json({
      ok: true,
      client_uuid: segments[3],
      items: await adminService.listNamespaces(segments[3]),
    });
  }

  if (
    request.method === "GET" &&
    segments.length === 5 &&
    segments[0] === "v1" &&
    segments[1] === "admin" &&
    segments[2] === "clients" &&
    segments[4] === "kv"
  ) {
    const namespace = readRequiredQuery(url, "namespace");
    return Response.json({
      ok: true,
      client_uuid: segments[3],
      namespace,
      items: await adminService.listKvRecords(segments[3], namespace),
    });
  }

  if (
    request.method === "GET" &&
    segments.length === 6 &&
    segments[0] === "v1" &&
    segments[1] === "admin" &&
    segments[2] === "clients" &&
    segments[4] === "kv" &&
    segments[5] === "value"
  ) {
    return Response.json(
      await adminService.getKvValue(
        segments[3],
        readRequiredQuery(url, "namespace"),
        readRequiredQuery(url, "key"),
      ),
    );
  }

  if (
    request.method === "POST" &&
    segments.length === 6 &&
    segments[0] === "v1" &&
    segments[1] === "admin" &&
    segments[2] === "clients" &&
    segments[4] === "kv" &&
    segments[5] === "save"
  ) {
    return Response.json(await adminService.savePlaintextKv(segments[3], await parseJsonBody(request)));
  }

  throw new ValidationError(`Unsupported admin route: ${request.method} ${path}`, {
    error_code: "route_not_found",
  });
}
