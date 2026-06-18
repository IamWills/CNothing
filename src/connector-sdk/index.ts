import { verifyCapabilityGrant } from "../v2/grant-token";

export { verifyCapabilityGrant, signCapabilityGrant } from "../v2/grant-token";
export type { CapabilityGrantPayload } from "../v2/v2.entity";

export type ConnectorExecuteInput = {
  grant: string;
  capability: string;
  input: Record<string, unknown>;
  user_id: string;
  agent_id: string;
};

export type ConnectorExecuteResult = {
  ok: true;
  result: unknown;
};

export type ConnectorRegistrationInput = {
  provider: string;
  display_name: string;
  callback_url: string;
  public_key_pem?: string;
  jwks_url?: string;
  capabilities?: Array<{
    name: string;
    description?: string;
    capability_type?: "ACTION" | "QUERY" | "CONFIDENTIAL_QUERY";
    scopes?: string[];
    risk_level?: "PUBLIC" | "LOW" | "MEDIUM" | "HIGH" | "CONFIDENTIAL";
    input_schema?: Record<string, unknown>;
    output_schema?: Record<string, unknown>;
  }>;
};

export type ConnectorRuntimeConfig = {
  connectorId: string;
  cnothingPublicKeyPem: string;
  cnothingIssuer?: string;
  executeCapability: (input: ConnectorExecuteInput) => Promise<unknown>;
};

export function verifyGrant(
  config: Pick<ConnectorRuntimeConfig, "cnothingPublicKeyPem" | "cnothingIssuer" | "connectorId">,
  grantToken: string,
) {
  return verifyCapabilityGrant({
    token: grantToken,
    publicKeyPem: config.cnothingPublicKeyPem,
    expectedIssuer: config.cnothingIssuer ?? "cnothing",
    expectedAudience: config.connectorId,
  });
}

export async function registerConnectorViaAdmin(input: {
  baseUrl: string;
  bearerToken: string;
  registration: ConnectorRegistrationInput;
}): Promise<{ connector: Record<string, unknown>; capabilities: Record<string, unknown>[] }> {
  const headers = {
    authorization: `Bearer ${input.bearerToken}`,
    "content-type": "application/json",
  };

  const connectorResponse = await fetch(`${input.baseUrl.replace(/\/+$/, "")}/v2/connectors/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      provider: input.registration.provider,
      display_name: input.registration.display_name,
      callback_url: input.registration.callback_url,
      public_key_pem: input.registration.public_key_pem,
      jwks_url: input.registration.jwks_url,
    }),
  });
  const connectorPayload = (await connectorResponse.json()) as {
    ok?: boolean;
    connector?: Record<string, unknown>;
    error?: { message?: string };
  };
  if (!connectorResponse.ok || !connectorPayload.connector) {
    throw new Error(connectorPayload.error?.message ?? "Connector registration failed");
  }

  const connectorId = String(connectorPayload.connector.id);
  const capabilities: Record<string, unknown>[] = [];
  for (const capability of input.registration.capabilities ?? []) {
    const response = await fetch(`${input.baseUrl.replace(/\/+$/, "")}/v2/capabilities/register`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        connector_id: connectorId,
        ...capability,
      }),
    });
    const payload = (await response.json()) as {
      capability?: Record<string, unknown>;
      error?: { message?: string };
    };
    if (!response.ok || !payload.capability) {
      throw new Error(payload.error?.message ?? `Capability registration failed: ${capability.name}`);
    }
    capabilities.push(payload.capability);
  }

  return { connector: connectorPayload.connector, capabilities };
}

export function createConnectorHandler(config: ConnectorRuntimeConfig) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return Response.json({ error: { message: "Method not allowed" } }, { status: 405 });
    }

    const authHeader = request.headers.get("Authorization") ?? "";
    const grantToken = /^Bearer\s+(.+)$/i.exec(authHeader)?.[1]?.trim();
    if (!grantToken) {
      return Response.json({ error: { message: "Missing grant token" } }, { status: 401 });
    }

    try {
      verifyGrant(config, grantToken);
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

    const body = (await request.json().catch(() => null)) as ConnectorExecuteInput | null;
    if (!body?.capability || !body.input) {
      return Response.json({ error: { message: "Invalid request body" } }, { status: 400 });
    }

    try {
      const result = await config.executeCapability(body);
      return Response.json({ ok: true, result } satisfies ConnectorExecuteResult);
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
  };
}
