import { beforeEach, expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { describeWithDb, resetDatabase } from "../../__tests__/helpers/db";
import { givenAgent, givenProvider, givenUserSession } from "../../__tests__/helpers/fixtures";
import { handleV4Request } from "../../api/v4.api";
import { deviceService } from "../device.service";
import { createProxyAccessRequest, decideProxyAccessRequest } from "../proxy.repository";

const verifier = "v".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");
const publicKeyJwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "jwk" });
function request(path: string, token?: string, body?: unknown) {
  return new Request(`https://cnothing.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describeWithDb("mobile account login and durable approval history", () => {
  beforeEach(resetDatabase);

  test("browser login requires a user session and returns only a verifier-bound pairing code", async () => {
    await expect(handleV4Request(request(`/v4/devices/mobile-return?state=${"s".repeat(32)}&code_challenge=${challenge}`))).rejects.toThrow(/session required/i);
    const { token, user } = await givenUserSession();
    const page = await handleV4Request(request(`/v4/devices/mobile-return?state=${"s".repeat(32)}&code_challenge=${challenge}`, token));
    expect(page.headers.get("Cache-Control")).toBe("no-store");
    const html = await page.text();
    expect(html).toContain("cnothing://login-callback");
    expect(html).not.toContain(token);
    const response = await handleV4Request(request("/v4/devices/mobile-pairing-codes", token, { code_challenge: challenge }));
    const result = await response.json() as { pairing_code: string };
    for (const wrong of [undefined, "w".repeat(43)]) {
      await expect(deviceService.pairDevice({ pairingCode: result.pairing_code, deviceName: "Wrong phone", publicKeyJwk, codeVerifier: wrong })).rejects.toThrow(/pairing code/i);
    }
    const paired = await deviceService.pairDevice({ pairingCode: result.pairing_code, deviceName: "iPhone", publicKeyJwk, codeVerifier: verifier });
    expect(paired.device.user_id).toBe(user.id);
    expect(paired.device.key_registered).toBe(true);
    await expect(deviceService.pairDevice({ pairingCode: result.pairing_code, deviceName: "Replay", publicKeyJwk, codeVerifier: verifier })).rejects.toThrow(/pairing code/i);
  });

  test("mobile login rejects malformed challenges and callback state", async () => {
    const { token } = await givenUserSession();
    await expect(handleV4Request(request("/v4/devices/mobile-pairing-codes", token, { code_challenge: "bad" }))).rejects.toThrow(/challenge/i);
    await expect(handleV4Request(request(`/v4/devices/mobile-return?state=bad&code_challenge=${challenge}`, token))).rejects.toThrow(/session/i);
  });

  test("history retains decisions, excludes pending and other users, and supports pagination", async () => {
    const { agent } = await givenAgent();
    const provider = await givenProvider();
    const owner = await givenUserSession();
    const other = await givenUserSession();
    const create = (userId: string, ttl = 600) => createProxyAccessRequest({ agent_id: agent.id, provider_slug: provider.slug, requested_hosts: ["api.example.com"], user_hint: userId, ttl_seconds: ttl });
    const pending = await create(owner.user.id);
    const foreign = await create(other.user.id, -1);
    for (let i = 0; i < 51; i++) {
      const row = await create(owner.user.id);
      await decideProxyAccessRequest({ id: row.id, status: i % 2 ? "approved" : "denied", user_id: owner.user.id });
    }
    const expired = await create(owner.user.id, -1);
    const page = await handleV4Request(request("/v4/access-requests/history", owner.token));
    const body = await page.json() as { items: Array<{ access_request_id: string; status: string; decided_at: string | null }>; has_more: boolean };
    expect(body.items).toHaveLength(50);
    expect(body.has_more).toBe(true);
    expect(body.items[0]).toMatchObject({ access_request_id: expired.id, status: "expired" });
    expect(body.items.some(row => row.access_request_id === pending.id || row.access_request_id === foreign.id)).toBe(false);
    expect(body.items.find(row => row.status === "approved")?.decided_at).toBeTruthy();
    const second = await (await handleV4Request(request("/v4/access-requests/history?offset=50", owner.token))).json() as typeof body;
    expect(second.items).toHaveLength(2);
    expect(second.has_more).toBe(false);
    expect(new Set([...body.items, ...second.items].map(row => row.access_request_id)).size).toBe(52);
    await expect(handleV4Request(request("/v4/access-requests/history"))).rejects.toThrow(/session required/i);
    await expect(handleV4Request(request("/v4/access-requests/history?offset=-1", owner.token))).rejects.toThrow(/offset/i);
  });
});
