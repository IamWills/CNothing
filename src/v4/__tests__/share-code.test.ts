import { describe, expect, test } from "bun:test";
import { normalizeShareCodeInput } from "../share-code.util";

describe("normalizeShareCodeInput", () => {
  test("uppercases u_ codes", () => {
    expect(normalizeShareCodeInput("u_ab12cd")).toBe("U_AB12CD");
  });

  test("prefixes bare 6-char bodies", () => {
    expect(normalizeShareCodeInput("ab12cd")).toBe("U_AB12CD");
  });
});
