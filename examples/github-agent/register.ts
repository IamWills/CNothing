/**
 * Register a v2 agent owned by a GitHub user and grant low-risk platform capabilities.
 *
 * Prerequisites:
 * 1. User has signed in with GitHub on Console (links credential + auto-grants for platform agent).
 * 2. CNOTHING_BASE_URL and KEYSERVICE_BEARER_TOKEN (admin) are set.
 *
 * Usage:
 *   GITHUB_LOGIN=IamWills \
 *   AGENT_NAME=my-cursor-agent \
 *   CNOTHING_BASE_URL=https://cnothing.com \
 *   KEYSERVICE_BEARER_TOKEN=... \
 *   bun run examples/github-agent/register.ts
 */
const baseUrl = (process.env.CNOTHING_BASE_URL ?? "https://cnothing.com").replace(/\/+$/, "");
const adminToken = process.env.KEYSERVICE_BEARER_TOKEN?.trim() ?? "";
const githubLogin = process.env.GITHUB_LOGIN?.trim() ?? "";
const agentName = process.env.AGENT_NAME?.trim() ?? "my-github-agent";

if (!adminToken) {
  throw new Error("KEYSERVICE_BEARER_TOKEN is required");
}
if (!githubLogin) {
  throw new Error("GITHUB_LOGIN is required (GitHub username without @)");
}

const ownerUserId = `github:${githubLogin}`;

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: { message?: string } }).error?.message ?? "Request failed")
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

const lowRiskCapabilities = [
  "platform.echo",
  "platform.ping",
  "github.list_repositories",
  "github.get_repository",
];

const registered = await requestJson<{ ok: true; agent: { id: string }; access_token: string }>(
  "/v2/agents/register",
  {
    method: "POST",
    body: JSON.stringify({
      name: agentName,
      owner_user_id: ownerUserId,
      metadata: {
        linked_github_login: githubLogin,
        created_by: "examples/github-agent/register.ts",
      },
    }),
  },
);

console.log("Agent registered:");
console.log(`  id: ${registered.agent.id}`);
console.log(`  name: ${agentName}`);
console.log(`  owner_user_id: ${ownerUserId}`);
console.log(`  access_token: ${registered.access_token}`);
console.log("");
console.log("Granting low-risk capabilities...");

for (const capability of lowRiskCapabilities) {
  try {
    await requestJson("/v2/grants", {
      method: "POST",
      body: JSON.stringify({
        user_id: ownerUserId,
        agent_id: registered.agent.id,
        capability,
      }),
    });
    console.log(`  granted ${capability}`);
  } catch (error) {
    console.warn(
      `  skip ${capability}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

console.log("");
console.log("Invoke example:");
console.log(`curl -sS -X POST ${baseUrl}/v2/capabilities/invoke \\`);
console.log(`  -H "Authorization: Bearer ${registered.access_token}" \\`);
console.log(`  -H "Content-Type: application/json" \\`);
console.log(`  -d '{"capability":"github.list_repositories","input":{"per_page":5},"user_id":"${ownerUserId}"}'`);
