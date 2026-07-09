import type { CapabilityRecord, JsonObject } from "../../v2/v2.entity";

export function summarizeInputForApproval(input: JsonObject): string {
  const keys = Object.keys(input).slice(0, 12);
  const parts = keys.map((key) => {
    const value = input[key];
    if (value === null || value === undefined) return `${key}=null`;
    if (typeof value === "string") {
      const truncated = value.length > 80 ? `${value.slice(0, 80)}…` : value;
      return `${key}=${truncated}`;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return `${key}=${value}`;
    }
    return `${key}=[${typeof value}]`;
  });
  return parts.join(", ") || "(no input)";
}

export function deriveResourceKey(
  capability: CapabilityRecord,
  input: JsonObject,
): string | null {
  if (capability.name === "github.create_repo") {
    const name = typeof input.name === "string" ? input.name : null;
    const org = typeof input.org === "string" ? input.org : null;
    if (name) {
      return org ? `${org}/${name}` : name;
    }
  }
  if (capability.name === "github.create_issue") {
    const owner = typeof input.owner === "string" ? input.owner : "";
    const repo = typeof input.repo === "string" ? input.repo : "";
    const title = typeof input.title === "string" ? input.title : "";
    if (owner && repo) return `${owner}/${repo}:${title.slice(0, 64)}`;
  }
  if (typeof input.resource === "string") return input.resource;
  if (typeof input.resource_id === "string") return input.resource_id;
  return null;
}
