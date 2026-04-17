import type { FastifyInstance } from "fastify";
import Redis from "ioredis";
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
}
