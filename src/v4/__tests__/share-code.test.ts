import { describe, expect, test } from "bun:test";
import { normalizeShareCodeInput } from "../share-code.util";
import { resolveAgentUserHint } from "../share-code.service";

describe("normalizeShareCodeInput", () => {
  test("uppercases u_ codes", () => {
    expect(normalizeShareCodeInput("u_ab12cd")).toBe("U_AB12CD");
  });

  test("prefixes bare 6-char bodies", () => {
    expect(normalizeShareCodeInput("ab12cd")).toBe("U_AB12CD");
  });
});

describe("resolveAgentUserHint", () => {
  test("accepts github:prefixed ids as-is without DB", async () => {
    expect(await resolveAgentUserHint("github:Ciamme")).toEqual({ userId: "github:Ciamme" });
  });

  test("returns empty for blank input", async () => {
    expect(await resolveAgentUserHint("")).toEqual({});
    expect(await resolveAgentUserHint(undefined)).toEqual({});
  });
});
