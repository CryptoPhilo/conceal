import type { FastifyInstance } from "fastify";
import { getDb } from "../db.js";

export async function internalRoutes(app: FastifyInstance) {
  // Called by the Lambda for fast address lookups (internal network only)
  app.get<{ Querystring: { addr: string } }>("/internal/masking-lookup", async (req, reply) => {
    const { addr } = req.query;
    if (!addr) return reply.status(400).send({ error: "addr_required" });

    const sql = getDb();
    const [row] = await sql`
      SELECT ma.id, ma.user_id, ma.address, ma.active, u.email AS real_email
      FROM masking_addresses ma
      JOIN users u ON u.id = ma.user_id
      WHERE ma.address = ${addr}
      LIMIT 1
    `;
    if (!row) return reply.status(404).send({ error: "not_found" });
    return row;
  });
}
