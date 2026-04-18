#!/usr/bin/env tsx
/**
 * Convert pipeline-results.jsonl into a canonical training corpus for
 * future BERT / local-LLM fine-tuning.
 *
 * Usage:
 *   npx tsx scripts/export-training-data.ts
 *   npx tsx scripts/export-training-data.ts --input pipeline-results.jsonl \
 *     --output training-corpus.jsonl --min-confidence 0.7
 *
 * Output format (one JSON per line):
 *   {
 *     "text": "<Subject: …\nFrom: …\nBody: …>",
 *     "urgency":  "high",          // critical | high | normal | low
 *     "category": "action_required", // informational | action_required | uncertain
 *     "work_types": ["meeting"],   // array, may be empty
 *     "source": "silver_claude"    // always "silver_claude" — human review needed before production
 *   }
 *
 * Options:
 *   --input <path>          Source JSONL (default: pipeline-results.jsonl)
 *   --output <path>         Training JSONL (default: training-corpus.jsonl)
 *   --min-confidence <0-1>  Drop rows where Brain priorityScore < threshold×100 (default: 0)
 *   --exclude-errors        Drop rows that have an error field
 *   --stats                 Print class distribution summary after export
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync } from "node:fs";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    input: { type: "string", default: "pipeline-results.jsonl" },
    output: { type: "string", default: "training-corpus.jsonl" },
    "min-confidence": { type: "string", default: "0" },
    "exclude-errors": { type: "boolean", default: false },
    stats: { type: "boolean", default: false },
  },
  strict: false,
});

const INPUT_FILE = args.input as string;
const OUTPUT_FILE = args.output as string;
const MIN_SCORE = parseFloat(args["min-confidence"] as string) * 100;
const EXCLUDE_ERRORS = args["exclude-errors"] as boolean;
const PRINT_STATS = args.stats as boolean;

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
  brainSummary?: string;
  brainPriorityScore?: number;
  brainAction?: string;
  brainUrgencyLevel?: string;
  phase2Category?: string;
  phase2WorkTypes?: string[];
  bodyPreview?: string;
  error?: string;
}

export interface TrainingExample {
  text: string;
  urgency: string;
  category: string;
  work_types: string[];
  source: "silver_claude";
  meta: {
    messageId: string;
    senderDomain: string;
    sieveL1Label: string | null;
    brainPriorityScore?: number;
    date: string;
  };
}

export function toTrainingExample(r: PipelineResult): TrainingExample | null {
  // Must have at least Phase 2 classification
  if (!r.phase2Category) return null;
  if (EXCLUDE_ERRORS && r.error) return null;
  if (MIN_SCORE > 0 && (r.brainPriorityScore ?? 0) < MIN_SCORE) return null;

  const urgency = r.brainUrgencyLevel ?? "normal";
  const category = r.phase2Category;
  const work_types = r.phase2WorkTypes ?? [];

  const lines: string[] = [
    `Subject: ${r.subject}`,
    `From: ${r.senderDomain}`,
  ];
  if (r.bodyPreview?.trim()) {
    lines.push(`Body:\n${r.bodyPreview.trim()}`);
  }

  return {
    text: lines.join("\n"),
    urgency,
    category,
    work_types,
    source: "silver_claude",
    meta: {
      messageId: r.messageId,
      senderDomain: r.senderDomain,
      sieveL1Label: r.sieveL1Label,
      brainPriorityScore: r.brainPriorityScore,
      date: r.date,
    },
  };
}

function printStats(examples: TrainingExample[]) {
  const n = examples.length;
  console.log(`\nTraining corpus stats (${n} examples):`);

  console.log("\nUrgency:");
  const urgencyCounts = new Map<string, number>();
  for (const e of examples) urgencyCounts.set(e.urgency, (urgencyCounts.get(e.urgency) ?? 0) + 1);
  for (const [k, v] of [...urgencyCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(12)} ${v.toString().padStart(6)}  (${((v / n) * 100).toFixed(1)}%)`);
  }

  console.log("\nCategory:");
  const catCounts = new Map<string, number>();
  for (const e of examples) catCounts.set(e.category, (catCounts.get(e.category) ?? 0) + 1);
  for (const [k, v] of [...catCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(20)} ${v.toString().padStart(6)}  (${((v / n) * 100).toFixed(1)}%)`);
  }

  console.log("\nWork types:");
  const wtCounts = new Map<string, number>();
  for (const e of examples) {
    for (const wt of e.work_types) wtCounts.set(wt, (wtCounts.get(wt) ?? 0) + 1);
  }
  for (const [k, v] of [...wtCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(12)} ${v.toString().padStart(6)}`);
  }

  const withBody = examples.filter((e) => e.text.includes("Body:")).length;
  console.log(`\nWith body text: ${withBody}/${n} (${((withBody / n) * 100).toFixed(1)}%)`);
}

function main() {
  if (!existsSync(INPUT_FILE)) {
    console.error(`Input not found: ${INPUT_FILE}`);
    process.exit(1);
  }

  const rows = readFileSync(INPUT_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as PipelineResult);

  if (existsSync(OUTPUT_FILE)) unlinkSync(OUTPUT_FILE);

  const examples: TrainingExample[] = [];
  let skipped = 0;

  for (const row of rows) {
    const ex = toTrainingExample(row);
    if (!ex) { skipped++; continue; }
    examples.push(ex);
    appendFileSync(OUTPUT_FILE, JSON.stringify(ex) + "\n");
  }

  console.log(`Exported ${examples.length} training examples to ${OUTPUT_FILE}`);
  console.log(`Skipped ${skipped} rows (no Phase 2 output or below confidence threshold)`);

  if (PRINT_STATS) printStats(examples);
}

main();
