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

export async function loadUserRules(userId: string) {
  const sql = getDb();
  return sql<
    Array<{
      id: string;
      priority: number;
      rule_type: "regex" | "keyword" | "sender_domain" | "sieve_label";
      pattern: string;
      action: "drop" | "batch" | "priority" | "reply";
      reply_template: string | null;
    }>
  >`
    SELECT id, priority, rule_type, pattern, action, reply_template
    FROM filter_rules
    WHERE user_id = ${userId} AND active = true
    ORDER BY priority DESC, created_at ASC
  `;
}

export async function updateEmailLogSieve(
  senderHash: string,
  subjectHash: string,
  userId: string,
  sieveLabel: string | null,
  actionTaken: "drop" | "delivered" | "replied" | "batched" | "bounced"
) {
  const sql = getDb();
  await sql`
    UPDATE email_log
    SET sieve_label = ${sieveLabel}, action_taken = ${actionTaken}
    WHERE sender_hash = ${senderHash}
      AND subject_hash = ${subjectHash}
      AND user_id = ${userId}
      AND received_at >= now() - interval '10 minutes'
    LIMIT 1
  `;
}
