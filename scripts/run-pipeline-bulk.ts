#!/usr/bin/env tsx
/**
 * Run fetched inbox emails through the classification pipeline offline.
 * Reads JSONL from fetch-real-inbox.ts and outputs classified results.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=<key> npx tsx scripts/run-pipeline-bulk.ts
 *   ANTHROPIC_API_KEY=<key> npx tsx scripts/run-pipeline-bulk.ts --input inbox-raw.jsonl --output pipeline-results.jsonl
 *
 * Options (env vars):
 *   ANTHROPIC_API_KEY   Required for Brain/Phase 2 LLM calls.
 *   SIEVE_SERVICE_URL   Python sieve service URL (default: http://localhost:8000).
 *   CONCURRENCY         Parallel LLM calls (default: 5).
 *   SKIP_BRAIN          Set to "1" to skip Brain/Phase 2 — only run L1 + L2.
 *   RESUME              Set to "1" to skip already-processed message IDs.
 *
 * CLI flags:
 *   --input <path>         Input JSONL file (default: inbox-raw.jsonl)
 *   --output <path>        Output JSONL file (default: pipeline-results.jsonl)
 *   --train-output <path>  If set, write silver training corpus alongside results
 */

import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { readFileSync as rf } from "node:fs";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
// Worker source imports — tsx resolves .js → .ts in source trees
import { classify } from "../packages/worker/src/sieve.js";
import { classifyPhase2 } from "../packages/worker/src/classifier-phase2.js";
import { classifyPhase3 } from "../packages/worker/src/classifier-phase3.js";
import { toTrainingExample } from "./export-training-data.js";
import type { InboundEmailJob } from "@shadow/shared";

const { values: args } = parseArgs({
  options: {
    input: { type: "string", default: "inbox-raw.jsonl" },
    output: { type: "string", default: "pipeline-results.jsonl" },
    "train-output": { type: "string" },
  },
  strict: false,
});

const INPUT_FILE = args.input as string;
const OUTPUT_FILE = args.output as string;
const TRAIN_OUTPUT = args["train-output"] as string | undefined;
const SIEVE_SERVICE_URL = process.env.SIEVE_SERVICE_URL ?? "http://localhost:8000";
const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? "5", 10);
const SKIP_BRAIN = process.env.SKIP_BRAIN === "1";
const RESUME = process.env.RESUME === "1";

const TEST_USER_ID = "bulk-test-user";
const TEST_MASKING_ADDRESS = "test@conceal.test";

interface InboxRow {
  id: string;
  from: string;
  subject: string;
  date: string;
  senderDomain: string;
  senderLocalPart: string;
  listUnsubscribe?: string;
  precedence?: string;
  bodyPreview?: string;
}

interface PipelineResult {
  messageId: string;
  from: string;
  subject: string;
  date: string;
  senderDomain: string;
  senderLocalPart: string;
  sieveL1Label: string | null;
  sieveL1Action: string;
  sieveL2Label?: string;
  sieveL2Score?: number;
  sieveL2ThreatLevel?: string;
  sieveL2SecurityFlags?: string[];
  brainSummary?: string;
  brainPriorityScore?: number;
  brainAction?: string;
  brainUrgencyLevel?: string;
  phase2Category?: string;
  phase2WorkTypes?: string[];
  phase3RecipientType?: string;
  phase3Confidence?: number;
  error?: string;
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function toInboundJob(row: InboxRow): InboundEmailJob {
  return {
    messageId: row.id,
    maskingAddress: TEST_MASKING_ADDRESS,
    realAddress: row.from,
    userId: TEST_USER_ID,
    senderHash: hash(row.from),
    subjectHash: hash(row.subject),
    senderDomain: row.senderDomain,
    senderLocalPart: row.senderLocalPart,
    subject: row.subject,
    bodyPreview: row.bodyPreview,
    rawS3Key: `bulk-test/${row.id}`,
    receivedAt: new Date(row.date || Date.now()).toISOString(),
    toAddresses: [TEST_MASKING_ADDRESS],
    ccAddresses: [],
  };
}

async function callSieveL2(
  job: InboundEmailJob,
  l1Label: string | null
): Promise<{ label: string; score: number; threatLevel: string; securityFlags: string[] }> {
  try {
    const res = await fetch(`${SIEVE_SERVICE_URL}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: job.subject,
        sender_domain: job.senderDomain,
        sender_local: job.senderLocalPart,
        sieve_label: l1Label,
        body_preview: job.bodyPreview,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`L2 status ${res.status}`);
    const data = (await res.json()) as {
      label: string;
      score: number;
      threat_level: string;
      security_flags: string[];
    };
    return {
      label: data.label,
      score: data.score,
      threatLevel: data.threat_level,
      securityFlags: data.security_flags,
    };
  } catch {
    return { label: "normal", score: 0.5, threatLevel: "none", securityFlags: [] };
  }
}

async function runBrainDirect(
  job: InboundEmailJob,
  sieveLabel: string | null
): Promise<{ summary: string; priorityScore: number; action: string; urgencyLevel: string }> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt =
    "You are an email triage assistant. Given email metadata and body content, " +
    "produce a concise actionable summary, a priority score 0-100, and an urgency level. " +
    "Output JSON: { summary: string, priorityScore: number, action: 'deliver' | 'reply', " +
    "urgencyLevel: 'critical' | 'high' | 'normal' | 'low' }. " +
    "urgencyLevel rules: 'critical'=needs response within hours; 'high'=needs response today; " +
    "'normal'=can wait a day or two; 'low'=informational/no action needed. " +
    "Use the body content to detect deadlines, escalations, and urgency signals. " +
    "No user context available.";

  const bodySection = job.bodyPreview
    ? `\nBody preview:\n${job.bodyPreview.slice(0, 800)}`
    : "";

  const userMessage =
    `Analyze this email:\n` +
    `Subject: ${job.subject}\n` +
    `Sender domain: ${job.senderDomain}\n` +
    `Sieve label: ${sieveLabel ?? "none"}\n` +
    `Received at: ${job.receivedAt}` +
    bodySection;

  try {
    const response = await anthropic.beta.promptCaching.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMessage }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text")
      return { summary: "(no summary)", priorityScore: 50, action: "deliver", urgencyLevel: "normal" };

    const raw = textBlock.text.trim();
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
    const parsed = JSON.parse(jsonMatch[1] ?? raw) as {
      summary: string;
      priorityScore: number;
      action: string;
      urgencyLevel: string;
    };
    return parsed;
  } catch {
    return { summary: "(error)", priorityScore: 50, action: "deliver", urgencyLevel: "normal" };
  }
}

async function processRow(row: InboxRow): Promise<PipelineResult> {
  const job = toInboundJob(row);
  const result: PipelineResult = {
    messageId: row.id,
    from: row.from,
    subject: row.subject,
    date: row.date,
    senderDomain: row.senderDomain,
    senderLocalPart: row.senderLocalPart,
    sieveL1Label: null,
    sieveL1Action: "pass_through",
  };

  try {
    // Stage 1: Sieve L1
    const l1 = classify(job, []);
    result.sieveL1Label = l1.label;
    result.sieveL1Action = l1.action;

    if (l1.action === "auto_delete") return result;

    // Stage 2: Sieve L2 (only if service available)
    try {
      const l2 = await callSieveL2(job, l1.label);
      result.sieveL2Label = l2.label;
      result.sieveL2Score = l2.score;
      result.sieveL2ThreatLevel = l2.threatLevel;
      result.sieveL2SecurityFlags = l2.securityFlags;

      const securityDrop = ["malware_attachment", "phishing_suspect", "fraud_suspect", "spam"];
      if (securityDrop.includes(l2.label)) return result;
    } catch {
      // L2 unavailable — continue without it
    }

    if (SKIP_BRAIN) return result;

    // Stage 3: Phase 2 (work type classification)
    const phase2 = await classifyPhase2(
      job.subject,
      job.senderDomain,
      job.senderLocalPart,
      result.sieveL2Label ?? result.sieveL1Label,
      job.bodyPreview
    );
    result.phase2Category = phase2.informationalCategory;
    result.phase2WorkTypes = phase2.workTypes;

    // Stage 4: Phase 3 (recipient type) — deterministic
    const phase3 = classifyPhase3(job.maskingAddress, job.toAddresses, job.ccAddresses);
    result.phase3RecipientType = phase3.recipientType;
    result.phase3Confidence = phase3.confidence;

    // Stage 5: Brain (LLM summary + priority)
    const brain = await runBrainDirect(job, result.sieveL2Label ?? result.sieveL1Label);
    result.brainSummary = brain.summary;
    result.brainPriorityScore = brain.priorityScore;
    result.brainAction = brain.action;
    result.brainUrgencyLevel = brain.urgencyLevel;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function main() {
  if (!existsSync(INPUT_FILE)) {
    console.error(`Input file not found: ${INPUT_FILE}`);
    console.error("Run fetch-real-inbox.ts first.");
    process.exit(1);
  }

  const lines = readFileSync(INPUT_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as InboxRow);

  // Resume: skip already-processed IDs
  const processed = new Set<string>();
  if (RESUME && existsSync(OUTPUT_FILE)) {
    for (const line of rf(OUTPUT_FILE, "utf8").split("\n").filter(Boolean)) {
      try {
        processed.add((JSON.parse(line) as PipelineResult).messageId);
      } catch {}
    }
    console.log(`Resuming — ${processed.size} already processed`);
  }

  const todo = lines.filter((r) => !processed.has(r.id));
  console.log(
    `Processing ${todo.length} emails (${lines.length - todo.length} skipped) with concurrency=${CONCURRENCY}`
  );
  console.log(`SKIP_BRAIN=${SKIP_BRAIN}, SIEVE_SERVICE_URL=${SIEVE_SERVICE_URL}`);

  let done = 0;
  const start = Date.now();

  if (TRAIN_OUTPUT) console.log(`Training corpus output: ${TRAIN_OUTPUT}`);

  await runPool(todo, CONCURRENCY, async (row, _i) => {
    const result = await processRow(row);
    appendFileSync(OUTPUT_FILE, JSON.stringify(result) + "\n");
    if (TRAIN_OUTPUT) {
      const ex = toTrainingExample(result as Parameters<typeof toTrainingExample>[0]);
      if (ex) appendFileSync(TRAIN_OUTPUT, JSON.stringify(ex) + "\n");
    }
    done++;
    if (done % 50 === 0 || done === todo.length) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const rate = (done / ((Date.now() - start) / 1000)).toFixed(1);
      process.stdout.write(`\r${done}/${todo.length} (${rate}/s, ${elapsed}s elapsed)   `);
    }
  });

  console.log(`\nDone. Results written to ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
