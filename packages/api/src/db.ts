import postgres from "postgres";

let _sql: ReturnType<typeof postgres> | undefined;

export function getDb() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _sql = postgres(url);
  }
  return _sql;
}
