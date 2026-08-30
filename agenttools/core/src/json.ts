import type { JsonObject } from "./types";

export type { JsonObject };

export function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
