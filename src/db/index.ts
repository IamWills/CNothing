import { readFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Pool, type PoolClient } from "pg";
import config from "../config";

export const pool = new Pool({
  connectionString: config.databaseUrl,
});

/**
 * Runs `handler` inside a real transaction. Issuing BEGIN/COMMIT through the
 * pool is unsafe because each pool.query() may land on a different connection,
 * so every statement must share one checked-out client.
 */
export async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function hasMigrationBeenApplied(name: string): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
  return (result.rowCount ?? 0) > 0;
}

export async function initDb(): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const migrationsDir = path.join(__dirname, "..", "..", "migrations");

  let files: string[] = [];
  try {
    files = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
  } catch {
    return;
  }

  await ensureMigrationsTable();

  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    const applied = await hasMigrationBeenApplied(file);
    if (applied) {
      // eslint-disable-next-line no-console
      console.log(`Skipping already applied migration: ${file}`);
      // eslint-disable-next-line no-continue
      continue;
    }

    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    // eslint-disable-next-line no-console
    console.log(`Applying migration: ${file}`);
    // eslint-disable-next-line no-await-in-loop
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", [
        file,
      ]);
    });
  }
}
