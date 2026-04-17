import postgres from "postgres";

let _sql: ReturnType<typeof postgres> | undefined;

export function getDb() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _sql = postgres(url, { max: 5 });
  }
  return _sql;
}

export interface MaskingRow {
  id: string;
  user_id: string;
  address: string;
  active: boolean;
}

export async function lookupMasking(maskingAddress: string): Promise<MaskingRow | null> {
  const sql = getDb();
  const rows = await sql<MaskingRow[]>`
    SELECT id, user_id, address, active
    FROM masking_addresses
    WHERE address = ${maskingAddress}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getUserEmail(userId: string): Promise<string | null> {
  const sql = getDb();
  const rows = await sql<{ email: string }[]>`
    SELECT email FROM users WHERE id = ${userId} LIMIT 1
  `;
  return rows[0]?.email ?? null;
}

export async function insertEmailLog(entry: {
  userId: string;
  maskingAddressId: string;
  senderHash: string;
  subjectHash: string;
  receivedAt: Date;
  actionTaken: string;
}) {
  const sql = getDb();
  await sql`
    INSERT INTO email_log
      (user_id, masking_address_id, sender_hash, subject_hash, received_at, action_taken)
    VALUES
      (${entry.userId}, ${entry.maskingAddressId}, ${entry.senderHash},
       ${entry.subjectHash}, ${entry.receivedAt}, ${entry.actionTaken})
  `;
}
