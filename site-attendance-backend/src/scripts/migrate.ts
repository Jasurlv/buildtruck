import { readdir, readFile } from "node:fs/promises";
import pool from "../db/pool.js";

// Resolves to site-attendance-backend/migrations from both src/scripts and dist/scripts.
const migrationsDir = new URL("../../migrations/", import.meta.url);
// Arbitrary constant so concurrent deploys never apply migrations at the same time.
const MIGRATION_LOCK_ID = 7_202_611;

async function migrate(): Promise<void> {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const applied = new Set(
      (await client.query("SELECT filename FROM schema_migrations")).rows.map(
        (row: { filename: string }) => row.filename,
      ),
    );

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(new URL(file, migrationsDir), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`Applied ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed`, { cause: error });
      }
    }
    console.log("Database schema is up to date.");
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}

migrate()
  .catch((error: unknown) => {
    console.error("Unable to run migrations:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
