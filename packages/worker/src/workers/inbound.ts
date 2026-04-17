import type { Job } from "bullmq";
import { Queue } from "bullmq";
import type { InboundEmailJob } from "@shadow/shared";
import { QUEUE_NAMES } from "@shadow/shared";
import { classify } from "../sieve.js";
import { loadUserRules, updateEmailLogSieve } from "../db.js";

let _brainQueue: Queue | undefined;
let _batchQueue: Queue | undefined;

function getBrainQueue(connection: Parameters<typeof Queue>[1]["connection"]) {
  if (!_brainQueue) _brainQueue = new Queue(QUEUE_NAMES.BRAIN, { connection });
  return _brainQueue;
}

function getBatchQueue(connection: Parameters<typeof Queue>[1]["connection"]) {
  if (!_batchQueue) _batchQueue = new Queue(QUEUE_NAMES.BRAIN_BATCH, { connection });
  return _batchQueue;
}

type SievedJob = InboundEmailJob & { sieveLabel: string | null; sieveAction: string };

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

  // pass_through — enqueue to brain (priority or normal)
  const bq = getBrainQueue(redisConnection);
  await bq.add("sieved", payload, {
    priority: result.priority ? 1 : 10,
    removeOnComplete: true,
    removeOnFail: 1000,
    attempts: 3,
    backoff: { type: "exponential", delay: 3000 },
  });
  job.log(`[sieve] passed — priority=${result.priority}, replyTemplate=${result.replyTemplate != null}`);
}
