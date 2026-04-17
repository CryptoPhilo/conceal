import type { FastifyInstance } from "fastify";
import { getDb } from "../db.js";

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
               priority_score, summary, action_taken, delivered_at
        FROM email_log
        WHERE user_id = ${userId}
        ORDER BY received_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const [{ count }] = await sql<[{ count: number }]>`
        SELECT COUNT(*)::int AS count FROM email_log WHERE user_id = ${userId}
      `;

      return { items: rows, total: count, limit, offset };
    }
  );

  // GET /v1/email-log/:id
  app.get<{ Params: { id: string } }>("/email-log/:id", async (req, reply) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;

    const [row] = await sql`
      SELECT id, sender_hash, subject_hash, received_at, sieve_label,
             priority_score, summary, action_taken, delivered_at
      FROM email_log
      WHERE id = ${req.params.id} AND user_id = ${userId}
    `;

    if (!row) return reply.status(404).send({ error: "not_found" });
    return row;
  });
}
