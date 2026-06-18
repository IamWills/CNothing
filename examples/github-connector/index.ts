import { createConnectorHandler } from "../../src/connector-sdk/index";

const connectorId = process.env.GITHUB_CONNECTOR_ID ?? "";
const cnothingPublicKeyPem = process.env.CNOTHING_PUBLIC_KEY_PEM ?? "";
const githubToken = process.env.GITHUB_TOKEN ?? "";
const port = Number(process.env.PORT ?? "3031");

if (!connectorId) {
  throw new Error("GITHUB_CONNECTOR_ID is required");
}
if (!cnothingPublicKeyPem) {
  throw new Error("CNOTHING_PUBLIC_KEY_PEM is required");
}
if (!githubToken) {
  throw new Error("GITHUB_TOKEN is required");
}

async function githubRequest(path: string, init?: RequestInit) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${githubToken}`,
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "message" in data
        ? String((data as { message?: string }).message ?? "GitHub API error")
        : `GitHub API returned ${response.status}`;
    throw new Error(message);
  }
  return data;
}

const handler = createConnectorHandler({
  connectorId,
  cnothingPublicKeyPem,
  executeCapability: async (input) => {
    switch (input.capability) {
      case "github.list_repositories": {
        const perPage = Number(input.input.per_page ?? 30);
        const type = String(input.input.type ?? "all");
        const data = await githubRequest(
          `/user/repos?per_page=${encodeURIComponent(String(perPage))}&type=${encodeURIComponent(type)}`,
        );
        return { repositories: data };
      }

      case "github.get_repository": {
        const repo = String(input.input.repo ?? "");
        if (!repo.includes("/")) {
          throw new Error("input.repo must be in owner/name format");
        }
        const data = await githubRequest(`/repos/${repo}`);
        return { repository: data };
      }

      case "github.create_issue": {
        const repo = String(input.input.repo ?? "");
        const title = String(input.input.title ?? "");
        const body = typeof input.input.body === "string" ? input.input.body : undefined;
        if (!repo.includes("/")) {
          throw new Error("input.repo must be in owner/name format");
        }
        if (!title.trim()) {
          throw new Error("input.title is required");
        }
        const data = await githubRequest(`/repos/${repo}/issues`, {
          method: "POST",
          body: JSON.stringify({
            title,
            body,
            labels: Array.isArray(input.input.labels) ? input.input.labels : undefined,
          }),
        });
        return {
          issue: data,
          issue_number: (data as { number?: number }).number,
          url: (data as { html_url?: string }).html_url,
        };
      }

      default:
        throw new Error(`Unsupported capability: ${input.capability}`);
    }
  },
});

Bun.serve({ port, fetch: handler });

console.log(`GitHub connector listening on http://localhost:${port}`);
