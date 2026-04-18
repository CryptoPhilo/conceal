import type { Job, ConnectionOptions } from "bullmq";
import { Queue } from "bullmq";
import Anthropic from "@anthropic-ai/sdk";
import type { SievedJob, DeliveryJob } from "@shadow/shared";
import { QUEUE_NAMES } from "@shadow/shared";
import {
  updateEmailLogBrain,
  updateEmailLogPhase3,
  loadUserContextVectors,
} from "../db.js";
import { classifyPhase2 } from "../classifier-phase2.js";
import { classifyPhase3 } from "../classifier-phase3.js";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

let _deliveryQueue: Queue | undefined;

function getDeliveryQueue(connection: ConnectionOptions) {
  if (!_deliveryQueue) _deliveryQueue = new Queue(QUEUE_NAMES.DELIVERY, { connection });
  return _deliveryQueue;
}

interface BrainResult {
  summary: string;
  priorityScore: number;
  action: "deliver" | "reply";
  replyDraft?: string;
}

function buildFallback(senderDomain: string): BrainResult {
  return {
    summary: `Email from ${senderDomain}`,
    priorityScore: 50,
    action: "deliver",
  };
}

async function runBrain(data: SievedJob): Promise<BrainResult> {
  let contextVectors: string[] = [];
  try {
    contextVectors = await loadUserContextVectors(data.userId);
  } catch {
    // No context vectors is fine — proceed with empty context
  }

  const userContext =
    contextVectors.length > 0
      ? contextVectors.join("\n---\n")
      : "No user context available.";

  const systemPrompt =
    "You are an email triage assistant. Given email metadata (subject, sender domain), " +
    "produce a concise actionable summary and a priority score 0-100. " +
    'Output JSON: { summary: string, priorityScore: number, action: \'deliver\' | \'reply\', replyDraft?: string }. ' +
    `User context:\n${userContext}`;

  const userMessage =
    `Analyze this email:\n` +
    `Subject hash: ${data.subjectHash}\n` +
    `Sender domain: ${data.senderDomain}\n` +
    `Sieve label: ${data.sieveLabel ?? "none"}\n` +
    `Sieve action: ${data.sieveAction}\n` +
    `Received at: ${data.receivedAt}`;

  try {
    const response = await anthropic.beta.promptCaching.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return buildFallback(data.senderDomain);
    }

    const raw = textBlock.text.trim();
    // Extract JSON from potential markdown code blocks
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
    const jsonStr = jsonMatch[1] ?? raw;

    const parsed = JSON.parse(jsonStr) as BrainResult;
    if (
      typeof parsed.summary !== "string" ||
      typeof parsed.priorityScore !== "number" ||
      (parsed.action !== "deliver" && parsed.action !== "reply")
    ) {
      return buildFallback(data.senderDomain);
    }
    return parsed;
  } catch {
    return buildFallback(data.senderDomain);
  }
}

export async function processBrain(
  job: Job<SievedJob>,
  redisConnection: ConnectionOptions
): Promise<void> {
  const data = job.data;

  job.log(`[brain] processing — sieveLabel=${data.sieveLabel ?? "none"}`);

  const [result, phase2, phase3] = await Promise.all([
    runBrain(data),
    classifyPhase2(data.subject, data.senderDomain, data.senderLocalPart, data.sieveLabel),
    Promise.resolve(classifyPhase3(data.maskingAddress, data.toAddresses ?? [], data.ccAddresses ?? [])),
  ]);

  job.log(
    `[brain] result — action=${result.action} score=${result.priorityScore} ` +
      `summary="${result.summary.slice(0, 80)}"`
  );
  job.log(
    `[brain] phase2 — category=${phase2.informationalCategory} ` +
      `confidence=${phase2.informationalConfidence.toFixed(2)} ` +
      `workTypes=${phase2.workTypes.join(",")}`
  );
  job.log(
    `[brain] phase3 — recipientType=${phase3.recipientType} ` +
      `confidence=${phase3.confidence.toFixed(2)}`
  );

  const dbAction = result.action === "reply" ? "replied" : "delivered";
  try {
    await Promise.all([
      updateEmailLogBrain(
        data.senderHash,
        data.subjectHash,
        data.userId,
        result.summary,
        result.priorityScore,
        dbAction,
        phase2.informationalCategory,
        phase2.workTypes
      ),
      updateEmailLogPhase3(
        data.senderHash,
        data.subjectHash,
        data.userId,
        phase3.recipientType,
        phase3.confidence
      ),
    ]);
  } catch (err) {
    job.log(`[brain] warn: updateEmailLog failed: ${String(err)}`);
  }

  const deliveryPayload: DeliveryJob = {
    ...data,
    summary: result.summary,
    priorityScore: result.priorityScore,
    brainAction: result.action,
    ...(result.replyDraft ? { replyDraft: result.replyDraft } : {}),
    informationalCategory: phase2.informationalCategory,
    workTypes: phase2.workTypes,
  };

  const dq = getDeliveryQueue(redisConnection);
  await dq.add("delivery", deliveryPayload, {
    removeOnComplete: true,
    removeOnFail: 1000,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
  });

  job.log(`[brain] pushed to delivery queue`);
}
