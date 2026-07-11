import { randomUUID } from "node:crypto";
import { pool } from "../../db";
import type { JsonObject } from "../../v2/v2.entity";
import type { PolicyRiskLevel } from "./policy-engine-v3";

export type TrustPolicyEffect =
  | "allow"
  | "deny"
  | "require_approval"
  | "require_reauth"
  | "scope_limit"
  | "rate_limit"
  | "destructive_action_block"
  | "time_window"
  | "resource_constraint"
  | "agent_allowlist"
  | "provider_allowlist";

export type TrustPolicyRecord = {
  id: string;
  name: string;
  description: string;
  capability_id: string | null;
  capability_pattern: string | null;
  provider_pattern: string | null;
  agent_id: string | null;
  agent_allowlist: string[];
  provider_allowlist: string[];
  effect: TrustPolicyEffect;
  risk_level: PolicyRiskLevel;
  rate_limit_per_minute: number | null;
  time_window_start: string | null;
  time_window_end: string | null;
  time_window_tz: string;
  resource_constraint: JsonObject;
  scope_limit: string[];
  destructive_action_block: boolean;
  require_reauth: boolean;
  priority: number;
  enabled: boolean;
  status: string;
  tenant_id: string;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function normalizeMetadata(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function mapRow(row: Record<string, unknown>): TrustPolicyRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    capability_id: row.capability_id ? String(row.capability_id) : null,
    capability_pattern: row.capability_pattern ? String(row.capability_pattern) : null,
    provider_pattern: row.provider_pattern ? String(row.provider_pattern) : null,
    agent_id: row.agent_id ? String(row.agent_id) : null,
    agent_allowlist: asStringArray(row.agent_allowlist),
    provider_allowlist: asStringArray(row.provider_allowlist),
    effect: String(row.effect) as TrustPolicyEffect,
    risk_level: String(row.risk_level ?? "medium") as PolicyRiskLevel,
    rate_limit_per_minute:
      row.rate_limit_per_minute === null || row.rate_limit_per_minute === undefined
        ? null
        : Number(row.rate_limit_per_minute),
    time_window_start: row.time_window_start ? String(row.time_window_start) : null,
    time_window_end: row.time_window_end ? String(row.time_window_end) : null,
    time_window_tz: String(row.time_window_tz ?? "UTC"),
    resource_constraint: normalizeMetadata(row.resource_constraint),
    scope_limit: asStringArray(row.scope_limit),
    destructive_action_block: Boolean(row.destructive_action_block),
    require_reauth: Boolean(row.require_reauth),
    priority: Number(row.priority ?? 100),
    enabled: Boolean(row.enabled),
    status: String(row.status ?? "active"),
    tenant_id: String(row.tenant_id ?? "default"),
    metadata: normalizeMetadata(row.metadata),
    created_at: new Date(String(row.created_at)).toISOString(),
    updated_at: new Date(String(row.updated_at)).toISOString(),
    deleted_at: row.deleted_at ? new Date(String(row.deleted_at)).toISOString() : null,
  };
}

export async function listTrustPolicies(): Promise<TrustPolicyRecord[]> {
  const result = await pool.query(
    `
      SELECT * FROM cap_trust_policies
      WHERE enabled = TRUE AND deleted_at IS NULL AND status = 'active'
      ORDER BY priority ASC, created_at ASC
    `,
  );
  return result.rows.map(mapRow);
}

export async function listAllTrustPolicies(limit = 200): Promise<TrustPolicyRecord[]> {
  const result = await pool.query(
    `
      SELECT * FROM cap_trust_policies
      WHERE deleted_at IS NULL
      ORDER BY priority ASC, created_at DESC
      LIMIT $1
    `,
    [limit],
  );
  return result.rows.map(mapRow);
}

export async function createTrustPolicy(input: {
  name: string;
  description?: string;
  capability_id?: string | null;
  capability_pattern?: string | null;
  provider_pattern?: string | null;
  agent_id?: string | null;
  agent_allowlist?: string[];
  provider_allowlist?: string[];
  effect: TrustPolicyEffect;
  risk_level?: PolicyRiskLevel;
  rate_limit_per_minute?: number | null;
  time_window_start?: string | null;
  time_window_end?: string | null;
  resource_constraint?: JsonObject;
  scope_limit?: string[];
  destructive_action_block?: boolean;
  require_reauth?: boolean;
  priority?: number;
  tenant_id?: string;
  metadata?: JsonObject;
}): Promise<TrustPolicyRecord> {
  const id = randomUUID();
  await pool.query(
    `
      INSERT INTO cap_trust_policies (
        id, name, description, capability_id, capability_pattern, provider_pattern,
        agent_id, agent_allowlist, provider_allowlist, effect, risk_level,
        rate_limit_per_minute, time_window_start, time_window_end,
        resource_constraint, scope_limit, destructive_action_block, require_reauth,
        priority, tenant_id, metadata
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,
        $15::jsonb,$16::jsonb,$17,$18,$19,$20,$21::jsonb
      )
    `,
    [
      id,
      input.name,
      input.description ?? "",
      input.capability_id ?? null,
      input.capability_pattern ?? null,
      input.provider_pattern ?? null,
      input.agent_id ?? null,
      JSON.stringify(input.agent_allowlist ?? []),
      JSON.stringify(input.provider_allowlist ?? []),
      input.effect,
      input.risk_level ?? "medium",
      input.rate_limit_per_minute ?? null,
      input.time_window_start ?? null,
      input.time_window_end ?? null,
      JSON.stringify(input.resource_constraint ?? {}),
      JSON.stringify(input.scope_limit ?? []),
      input.destructive_action_block ?? false,
      input.require_reauth ?? false,
      input.priority ?? 100,
      input.tenant_id ?? "default",
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  const result = await pool.query(`SELECT * FROM cap_trust_policies WHERE id = $1`, [id]);
  return mapRow(result.rows[0]!);
}
