import { describe, expect, test } from "bun:test";

import {
  canActivateProvider,
  parseProviderSource,
  registryStatusFor,
  slugFromIssuerOrHost,
} from "../provider-registry";
import { selectRegistrationStrategy } from "../provider-registration";

describe("provider registry mapping", () => {
  test("maps stored status onto the console lifecycle without renaming columns", () => {
    expect(
      registryStatusFor({ status: "active", source: "manual", reviewed_at: null }),
    ).toBe("active");
    expect(
      registryStatusFor({ status: "disabled", source: "discovered", reviewed_at: null }),
    ).toBe("disabled");
    expect(
      registryStatusFor({ status: "unconfigured", source: "discovered", reviewed_at: null }),
    ).toBe("discovered");
    expect(
      registryStatusFor({
        status: "unconfigured",
        source: "discovered",
        reviewed_at: "2026-08-20T00:00:00.000Z",
      }),
    ).toBe("reviewed");
    expect(
      registryStatusFor({ status: "unconfigured", source: "manual", reviewed_at: null }),
    ).toBe("unverified");
  });

  test("unknown source values collapse to manual", () => {
    expect(parseProviderSource("browser")).toBe("manual");
    expect(parseProviderSource("discovered")).toBe("discovered");
  });

  test("selects dynamic registration when a discovery target is present", () => {
    expect(selectRegistrationStrategy({ issuer: "https://issuer.example.com" }).method).toBe(
      "dynamic",
    );
    expect(selectRegistrationStrategy({}).method).toBe("manual");
  });

  test("derives a slug from an issuer host", () => {
    expect(slugFromIssuerOrHost("https://accounts.google.com")).toBe("accounts-google-com");
    expect(slugFromIssuerOrHost("https://www.example.com/realms/app")).toBe("example-com");
  });

  test("activation requires client credentials unless the client is public", () => {
    expect(
      canActivateProvider({
        client_id: null,
        token_auth_method: "client_secret_post",
        encrypted_client_secret: null,
        client_secret_vault_id: null,
      }),
    ).toBe(false);
    expect(
      canActivateProvider({
        client_id: "public",
        token_auth_method: "none",
        encrypted_client_secret: null,
        client_secret_vault_id: null,
      }),
    ).toBe(true);
  });
});
