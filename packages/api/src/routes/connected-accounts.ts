import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db.js";
import { encrypt } from "../lib/crypto.js";
import { Redis } from "ioredis";
import { Queue } from "bullmq";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const analysisQueue = new Queue("email-analysis", { connection: redis });

const ImapConfigSchema = z.object({
  email_address: z.string().email(),
  imap_host: z.string().min(1),
  imap_port: z.number().int().min(1).max(65535).default(993),
  imap_tls: z.boolean().default(true),
  smtp_host: z.string().min(1),
  smtp_port: z.number().int().min(1).max(65535).default(587),
  // Password stored encrypted — never returned to client
  password: z.string().min(1),
});

export async function connectedAccountsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  // List connected accounts
  app.get("/connected-accounts", async (req) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;
    return sql`
      SELECT id, provider, email_address, status, last_synced_at, created_at
      FROM connected_accounts
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `;
  });

  // Add IMAP account
  app.post("/connected-accounts/imap", async (req, reply) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;
    const body = ImapConfigSchema.parse(req.body);

    const [existing] = await sql`
      SELECT id FROM connected_accounts
      WHERE user_id = ${userId} AND email_address = ${body.email_address}
    `;
    if (existing) {
      return reply.status(409).send({ error: "account_already_connected" });
    }

    const [row] = await sql`
      INSERT INTO connected_accounts
        (user_id, provider, email_address, access_token_enc,
         imap_host, imap_port, imap_tls, smtp_host, smtp_port)
      VALUES (
        ${userId}, 'imap', ${body.email_address}, ${encrypt(body.password)},
        ${body.imap_host}, ${body.imap_port}, ${body.imap_tls},
        ${body.smtp_host}, ${body.smtp_port}
      )
      RETURNING id, provider, email_address, status, created_at
    `;

    // Trigger initial analysis
    await analysisQueue.add(
      "analyze",
      { userId, connectedAccountId: row.id, provider: "imap" },
      { attempts: 3, backoff: { type: "exponential", delay: 5000 } }
    );

    return reply.status(201).send(row);
  });

  // Get a single connected account (no tokens returned)
  app.get<{ Params: { id: string } }>("/connected-accounts/:id", async (req, reply) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;
    const [row] = await sql`
      SELECT id, provider, email_address, status, last_synced_at, created_at,
             imap_host, imap_port, imap_tls, smtp_host, smtp_port
      FROM connected_accounts
      WHERE id = ${req.params.id} AND user_id = ${userId}
    `;
    if (!row) return reply.status(404).send({ error: "not_found" });
    return row;
  });

  // Remove connected account
  app.delete<{ Params: { id: string } }>("/connected-accounts/:id", async (req, reply) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;
    const [row] = await sql`
      DELETE FROM connected_accounts
      WHERE id = ${req.params.id} AND user_id = ${userId}
      RETURNING id
    `;
    if (!row) return reply.status(404).send({ error: "not_found" });
    return reply.status(204).send();
  });

  // Trigger batch email analysis for a connected account
  app.post<{ Params: { id: string } }>("/connected-accounts/:id/analyze", async (req, reply) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;

    const [account] = await sql`
      SELECT id, provider FROM connected_accounts
      WHERE id = ${req.params.id} AND user_id = ${userId} AND status = 'active'
    `;
    if (!account) return reply.status(404).send({ error: "not_found_or_inactive" });

    // Check for already-running job
    const [running] = await sql`
      SELECT id FROM email_analysis_jobs
      WHERE connected_account_id = ${req.params.id} AND status IN ('pending', 'running')
    `;
    if (running) {
      return reply.status(409).send({ error: "analysis_already_running", jobId: running.id });
    }

    const [job] = await sql`
      INSERT INTO email_analysis_jobs (user_id, connected_account_id)
      VALUES (${userId}, ${req.params.id})
      RETURNING id, status, created_at
    `;

    await analysisQueue.add(
      "analyze",
      { userId, connectedAccountId: account.id, provider: account.provider, jobId: job.id },
      { attempts: 3, backoff: { type: "exponential", delay: 5000 } }
    );

    return reply.status(202).send({ jobId: job.id, status: "pending" });
  });

  // Get analysis job status
  app.get<{ Params: { id: string } }>("/connected-accounts/:id/analysis", async (req, reply) => {
    const sql = getDb();
    const userId = (req.user as { sub: string }).sub;

    const [account] = await sql`
      SELECT id FROM connected_accounts WHERE id = ${req.params.id} AND user_id = ${userId}
    `;
    if (!account) return reply.status(404).send({ error: "not_found" });

    const jobs = await sql`
      SELECT id, status, emails_scanned, subscriptions_found, newsletters_found,
             error_message, started_at, completed_at, created_at
      FROM email_analysis_jobs
      WHERE connected_account_id = ${req.params.id}
      ORDER BY created_at DESC
      LIMIT 10
    `;
    return jobs;
  });
}
