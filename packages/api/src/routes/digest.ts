import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { getDb } from "../db.js";

let _redis: Redis | undefined;

function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is not set");
    _redis = new Redis(url, { maxRetriesPerRequest: null });
  }
  return _redis;
}

export async function digestRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  // GET /v1/digest/today — reads digest:{userId} list from Redis
  app.get("/digest/today", async (req) => {
    const userId = (req.user as { sub: string }).sub;
    const redis = getRedis();
    const key = `digest:${userId}`;
    const raw = await redis.lrange(key, 0, -1);
    const summaries = raw.map((item) => {
      try {
        return JSON.parse(item) as { summary: string; ts: number };
      } catch {
        return { summary: item, ts: 0 };
      }
    });
    return { items: summaries, count: summaries.length };
  });

  // GET /v1/dashboard/summary — counts from email_log for last 7 days
  app.get("/dashboard/summary", async (req) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;

    const rows = await sql<Array<{ action_taken: string; count: number }>>`
      SELECT action_taken, COUNT(*)::int AS count
      FROM email_log
      WHERE user_id = ${userId}
        AND received_at >= now() - interval '7 days'
      GROUP BY action_taken
    `;

    const counts: Record<string, number> = {
      total: 0,
      delivered: 0,
      dropped: 0,
      batched: 0,
      replied: 0,
      bounced: 0,
    };

    for (const row of rows) {
      counts[row.action_taken] = row.count;
      counts["total"] += row.count;
    }

    return { period: "7d", counts };
  });

  // GET /v1/dashboard/grouped — three group views for the last 7 days
  app.get("/dashboard/grouped", async (req) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;

    const [workTypeRows, senderRows, urgentRows] = await Promise.all([
      // Work-type distribution (each email may appear in multiple work types)
      sql<Array<{ work_type: string; count: number }>>`
        SELECT unnest(work_types) AS work_type, COUNT(*)::int AS count
        FROM email_log
        WHERE user_id = ${userId}
          AND received_at >= now() - interval '7 days'
          AND cardinality(work_types) > 0
        GROUP BY work_type
        ORDER BY count DESC
      `,
      // Top 20 sender domains by volume
      sql<Array<{ sender_domain: string; count: number; labels: string[]; work_types: string[] }>>`
        SELECT
          sender_domain,
          COUNT(*)::int AS count,
          array_agg(DISTINCT sieve_label) FILTER (WHERE sieve_label IS NOT NULL) AS labels,
          (SELECT array_agg(DISTINCT wt) FROM unnest(array_agg(work_types)) AS sub(arr), unnest(sub.arr) AS wt) AS work_types
        FROM email_log
        WHERE user_id = ${userId}
          AND received_at >= now() - interval '7 days'
          AND sender_domain IS NOT NULL
        GROUP BY sender_domain
        ORDER BY count DESC
        LIMIT 20
      `,
      // Urgent emails: only LLM-verified urgent (prevents keyword spoofing)
      sql<Array<{ sender_domain: string | null; summary: string | null; priority_score: number | null; received_at: string; sieve_label: string | null }>>`
        SELECT sender_domain, summary, priority_score, received_at, sieve_label
        FROM email_log
        WHERE user_id = ${userId}
          AND received_at >= now() - interval '7 days'
          AND urgent_verified = true
        ORDER BY priority_score DESC NULLS LAST, received_at DESC
        LIMIT 20
      `,
    ]);

    return {
      period: "7d",
      workTypes: workTypeRows.map((r) => ({ workType: r.work_type, count: r.count })),
      topSenders: senderRows.map((r) => ({
        senderDomain: r.sender_domain,
        count: r.count,
        labels: r.labels ?? [],
        topWorkTypes: r.work_types ?? [],
      })),
      urgent: {
        count: urgentRows.length,
        emails: urgentRows,
      },
    };
  });
}
