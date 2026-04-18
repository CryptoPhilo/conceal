import type { FastifyInstance } from "fastify";
import { getDb } from "../db.js";

function computeThreatLevel(priorityScore: number | null): "critical" | "high" | "medium" | "low" {
  if (priorityScore === null || priorityScore === undefined) return "low";
  if (priorityScore >= 80) return "critical";
  if (priorityScore >= 60) return "high";
  if (priorityScore >= 40) return "medium";
  return "low";
}

function enrichRow(row: Record<string, unknown>) {
  return {
    ...row,
    threat_level: computeThreatLevel(row.priority_score as number | null),
  };
}

export async function emailLogRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  // GET /v1/email-log?limit=20&offset=0
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/email-log",
    async (req) => {
      const sql = getDb();
      const userId = (req.user as { sub: string }).sub;
      const limit = Math.min(parseInt(req.query.limit ?? "20", 10), 100);
      const offset = parseInt(req.query.offset ?? "0", 10);

      const rows = await sql`
        SELECT id, sender_hash, subject_hash, received_at, sieve_label,
               priority_score, summary, action_taken, delivered_at,
               recipient_type, recipient_confidence
        FROM email_log
        WHERE user_id = ${userId}
        ORDER BY received_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const [{ count }] = await sql<[{ count: number }]>`
        SELECT COUNT(*)::int AS count FROM email_log WHERE user_id = ${userId}
      `;

      return { items: rows.map(enrichRow), total: count, limit, offset };
    }
  );

  // GET /v1/email-log/:id
  app.get<{ Params: { id: string } }>("/email-log/:id", async (req, reply) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;

    const [row] = await sql`
      SELECT id, sender_hash, subject_hash, received_at, sieve_label,
             priority_score, summary, action_taken, delivered_at,
             recipient_type, recipient_confidence
      FROM email_log
      WHERE id = ${req.params.id} AND user_id = ${userId}
    `;

    if (!row) return reply.status(404).send({ error: "not_found" });
    return enrichRow(row as Record<string, unknown>);
  });
}
