import { ValidationError } from "../utils/errors";
import { listMcpResources, listMcpTools } from "./mcp-catalog";
import { listSkillCatalogEntries } from "./skills-catalog";

export async function handleCatalogRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/v1/catalog/mcp") {
    return Response.json({
      ok: true,
      tools: listMcpTools(),
      resources: listMcpResources(),
    });
  }

  if (request.method === "GET" && url.pathname === "/v1/catalog/skills") {
    return Response.json({
      ok: true,
      items: listSkillCatalogEntries(),
    });
  }

  throw new ValidationError(`Unsupported catalog route: ${request.method} ${url.pathname}`, {
    error_code: "route_not_found",
  });
}
