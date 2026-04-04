import { randomBytes } from "node:crypto";
import config from "../config";
import { getPublicKeyInfo } from "../crypto/hybrid-envelope";
import { ValidationError } from "../utils/errors";
import type { AuthaiPublicKeyView, JsonObject } from "./key-service.entity";

export function normalizeString(
  value: unknown,
  fieldName: string,
  pattern: RegExp,
  maxLength: number,
): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new ValidationError(`${fieldName} is required`, { error_code: "missing_field" });
  }
  if (normalized.length > maxLength || !pattern.test(normalized)) {
    throw new ValidationError(`${fieldName} contains unsupported characters`, {
      error_code: "invalid_field",
      field: fieldName,
    });
  }
  return normalized;
}

export function normalizeOptionalString(value: unknown, maxLength: number): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    throw new ValidationError("Field is too long", { error_code: "field_too_long" });
  }
  return normalized;
}

export function normalizeJsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

export function assertJsonSerializable(value: unknown, fieldName: string): void {
  try {
    JSON.stringify(value);
  } catch (error) {
    throw new ValidationError(`${fieldName} must be JSON serializable`, {
      error_code: "invalid_json",
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function now(): Date {
  return new Date();
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

export function createNonce(): string {
  return randomBytes(32).toString("base64url");
}

export function authaiPublicKeyView(): AuthaiPublicKeyView {
  return getPublicKeyInfo({
    publicKeyPem: config.authaiPublicKeyPem,
    keyId: config.authaiKeyId,
  });
}

export function normalizeNamespace(value: unknown): string {
  return normalizeString(value, "namespace", /^[a-zA-Z0-9._:@/-]{1,160}$/, 160);
}

export function normalizeRecordKey(value: unknown): string {
  return normalizeString(value, "key", /^[a-zA-Z0-9._:@/-]{1,256}$/, 256);
}

export function normalizeClientPublicKey(value: unknown): string {
  const pem = typeof value === "string" ? value.trim() : "";
  if (!pem) {
    throw new ValidationError("client_public_key is required", { error_code: "missing_field" });
  }
  if (!pem.includes("BEGIN PUBLIC KEY")) {
    throw new ValidationError("client_public_key must be a PEM encoded public key", {
      error_code: "invalid_public_key",
    });
  }
  return pem;
}
