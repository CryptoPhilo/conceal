import postgres from "postgres";

let _sql: ReturnType<typeof postgres> | undefined;

export function getDb() {
  if (!_sql) {
    const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.POSTGRES_URL_NON_POOLING;
    if (!url) throw new Error("DATABASE_URL is not set");
    const isPooler = url.includes("pooler.supabase.com") || url.includes("pgbouncer=true") || url.includes(":6543") || url.includes("-pooler.");
    _sql = postgres(url, { ssl: "prefer", prepare: !isPooler });
  }
  return _sql;
}
