import { describe, expect, test } from "bun:test";
import {
  generateCandidatesFromOpenApi,
  resolveOpenApiRequiredScopes,
} from "../import-openapi.util";
import { parseMinimalYaml } from "../openapi-yaml.util";

describe("v2.6 OpenAPI import", () => {
  test("parses minimal YAML OpenAPI", () => {
    const doc = parseMinimalYaml(`
openapi: 3.0.0
info:
  title: Demo
paths:
  /users:
    get:
      operationId: listUsers
      summary: List users
`);
    expect(doc.openapi).toBe("3.0.0");
    expect((doc.info as { title?: string }).title).toBe("Demo");
  });

  test("extracts oauth2 scopes from securitySchemes", () => {
    const doc = {
      components: {
        securitySchemes: {
          oauth: {
            type: "oauth2",
            flows: {
              authorizationCode: {
                scopes: { "read:user": "Read user", repo: "Repo access" },
              },
            },
          },
        },
      },
      security: [{ oauth: ["read:user"] }],
      paths: {
        "/user": {
          get: {
            operationId: "getAuthenticatedUser",
            security: [{ oauth: ["read:user"] }],
          },
        },
      },
    };

    const scopes = resolveOpenApiRequiredScopes(doc, doc.paths["/user"].get, ["read:user", "repo"]);
    expect(scopes).toContain("read:user");
  });

  test("marks confidential read operations", () => {
    const doc = {
      paths: {
        "/messages/{id}": {
          get: {
            operationId: "read_email_message",
            summary: "Read email message body",
          },
        },
      },
    };
    const candidates = generateCandidatesFromOpenApi(doc, "gmail");
    expect(candidates[0]?.risk_level).toBe("CONFIDENTIAL");
    expect(candidates[0]?.capability_type).toBe("CONFIDENTIAL_QUERY");
  });

  test("marks delete operations as HIGH", () => {
    const doc = {
      paths: {
        "/repos/{id}": {
          delete: {
            operationId: "deleteRepo",
          },
        },
      },
    };
    const candidates = generateCandidatesFromOpenApi(doc, "github");
    expect(candidates[0]?.risk_level).toBe("HIGH");
    expect(candidates[0]?.name).toBe("github.deleteRepo");
  });
});

describe("oidc provider discovery helpers", () => {
  test("mergeDiscoveredProviderInput passes through manual URLs", async () => {
    const { mergeDiscoveredProviderInput } = await import("../oidc-provider-discovery.service");
    const merged = await mergeDiscoveredProviderInput({
      slug: "custom",
      display_name: "Custom",
      authorization_url: "https://example.com/oauth/authorize",
      token_url: "https://example.com/oauth/token",
    });
    expect(merged.authorization_url).toBe("https://example.com/oauth/authorize");
    expect(merged.token_url).toBe("https://example.com/oauth/token");
  });
});
