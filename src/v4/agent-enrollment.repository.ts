import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../db";
import type { JsonObject } from "./platform.entity";

export type AgentEnrollmentStatus = "pending" | "approved" | "denied" | "expired";

export type AgentEnrollmentRecord = {
  id: string;
  client_name: string;
  client_uri: string | null;
  software_id: string | null;
  user_code: string;
  enrollment_secret_hash: string;
  status: AgentEnrollmentStatus;
  owner_user_id: string | null;
  agent_id: string | null;
  access_token_encrypted: Buffer | null;
  issued_ip: string | null;
  expires_at: string;
  approved_at: string | null;
  denied_at: string | null;
  claimed_at: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

type Queryable = Pick<typeof pool, "query"> | PoolClient;

function asIso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function mapRow(row: Record<string, unknown>): AgentEnrollmentRecord {
  return {
    id: String(row.id),
    client_name: String(row.client_name),
    client_uri: row.client_uri ? String(row.client_uri) : null,
    software_id: row.software_id ? String(row.software_id) : null,
    user_code: String(row.user_code),
    enrollment_secret_hash: String(row.enrollment_secret_hash),
    status: String(row.status) as AgentEnrollmentStatus,
    owner_user_id: row.owner_user_id ? String(row.owner_user_id) : null,
    agent_id: row.agent_id ? String(row.agent_id) : null,
    access_token_encrypted: row.access_token_encrypted
      ? Buffer.from(row.access_token_encrypted as Buffer)
      : null,
    issued_ip: row.issued_ip ? String(row.issued_ip) : null,
    expires_at: asIso(row.expires_at),
    approved_at: row.approved_at ? asIso(row.approved_at) : null,
    denied_at: row.denied_at ? asIso(row.denied_at) : null,
    claimed_at: row.claimed_at ? asIso(row.claimed_at) : null,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as JsonObject)
        : {},
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

export async function insertAgentEnrollment(input: {
  client_name: string;
  client_uri?: string;
  software_id?: string;
  user_code: string;
  enrollment_secret_hash: string;
  issued_ip?: string;
  ttl_seconds: number;
  metadata?: JsonObject;
}): Promise<AgentEnrollmentRecord> {
  const result = await pool.query(
    `INSERT INTO cap_agent_enrollments
       (id, client_name, client_uri, software_id, user_code, enrollment_secret_hash,
        issued_ip, expires_at, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + ($8 || ' seconds')::interval, $9::jsonb)
     RETURNING *`,
    [
      randomUUID(),
      input.client_name,
      input.client_uri ?? null,
      input.software_id ?? null,
      input.user_code,
      input.enrollment_secret_hash,
      input.issued_ip ?? null,
      String(input.ttl_seconds),
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return mapRow(result.rows[0]);
}

export async function findAgentEnrollmentById(
  id: string,
  client?: Queryable,
): Promise<AgentEnrollmentRecord | null> {
  const db = client ?? pool;
  const result = await db.query(`SELECT * FROM cap_agent_enrollments WHERE id = $1`, [id]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function findAgentEnrollmentBySecretHash(
  secretHash: string,
): Promise<AgentEnrollmentRecord | null> {
  const result = await pool.query(
    `SELECT * FROM cap_agent_enrollments WHERE enrollment_secret_hash = $1`,
    [secretHash],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function countRecentEnrollmentsByIp(input: {
  issued_ip: string;
  window_seconds: number;
}): Promise<{ total: number; pending: number }> {
  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'pending' AND expires_at > NOW())::int AS pending
     FROM cap_agent_enrollments
     WHERE issued_ip = $1 AND created_at > NOW() - ($2 || ' seconds')::interval`,
    [input.issued_ip, String(input.window_seconds)],
  );
  return {
    total: Number(result.rows[0]?.total ?? 0),
    pending: Number(result.rows[0]?.pending ?? 0),
  };
}

export async function lockAgentEnrollment(
  client: PoolClient,
  id: string,
): Promise<AgentEnrollmentRecord | null> {
  const result = await client.query(
    `SELECT * FROM cap_agent_enrollments WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function markEnrollmentApproved(
  client: PoolClient,
  input: {
    id: string;
    owner_user_id: string;
    agent_id: string;
    access_token_encrypted: Buffer;
  },
): Promise<AgentEnrollmentRecord> {
  const result = await client.query(
    `UPDATE cap_agent_enrollments
     SET status = 'approved',
         owner_user_id = $2,
         agent_id = $3,
         access_token_encrypted = $4,
         approved_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [input.id, input.owner_user_id, input.agent_id, input.access_token_encrypted],
  );
  return mapRow(result.rows[0]);
}

export async function markEnrollmentDenied(
  client: PoolClient,
  id: string,
  ownerUserId: string,
): Promise<AgentEnrollmentRecord> {
  const result = await client.query(
    `UPDATE cap_agent_enrollments
     SET status = 'denied',
         owner_user_id = $2,
         denied_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, ownerUserId],
  );
  return mapRow(result.rows[0]);
}

export async function markEnrollmentExpired(
  client: PoolClient,
  id: string,
): Promise<AgentEnrollmentRecord> {
  const result = await client.query(
    `UPDATE cap_agent_enrollments
     SET status = 'expired', updated_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [id],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : await findAgentEnrollmentById(id, client) as AgentEnrollmentRecord;
}

export async function claimEnrollmentToken(
  client: PoolClient,
  id: string,
): Promise<AgentEnrollmentRecord> {
  const result = await client.query(
    `UPDATE cap_agent_enrollments
     SET claimed_at = NOW(),
         access_token_encrypted = NULL,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id],
  );
  return mapRow(result.rows[0]);
}
