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

export async function updateEmailLogBrain(
  senderHash: string,
  subjectHash: string,
  userId: string,
  summary: string,
  priorityScore: number,
  actionTaken: "drop" | "delivered" | "replied" | "batched" | "bounced"
) {
  const sql = getDb();
  await sql`
    UPDATE email_log
    SET summary = ${summary},
        priority_score = ${priorityScore},
        action_taken = ${actionTaken}
    WHERE sender_hash = ${senderHash}
      AND subject_hash = ${subjectHash}
      AND user_id = ${userId}
      AND received_at >= now() - interval '10 minutes'
    LIMIT 1
  `;
}

export async function loadUserContextVectors(userId: string): Promise<string[]> {
  const sql = getDb();
  const rows = await sql<Array<{ content: string }>>`
    SELECT content
    FROM user_context_vectors
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 5
  `;
  return rows.map((r) => r.content);
}

export async function loadDeliveryDestinations(userId: string): Promise<
  Array<{
    id: string;
    type: string;
    configEnc: Record<string, unknown>;
  }>
> {
  const sql = getDb();
  const rows = await sql<
    Array<{ id: string; type: string; config_enc: Record<string, unknown> }>
  >`
    SELECT id, type, config_enc
    FROM delivery_destinations
    WHERE user_id = ${userId} AND active = true
  `;
  return rows.map((r) => ({ id: r.id, type: r.type, configEnc: r.config_enc }));
}

export async function loadUserEmail(userId: string): Promise<string | null> {
  const sql = getDb();
  const rows = await sql<Array<{ email: string }>>`
    SELECT email FROM users WHERE id = ${userId} LIMIT 1
  `;
  return rows[0]?.email ?? null;
}

export async function loadUserLocale(userId: string): Promise<string> {
  try {
    const sql = getDb();
    const rows = await sql<Array<{ preferred_language: string }>>`
      SELECT preferred_language FROM users WHERE id = ${userId} LIMIT 1
    `;
    return rows[0]?.preferred_language ?? "ko";
  } catch {
    return "ko";
  }
}

export async function markEmailDelivered(
  senderHash: string,
  subjectHash: string,
  userId: string
) {
  const sql = getDb();
  await sql`
    UPDATE email_log
    SET action_taken = 'delivered', delivered_at = now()
    WHERE sender_hash = ${senderHash}
      AND subject_hash = ${subjectHash}
      AND user_id = ${userId}
      AND received_at >= now() - interval '10 minutes'
    LIMIT 1
  `;
}
