import type { JsonObject } from "./platform.entity";
import type {
  OAuthProviderRecord,
  OAuthProviderSource,
  OAuthProviderStatus,
} from "./oauth.entity";

export type ProviderSource = OAuthProviderSource;

/**
 * Operator-facing lifecycle. Stored status remains
 * active | unconfigured | disabled; this is a view over those columns plus
 * source and reviewed_at.
 */
export type ProviderRegistryStatus =
  | "discovered"
  | "unverified"
  | "reviewed"
  | "active"
  | "disabled";

export type ProviderRegistrationMethod = "manual" | "dynamic";

export type ProviderValidationResult = {
  ok: boolean;
  checked_at: string;
  method: ProviderRegistrationMethod;
  error?: string;
  issuer?: string | null;
  authorization_url?: string | null;
  token_url?: string | null;
  jwks_url?: string | null;
};

export type ProviderRegistryMeta = {
  method: ProviderRegistrationMethod;
  validation?: ProviderValidationResult;
};

export function parseProviderSource(value: unknown): ProviderSource {
  if (value === "discovered" || value === "imported" || value === "manual") {
    return value;
  }
  return "manual";
}

export function registryMetaFromMetadata(metadata: JsonObject): ProviderRegistryMeta | null {
  const raw = metadata.registry;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    const legacy = metadata.registration_method;
    if (legacy === "dynamic" || legacy === "manual") {
      return { method: legacy };
    }
    return null;
  }
  const record = raw as Record<string, unknown>;
  const method: ProviderRegistrationMethod = record.method === "dynamic" ? "dynamic" : "manual";
  const validationRaw = record.validation;
  let validation: ProviderValidationResult | undefined;
  if (validationRaw && typeof validationRaw === "object" && !Array.isArray(validationRaw)) {
    const v = validationRaw as Record<string, unknown>;
    validation = {
      ok: v.ok === true,
      checked_at: typeof v.checked_at === "string" ? v.checked_at : new Date(0).toISOString(),
      method: v.method === "dynamic" ? "dynamic" : method,
      ...(typeof v.error === "string" ? { error: v.error } : {}),
      ...(v.issuer === null || typeof v.issuer === "string" ? { issuer: v.issuer } : {}),
      ...(v.authorization_url === null || typeof v.authorization_url === "string"
        ? { authorization_url: v.authorization_url }
        : {}),
      ...(v.token_url === null || typeof v.token_url === "string" ? { token_url: v.token_url } : {}),
      ...(v.jwks_url === null || typeof v.jwks_url === "string" ? { jwks_url: v.jwks_url } : {}),
    };
  }
  return { method, ...(validation ? { validation } : {}) };
}

export function withRegistryMetadata(
  metadata: JsonObject | undefined,
  registry: ProviderRegistryMeta,
): JsonObject {
  const next = { ...(metadata ?? {}) };
  next.registry = {
    method: registry.method,
    ...(registry.validation ? { validation: registry.validation } : {}),
  };
  return next;
}

export function registryStatusFor(provider: {
  status: OAuthProviderStatus;
  source: ProviderSource;
  reviewed_at: string | null;
}): ProviderRegistryStatus {
  if (provider.status === "disabled") {
    return "disabled";
  }
  if (provider.status === "active") {
    return "active";
  }
  if (provider.reviewed_at) {
    return "reviewed";
  }
  if (provider.source === "discovered") {
    return "discovered";
  }
  return "unverified";
}

export function registrationMethodFor(provider: OAuthProviderRecord & { source: ProviderSource }): ProviderRegistrationMethod {
  const fromMeta = registryMetaFromMetadata(provider.metadata);
  if (fromMeta?.method) {
    return fromMeta.method;
  }
  if (provider.source === "discovered" || provider.discovery_url || provider.issuer) {
    return "dynamic";
  }
  return "manual";
}

export function slugFromIssuerOrHost(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return url.hostname
      .replace(/^www\./, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
  }
}

export function canActivateProvider(provider: {
  client_id: string | null;
  token_auth_method: OAuthProviderRecord["token_auth_method"];
  encrypted_client_secret: Buffer | null;
  client_secret_vault_id: string | null;
}): boolean {
  if (!provider.client_id?.trim()) {
    return false;
  }
  if (provider.token_auth_method === "none") {
    return true;
  }
  return Boolean(provider.encrypted_client_secret || provider.client_secret_vault_id);
}
