#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PgDatabase } from "./client.js";
import { loadEnv } from "../config/env.js";

/**
 * Minimal SQL migration runner. Applies `db/migrations/*.sql` in filename
 * order, tracking applied files in `schema_migrations`.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const db = new PgDatabase(env.DATABASE_URL);

  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const migrationsDir = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "db",
    "migrations",
  );
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

  const applied = new Set(
    (await db.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map(
      (r) => r.name,
    ),
  );

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`= ${file} (already applied)`);
      continue;
    }
    const sql = await readFile(join(migrationsDir, file), "utf8");
    await db.transaction(async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
    console.log(`+ ${file} applied`);
  }

  await db.close();
  console.log("Migrations complete.");
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});
