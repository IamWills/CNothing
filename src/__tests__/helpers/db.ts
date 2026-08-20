import { describe } from "bun:test";
import { pool } from "../../db";

export const testDatabaseReady = Boolean(
  (globalThis as unknown as { __CNOTHING_TEST_DB_READY__?: boolean }).__CNOTHING_TEST_DB_READY__,
);

/** Skips the suite instead of failing when no Postgres is available locally. */
export const describeWithDb = testDatabaseReady ? describe : describe.skip;

const MUTABLE_TABLES = [
  "proxy_request_audit",
  "proxy_transactions",
  "proxy_grants",
  "proxy_access_requests",
  "device_approval_challenges",
  "device_pairing_codes",
  "user_devices",
  "user_share_codes",
  "cap_oauth_connect_states",
  "cap_oauth_connections",
  "cap_oauth_audit",
  "cap_oauth_providers",
  "cap_secret_vault",
  "vault_audit",
  "cap_agents",
  "cap_user_sessions",
  "cap_user_identities",
  "cap_oidc_states",
  "cap_oidc_providers",
  "cap_oauth2_states",
  "cap_system_state",
];

export async function resetDatabase(): Promise<void> {
  if (!testDatabaseReady) return;
  await pool.query(`TRUNCATE ${MUTABLE_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

/**
 * Concurrency tests are meaningless against a cold pool: the first caller wins
 * simply because every other caller has to pay for a TCP connect first. Warming
 * idle clients up front makes parallel requests actually interleave.
 */
export async function warmConnectionPool(clients = 4): Promise<void> {
  if (!testDatabaseReady) return;
  await Promise.all(Array.from({ length: clients }, () => pool.query("SELECT 1")));
}
