import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../db.js";

const MASKING_DOMAIN = process.env.MASKING_DOMAIN ?? "shadow.yourdomain.com";
const FREE_TIER_LIMIT = 3;

export async function maskingAddressRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get("/masking-addresses", async (req) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;
    const addresses = await sql`
      SELECT id, address, label, active, created_at
      FROM masking_addresses
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `;
    return { addresses };
  });

  app.post("/masking-addresses", async (req, reply) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;
    const body = z.object({ label: z.string().max(64).optional() }).parse(req.body);

    const [user] = await sql`SELECT plan FROM users WHERE id = ${userId}`;
    if (!user) return reply.status(401).send({ error: "user_not_found" });

    if (user.plan === "free") {
      const [{ count }] = await sql`
        SELECT COUNT(*)::int AS count FROM masking_addresses WHERE user_id = ${userId}
      `;
      if (count >= FREE_TIER_LIMIT) {
        return reply.status(402).send({ error: "free_tier_limit", limit: FREE_TIER_LIMIT });
      }
    }

    const slug = nanoid(8).toLowerCase();
    const address = `${slug}@${MASKING_DOMAIN}`;

    const [row] = await sql`
      INSERT INTO masking_addresses (user_id, address, label)
      VALUES (${userId}, ${address}, ${body.label ?? null})
      RETURNING id, address, label, active, created_at
    `;
    return reply.status(201).send(row);
  });

  app.patch<{ Params: { id: string } }>("/masking-addresses/:id", async (req, reply) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;
    const body = z
      .object({
        label: z.string().max(64).optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body);

    const updates: Record<string, unknown> = {};
    if (body.label !== undefined) updates["label"] = body.label;
    if (body.active !== undefined) updates["active"] = body.active;

    if (Object.keys(updates).length === 0) return reply.status(400).send({ error: "no_fields" });

    const [row] = await sql`
      UPDATE masking_addresses
      SET ${sql(updates)}
      WHERE id = ${req.params.id} AND user_id = ${userId}
      RETURNING id, address, label, active, created_at
    `;
    if (!row) return reply.status(404).send({ error: "not_found" });
    return row;
  });

  app.delete<{ Params: { id: string } }>("/masking-addresses/:id", async (req, reply) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;

    // Soft-delete: deactivate rather than remove (preserves email_log FK integrity)
    const [row] = await sql`
      UPDATE masking_addresses
      SET active = false
      WHERE id = ${req.params.id} AND user_id = ${userId}
      RETURNING id
    `;
    if (!row) return reply.status(404).send({ error: "not_found" });
    return reply.status(204).send();
  });
}
