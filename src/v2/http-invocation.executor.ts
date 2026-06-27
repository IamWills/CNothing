import type { JsonObject } from "./v2.entity";

function renderUrlTemplate(template: string, payload: JsonObject): string {
  return template.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = payload[key];
    return encodeURIComponent(value === undefined || value === null ? "" : String(value));
  });
}

function resolveInvocationConfig(capability: {
  invocation_config: JsonObject;
  metadata: JsonObject;
}): JsonObject {
  if (Object.keys(capability.invocation_config).length > 0) {
    return capability.invocation_config;
  }
  const fromMetadata = capability.metadata.invocation_config;
  return fromMetadata && typeof fromMetadata === "object"
    ? (fromMetadata as JsonObject)
    : {};
}

export function readCapabilityInvocationType(capability: {
  invocation_type: string | null;
  metadata: JsonObject;
}): string {
  if (capability.invocation_type) {
    return capability.invocation_type;
  }
  const fromMetadata = capability.metadata.invocation_type;
  return typeof fromMetadata === "string" ? fromMetadata : "builtin";
}

export async function executeHttpCapability(input: {
  capability: {
    name: string;
    invocation_config: JsonObject;
    metadata: JsonObject;
  };
  payload: JsonObject;
  accessToken?: string;
}): Promise<unknown> {
  const config = resolveInvocationConfig(input.capability);
  const method = String(config.method ?? "GET").toUpperCase();
  const baseUrl = String(config.base_url ?? "").replace(/\/+$/, "");
  const urlTemplate = String(config.url_template ?? "/");
  const path = renderUrlTemplate(urlTemplate, input.payload);
  const url = path.startsWith("http")
    ? path
    : `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  if (!url.startsWith("http")) {
    throw new Error("HTTP capability missing base_url or absolute url_template");
  }

  const headers: Record<string, string> = {
    accept: "application/json",
    ...(config.headers && typeof config.headers === "object"
      ? (config.headers as Record<string, string>)
      : {}),
  };

  const authType = String(config.auth ?? "bearer");
  if (authType === "bearer") {
    if (!input.accessToken?.trim()) {
      throw new Error("OAuth connection required for this HTTP capability");
    }
    headers.authorization = `Bearer ${input.accessToken}`;
  }

  const queryParams =
    config.query_params && typeof config.query_params === "object"
      ? (config.query_params as Record<string, string>)
      : undefined;
  const finalUrl = new URL(url);
  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      finalUrl.searchParams.set(key, renderUrlTemplate(value, input.payload));
    }
  }

  const hasBody = !["GET", "HEAD", "DELETE"].includes(method);
  const bodyPayload =
    config.body && typeof config.body === "object" ? (config.body as JsonObject) : input.payload;

  const response = await fetch(finalUrl.toString(), {
    method,
    headers: {
      ...headers,
      ...(hasBody ? { "content-type": "application/json" } : {}),
    },
    body: hasBody ? JSON.stringify(bodyPayload) : undefined,
  });

  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    throw new Error(`HTTP capability ${input.capability.name} returned ${response.status}`);
  }
  return data;
}
