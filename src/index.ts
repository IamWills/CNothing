import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { handleAdminRequest } from "./admin/admin.api";
import { handleKeyRequest } from "./api/key.api";
import { handleCatalogRequest } from "./catalog/catalog.api";
import config from "./config";
import { initDb } from "./db";
import { handleMcpInfo, handleMcpMessage, handleMcpSse } from "./mcp/mcp-handler";
import { toHttpResponse } from "./utils/errors";
import { corsHeaders } from "./utils/http";

function inferBaseUrl(request: Request): string {
  return new URL(request.url).origin;
}

function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(request)).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, { status: response.status, headers });
}

async function router(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const baseUrl = inferBaseUrl(request);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (pathname === "/health") {
    return withCors(Response.json({ status: "ok", service: config.serviceName }), request);
  }

  if (pathname === "/mcp" && request.method === "POST") {
    return withCors(await handleMcpMessage(request), request);
  }
  if (pathname === "/mcp" && request.method === "GET") {
    const accept = request.headers.get("Accept") ?? "";
    if (accept.includes("text/event-stream")) {
      return withCors(handleMcpSse(baseUrl, "/mcp"), request);
    }
    return withCors(
      Response.json(handleMcpInfo(baseUrl), {
        headers: { "Cache-Control": "public, max-age=60" },
      }),
      request,
    );
  }
  if (pathname === "/.well-known/mcp" && request.method === "GET") {
    return withCors(
      Response.json(handleMcpInfo(baseUrl), {
        headers: { "Cache-Control": "public, max-age=60" },
      }),
      request,
    );
  }
  if (pathname === "/mcp/sse" && request.method === "GET") {
    return withCors(handleMcpSse(baseUrl, "/mcp/message"), request);
  }
  if (pathname === "/mcp/message" && request.method === "POST") {
    return withCors(await handleMcpMessage(request), request);
  }

  if (pathname === "/mcp/manifest" || pathname === "/.well-known/mcp/manifest.json") {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const content = readFileSync(path.join(__dirname, "..", "mcp-manifest.json"), "utf8");
    return withCors(
      new Response(content, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=60",
        },
      }),
      request,
    );
  }

  if (pathname === "/openapi.json" && request.method === "GET") {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const content = readFileSync(path.join(__dirname, "..", "openapi.json"), "utf8");
    return withCors(
      new Response(content, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=60",
        },
      }),
      request,
    );
  }

  if (pathname.startsWith("/v1/")) {
    if (pathname.startsWith("/v1/catalog/")) {
      return withCors(await handleCatalogRequest(request), request);
    }
    if (pathname.startsWith("/v1/admin/")) {
      return withCors(await handleAdminRequest(request), request);
    }
    return withCors(await handleKeyRequest(request), request);
  }

  return withCors(
    Response.json(
      {
        error: {
          type: "NotFound",
          message: `Route not found: ${pathname}`,
        },
      },
      { status: 404 },
    ),
    request,
  );
}

async function main(): Promise<void> {
  await initDb();
  Bun.serve({
    port: config.port,
    fetch: (request: Request) => router(request).catch((error) => toHttpResponse(error)),
  });
  // eslint-disable-next-line no-console
  console.log(`${config.serviceName} listening on http://localhost:${config.port}`);
}

void main();
