import { pool } from "../db";

const REQUIRED_RELATIONS = [
  "cap_trust_policies",
  "cap_executions",
  "cap_approvals",
  "cap_secret_vault",
  "cap_worker_runs",
] as const;

export type TrustLayerReadiness = {
  ready: boolean;
  missing_relations: string[];
  trust_policy_count: number | null;
};

/**
 * Production readiness probe for Execution Trust Layer schema.
 * Missing relations must fail health checks — never silently degrade in prod UI.
 */
export async function checkTrustLayerReadiness(): Promise<TrustLayerReadiness> {
  const missing: string[] = [];

  for (const name of REQUIRED_RELATIONS) {
    const result = await pool.query(`SELECT to_regclass($1) AS reg`, [`public.${name}`]);
    if (!result.rows[0]?.reg) {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    return {
      ready: false,
      missing_relations: missing,
      trust_policy_count: null,
    };
  }

  const countResult = await pool.query(
    `
      SELECT COUNT(*)::int AS count
      FROM cap_trust_policies
      WHERE deleted_at IS NULL
    `,
  );

  return {
    ready: true,
    missing_relations: [],
    trust_policy_count: Number(countResult.rows[0]?.count ?? 0),
  };
}
