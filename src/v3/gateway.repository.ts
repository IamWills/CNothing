import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool } from "../db";
import type { JsonObject } from "../v2/v2.entity";
import type {
  ApprovalRecord,
  ApprovalStatus,
  ApprovalType,
  CapabilityPermissionRecord,
  ExecutionRecord,
  ExecutionStatus,
} from "./v3.entity";

function normalizeMetadata(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asIso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function mapApprovalRow(row: Record<string, unknown>): ApprovalRecord {
  const rawType = row.approval_type ? String(row.approval_type) : "execution_confirmation";
  const approval_type: ApprovalType =
    rawType === "capability_grant" ||
    rawType === "execution_confirmation" ||
    rawType === "reauthentication"
      ? rawType
      : "execution_confirmation";

  return {
    id: String(row.id),
    user_id: String(row.user_id),
    agent_id: String(row.agent_id),
    capability_id: String(row.capability_id),
    execution_id: row.execution_id ? String(row.execution_id) : null,
    policy_id: row.policy_id ? String(row.policy_id) : null,
    approval_type,
    requested_action: String(row.requested_action ?? ""),
    input_summary: String(row.input_summary ?? ""),
    safe_input_summary: row.safe_input_summary
      ? String(row.safe_input_summary)
      : String(row.input_summary ?? ""),
    input_hash: row.input_hash ? String(row.input_hash) : null,
    risk_level: String(row.risk_level ?? "MEDIUM"),
    scopes: asStringArray(row.scopes),
    resource_key: row.resource_key ? String(row.resource_key) : null,
    expires_at: asIso(row.expires_at),
    status: String(row.status) as ApprovalStatus,
    approved_at: row.approved_at ? asIso(row.approved_at) : null,
    rejected_at: row.rejected_at ? asIso(row.rejected_at) : null,
    cancelled_at: row.cancelled_at ? asIso(row.cancelled_at) : null,
    decided_by: row.decided_by ? String(row.decided_by) : null,
    approval_token_hash: row.approval_token_hash ? String(row.approval_token_hash) : null,
    tenant_id: String(row.tenant_id ?? "default"),
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

function mapExecutionRow(row: Record<string, unknown>): ExecutionRecord {
  return {
    id: String(row.id),
    agent_id: String(row.agent_id),
    user_id: row.user_id ? String(row.user_id) : null,
    capability_id: String(row.capability_id),
    provider_id: row.provider_id ? String(row.provider_id) : null,
    connection_id: row.connection_id ? String(row.connection_id) : null,
    approval_id: row.approval_id ? String(row.approval_id) : null,
    idempotency_key: row.idempotency_key ? String(row.idempotency_key) : null,
    status: String(row.status) as ExecutionStatus,
    input_hash: row.input_hash ? String(row.input_hash) : null,
    result_hash: row.result_hash ? String(row.result_hash) : null,
    error_code: row.error_code ? String(row.error_code) : null,
    error_message: row.error_message ? String(row.error_message) : null,
    dry_run: Boolean(row.dry_run),
    result_payload: row.result_payload ? normalizeMetadata(row.result_payload) : null,
    policy_decision: row.policy_decision ? normalizeMetadata(row.policy_decision) : null,
    worker_type: row.worker_type ? String(row.worker_type) : null,
    safe_input: row.safe_input ? normalizeMetadata(row.safe_input) : null,
    sanitized_output: row.sanitized_output ? normalizeMetadata(row.sanitized_output) : null,
    audit_chain_id: row.audit_chain_id ? String(row.audit_chain_id) : null,
    tenant_id: String(row.tenant_id ?? "default"),
    started_at: asIso(row.started_at),
    finished_at: row.finished_at ? asIso(row.finished_at) : null,
    completed_at: row.completed_at
      ? asIso(row.completed_at)
      : row.finished_at
        ? asIso(row.finished_at)
        : null,
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

function mapPermissionRow(row: Record<string, unknown>): CapabilityPermissionRecord {
  return {
    id: String(row.id),
    agent_id: row.agent_id ? String(row.agent_id) : null,
    capability_id: row.capability_id ? String(row.capability_id) : null,
    capability_pattern: row.capability_pattern ? String(row.capability_pattern) : null,
    provider_pattern: row.provider_pattern ? String(row.provider_pattern) : null,
    effect: String(row.effect) as CapabilityPermissionRecord["effect"],
    max_risk_level: row.max_risk_level ? String(row.max_risk_level) : null,
    require_approval:
      row.require_approval === null || row.require_approval === undefined
        ? null
        : Boolean(row.require_approval),
    rate_limit_per_minute:
      row.rate_limit_per_minute === null || row.rate_limit_per_minute === undefined
        ? null
        : Number(row.rate_limit_per_minute),
    spending_limit_cents:
      row.spending_limit_cents === null || row.spending_limit_cents === undefined
        ? null
        : Number(row.spending_limit_cents),
    enabled: Boolean(row.enabled),
    priority: Number(row.priority ?? 100),
    tenant_id: String(row.tenant_id ?? "default"),
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
    deleted_at: row.deleted_at ? asIso(row.deleted_at) : null,
  };
}

export function hashApprovalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateApprovalToken(): string {
  return `appr_${randomBytes(24).toString("base64url")}`;
}

export async function createApproval(input: {
  user_id: string;
  agent_id: string;
  capability_id: string;
  requested_action: string;
  input_summary: string;
  input_hash?: string | null;
  risk_level: string;
  scopes?: string[];
  resource_key?: string | null;
  expires_at: string;
  tenant_id?: string;
  metadata?: JsonObject;
  approval_token?: string;
  execution_id?: string | null;
  policy_id?: string | null;
  approval_type?: ApprovalType;
}): Promise<{ approval: ApprovalRecord; approval_token: string }> {
  const id = randomUUID();
  const token = input.approval_token ?? generateApprovalToken();
  const tokenHash = hashApprovalToken(token);
  const approvalType: ApprovalType = input.approval_type ?? "execution_confirmation";

  const values = [
    id,
    input.user_id,
    input.agent_id,
    input.capability_id,
    input.requested_action,
    input.input_summary,
    input.input_hash ?? null,
    input.risk_level,
    JSON.stringify(input.scopes ?? []),
    input.resource_key ?? null,
    input.expires_at,
    tokenHash,
    input.tenant_id ?? "default",
    JSON.stringify({
      ...(input.metadata ?? {}),
      execution_id: input.execution_id ?? null,
      policy_id: input.policy_id ?? null,
      approval_type: approvalType,
    }),
    input.execution_id ?? null,
    input.policy_id ?? null,
    input.input_summary,
    approvalType,
  ];

  try {
    await pool.query(
      `
        INSERT INTO cap_approvals (
          id, user_id, agent_id, capability_id, requested_action, input_summary,
          input_hash, risk_level, scopes, resource_key, expires_at, status,
          approval_token_hash, tenant_id, metadata, execution_id, policy_id,
          safe_input_summary, approval_type
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,'pending',$12,$13,$14::jsonb,$15,$16,$17,$18)
      `,
      values,
    );
  } catch {
    // Pre-019 / pre-018 schema fallback
    try {
      await pool.query(
        `
          INSERT INTO cap_approvals (
            id, user_id, agent_id, capability_id, requested_action, input_summary,
            input_hash, risk_level, scopes, resource_key, expires_at, status,
            approval_token_hash, tenant_id, metadata, execution_id, policy_id,
            safe_input_summary
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,'pending',$12,$13,$14::jsonb,$15,$16,$17)
        `,
        values.slice(0, 17),
      );
    } catch {
      await pool.query(
        `
          INSERT INTO cap_approvals (
            id, user_id, agent_id, capability_id, requested_action, input_summary,
            input_hash, risk_level, scopes, resource_key, expires_at, status,
            approval_token_hash, tenant_id, metadata
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,'pending',$12,$13,$14::jsonb)
        `,
        values.slice(0, 14),
      );
    }
  }

  const approval = await findApprovalById(id);
  if (!approval) {
    throw new Error("Failed to create approval");
  }
  return { approval, approval_token: token };
}

export async function findApprovalById(id: string): Promise<ApprovalRecord | null> {
  const result = await pool.query(`SELECT * FROM cap_approvals WHERE id = $1`, [id]);
  return result.rows[0] ? mapApprovalRow(result.rows[0]) : null;
}

export async function findApprovalByToken(token: string): Promise<ApprovalRecord | null> {
  const result = await pool.query(
    `SELECT * FROM cap_approvals WHERE approval_token_hash = $1`,
    [hashApprovalToken(token)],
  );
  return result.rows[0] ? mapApprovalRow(result.rows[0]) : null;
}

export async function listApprovals(input: {
  user_id?: string;
  agent_id?: string;
  status?: ApprovalStatus;
  approval_type?: ApprovalType;
  limit?: number;
}): Promise<ApprovalRecord[]> {
  const clauses: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (input.user_id) {
    clauses.push(`user_id = $${i++}`);
    values.push(input.user_id);
  }
  if (input.agent_id) {
    clauses.push(`agent_id = $${i++}`);
    values.push(input.agent_id);
  }
  if (input.status) {
    clauses.push(`status = $${i++}`);
    values.push(input.status);
  }
  if (input.approval_type) {
    clauses.push(`COALESCE(approval_type, 'execution_confirmation') = $${i++}`);
    values.push(input.approval_type);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  values.push(Math.min(input.limit ?? 50, 200));

  try {
    const result = await pool.query(
      `SELECT * FROM cap_approvals ${where} ORDER BY created_at DESC LIMIT $${i}`,
      values,
    );
    return result.rows.map(mapApprovalRow);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!input.approval_type || !/approval_type/i.test(message)) {
      throw err;
    }
    // Pre-019: approval_type column missing — list without type SQL filter
    const fallback = await listApprovals({
      user_id: input.user_id,
      agent_id: input.agent_id,
      status: input.status,
      limit: input.limit,
    });
    return fallback.filter((a) => a.approval_type === input.approval_type);
  }
}

export async function findReusableApproval(input: {
  user_id: string;
  agent_id: string;
  capability_id: string;
  resource_key?: string | null;
  scopes_key?: string | null;
  policy: string;
}): Promise<ApprovalRecord | null> {
  if (input.policy === "every_time" || input.policy === "none") {
    return null;
  }

  const clauses = [
    `user_id = $1`,
    `agent_id = $2`,
    `capability_id = $3`,
    `status = 'approved'`,
    `expires_at > NOW()`,
  ];
  const values: unknown[] = [input.user_id, input.agent_id, input.capability_id];
  let i = 4;

  if (input.policy === "once_per_resource" && input.resource_key) {
    clauses.push(`resource_key = $${i++}`);
    values.push(input.resource_key);
  }

  if (input.policy === "once_per_scope" && input.scopes_key) {
    clauses.push(`metadata->>'scopes_key' = $${i++}`);
    values.push(input.scopes_key);
  }

  if (input.policy === "once") {
    // any prior approved approval for this capability is enough
  }

  if (input.policy === "time_window") {
    // already filtered by expires_at > NOW()
  }

  const result = await pool.query(
    `
      SELECT * FROM cap_approvals
      WHERE ${clauses.join(" AND ")}
      ORDER BY approved_at DESC NULLS LAST
      LIMIT 1
    `,
    values,
  );
  return result.rows[0] ? mapApprovalRow(result.rows[0]) : null;
}

export async function decideApproval(input: {
  id: string;
  decision: "approved" | "rejected";
  decided_by: string;
}): Promise<ApprovalRecord | null> {
  const field = input.decision === "approved" ? "approved_at" : "rejected_at";
  await pool.query(
    `
      UPDATE cap_approvals
      SET status = $2, ${field} = NOW(), decided_by = $3, updated_at = NOW()
      WHERE id = $1 AND status = 'pending'
    `,
    [input.id, input.decision, input.decided_by],
  );
  return findApprovalById(input.id);
}

/** Mark an approved approval as consumed after successful resume execution. */
export async function consumeApproval(id: string): Promise<ApprovalRecord | null> {
  await pool.query(
    `
      UPDATE cap_approvals
      SET status = 'consumed', updated_at = NOW()
      WHERE id = $1 AND status = 'approved'
    `,
    [id],
  );
  return findApprovalById(id);
}

export async function expireStaleApprovals(): Promise<number> {
  const result = await pool.query(
    `
      UPDATE cap_approvals
      SET status = 'expired', updated_at = NOW()
      WHERE status = 'pending' AND expires_at < NOW()
    `,
  );
  return result.rowCount ?? 0;
}

export async function cancelApproval(id: string): Promise<ApprovalRecord | null> {
  await pool.query(
    `
      UPDATE cap_approvals
      SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'pending'
    `,
    [id],
  );
  return findApprovalById(id);
}

export async function createExecution(input: {
  agent_id: string;
  user_id?: string | null;
  capability_id: string;
  approval_id?: string | null;
  idempotency_key?: string | null;
  status?: ExecutionStatus;
  input_hash?: string | null;
  dry_run?: boolean;
  tenant_id?: string;
  metadata?: JsonObject;
  audit_chain_id?: string | null;
  provider_id?: string | null;
  connection_id?: string | null;
  safe_input?: JsonObject | null;
  policy_decision?: JsonObject | null;
  worker_type?: string | null;
}): Promise<ExecutionRecord> {
  const id = randomUUID();
  const status = input.status ?? "created";
  const meta = {
    ...(input.metadata ?? {}),
    audit_chain_id: input.audit_chain_id ?? null,
  };
  try {
    await pool.query(
      `
        INSERT INTO cap_executions (
          id, agent_id, user_id, capability_id, approval_id, idempotency_key,
          status, input_hash, dry_run, tenant_id, metadata,
          audit_chain_id, provider_id, connection_id, safe_input, policy_decision, worker_type
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15::jsonb,$16::jsonb,$17)
      `,
      [
        id,
        input.agent_id,
        input.user_id ?? null,
        input.capability_id,
        input.approval_id ?? null,
        input.idempotency_key ?? null,
        status,
        input.input_hash ?? null,
        input.dry_run ?? false,
        input.tenant_id ?? "default",
        JSON.stringify(meta),
        input.audit_chain_id ?? null,
        input.provider_id ?? null,
        input.connection_id ?? null,
        input.safe_input ? JSON.stringify(input.safe_input) : null,
        input.policy_decision ? JSON.stringify(input.policy_decision) : null,
        input.worker_type ?? null,
      ],
    );
  } catch {
    // Pre-018 / status-check fallback: map created -> pending
    const legacyStatus = status === "created" ? "pending" : status;
    await pool.query(
      `
        INSERT INTO cap_executions (
          id, agent_id, user_id, capability_id, approval_id, idempotency_key,
          status, input_hash, dry_run, tenant_id, metadata
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
      `,
      [
        id,
        input.agent_id,
        input.user_id ?? null,
        input.capability_id,
        input.approval_id ?? null,
        input.idempotency_key ?? null,
        legacyStatus === "denied" || legacyStatus === "reconnect_required" || legacyStatus === "policy_checking"
          ? "pending"
          : legacyStatus,
        input.input_hash ?? null,
        input.dry_run ?? false,
        input.tenant_id ?? "default",
        JSON.stringify(meta),
      ],
    );
  }
  const execution = await findExecutionById(id);
  if (!execution) {
    throw new Error("Failed to create execution");
  }
  return execution;
}

export async function findExecutionById(id: string): Promise<ExecutionRecord | null> {
  const result = await pool.query(`SELECT * FROM cap_executions WHERE id = $1`, [id]);
  return result.rows[0] ? mapExecutionRow(result.rows[0]) : null;
}

export async function findExecutionByIdempotency(input: {
  agent_id: string;
  capability_id: string;
  idempotency_key: string;
}): Promise<ExecutionRecord | null> {
  const result = await pool.query(
    `
      SELECT * FROM cap_executions
      WHERE agent_id = $1 AND capability_id = $2 AND idempotency_key = $3
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [input.agent_id, input.capability_id, input.idempotency_key],
  );
  return result.rows[0] ? mapExecutionRow(result.rows[0]) : null;
}

export async function updateExecution(
  id: string,
  patch: Partial<{
    status: ExecutionStatus;
    approval_id: string | null;
    result_hash: string | null;
    error_code: string | null;
    error_message: string | null;
    result_payload: JsonObject | null;
    finished_at: string | null;
    completed_at: string | null;
    metadata: JsonObject;
    policy_decision: JsonObject | null;
    worker_type: string | null;
    safe_input: JsonObject | null;
    sanitized_output: JsonObject | null;
    audit_chain_id: string | null;
    provider_id: string | null;
    connection_id: string | null;
    user_id: string | null;
  }>,
): Promise<ExecutionRecord | null> {
  const fields: string[] = ["updated_at = NOW()"];
  const values: unknown[] = [];
  let i = 1;

  if (patch.status !== undefined) {
    fields.push(`status = $${i++}`);
    values.push(patch.status);
  }
  if (patch.approval_id !== undefined) {
    fields.push(`approval_id = $${i++}`);
    values.push(patch.approval_id);
  }
  if (patch.result_hash !== undefined) {
    fields.push(`result_hash = $${i++}`);
    values.push(patch.result_hash);
  }
  if (patch.error_code !== undefined) {
    fields.push(`error_code = $${i++}`);
    values.push(patch.error_code);
  }
  if (patch.error_message !== undefined) {
    fields.push(`error_message = $${i++}`);
    values.push(patch.error_message);
  }
  if (patch.result_payload !== undefined) {
    fields.push(`result_payload = $${i++}::jsonb`);
    values.push(JSON.stringify(patch.result_payload));
  }
  if (patch.finished_at !== undefined) {
    fields.push(`finished_at = $${i++}`);
    values.push(patch.finished_at);
  }
  if (patch.completed_at !== undefined) {
    fields.push(`completed_at = $${i++}`);
    values.push(patch.completed_at);
  }
  if (patch.metadata !== undefined) {
    fields.push(`metadata = $${i++}::jsonb`);
    values.push(JSON.stringify(patch.metadata));
  }
  if (patch.policy_decision !== undefined) {
    fields.push(`policy_decision = $${i++}::jsonb`);
    values.push(patch.policy_decision ? JSON.stringify(patch.policy_decision) : null);
  }
  if (patch.worker_type !== undefined) {
    fields.push(`worker_type = $${i++}`);
    values.push(patch.worker_type);
  }
  if (patch.safe_input !== undefined) {
    fields.push(`safe_input = $${i++}::jsonb`);
    values.push(patch.safe_input ? JSON.stringify(patch.safe_input) : null);
  }
  if (patch.sanitized_output !== undefined) {
    fields.push(`sanitized_output = $${i++}::jsonb`);
    values.push(patch.sanitized_output ? JSON.stringify(patch.sanitized_output) : null);
  }
  if (patch.audit_chain_id !== undefined) {
    fields.push(`audit_chain_id = $${i++}`);
    values.push(patch.audit_chain_id);
  }
  if (patch.provider_id !== undefined) {
    fields.push(`provider_id = $${i++}`);
    values.push(patch.provider_id);
  }
  if (patch.connection_id !== undefined) {
    fields.push(`connection_id = $${i++}`);
    values.push(patch.connection_id);
  }
  if (patch.user_id !== undefined) {
    fields.push(`user_id = $${i++}`);
    values.push(patch.user_id);
  }

  values.push(id);
  try {
    await pool.query(`UPDATE cap_executions SET ${fields.join(", ")} WHERE id = $${i}`, values);
  } catch (error) {
    const needsLegacyStatus =
      patch.status === "denied" ||
      patch.status === "reconnect_required" ||
      patch.status === "created" ||
      patch.status === "policy_checking" ||
      patch.status === "approved";
    if (!needsLegacyStatus) throw error;

    const legacy =
      patch.status === "denied" || patch.status === "reconnect_required"
        ? "failed"
        : patch.status === "created" || patch.status === "policy_checking"
          ? "pending"
          : "running";

    await pool.query(
      `
        UPDATE cap_executions
        SET status = $1,
            updated_at = NOW(),
            error_code = COALESCE($2, error_code),
            error_message = COALESCE($3, error_message),
            finished_at = COALESCE($4, finished_at)
        WHERE id = $5
      `,
      [
        legacy,
        patch.error_code ?? null,
        patch.error_message ?? null,
        patch.finished_at ?? null,
        id,
      ],
    );
  }
  return findExecutionById(id);
}

export async function createWorkerRun(input: {
  execution_id: string;
  worker_type: string;
  status?: string;
  metadata?: JsonObject;
}): Promise<string> {
  const id = randomUUID();
  try {
    await pool.query(
      `
        INSERT INTO cap_worker_runs (id, execution_id, worker_type, status, metadata)
        VALUES ($1, $2, $3, $4, $5::jsonb)
      `,
      [
        id,
        input.execution_id,
        input.worker_type,
        input.status ?? "started",
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("cap_worker_runs") && !message.includes("does not exist")) {
      throw error;
    }
  }
  return id;
}

export async function finishWorkerRun(input: {
  id: string;
  status: "completed" | "failed" | "timeout" | "cancelled";
  error_code?: string | null;
  error_message?: string | null;
}): Promise<void> {
  try {
    await pool.query(
      `
        UPDATE cap_worker_runs
        SET status = $2, finished_at = NOW(), updated_at = NOW(),
            error_code = $3, error_message = $4
        WHERE id = $1
      `,
      [input.id, input.status, input.error_code ?? null, input.error_message ?? null],
    );
  } catch {
    // table may not exist pre-migration
  }
}

export async function listExecutions(input: {
  user_id?: string;
  agent_id?: string;
  status?: ExecutionStatus;
  limit?: number;
}): Promise<ExecutionRecord[]> {
  const clauses: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (input.user_id) {
    clauses.push(`user_id = $${i++}`);
    values.push(input.user_id);
  }
  if (input.agent_id) {
    clauses.push(`agent_id = $${i++}`);
    values.push(input.agent_id);
  }
  if (input.status) {
    clauses.push(`status = $${i++}`);
    values.push(input.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  values.push(Math.min(input.limit ?? 50, 200));
  const result = await pool.query(
    `SELECT * FROM cap_executions ${where} ORDER BY created_at DESC LIMIT $${i}`,
    values,
  );
  return result.rows.map(mapExecutionRow);
}

export async function listCapabilityPermissions(): Promise<CapabilityPermissionRecord[]> {
  const result = await pool.query(
    `
      SELECT * FROM cap_capability_permissions
      WHERE enabled = TRUE AND deleted_at IS NULL
      ORDER BY priority ASC, created_at ASC
    `,
  );
  return result.rows.map(mapPermissionRow);
}

export async function createCapabilityPermission(input: {
  agent_id?: string | null;
  capability_id?: string | null;
  capability_pattern?: string | null;
  provider_pattern?: string | null;
  effect: CapabilityPermissionRecord["effect"];
  max_risk_level?: string | null;
  require_approval?: boolean | null;
  rate_limit_per_minute?: number | null;
  spending_limit_cents?: number | null;
  priority?: number;
  tenant_id?: string;
  metadata?: JsonObject;
}): Promise<CapabilityPermissionRecord> {
  const id = randomUUID();
  await pool.query(
    `
      INSERT INTO cap_capability_permissions (
        id, agent_id, capability_id, capability_pattern, provider_pattern,
        effect, max_risk_level, require_approval, rate_limit_per_minute,
        spending_limit_cents, priority, tenant_id, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
    `,
    [
      id,
      input.agent_id ?? null,
      input.capability_id ?? null,
      input.capability_pattern ?? null,
      input.provider_pattern ?? null,
      input.effect,
      input.max_risk_level ?? null,
      input.require_approval ?? null,
      input.rate_limit_per_minute ?? null,
      input.spending_limit_cents ?? null,
      input.priority ?? 100,
      input.tenant_id ?? "default",
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  const result = await pool.query(`SELECT * FROM cap_capability_permissions WHERE id = $1`, [id]);
  return mapPermissionRow(result.rows[0]!);
}

export async function listAllCapabilityPermissions(limit = 100): Promise<CapabilityPermissionRecord[]> {
  const result = await pool.query(
    `
      SELECT * FROM cap_capability_permissions
      WHERE deleted_at IS NULL
      ORDER BY priority ASC, created_at DESC
      LIMIT $1
    `,
    [limit],
  );
  return result.rows.map(mapPermissionRow);
}

export async function incrementRateLimitBucket(input: {
  bucket_key: string;
  window_start: Date;
}): Promise<number> {
  const id = randomUUID();
  const result = await pool.query(
    `
      INSERT INTO cap_rate_limit_buckets (id, bucket_key, window_start, count)
      VALUES ($1, $2, $3, 1)
      ON CONFLICT (bucket_key, window_start)
      DO UPDATE SET count = cap_rate_limit_buckets.count + 1, updated_at = NOW()
      RETURNING count
    `,
    [id, input.bucket_key, input.window_start.toISOString()],
  );
  return Number(result.rows[0]?.count ?? 1);
}

export async function updateCapabilityGatewayFields(input: {
  id: string;
  execution_type?: string;
  approval_policy?: string;
  provider?: string | null;
  owner_user_id?: string | null;
}): Promise<void> {
  const fields: string[] = ["updated_at = NOW()"];
  const values: unknown[] = [];
  let i = 1;

  if (input.execution_type !== undefined) {
    fields.push(`execution_type = $${i++}`);
    values.push(input.execution_type);
  }
  if (input.approval_policy !== undefined) {
    fields.push(`approval_policy = $${i++}`);
    values.push(input.approval_policy);
  }
  if (input.provider !== undefined) {
    fields.push(`provider = $${i++}`);
    values.push(input.provider);
  }
  if (input.owner_user_id !== undefined) {
    fields.push(`owner_user_id = $${i++}`);
    values.push(input.owner_user_id);
  }

  values.push(input.id);
  await pool.query(`UPDATE cap_capabilities SET ${fields.join(", ")} WHERE id = $${i}`, values);
}
