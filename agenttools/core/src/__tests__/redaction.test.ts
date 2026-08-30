import { expect, test } from "bun:test";

import { assertModelSafe, containsHostSecret, renderModelJson, userVisibleEnrollment } from "../redaction";

test("detects host enrollment secrets and agent tokens", () => {
  expect(containsHostSecret({ token: "enrs_abc" })).toBe(true);
  expect(containsHostSecret({ token: "agent_live_abc" })).toBe(true);
  expect(containsHostSecret({ approval_url: "https://cnothing.com/approve-agent/x" })).toBe(false);
});

test("renderModelJson refuses secrets", () => {
  expect(() => renderModelJson({ access_token: "agent_xxx" })).toThrow(/host secrets/);
  expect(renderModelJson({ status: "ready" })).toContain("ready");
});

test("assertModelSafe allows enrollment_required payloads", () => {
  const visible = userVisibleEnrollment({
    approval_url: "https://cnothing.com/approve-agent/enr-1",
    user_code: "AB12-CD34",
    expires_at: "2099-01-01T00:00:00.000Z",
  });
  expect(() => assertModelSafe(visible)).not.toThrow();
});
