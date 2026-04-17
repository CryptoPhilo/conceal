import { Worker } from "bullmq";
import Redis from "ioredis";
import type { InboundEmailJob } from "@shadow/shared";
import { QUEUE_NAMES } from "@shadow/shared";
import { processInbound } from "./workers/inbound.js";

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) throw new Error("REDIS_URL is not set");

const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

const inboundWorker = new Worker<InboundEmailJob>(
  QUEUE_NAMES.INBOUND,
  (job) => processInbound(job, connection),
  {
    connection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? "10", 10),
  }
);

inboundWorker.on("completed", (job) => {
  console.log(`[worker] job ${job.id} completed`);
});

inboundWorker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err.message);
});

console.log("[worker] Sieve Level 1 worker started");

async function shutdown() {
  await inboundWorker.close();
  connection.disconnect();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
