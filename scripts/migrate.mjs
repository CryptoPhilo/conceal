#!/usr/bin/env node
// Applies all SQL migration files in supabase/migrations/ to the target database.
// Tracks applied migrations in a _migrations table for idempotency.
import postgres from "postgres";
import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const isPooler =
  url.includes("pooler.supabase.com") ||
  url.includes("pgbouncer=true") ||
  url.includes(":6543") ||
  url.includes("-pooler.");

const sql = postgres(url, { ssl: "prefer", prepare: !isPooler, max: 1 });

await sql`
  CREATE TABLE IF NOT EXISTS _migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

const applied = new Set(
  (await sql`SELECT filename FROM _migrations`).map((r) => r.filename)
);

const files = (await readdir(MIGRATIONS_DIR))
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const file of files) {
  if (applied.has(file)) {
    console.log(`  skip  ${file}`);
    continue;
  }
  const body = await readFile(join(MIGRATIONS_DIR, file), "utf8");
  console.log(`  apply ${file}`);
  await sql.unsafe(body);
  await sql`INSERT INTO _migrations (filename) VALUES (${file})`;
}

console.log("Migrations complete.");
await sql.end();
