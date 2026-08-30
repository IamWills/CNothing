import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileCredentialStore } from "../file-store";
import { userVisibleEnrollment } from "../redaction";

const originalEnv = {
  CNOTHING_AGENT_TOKEN: process.env.CNOTHING_AGENT_TOKEN,
  CNOTHING_AGENT_TOKEN_FILE: process.env.CNOTHING_AGENT_TOKEN_FILE,
};

afterEach(() => {
  if (originalEnv.CNOTHING_AGENT_TOKEN === undefined) delete process.env.CNOTHING_AGENT_TOKEN;
  else process.env.CNOTHING_AGENT_TOKEN = originalEnv.CNOTHING_AGENT_TOKEN;
  if (originalEnv.CNOTHING_AGENT_TOKEN_FILE === undefined) delete process.env.CNOTHING_AGENT_TOKEN_FILE;
  else process.env.CNOTHING_AGENT_TOKEN_FILE = originalEnv.CNOTHING_AGENT_TOKEN_FILE;
});

test("stores the claimed agent token privately and erases enrollment state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cnothing-plugin-"));
  const tokenPath = join(dir, "agent.token");
  process.env.CNOTHING_AGENT_TOKEN_FILE = tokenPath;
  delete process.env.CNOTHING_AGENT_TOKEN;
  const store = new FileCredentialStore(tokenPath);

  await store.writeEnrollment({
    enrollment_id: "enr-1",
    enrollment_secret: "enrs_secret",
    approval_url: "https://cnothing.com/approve-agent/enr-1",
    user_code: "AB12-CD34",
    expires_at: new Date().toISOString(),
  });
  await store.writeToken("agent_host_only");

  expect(await readFile(store.tokenFilePath(), "utf8")).toContain("agent_host_only");
  expect((await stat(store.tokenFilePath())).mode & 0o777).toBe(0o600);
  await expect(readFile(store.enrollmentFilePath(), "utf8")).rejects.toThrow();
  expect(await store.readToken()).toBe("agent_host_only");
  await rm(dir, { recursive: true, force: true });
});

test("user-visible enrollment payload never includes secrets", () => {
  const visible = userVisibleEnrollment({
    approval_url: "https://cnothing.com/approve-agent/enr-1",
    user_code: "AB12-CD34",
    expires_at: "2099-01-01T00:00:00.000Z",
  });
  expect(JSON.stringify(visible)).not.toContain("enrs_");
  expect(JSON.stringify(visible)).not.toContain("agent_");
  expect(visible.user_action.approval_url).toContain("/approve-agent/");
});
