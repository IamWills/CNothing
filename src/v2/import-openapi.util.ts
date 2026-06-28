import type { JsonObject } from "./v2.entity";

function inferRiskFromOperation(input: {
  method: string;
  operationId: string;
  summary?: string;
  pathName?: string;
}): { risk_level: string; capability_type: string } {
  const haystack =
    `${input.method} ${input.operationId} ${input.summary ?? ""} ${input.pathName ?? ""}`.toLowerCase();
  if (
    haystack.includes("delete") ||
    haystack.includes("payment") ||
    haystack.includes("transfer") ||
    haystack.includes("admin")
  ) {
    return { risk_level: "HIGH", capability_type: "ACTION" };
  }
  if (
    haystack.includes("read") &&
    (haystack.includes("email") ||
      haystack.includes("file") ||
      haystack.includes("private") ||
      haystack.includes("message") ||
      haystack.includes("source") ||
      haystack.includes("contract") ||
      haystack.includes("financial"))
  ) {
    return { risk_level: "CONFIDENTIAL", capability_type: "CONFIDENTIAL_QUERY" };
  }
  if (input.method === "get" || input.method === "head") {
    return { risk_level: "LOW", capability_type: "QUERY" };
  }
  return { risk_level: "MEDIUM", capability_type: "ACTION" };
}

function resolveRef(doc: JsonObject, ref: string): JsonObject | undefined {
  if (!ref.startsWith("#/")) {
    return undefined;
  }
  const parts = ref.slice(2).split("/");
  let current: unknown = doc;
  for (const part of parts) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current && typeof current === "object" && !Array.isArray(current)
    ? (current as JsonObject)
    : undefined;
}

function resolveSchema(doc: JsonObject, schema: unknown, depth = 0): JsonObject {
  if (depth > 6 || !schema || typeof schema !== "object") {
    return { type: "object" };
  }
  const node = schema as JsonObject;
  if (typeof node.$ref === "string") {
    const resolved = resolveRef(doc, node.$ref);
    return resolved ? resolveSchema(doc, resolved, depth + 1) : { type: "object" };
  }
  return node;
}

function buildInputSchema(
  doc: JsonObject,
  operation: JsonObject,
  pathName: string,
  method: string,
): JsonObject {
  const properties: Record<string, JsonObject> = {};
  const required: string[] = [];

  const parameters = (operation.parameters as JsonObject[] | undefined) ?? [];
  for (const parameter of parameters) {
    const resolved =
      typeof parameter.$ref === "string" ? resolveRef(doc, parameter.$ref) ?? parameter : parameter;
    const name = String(resolved.name ?? "");
    if (!name) {
      continue;
    }
    properties[name] = {
      ...(resolveSchema(doc, resolved.schema ?? { type: "string" }) as JsonObject),
      description: resolved.description ? String(resolved.description) : undefined,
      in: resolved.in ? String(resolved.in) : undefined,
    } as JsonObject;
    if (resolved.required) {
      required.push(name);
    }
  }

  const requestBody = operation.requestBody as JsonObject | undefined;
  const content = requestBody?.content as Record<string, JsonObject> | undefined;
  const jsonBody = content?.["application/json"] ?? content?.["*/*"];
  if (jsonBody?.schema) {
    properties.body = resolveSchema(doc, jsonBody.schema) as JsonObject;
    if (requestBody?.required) {
      required.push("body");
    }
  }

  return {
    type: "object",
    properties: {
      path: {
        type: "object",
        description: "Path template parameters",
        properties: Object.fromEntries(
          [...pathName.matchAll(/\{([^}]+)\}/g)].map((match) => [
            match[1],
            { type: "string", description: `Path parameter ${match[1]}` },
          ]),
        ),
      },
      ...properties,
    },
    ...(required.length > 0 ? { required } : {}),
    description: `${method.toUpperCase()} ${pathName}`,
  };
}

function buildOutputSchema(doc: JsonObject, operation: JsonObject): JsonObject {
  const responses = (operation.responses as Record<string, JsonObject>) ?? {};
  const success =
    responses["200"] ?? responses["201"] ?? responses["202"] ?? responses.default;
  const content = success?.content as Record<string, JsonObject> | undefined;
  const jsonBody = content?.["application/json"] ?? content?.["*/*"];
  if (jsonBody?.schema) {
    return resolveSchema(doc, jsonBody.schema) as JsonObject;
  }
  return { type: "object" };
}

export function resolveOpenApiSecuritySchemes(doc: JsonObject): Record<string, JsonObject> {
  const components = doc.components as JsonObject | undefined;
  return (components?.securitySchemes as Record<string, JsonObject>) ?? {};
}

export function resolveOpenApiRequiredScopes(
  doc: JsonObject,
  operation: JsonObject,
  providerSupportedScopes: string[],
): string[] {
  const schemes = resolveOpenApiSecuritySchemes(doc);
  const scopes = new Set<string>();
  const security = (operation.security as Array<Record<string, string[]>> | undefined) ??
    (doc.security as Array<Record<string, string[]>> | undefined) ??
    [];

  for (const requirement of security) {
    for (const [schemeName, requiredScopes] of Object.entries(requirement)) {
      const scheme = schemes[schemeName];
      if (!scheme || String(scheme.type) !== "oauth2") {
        continue;
      }
      const oauthFlows = scheme.flows as JsonObject | undefined;
      for (const flow of Object.values(oauthFlows ?? {})) {
        const flowScopes = (flow as JsonObject).scopes as Record<string, string> | undefined;
        if (requiredScopes?.length) {
          for (const scope of requiredScopes) {
            scopes.add(scope);
          }
        } else if (flowScopes) {
          for (const scope of Object.keys(flowScopes)) {
            scopes.add(scope);
          }
        }
      }
    }
  }

  const filtered = [...scopes].filter((scope) =>
    providerSupportedScopes.length === 0 ? true : providerSupportedScopes.includes(scope),
  );
  return filtered.length > 0 ? filtered : [...scopes];
}

export function resolveOpenApiBaseUrl(doc: JsonObject, sourceUrl?: string): string | undefined {
  const servers = doc.servers as Array<{ url?: string }> | undefined;
  const serverUrl = servers?.[0]?.url?.trim();
  if (serverUrl?.startsWith("http://") || serverUrl?.startsWith("https://")) {
    return serverUrl.replace(/\/+$/, "");
  }
  if (serverUrl && sourceUrl) {
    try {
      const resolved = new URL(serverUrl, new URL(sourceUrl).origin);
      return resolved.toString().replace(/\/+$/, "");
    } catch {
      /* ignore invalid URL */
    }
  }
  if (sourceUrl) {
    try {
      return new URL(sourceUrl).origin;
    } catch {
      /* ignore invalid URL */
    }
  }
  return undefined;
}

export function resolveOpenApiAuth(doc: JsonObject): "bearer" | "none" {
  const schemes = resolveOpenApiSecuritySchemes(doc);
  for (const scheme of Object.values(schemes)) {
    const type = String(scheme.type ?? "");
    if (type === "oauth2") {
      return "bearer";
    }
    if (type === "http" && String(scheme.scheme ?? "").toLowerCase() === "bearer") {
      return "bearer";
    }
  }
  return "none";
}

export function generateCandidatesFromOpenApi(
  doc: JsonObject,
  providerSlug: string,
  options?: { sourceUrl?: string; providerSupportedScopes?: string[] },
): JsonObject[] {
  const paths = (doc.paths as Record<string, Record<string, JsonObject>>) ?? {};
  const candidates: JsonObject[] = [];
  const baseUrl = resolveOpenApiBaseUrl(doc, options?.sourceUrl);
  const auth = resolveOpenApiAuth(doc);
  const supportedScopes = options?.providerSupportedScopes ?? [];

  for (const [pathName, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) {
        continue;
      }
      const operationId =
        (operation.operationId as string | undefined) ??
        `${method}_${pathName.replace(/[^\w]+/g, "_")}`;
      const name = `${providerSlug}.${operationId.replace(/[^\w.]+/g, "_")}`;
      const inferred = inferRiskFromOperation({
        method,
        operationId,
        summary: operation.summary as string | undefined,
        pathName,
      });
      const requiredScopes = resolveOpenApiRequiredScopes(doc, operation, supportedScopes);

      candidates.push({
        name,
        display_name: (operation.summary as string | undefined) ?? operationId,
        description: (operation.description as string | undefined) ?? "",
        capability_type: inferred.capability_type,
        risk_level: inferred.risk_level,
        required_scopes: requiredScopes,
        source: "openapi_import",
        invocation_type: "http",
        invocation_config: {
          method: method.toUpperCase(),
          url_template: pathName,
          ...(baseUrl ? { base_url: baseUrl } : {}),
          auth,
        },
        input_schema: buildInputSchema(doc, operation, pathName, method),
        output_schema: buildOutputSchema(doc, operation),
        enabled: false,
        policy_config:
          inferred.risk_level === "HIGH" || inferred.risk_level === "CONFIDENTIAL"
            ? { require_user_confirmation: true }
            : {},
      });
    }
  }

  return candidates;
}
