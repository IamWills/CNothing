import { randomUUID } from "node:crypto";
import { pool } from "../db";
import type { JsonObject } from "../v2/v2.entity";

export type UserDeviceRecord = {
  id: string;
  user_id: string;
  platform: string;
  device_name: string;
  push_token: string | null;
  push_environment: string;
  status: "active" | "revoked";
  last_seen_at: string | null;
  metadata: JsonObject;
  created_at: string;
};

function asIso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function mapDeviceRow(row: Record<string, unknown>): UserDeviceRecord {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    platform: String(row.platform),
    device_name: String(row.device_name ?? ""),
    push_token: row.push_token ? String(row.push_token) : null,
    push_environment: String(row.push_environment ?? "production"),
    status: String(row.status) as UserDeviceRecord["status"],
    last_seen_at: row.last_seen_at ? asIso(row.last_seen_at) : null,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as JsonObject)
        : {},
    created_at: asIso(row.created_at),
  };
}

export async function createPairingCode(input: {
  user_id: string;
  code_hash: string;
  ttl_seconds: number;
}): Promise<{ id: string; expires_at: string }> {
  const id = randomUUID();
  const result = await pool.query(
    `
      INSERT INTO device_pairing_codes (id, user_id, code_hash, expires_at)
      VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::interval)
      RETURNING id, expires_at
    `,
    [id, input.user_id, input.code_hash, String(input.ttl_seconds)],
  );
  return { id, expires_at: asIso(result.rows[0].expires_at) };
}

export async function consumePairingCode(input: {
  code_hash: string;
  device_id: string;
}): Promise<{ user_id: string } | null> {
  const result = await pool.query(
    `
      UPDATE device_pairing_codes
      SET consumed_at = NOW(), device_id = $2
      WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()
      RETURNING user_id
    `,
    [input.code_hash, input.device_id],
  );
  const row = result.rows[0];
  return row ? { user_id: String(row.user_id) } : null;
}

export async function createUserDevice(input: {
  id: string;
  user_id: string;
  platform: string;
  device_name: string;
  metadata?: JsonObject;
}): Promise<UserDeviceRecord> {
  const result = await pool.query(
    `
      INSERT INTO user_devices (id, user_id, platform, device_name, metadata)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      RETURNING *
    `,
    [input.id, input.user_id, input.platform, input.device_name, JSON.stringify(input.metadata ?? {})],
  );
  return mapDeviceRow(result.rows[0]);
}

export async function updateDevicePushToken(input: {
  device_id: string;
  user_id: string;
  push_token: string;
  push_environment: string;
}): Promise<UserDeviceRecord | null> {
  const result = await pool.query(
    `
      UPDATE user_devices
      SET push_token = $3, push_environment = $4, last_seen_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND user_id = $2 AND status = 'active'
      RETURNING *
    `,
    [input.device_id, input.user_id, input.push_token, input.push_environment],
  );
  const row = result.rows[0];
  return row ? mapDeviceRow(row) : null;
}

export async function touchDevice(deviceId: string): Promise<void> {
  await pool.query(`UPDATE user_devices SET last_seen_at = NOW(), updated_at = NOW() WHERE id = $1`, [
    deviceId,
  ]);
}

export async function listUserDevices(userId: string): Promise<UserDeviceRecord[]> {
  const result = await pool.query(
    `SELECT * FROM user_devices WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows.map(mapDeviceRow);
}

export async function listActivePushDevices(userId: string): Promise<UserDeviceRecord[]> {
  const result = await pool.query(
    `
      SELECT * FROM user_devices
      WHERE user_id = $1 AND status = 'active' AND push_token IS NOT NULL
      ORDER BY created_at DESC
    `,
    [userId],
  );
  return result.rows.map(mapDeviceRow);
}

export async function revokeUserDevice(input: {
  device_id: string;
  user_id: string;
}): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE user_devices
      SET status = 'revoked', push_token = NULL, updated_at = NOW()
      WHERE id = $1 AND user_id = $2 AND status = 'active'
      RETURNING id
    `,
    [input.device_id, input.user_id],
  );
  return Boolean(result.rows[0]);
}
