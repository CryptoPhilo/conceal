import type { Job, ConnectionOptions } from "bullmq";
import { Queue } from "bullmq";
import type { SievedJob } from "@shadow/shared";
import { QUEUE_NAMES } from "@shadow/shared";
import { updateEmailLogSieve } from "../db.js";

const SIEVE_SERVICE_URL = process.env.SIEVE_SERVICE_URL ?? "http://localhost:8000";

interface SieveServiceResponse {
  label: "urgent" | "newsletter" | "spam" | "normal";
  score: number;
  priority: boolean;
}

let _brainQueue: Queue | undefined;
let _batchQueue: Queue | undefined;

function getBrainQueue(connection: ConnectionOptions) {
  if (!_brainQueue) _brainQueue = new Queue(QUEUE_NAMES.BRAIN, { connection });
  return _brainQueue;
}

function getBatchQueue(connection: ConnectionOptions) {
  if (!_batchQueue) _batchQueue = new Queue(QUEUE_NAMES.BRAIN_BATCH, { connection });
  return _batchQueue;
}

async function callSieveService(
  subject: string,
  senderDomain: string,
  senderLocal: string
): Promise<SieveServiceResponse> {
  try {
    const res = await fetch(`${SIEVE_SERVICE_URL}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject,
        sender_domain: senderDomain,
        sender_local: senderLocal,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error(`sieve-service returned ${res.status}`);
    }
    return (await res.json()) as SieveServiceResponse;
  } catch (err) {
    // Fall back to normal classification on any error
    return { label: "normal", score: 0.5, priority: false };
  }
}

export async function processSieveL2(
  job: Job<SievedJob>,
  redisConnection: ConnectionOptions
): Promise<void> {
  const data = job.data;

  const result = await callSieveService(
    data.subject,
    data.senderDomain,
    data.senderLocalPart
  );

  job.log(`[sieve-l2] label=${result.label} score=${result.score.toFixed(3)} priority=${result.priority}`);

  if (result.label === "spam") {
    await updateEmailLogSieve(data.senderHash, data.subjectHash, data.userId, "spam", "drop");
    job.log("[sieve-l2] dropped as spam");
    return;
  }

  // Update DB with L2 label (keep action as "delivered" / "batched" from L1 or update)
  const dbAction =
    result.label === "newsletter" ? "batched" : "delivered";
  await updateEmailLogSieve(
    data.senderHash,
    data.subjectHash,
    data.userId,
    result.label,
    dbAction
  );

  const payload: SievedJob = {
    ...data,
    sieveLabel: result.label,
  };

  if (result.label === "newsletter") {
    // Newsletters → batch queue
    const bq = getBatchQueue(redisConnection);
    await bq.add("l2-sieved", payload, {
      priority: 10,
      removeOnComplete: true,
      removeOnFail: 1000,
      attempts: 3,
      backoff: { type: "exponential", delay: 3000 },
    });
    job.log("[sieve-l2] routed to brain:batch (newsletter)");
    return;
  }

  // urgent / normal → brain queue
  const brainQueue = getBrainQueue(redisConnection);
  await brainQueue.add("l2-sieved", payload, {
    priority: result.priority ? 1 : 10,
    removeOnComplete: true,
    removeOnFail: 1000,
    attempts: 3,
    backoff: { type: "exponential", delay: 3000 },
  });
  job.log(`[sieve-l2] routed to brain — priority=${result.priority}`);
}
