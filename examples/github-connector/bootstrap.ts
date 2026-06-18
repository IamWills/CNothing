/**
 * Bootstrap the GitHub connector and capabilities against a running CNothing instance.
 *
 * Usage:
 *   CNOTHING_BASE_URL=http://127.0.0.1:3021 \
 *   CNOTHING_ADMIN_TOKEN=... \
 *   GITHUB_CONNECTOR_CALLBACK_URL=http://127.0.0.1:3031 \
 *   bun run examples/github-connector/bootstrap.ts
 */

const baseUrl = (process.env.CNOTHING_BASE_URL ?? "http://127.0.0.1:3021").replace(/\/+$/, "");
const adminToken = process.env.CNOTHING_ADMIN_TOKEN ?? "";
const callbackUrl = process.env.GITHUB_CONNECTOR_CALLBACK_URL ?? "http://127.0.0.1:3031";

if (!adminToken) {
  throw new Error("CNOTHING_ADMIN_TOKEN is required");
}

async function request<T>(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    throw new Error(
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: { message?: string } }).error?.message ?? "Request failed")
        : `Request failed: ${response.status}`,
    );
  }
  return data as T;
}

const connectorResponse = await request<{ ok: true; connector: { id: string } }>(
  "/v2/connectors/register",
  {
    provider: "github",
    display_name: "GitHub Connector",
    callback_url: callbackUrl,
    metadata: { demo: true },
  },
);

const connectorId = connectorResponse.connector.id;

const capabilities = [
  {
    name: "github.create_issue",
    description: "Create a GitHub issue in a repository",
    capability_type: "ACTION",
    risk_level: "MEDIUM",
    scopes: ["repo.issue.write"],
    input_schema: {
      type: "object",
      required: ["repo", "title"],
      properties: {
        repo: { type: "string", description: "owner/name" },
        title: { type: "string" },
        body: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "github.list_repositories",
    description: "List repositories visible to the configured GitHub token",
    capability_type: "QUERY",
    risk_level: "LOW",
    scopes: ["repo.read"],
    input_schema: {
      type: "object",
      properties: {
        per_page: { type: "number" },
        type: { type: "string" },
      },
    },
  },
  {
    name: "github.get_repository",
    description: "Get metadata for a single GitHub repository",
    capability_type: "QUERY",
    risk_level: "LOW",
    scopes: ["repo.read"],
    input_schema: {
      type: "object",
      required: ["repo"],
      properties: {
        repo: { type: "string", description: "owner/name" },
      },
    },
  },
];

for (const capability of capabilities) {
  await request("/v2/capabilities/register", {
    connector_id: connectorId,
    ...capability,
  });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      connector_id: connectorId,
      callback_url: callbackUrl,
      capabilities: capabilities.map((item) => item.name),
      next_steps: [
        `export GITHUB_CONNECTOR_ID=${connectorId}`,
        "export GITHUB_TOKEN=ghp_...",
        "curl -s http://127.0.0.1:3021/v1/authai/public-key | jq -r '.authai_public_key.public_key_pem' > /tmp/cnothing-public.pem",
        "export CNOTHING_PUBLIC_KEY_PEM=\"$(cat /tmp/cnothing-public.pem)\"",
        "bun run examples/github-connector/index.ts",
      ],
    },
    null,
    2,
  ),
);
