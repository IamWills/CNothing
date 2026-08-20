import { beforeEach, expect, test } from "bun:test";

import { describeWithDb, resetDatabase } from "../../__tests__/helpers/db";
import { givenAgent } from "../../__tests__/helpers/fixtures";
import { requireAgentFromRequest } from "../agent-auth";
import { findAgentByAccessToken, revokeAgent } from "../platform.repository";
import { pool } from "../../db";

function requestWithToken(token?: string): Request {
  return new Request("https://cnothing.test/v4/grants", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describeWithDb("agent authentication", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("accepts an active agent's bearer token", async () => {
    const { agent, accessToken } = await givenAgent();
    const authenticated = await requireAgentFromRequest(requestWithToken(accessToken));
    expect(authenticated.id).toBe(agent.id);
  });

  test("stores only a hash of the agent token", async () => {
    const { accessToken } = await givenAgent();
    const stored = await pool.query(`SELECT access_token_hash FROM cap_agents`);
    expect(stored.rows[0].access_token_hash).not.toBe(accessToken);
    expect(JSON.stringify(stored.rows)).not.toContain(accessToken);
  });

  test("rejects a missing, malformed, or unknown token", async () => {
    await expect(requireAgentFromRequest(requestWithToken())).rejects.toThrow(
      /access token required/i,
    );
    await expect(requireAgentFromRequest(requestWithToken("agent_not_real"))).rejects.toThrow(
      /invalid or inactive/i,
    );
  });

  test("rejects a revoked agent", async () => {
    const { agent, accessToken } = await givenAgent();
    await revokeAgent({ id: agent.id });

    expect(await findAgentByAccessToken(accessToken)).toBeNull();
    await expect(requireAgentFromRequest(requestWithToken(accessToken))).rejects.toThrow(
      /invalid or inactive/i,
    );
  });

  test("one agent's token never authenticates as another agent", async () => {
    const first = await givenAgent();
    const second = await givenAgent();
    const authenticated = await requireAgentFromRequest(requestWithToken(second.accessToken));

    expect(authenticated.id).toBe(second.agent.id);
    expect(authenticated.id).not.toBe(first.agent.id);
  });
});
