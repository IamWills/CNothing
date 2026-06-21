import { verifyCapabilityGrant } from "../connector-sdk/index";
import config from "../config";
import { ValidationError } from "../utils/errors";
import {
  executePlatformCapability,
  PLATFORM_CONNECTOR_PROVIDER,
} from "../v2/platform-connector.executor";
import {
  executeSearchCapability,
} from "../v2/search-connector.executor";
import { SEARCH_CONNECTOR_PROVIDER } from "../v2/search-credential.service";
import { findConnectorByProvider } from "../v2/v2.repository";

type ConnectorExecuteBody = {
  grant?: string;
  capability?: string;
  input?: Record<string, unknown>;
  user_id?: string;
  agent_id?: string;
};

const CONNECTOR_ROUTES: Record<
  string,
  {
    provider: string;
    execute: (input: {
      capability: string;
      input: Record<string, unknown>;
      user_id: string;
      agent_id: string;
    }) => Promise<unknown>;
  }
> = {
  platform: {
    provider: PLATFORM_CONNECTOR_PROVIDER,
    execute: executePlatformCapability,
  },
  search: {
    provider: SEARCH_CONNECTOR_PROVIDER,
    execute: executeSearchCapability,
  },
};

export async function handleV2InternalRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  const routeMatch = /^\/v2\/internal\/connectors\/([^/]+)$/.exec(path);
  if (request.method !== "POST" || !routeMatch) {
    throw new ValidationError(`Unsupported route: ${request.method} ${path}`, {
      error_code: "route_not_found",
    });
  }

  const connectorKey = decodeURIComponent(routeMatch[1] ?? "");
  const route = CONNECTOR_ROUTES[connectorKey];
  if (!route) {
    throw new ValidationError(`Unsupported connector route: ${connectorKey}`, {
      error_code: "route_not_found",
    });
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const grantToken = /^Bearer\s+(.+)$/i.exec(authHeader)?.[1]?.trim();
  if (!grantToken) {
    return Response.json({ error: { message: "Missing grant token" } }, { status: 401 });
  }

  const connector = await findConnectorByProvider(route.provider);
  if (!connector) {
    return Response.json(
      { error: { message: `${connectorKey} connector not bootstrapped` } },
      { status: 503 },
    );
  }

  try {
    verifyCapabilityGrant({
      token: grantToken,
      publicKeyPem: config.authaiPublicKeyPem,
      expectedIssuer: "cnothing",
      expectedAudience: connector.id,
    });
  } catch (error) {
    return Response.json(
      {
        error: {
          message: error instanceof Error ? error.message : "Invalid grant",
        },
      },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as ConnectorExecuteBody | null;
  if (!body?.capability || !body.input || typeof body.input !== "object") {
    return Response.json({ error: { message: "Invalid request body" } }, { status: 400 });
  }

  try {
    const result = await route.execute({
      capability: body.capability,
      input: body.input,
      user_id: String(body.user_id ?? ""),
      agent_id: String(body.agent_id ?? ""),
    });
    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json(
      {
        error: {
          message: error instanceof Error ? error.message : "Execution failed",
        },
      },
      { status: 500 },
    );
  }
}
