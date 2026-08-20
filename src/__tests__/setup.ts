/**
 * Preloaded before any test module (see bunfig.toml).
 *
 * Integration tests run against a dedicated database so they can never touch a
 * development or production one. When Postgres is unreachable the DB-backed
 * suites are skipped instead of failing, unless CNOTHING_REQUIRE_DB_TESTS=1
 * (set in CI) makes a missing database a hard error.
 */
import { Pool } from "pg";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL?.trim() || "postgresql://127.0.0.1:5432/cnothing_test";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.KEYSERVICE_MASTER_KEY ??= Buffer.alloc(32, 7).toString("base64url");
process.env.KEYSERVICE_BEARER_TOKEN ??= "test-admin-token";
process.env.KEYSERVICE_PUBLIC_URL ??= "http://127.0.0.1:3021";
process.env.KEYSERVICE_CONSOLE_URL ??= "http://127.0.0.1:3000";

async function ensureTestDatabase(): Promise<void> {
  const databaseName = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, "");
  if (!databaseName) {
    throw new Error("TEST_DATABASE_URL must include a database name");
  }

  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = "/postgres";
  const admin = new Pool({
    connectionString: adminUrl.toString(),
    connectionTimeoutMillis: 3_000,
  });

  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      databaseName,
    ]);
    if (existing.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${databaseName.replace(/"/g, '""')}"`);
    }
  } finally {
    await admin.end().catch(() => undefined);
  }
}

let ready = false;
try {
  await ensureTestDatabase();
  const { initDb } = await import("../db");
  await initDb();
  ready = true;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (process.env.CNOTHING_REQUIRE_DB_TESTS === "1") {
    throw new Error(`Test database is required but unavailable: ${message}`);
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[cnothing-tests] Postgres unavailable (${message}). Skipping database-backed suites.`,
  );
}

(globalThis as unknown as { __CNOTHING_TEST_DB_READY__?: boolean }).__CNOTHING_TEST_DB_READY__ =
  ready;
