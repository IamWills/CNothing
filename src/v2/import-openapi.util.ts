import type { JsonObject } from "./v2.entity";

function inferRiskFromOperation(input: {
  method: string;
  operationId: string;
  summary?: string;
}): { risk_level: string; capability_type: string } {
  const haystack = `${input.method} ${input.operationId} ${input.summary ?? ""}`.toLowerCase();
  if (haystack.includes("delete") || haystack.includes("payment") || haystack.includes("transfer") || haystack.includes("admin")) {
    return { risk_level: "HIGH", capability_type: "ACTION" };
  }
  if (
    haystack.includes("read") &&
    (haystack.includes("email") || haystack.includes("file") || haystack.includes("private") || haystack.includes("message"))
  ) {
    return { risk_level: "CONFIDENTIAL", capability_type: "CONFIDENTIAL_QUERY" };
  }
  if (input.method === "get" || input.method === "head") {
    return { risk_level: "LOW", capability_type: "QUERY" };
  }
  return { risk_level: "MEDIUM", capability_type: "ACTION" };
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
  const components = doc.components as JsonObject | undefined;
  const schemes = (components?.securitySchemes as Record<string, JsonObject>) ?? {};
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
  options?: { sourceUrl?: string },
): JsonObject[] {
  const paths = (doc.paths as Record<string, Record<string, JsonObject>>) ?? {};
  const candidates: JsonObject[] = [];
  const baseUrl = resolveOpenApiBaseUrl(doc, options?.sourceUrl);
  const auth = resolveOpenApiAuth(doc);

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
      });

      candidates.push({
        name,
        display_name: (operation.summary as string | undefined) ?? operationId,
        description: (operation.description as string | undefined) ?? "",
        capability_type: inferred.capability_type,
        risk_level: inferred.risk_level,
        required_scopes: [],
        source: "openapi_import",
        invocation_type: "http",
        invocation_config: {
          method: method.toUpperCase(),
          url_template: pathName,
          ...(baseUrl ? { base_url: baseUrl } : {}),
          auth,
        },
        enabled: false,
        policy_config: inferred.risk_level === "HIGH" ? { require_user_confirmation: true } : {},
      });
    }
  }

  return candidates;
}
