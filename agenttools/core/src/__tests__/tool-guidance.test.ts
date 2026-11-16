import { expect, test } from "bun:test";
import { guideToolResult } from "../tool-guidance";

test("expired grants are not recommended for reuse", () => {
  expect(guideToolResult("list_grants", { items: [{ status: "active", expires_at: "2000-01-01" }] })).toMatchObject({ next_action: "call_list_providers" });
});

test("transaction approval resumes the original call and terminal statuses stop", () => {
  expect(guideToolResult("get_access_status", { status: "approved", type: "transaction", grant_id: "g" })).toMatchObject({ next_action: "retry_same_proxy_request" });
  for (const status of ["denied", "expired"]) {
    expect(guideToolResult("get_access_status", { status })).toMatchObject({ next_action: "none" });
  }
});
