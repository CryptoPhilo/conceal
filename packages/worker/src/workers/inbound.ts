import type { Job } from "bullmq";
import { Queue } from "bullmq";
import type { InboundEmailJob, SievedJob } from "@shadow/shared";
import { QUEUE_NAMES } from "@shadow/shared";
import { classify } from "../sieve.js";
import { loadUserRules, updateEmailLogSieve } from "../db.js";

let _sieveQueue: Queue | undefined;
let _batchQueue: Queue | undefined;

function getSieveQueue(connection: Parameters<typeof Queue>[1]["connection"]) {
  if (!_sieveQueue) _sieveQueue = new Queue(QUEUE_NAMES.SIEVE, { connection });
  return _sieveQueue;
}

function getBatchQueue(connection: Parameters<typeof Queue>[1]["connection"]) {
  if (!_batchQueue) _batchQueue = new Queue(QUEUE_NAMES.BRAIN_BATCH, { connection });
  return _batchQueue;
}

export async function processInbound(
  job: Job<InboundEmailJob>,
  redisConnection: Parameters<typeof Queue>[1]["connection"]
): Promise<void> {
  const data = job.data;

  const userRules = await loadUserRules(data.userId);
  const result = classify(data, userRules);

  const actionTakenMap = {
    auto_delete: "drop",
    quarantine: "batched",
    pass_through: "delivered",
  } as const;

  const dbAction = actionTakenMap[result.action];

  await updateEmailLogSieve(
    data.senderHash,
    data.subjectHash,
    data.userId,
    result.label,
    dbAction
  );

  if (result.action === "auto_delete") {
    job.log(`[sieve] dropped — label=${result.label ?? "none"}, rule=${result.matchedRuleId ?? "builtin"}`);
    return;
  }

  const payload: SievedJob = {
    ...data,
    sieveLabel: result.label,
    sieveAction: result.action,
  };

  if (result.action === "quarantine") {
    const bq = getBatchQueue(redisConnection);
    await bq.add("sieved", payload, {
      removeOnComplete: true,
      removeOnFail: 1000,
      attempts: 3,
      backoff: { type: "exponential", delay: 3000 },
    });
    job.log(`[sieve] quarantined — label=${result.label ?? "none"}`);
    return;
  }

  // pass_through — enqueue to sieve L2 for further classification
  const sq = getSieveQueue(redisConnection);
  await sq.add("sieved", payload, {
    priority: result.priority ? 1 : 10,
    removeOnComplete: true,
    removeOnFail: 1000,
    attempts: 3,
    backoff: { type: "exponential", delay: 3000 },
  });
  job.log(`[sieve] passed to sieve L2 — priority=${result.priority}, replyTemplate=${result.replyTemplate != null}`);
}
