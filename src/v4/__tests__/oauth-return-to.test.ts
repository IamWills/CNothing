import { expect, test } from "bun:test";
import { oauthReturnTo } from "../../../console/lib/return-to";

const origin = "https://cnothing.test";

test("OAuth connection and login return to the original approval", () => {
  const approval = `${origin}/approve-proxy/request-1?user=github%3Aalice`;
  expect(oauthReturnTo(`?redirect_after=${encodeURIComponent(approval)}`, origin, "/connections"))
    .toBe(approval);
  expect(oauthReturnTo("?redirect_after=%2Fapprove-agent%2Fenrollment-1", origin, "/login"))
    .toBe(`${origin}/approve-agent/enrollment-1`);
});

test("return navigation rejects external origins and unsafe URLs", () => {
  for (const url of ["https://evil.test/", "//evil.test/", "javascript:alert(1)", "https://user:pass@cnothing.test/", "https://["]) {
    expect(oauthReturnTo(`?redirect_after=${encodeURIComponent(url)}`, origin, "/connections"))
      .toBe(`${origin}/connections`);
  }
  expect(oauthReturnTo("", origin, "/login")).toBe(`${origin}/login`);
});
