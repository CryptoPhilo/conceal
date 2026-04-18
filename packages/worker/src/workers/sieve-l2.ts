import type { Job, ConnectionOptions } from "bullmq";
import { Queue } from "bullmq";
import type { SievedJob } from "@shadow/shared";
import { QUEUE_NAMES } from "@shadow/shared";
import { updateEmailLogSieve } from "../db.js";

const SIEVE_SERVICE_URL = process.env.SIEVE_SERVICE_URL ?? "http://localhost:8000";

type SieveLabel =
  | "urgent"
  | "newsletter"
  | "spam"
  | "normal"
  | "informational"
  | "malware_attachment"
  | "phishing_suspect"
  | "fraud_suspect";

interface SieveServiceResponse {
  label: SieveLabel;
  score: number;
  priority: boolean;
  security_flags: string[];
  threat_level: "none" | "low" | "medium" | "high";
}

/** Labels that represent confirmed or suspected security threats → auto-drop. */
const SECURITY_THREAT_LABELS = new Set<SieveLabel>([
  "malware_attachment",
  "phishing_suspect",
  "fraud_suspect",
]);

/** Labels routed to the batch (low-priority) queue. */
const BATCH_LABELS = new Set<SieveLabel>(["newsletter", "informational"]);

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

async function callSieveService(job: SievedJob): Promise<SieveServiceResponse> {
  try {
    const body: Record<string, unknown> = {
      subject: job.subject,
      sender_domain: job.senderDomain,
      sender_local: job.senderLocalPart,
    };

    // Pass authentication header results when available
    if ("spfPass" in job) body.spf_pass = (job as Record<string, unknown>).spfPass;
    if ("dkimPass" in job) body.dkim_pass = (job as Record<string, unknown>).dkimPass;
    if ("dmarcPass" in job) body.dmarc_pass = (job as Record<string, unknown>).dmarcPass;
    if ("senderDisplayName" in job) body.sender_display_name = (job as Record<string, unknown>).senderDisplayName;

    const res = await fetch(`${SIEVE_SERVICE_URL}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error(`sieve-service returned ${res.status}`);
    }
    return (await res.json()) as SieveServiceResponse;
  } catch {
    return { label: "normal", score: 0.5, priority: false, security_flags: [], threat_level: "none" };
  }
}

export async function processSieveL2(
  job: Job<SievedJob>,
  redisConnection: ConnectionOptions
): Promise<void> {
  const data = job.data;
  const result = await callSieveService(data);

  job.log(
    `[sieve-l2] label=${result.label} score=${result.score.toFixed(3)} ` +
    `priority=${result.priority} threat=${result.threat_level} flags=${result.security_flags.join(",")}`
  );

  // Security threats → drop immediately, no brain processing
  if (SECURITY_THREAT_LABELS.has(result.label)) {
    await updateEmailLogSieve(data.senderHash, data.subjectHash, data.userId, result.label, "drop");
    job.log(`[sieve-l2] dropped as security threat: ${result.label}`);
    return;
  }

  if (result.label === "spam") {
    await updateEmailLogSieve(data.senderHash, data.subjectHash, data.userId, "spam", "drop");
    job.log("[sieve-l2] dropped as spam");
    return;
  }

  const dbAction = BATCH_LABELS.has(result.label) ? "batched" : "delivered";
  await updateEmailLogSieve(
    data.senderHash,
    data.subjectHash,
    data.userId,
    result.label,
    dbAction
  );

  const payload: SievedJob = { ...data, sieveLabel: result.label };

  if (BATCH_LABELS.has(result.label)) {
    const bq = getBatchQueue(redisConnection);
    await bq.add("l2-sieved", payload, {
      priority: 10,
      removeOnComplete: true,
      removeOnFail: 1000,
      attempts: 3,
      backoff: { type: "exponential", delay: 3000 },
    });
    job.log(`[sieve-l2] routed to brain:batch (${result.label})`);
    return;
  }

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
