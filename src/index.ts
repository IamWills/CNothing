import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { handleAdminRequest } from "./admin/admin.api";
import { handleKeyRequest } from "./api/key.api";
import { handleV2PlatformRequest } from "./api/v2-platform.api";
import { handleV2InternalRequest } from "./api/v2-internal.api";
import { handleV2Request } from "./api/v2.api";
import {
  handleV25AgentRequest,
  handleV25ApproveRequest,
  handleV25ImportRequest,
  handleV25OAuthRequest,
  handleV25PlatformRequest,
} from "./api/v2.5.api";
import {
  handleV26AgentInvokeOnly,
  handleV26ApproveRequest,
  handleV26CapabilitiesRequest,
  handleV26ImportRequest,
  handleV26OAuthRequest,
  handleV26PlatformRequest,
} from "./api/v2.6.api";
import { handleV3Request } from "./api/v3.api";
import { handleApiV3Request } from "./api/api-v3.api";
import { handleCatalogRequest } from "./catalog/catalog.api";
import config from "./config";
import { initDb } from "./db";
import { runStartupBootstrap } from "./v2/platform-bootstrap.service";
import { runSearchStartupBootstrap } from "./v2/search-bootstrap.service";
import { runV25StartupBootstrap } from "./v2/v2.5-bootstrap.service";
import { migrateCredentialsToOAuthConnections } from "./v2/credential-migration.service";
import { migrateOAuthTokensToVault } from "./v3/oauth-token-vault-migration.service";
import { handleV2E2eInternalRequest } from "./api/v2-e2e-internal.api";
import { applySecurityMiddleware } from "./middleware/security";
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
    ["/openapi.json", "OpenAPI document (v1 legacy)"],
    ["/openapi-v2.json", "OpenAPI document (v2 capability platform)"],
    ["/openapi-v2.5.json", "OpenAPI document (v2.5 OAuth broker + capability gateway)"],
    ["/openapi-v2.6.json", "OpenAPI document (v2.6 universal OAuth + zero-code import)"],
    ["/openapi-v3.json", "OpenAPI document (v3.0 Universal Trust Broker for AI Agents)"],
    ["/api/v3/openapi.json", "OpenAPI document (v3 Capability Execution Gateway)"],
    ["/api/v3/capabilities/{id}/invoke", "Secretless capability invoke (pending_approval|completed|failed)"],
    ["/v3/agent/invoke", "Invoke a capability (v3 Trust Broker — no secrets returned)"],
    ["/v3/providers/proposals", "Agent submits provider proposal (public metadata only)"],
    ["/v1/authai/public-key", "AuthAI public key (v1 legacy)"],
    ["/v2/capabilities/invoke", "Invoke a capability (v2 primary agent API)"],
    ["/v2/authorize/request", "Request user authorization for capabilities"],
    ["/v2/jwks", "JWKS for Capability Grant verification"],
    ["/v2/capabilities", "List registered capabilities"],
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
    ? `<p style="margin:16px 0 0"><a href="${config.consoleUrl}" style="display:inline-flex;align-items:center;gap:8px;background:#ca279c;color:white;padding:10px 16px;border-radius:999px;text-decoration:none;font-weight:600">Open CNothing Console</a></p>`
    : `<p style="color:#475569">The standalone console UI is a separate Next.js app. If you deploy it, set <code>KEYSERVICE_CONSOLE_URL</code> to redirect the homepage there.</p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CNothing</title>
  </head>
  <body style="margin:0;font-family:'SF Pro Text','SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;background:linear-gradient(180deg,#ffffff 0%,#f7f7fb 44%,#eef1f7 100%);color:#0f172a">
    <main style="max-width:960px;margin:0 auto;padding:48px 20px 64px">
      <section style="border:1px solid #e8e8ee;border-radius:28px;background:rgba(255,255,255,0.92);box-shadow:0 18px 60px rgba(15,23,42,0.06);padding:32px">
        <div style="display:inline-flex;align-items:center;border:1px solid #e8e8ee;border-radius:999px;padding:6px 10px;font-size:12px;background:#f1f2f6">CNothing API</div>
        <h1 style="font-size:40px;line-height:1.05;margin:16px 0 12px">CNothing is running.</h1>
        <p style="font-size:17px;line-height:1.6;color:#475569;margin:0 0 20px">This deployment is serving the CNothing backend at <code>${baseUrl}</code>.</p>
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

function serveOpenApiDocument(request: Request, filename: string): Response {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const content = readFileSync(path.join(__dirname, "..", filename), "utf8");
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=60",
  };
  if (request.method === "HEAD") {
    return withCors(new Response(null, { status: 200, headers }), request);
  }
  return withCors(new Response(content, { status: 200, headers }), request);
}

function isOpenApiDocumentRequest(request: Request): boolean {
  return request.method === "GET" || request.method === "HEAD";
}

async function router(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const baseUrl = inferBaseUrl(request);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (pathname === "/health") {
    try {
      const { checkTrustLayerReadiness } = await import("./v3/trust-layer-readiness");
      const readiness = await checkTrustLayerReadiness();
      if (!readiness.ready) {
        return withCors(
          Response.json(
            {
              status: "degraded",
              service: config.serviceName,
              ready: false,
              error: {
                code: "schema_not_ready",
                message: "Execution Trust Layer schema is incomplete",
                missing_relations: readiness.missing_relations,
              },
            },
            { status: 503 },
          ),
          request,
        );
      }
      return withCors(
        Response.json({
          status: "ok",
          service: config.serviceName,
          ready: true,
          trust_layer: {
            ready: true,
            trust_policy_count: readiness.trust_policy_count,
          },
        }),
        request,
      );
    } catch (error) {
      return withCors(
        Response.json(
          {
            status: "error",
            service: config.serviceName,
            ready: false,
            error: {
              code: "health_check_failed",
              message: error instanceof Error ? error.message : String(error),
            },
          },
          { status: 503 },
        ),
        request,
      );
    }
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

  if (pathname === "/openapi.json" && isOpenApiDocumentRequest(request)) {
    return serveOpenApiDocument(request, "openapi.json");
  }

  if (pathname === "/openapi-v2.6.json" && isOpenApiDocumentRequest(request)) {
    return serveOpenApiDocument(request, "openapi-v2.6.json");
  }

  if (pathname === "/openapi-v3.json" && isOpenApiDocumentRequest(request)) {
    return serveOpenApiDocument(request, "openapi-v3.json");
  }

  if (pathname.startsWith("/api/v3")) {
    const apiV3Response = await handleApiV3Request(request);
    if (apiV3Response) {
      return withCors(apiV3Response, request);
    }
  }

  if (pathname.startsWith("/v3/")) {
    const v3Response = await handleV3Request(request);
    if (v3Response) {
      return withCors(v3Response, request);
    }
  }

  if (pathname === "/openapi-v2.5.json" && isOpenApiDocumentRequest(request)) {
    return serveOpenApiDocument(request, "openapi-v2.5.json");
  }

  if (pathname === "/openapi-v2.json" && isOpenApiDocumentRequest(request)) {
    return serveOpenApiDocument(request, "openapi-v2.json");
  }

  if (pathname.startsWith("/v1/")) {
    if (pathname.startsWith("/v1/catalog/")) {
      return withCors(await handleCatalogRequest(request), request);
    }
    if (pathname.startsWith("/v1/admin/")) {
      return withCors(await handleAdminRequest(request), request);
    }
    return withCors(await handleKeyRequest(request, baseUrl), request);
  }

  if (pathname.startsWith("/v2.6/")) {
    if (
      pathname.startsWith("/v2.6/agent/") ||
      pathname === "/v2.6/agent/invoke"
    ) {
      return withCors(await handleV26AgentInvokeOnly(request), request);
    }
    if (pathname.startsWith("/v2.6/oauth/")) {
      return withCors(await handleV26OAuthRequest(request), request);
    }
    if (
      pathname.startsWith("/v2.6/import/") ||
      pathname.startsWith("/v2.6/capabilities/")
    ) {
      return withCors(await handleV26ImportRequest(request), request);
    }
    if (pathname.startsWith("/v2.6/approve/") && request.method === "POST") {
      return withCors(await handleV26ApproveRequest(request), request);
    }
    const v26Platform = await handleV26PlatformRequest(request);
    if (v26Platform) {
      return withCors(v26Platform, request);
    }
    const v26Capabilities = await handleV26CapabilitiesRequest(request);
    if (v26Capabilities) {
      return withCors(v26Capabilities, request);
    }
  }

  if (pathname.startsWith("/v2/")) {
    if (pathname.startsWith("/v2/internal/e2e/")) {
      return withCors(await handleV2E2eInternalRequest(request), request);
    }
    if (pathname.startsWith("/v2/internal/")) {
      return withCors(await handleV2InternalRequest(request), request);
    }
    if (
      pathname.startsWith("/v2/agent/") ||
      pathname === "/v2/agent/invoke"
    ) {
      return withCors(await handleV25AgentRequest(request), request);
    }
    if (pathname.startsWith("/v2/admin/oauth/") || pathname.startsWith("/v2/oauth/")) {
      return withCors(await handleV25OAuthRequest(request), request);
    }
    if (pathname.startsWith("/v2/import/") || pathname.startsWith("/v2/capabilities/from-")) {
      return withCors(await handleV25ImportRequest(request), request);
    }
    if (pathname.startsWith("/v2/approve/") && request.method === "POST") {
      return withCors(await handleV25ApproveRequest(request), request);
    }
    const v25Platform = await handleV25PlatformRequest(request);
    if (v25Platform) {
      return withCors(v25Platform, request);
    }
    if (
      pathname.startsWith("/v2/platform/") ||
      pathname.startsWith("/v2/admin/") ||
      pathname.startsWith("/v2/auth/")
    ) {
      return withCors(await handleV2PlatformRequest(request), request);
    }
    return withCors(await handleV2Request(request), request);
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
  await runStartupBootstrap();
  await runSearchStartupBootstrap();
  await runV25StartupBootstrap();
  await migrateCredentialsToOAuthConnections();
  await migrateOAuthTokensToVault();
  Bun.serve({
    port: config.port,
    fetch: (request: Request) => {
      const url = new URL(request.url);
      return applySecurityMiddleware(request, url.pathname, () =>
        router(request).catch((error) => toHttpResponse(error)),
      );
    },
  });
  // eslint-disable-next-line no-console
  console.log(`${config.serviceName} listening on http://localhost:${config.port}`);
}

void main();
