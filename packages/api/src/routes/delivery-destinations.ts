import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db.js";

const ALLOWED_TYPES = ["slack", "notion", "todoist", "email_digest"] as const;

const CreateSchema = z.object({
  type: z.enum(ALLOWED_TYPES),
  config: z.record(z.unknown()),
});

const UpdateSchema = z.object({
  active: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});

export async function deliveryDestinationsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  // GET /v1/delivery-destinations — list active destinations (mask configEnc)
  app.get("/delivery-destinations", async (req) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;

    const rows = await sql<
      Array<{ id: string; type: string; active: boolean; created_at: Date }>
    >`
      SELECT id, type, active, created_at
      FROM delivery_destinations
      WHERE user_id = ${userId} AND active = true
      ORDER BY created_at DESC
    `;
    return rows;
  });

  // POST /v1/delivery-destinations — create
  app.post("/delivery-destinations", async (req, reply) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;
    const body = CreateSchema.parse(req.body);

    const [row] = await sql<
      Array<{ id: string; type: string; active: boolean; created_at: Date }>
    >`
      INSERT INTO delivery_destinations (user_id, type, config_enc)
      VALUES (${userId}, ${body.type}, ${sql.json(body.config as Record<string, string>)})
      RETURNING id, type, active, created_at
    `;
    return reply.status(201).send(row);
  });

  // PATCH /v1/delivery-destinations/:id — update active/config
  app.patch<{ Params: { id: string } }>(
    "/delivery-destinations/:id",
    async (req, reply) => {
      const sql = getDb();
      const userId = (req.user as { sub: string }).sub;
      const body = UpdateSchema.parse(req.body);

      const updates: Record<string, unknown> = {};
      if (body.active !== undefined) updates["active"] = body.active;
      if (body.config !== undefined) updates["config_enc"] = sql.json(body.config as Record<string, string>);

      if (Object.keys(updates).length === 0) {
        return reply.status(400).send({ error: "no_fields" });
      }

      const [row] = await sql<
        Array<{ id: string; type: string; active: boolean; created_at: Date }>
      >`
        UPDATE delivery_destinations
        SET ${sql(updates)}
        WHERE id = ${req.params.id} AND user_id = ${userId}
        RETURNING id, type, active, created_at
      `;
      if (!row) return reply.status(404).send({ error: "not_found" });
      return row;
    }
  );

  // DELETE /v1/delivery-destinations/:id
  app.delete<{ Params: { id: string } }>(
    "/delivery-destinations/:id",
    async (req, reply) => {
      const sql = getDb();
      const userId = (req.user as { sub: string }).sub;

      const [row] = await sql`
        DELETE FROM delivery_destinations
        WHERE id = ${req.params.id} AND user_id = ${userId}
        RETURNING id
      `;
      if (!row) return reply.status(404).send({ error: "not_found" });
      return reply.status(204).send();
    }
  );

  // POST /v1/delivery-destinations/:id/test — push a test entry
  app.post<{ Params: { id: string } }>(
    "/delivery-destinations/:id/test",
    async (req, reply) => {
      const sql = getDb();
      const userId = (req.user as { sub: string }).sub;

      const [dest] = await sql<
        Array<{ id: string; type: string; config_enc: Record<string, unknown> }>
      >`
        SELECT id, type, config_enc
        FROM delivery_destinations
        WHERE id = ${req.params.id} AND user_id = ${userId}
      `;

      if (!dest) return reply.status(404).send({ error: "not_found" });

      const summary = "🔔 Test delivery from Shadow Email";
      const priorityScore = 42;

      try {
        if (dest.type === "slack") {
          const cfg = dest.config_enc as { webhookUrl?: string };
          if (cfg.webhookUrl) {
            await fetch(cfg.webhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: `📧 ${summary}\nPriority: ${priorityScore}/100`,
                username: "Shadow Email",
              }),
              signal: AbortSignal.timeout(10_000),
            });
          }
        } else if (dest.type === "notion") {
          const cfg = dest.config_enc as { token?: string; databaseId?: string };
          if (cfg.token && cfg.databaseId) {
            await fetch("https://api.notion.com/v1/pages", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${cfg.token}`,
                "Content-Type": "application/json",
                "Notion-Version": "2022-06-28",
              },
              body: JSON.stringify({
                parent: { database_id: cfg.databaseId },
                properties: {
                  title: {
                    title: [{ type: "text", text: { content: summary } }],
                  },
                  Priority: { number: priorityScore },
                },
              }),
              signal: AbortSignal.timeout(10_000),
            });
          }
        }
        // email_digest / todoist: no-op for now — just return success
      } catch (err) {
        return reply.status(502).send({ error: "test_delivery_failed", detail: String(err) });
      }

      return { ok: true, type: dest.type };
    }
  );
}
