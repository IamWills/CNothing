/**
 * Link Search (search.morethinkings.com) for a v2 user without KV.
 *
 * Prerequisites:
 * 1. Server has KEYSERVICE_SEARCH_API_URL configured and search connector bootstrapped.
 * 2. User has signed in (e.g. GitHub OAuth) — you know their user_id (github:login).
 *
 * Usage (admin):
 *   CNOTHING_BASE_URL=https://cnothing.com \
 *   KEYSERVICE_BEARER_TOKEN=... \
 *   USER_ID=github:IamWills \
 *   bun run examples/search-connector/link.ts
 */
const baseUrl = (process.env.CNOTHING_BASE_URL ?? "https://cnothing.com").replace(/\/+$/, "");
const adminToken = process.env.KEYSERVICE_BEARER_TOKEN?.trim() ?? "";
const userId = process.env.USER_ID?.trim() ?? "";

if (!adminToken) {
  throw new Error("KEYSERVICE_BEARER_TOKEN is required");
}
if (!userId) {
  throw new Error("USER_ID is required (e.g. github:login)");
}

const response = await fetch(`${baseUrl}/v2/admin/search/link`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${adminToken}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    user_id: userId,
    label: process.env.LABEL?.trim() || undefined,
  }),
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

console.log(JSON.stringify(data, null, 2));
