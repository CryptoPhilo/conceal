import type { Job } from "bullmq";
import { Queue } from "bullmq";
import Anthropic from "@anthropic-ai/sdk";
import type { SievedJob, DeliveryJob } from "@shadow/shared";
import { QUEUE_NAMES } from "@shadow/shared";
import {
  updateEmailLogBrain,
  loadUserContextVectors,
} from "../db.js";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

let _deliveryQueue: Queue | undefined;

function getDeliveryQueue(connection: Parameters<typeof Queue>[1]["connection"]) {
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
    const response = await anthropic.beta.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      betas: ["prompt-caching-2024-07-31"],
      system: [
        {
          type: "text",
          text: systemPrompt,
          // @ts-expect-error — beta cache_control field
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
  redisConnection: Parameters<typeof Queue>[1]["connection"]
): Promise<void> {
  const data = job.data;

  job.log(`[brain] processing — sieveLabel=${data.sieveLabel ?? "none"}`);

  const result = await runBrain(data);

  job.log(
    `[brain] result — action=${result.action} score=${result.priorityScore} ` +
      `summary="${result.summary.slice(0, 80)}"`
  );

  const dbAction = result.action === "reply" ? "replied" : "delivered";
  try {
    await updateEmailLogBrain(
      data.senderHash,
      data.subjectHash,
      data.userId,
      result.summary,
      result.priorityScore,
      dbAction
    );
  } catch (err) {
    job.log(`[brain] warn: updateEmailLogBrain failed: ${String(err)}`);
  }

  const deliveryPayload: DeliveryJob = {
    ...data,
    summary: result.summary,
    priorityScore: result.priorityScore,
    brainAction: result.action,
    ...(result.replyDraft ? { replyDraft: result.replyDraft } : {}),
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
