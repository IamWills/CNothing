import { readFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";
import config from "../config";

export const pool = new Pool({
  connectionString: config.databaseUrl,
});

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

async function markMigrationApplied(name: string): Promise<void> {
  await pool.query("INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", [name]);
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
    await pool.query("BEGIN");
    try {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(sql);
      // eslint-disable-next-line no-await-in-loop
      await markMigrationApplied(file);
      // eslint-disable-next-line no-await-in-loop
      await pool.query("COMMIT");
    } catch (error) {
      // eslint-disable-next-line no-await-in-loop
      await pool.query("ROLLBACK");
      throw error;
    }
  }
}
