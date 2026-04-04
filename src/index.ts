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

function parseForwardedHeader(value: string | null): { proto?: string; host?: string } {
  if (!value) {
    return {};
  }

  const firstEntry = value.split(",")[0]?.trim();
  if (!firstEntry) {
    return {};
  }

  const result: { proto?: string; host?: string } = {};
  for (const segment of firstEntry.split(";")) {
    const [rawKey, rawValue] = segment.split("=", 2);
    const key = rawKey?.trim().toLowerCase();
    const normalizedValue = rawValue?.trim().replace(/^"|"$/g, "");
    if (!key || !normalizedValue) {
      continue;
    }
    if (key === "proto") {
      result.proto = normalizedValue;
    }
    if (key === "host") {
      result.host = normalizedValue;
    }
  }
  return result;
}

function inferBaseUrl(request: Request): string {
  const requestUrl = new URL(request.url);
  const forwarded = parseForwardedHeader(request.headers.get("Forwarded"));
  const forwardedProto = request.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("X-Forwarded-Host")?.split(",")[0]?.trim();
  const host = forwardedHost || forwarded.host || request.headers.get("Host") || requestUrl.host;
  const proto = forwardedProto || forwarded.proto || requestUrl.protocol.replace(/:$/, "");

  return `${proto}://${host}`;
}

function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(request)).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, { status: response.status, headers });
}

function renderHomePage(baseUrl: string): string {
  const endpointRows = [
    ["/health", "Health check"],
    ["/skill.md", "Primary skill markdown for AI discovery"],
    ["/mcp", "MCP info endpoint"],
    ["/openapi.json", "OpenAPI document"],
    ["/v1/authai/public-key", "AuthAI public key"],
    ["/v1/catalog/mcp", "Browsable MCP tools and resources"],
    ["/v1/catalog/skills", "Bundled skills catalog"],
  ];

  const links = endpointRows
    .map(
      ([pathname, label]) =>
        `<li><a href="${pathname}" style="color:#ca279c;text-decoration:none;font-weight:600">${pathname}</a><span style="color:#64748b"> - ${label}</span></li>`,
    )
    .join("");

  const consoleHint = config.consoleUrl
    ? `<p style="margin:16px 0 0"><a href="${config.consoleUrl}" style="display:inline-flex;align-items:center;gap:8px;background:#ca279c;color:white;padding:10px 16px;border-radius:999px;text-decoration:none;font-weight:600">Open KeyService Console</a></p>`
    : `<p style="color:#475569">The standalone console UI is a separate Next.js app. If you deploy it, set <code>KEYSERVICE_CONSOLE_URL</code> to redirect the homepage there.</p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>KeyService</title>
  </head>
  <body style="margin:0;font-family:'SF Pro Text','SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;background:linear-gradient(180deg,#ffffff 0%,#f7f7fb 44%,#eef1f7 100%);color:#0f172a">
    <main style="max-width:960px;margin:0 auto;padding:48px 20px 64px">
      <section style="border:1px solid #e8e8ee;border-radius:28px;background:rgba(255,255,255,0.92);box-shadow:0 18px 60px rgba(15,23,42,0.06);padding:32px">
        <div style="display:inline-flex;align-items:center;border:1px solid #e8e8ee;border-radius:999px;padding:6px 10px;font-size:12px;background:#f1f2f6">KeyService API</div>
        <h1 style="font-size:40px;line-height:1.05;margin:16px 0 12px">KeyService is running.</h1>
        <p style="font-size:17px;line-height:1.6;color:#475569;margin:0 0 20px">This deployment is serving the KeyService backend at <code>${baseUrl}</code>.</p>
        ${consoleHint}
      </section>

      <section style="margin-top:20px;border:1px solid #e8e8ee;border-radius:28px;background:white;padding:28px">
        <h2 style="margin:0 0 14px;font-size:22px">Available endpoints</h2>
        <ul style="margin:0;padding-left:18px;display:grid;gap:10px">${links}</ul>
      </section>
    </main>
  </body>
</html>`;
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

  if (pathname === "/skill.md" && request.method === "GET") {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const content = readFileSync(
      path.join(__dirname, "..", "skills", "keyservice-authai", "SKILL.md"),
      "utf8",
    );
    return withCors(
      new Response(content, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Cache-Control": "public, max-age=60",
        },
      }),
      request,
    );
  }

  if (pathname === "/" && request.method === "GET") {
    if (config.consoleUrl) {
      return withCors(Response.redirect(config.consoleUrl, 302), request);
    }
    return withCors(
      new Response(renderHomePage(baseUrl), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=60",
        },
      }),
      request,
    );
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
