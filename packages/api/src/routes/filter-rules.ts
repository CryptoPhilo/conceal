import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db.js";

const RuleTypeSchema = z.enum(["regex", "keyword", "sender_domain", "sieve_label"]);
const ActionSchema = z.enum(["drop", "batch", "priority", "reply"]);

const CreateRuleSchema = z.object({
  ruleType: RuleTypeSchema,
  pattern: z.string().min(1).max(500),
  action: ActionSchema,
  priority: z.number().int().min(0).max(1000).default(0),
  replyTemplate: z.string().max(2000).optional().nullable(),
});

const UpdateRuleSchema = z.object({
  pattern: z.string().min(1).max(500).optional(),
  action: ActionSchema.optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  replyTemplate: z.string().max(2000).optional().nullable(),
  active: z.boolean().optional(),
});

const ReorderSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});

export async function filterRulesRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get("/filter-rules", async (req) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;
    return sql`
      SELECT id, rule_type, pattern, action, priority, reply_template, active, created_at
      FROM filter_rules
      WHERE user_id = ${userId}
      ORDER BY priority DESC, created_at ASC
    `;
  });

  app.post("/filter-rules", async (req, reply) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;
    const body = CreateRuleSchema.parse(req.body);

    if (body.action === "reply" && !body.replyTemplate) {
      return reply.status(400).send({ error: "reply_template_required_for_reply_action" });
    }

    const [row] = await sql`
      INSERT INTO filter_rules (user_id, rule_type, pattern, action, priority, reply_template)
      VALUES (
        ${userId},
        ${body.ruleType},
        ${body.pattern},
        ${body.action},
        ${body.priority},
        ${body.replyTemplate ?? null}
      )
      RETURNING id, rule_type, pattern, action, priority, reply_template, active, created_at
    `;
    return reply.status(201).send(row);
  });

  app.patch<{ Params: { id: string } }>("/filter-rules/:id", async (req, reply) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;
    const body = UpdateRuleSchema.parse(req.body);

    const updates: Record<string, unknown> = {};
    if (body.pattern !== undefined) updates["pattern"] = body.pattern;
    if (body.action !== undefined) updates["action"] = body.action;
    if (body.priority !== undefined) updates["priority"] = body.priority;
    if (body.replyTemplate !== undefined) updates["reply_template"] = body.replyTemplate;
    if (body.active !== undefined) updates["active"] = body.active;

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: "no_fields" });
    }

    const [row] = await sql`
      UPDATE filter_rules
      SET ${sql(updates)}
      WHERE id = ${req.params.id} AND user_id = ${userId}
      RETURNING id, rule_type, pattern, action, priority, reply_template, active, created_at
    `;
    if (!row) return reply.status(404).send({ error: "not_found" });
    return row;
  });

  app.delete<{ Params: { id: string } }>("/filter-rules/:id", async (req, reply) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;

    const [row] = await sql`
      DELETE FROM filter_rules
      WHERE id = ${req.params.id} AND user_id = ${userId}
      RETURNING id
    `;
    if (!row) return reply.status(404).send({ error: "not_found" });
    return reply.status(204).send();
  });

  // Bulk reorder — assigns sequential priority values starting from length → 1
  app.post("/filter-rules/reorder", async (req, reply) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;
    const { orderedIds } = ReorderSchema.parse(req.body);

    await sql.begin(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        const priority = orderedIds.length - i;
        await tx`
          UPDATE filter_rules
          SET priority = ${priority}
          WHERE id = ${orderedIds[i]} AND user_id = ${userId}
        `;
      }
    });

    return reply.status(200).send({ reordered: orderedIds.length });
  });
}
