import { Worker } from "bullmq";
import { Redis } from "ioredis";
import type { InboundEmailJob, SievedJob, DeliveryJob, EmailAnalysisJob } from "@shadow/shared";
import { QUEUE_NAMES } from "@shadow/shared";
import { processInbound } from "./workers/inbound.js";
import { processSieveL2 } from "./workers/sieve-l2.js";
import { processBrain } from "./workers/brain.js";
import { processDelivery } from "./workers/delivery.js";
import { processEmailAnalysis } from "./workers/email-analysis.js";

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) throw new Error("REDIS_URL is not set");

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY ?? "10", 10);

const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

// Second Redis client for direct commands (RPUSH/EXPIRE in delivery worker)
const redisClient = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

// ── Sieve Level 1 ─────────────────────────────────────────────────────────────
const inboundWorker = new Worker<InboundEmailJob>(
  QUEUE_NAMES.INBOUND,
  (job) => processInbound(job, connection),
  { connection, concurrency: CONCURRENCY }
);

inboundWorker.on("completed", (job) => {
  console.log(`[inbound] job ${job.id} completed`);
});
inboundWorker.on("failed", (job, err) => {
  console.error(`[inbound] job ${job?.id} failed:`, err.message);
});

// ── Sieve Level 2 ─────────────────────────────────────────────────────────────
const sieveL2Worker = new Worker<SievedJob>(
  QUEUE_NAMES.SIEVE,
  (job) => processSieveL2(job, connection),
  { connection, concurrency: CONCURRENCY }
);

sieveL2Worker.on("completed", (job) => {
  console.log(`[sieve-l2] job ${job.id} completed`);
});
sieveL2Worker.on("failed", (job, err) => {
  console.error(`[sieve-l2] job ${job?.id} failed:`, err.message);
});

// ── Brain (priority queue) ────────────────────────────────────────────────────
const brainWorker = new Worker<SievedJob>(
  QUEUE_NAMES.BRAIN,
  (job) => processBrain(job, connection),
  { connection, concurrency: CONCURRENCY }
);

brainWorker.on("completed", (job) => {
  console.log(`[brain] job ${job.id} completed`);
});
brainWorker.on("failed", (job, err) => {
  console.error(`[brain] job ${job?.id} failed:`, err.message);
});

// ── Brain Batch (newsletter / quarantine queue) ───────────────────────────────
const brainBatchWorker = new Worker<SievedJob>(
  QUEUE_NAMES.BRAIN_BATCH,
  (job) => processBrain(job, connection),
  {
    connection,
    concurrency: Math.max(1, Math.floor(CONCURRENCY / 2)),
  }
);

brainBatchWorker.on("completed", (job) => {
  console.log(`[brain-batch] job ${job.id} completed`);
});
brainBatchWorker.on("failed", (job, err) => {
  console.error(`[brain-batch] job ${job?.id} failed:`, err.message);
});

// ── Delivery Hub ──────────────────────────────────────────────────────────────
const deliveryWorker = new Worker<DeliveryJob>(
  QUEUE_NAMES.DELIVERY,
  (job) => processDelivery(job, redisClient),
  { connection, concurrency: CONCURRENCY }
);

deliveryWorker.on("completed", (job) => {
  console.log(`[delivery] job ${job.id} completed`);
});
deliveryWorker.on("failed", (job, err) => {
  console.error(`[delivery] job ${job?.id} failed:`, err.message);
});

// ── Email Analysis (onboarding batch scan) ───────────────────────────────────
const emailAnalysisWorker = new Worker<EmailAnalysisJob>(
  QUEUE_NAMES.EMAIL_ANALYSIS,
  (job) => processEmailAnalysis(job),
  { connection, concurrency: 3 }
);

emailAnalysisWorker.on("completed", (job) => {
  console.log(`[email-analysis] job ${job.id} completed`);
});
emailAnalysisWorker.on("failed", (job, err) => {
  console.error(`[email-analysis] job ${job?.id} failed:`, err.message);
});

console.log("[worker] All pipeline workers started:");
console.log("  • email:inbound    → Sieve L1");
console.log("  • email:sieve      → Sieve L2");
console.log("  • email:brain      → Brain (priority)");
console.log("  • email:brain:batch → Brain (batch)");
console.log("  • email:delivery   → Delivery Hub");
console.log("  • email-analysis   → Onboarding batch scan");

async function shutdown() {
  await Promise.all([
    inboundWorker.close(),
    sieveL2Worker.close(),
    brainWorker.close(),
    brainBatchWorker.close(),
    deliveryWorker.close(),
    emailAnalysisWorker.close(),
  ]);
  connection.disconnect();
  redisClient.disconnect();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
