import Anthropic from "@anthropic-ai/sdk";
import { getDomainSendCount, getDomainUrgentRateLimit, upsertDomainTrustStats } from "./db.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Threshold: domains with fewer total emails are considered new/untrusted
const NEW_DOMAIN_THRESHOLD = 3;
// Rate-limit: more than this many urgent-flagged emails from same domain in 1 hour = suppressed
const URGENT_RATE_LIMIT_PER_HOUR = 5;

const SYSTEM_PROMPT =
  "You are a security-aware email triage assistant specializing in detecting keyword spoofing. " +
  "Your job is to determine whether an email genuinely requires immediate action, " +
  "or whether it only appears urgent because of manipulated subject keywords.\n\n" +
  "Evaluate based on:\n" +
  "- Does the email content context (work type, category) align with a real urgency signal?\n" +
  "- Could a spammer/marketer have artificially inserted urgency keywords?\n" +
  "- Is the sender domain consistent with the claimed urgency?\n\n" +
  'Output JSON only: {"urgent_verified": true|false, "reason": "<one sentence>"}';

export interface UrgentVerifyInput {
  subject: string;
  senderDomain: string;
  sieveLabel: string | null;
  workTypes: string[];
  informationalCategory: string;
  priorityScore: number;
  userId: string;
}

export interface UrgentVerifyResult {
  urgentVerified: boolean;
  reason: string;
}

async function callLLM(input: UrgentVerifyInput): Promise<UrgentVerifyResult> {
  const userMessage =
    `Subject: ${input.subject}\n` +
    `Sender domain: ${input.senderDomain}\n` +
    `Sieve label: ${input.sieveLabel ?? "none"}\n` +
    `Work types: ${input.workTypes.join(", ") || "none"}\n` +
    `Informational category: ${input.informationalCategory}\n` +
    `Priority score: ${input.priorityScore}/100\n\n` +
    "Does this email genuinely require immediate action, or is it keyword spoofing?";

  try {
    const response = await anthropic.beta.promptCaching.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 128,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userMessage }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { urgentVerified: false, reason: "LLM response parse error" };
    }

    const raw = textBlock.text.trim();
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
    const jsonStr = (jsonMatch[1] ?? raw).trim();
    const parsed = JSON.parse(jsonStr) as { urgent_verified: boolean; reason: string };

    return {
      urgentVerified: Boolean(parsed.urgent_verified),
      reason: parsed.reason ?? "",
    };
  } catch {
    return { urgentVerified: false, reason: "LLM call failed" };
  }
}

export async function verifyUrgent(input: UrgentVerifyInput): Promise<UrgentVerifyResult> {
  // Rate-limit check: too many urgent flags from this domain in 1 hour = spoofer signal
  const recentUrgentCount = await getDomainUrgentRateLimit(input.senderDomain, input.userId);
  if (recentUrgentCount > URGENT_RATE_LIMIT_PER_HOUR) {
    await upsertDomainTrustStats(input.senderDomain, true, false);
    return {
      urgentVerified: false,
      reason: `Rate-limit: ${recentUrgentCount} urgent flags from domain in last hour`,
    };
  }

  // Domain freshness check: new/untrusted domains get stricter treatment
  const domainSendCount = await getDomainSendCount(input.senderDomain, input.userId);
  const isNewDomain = domainSendCount < NEW_DOMAIN_THRESHOLD;

  // If purely informational category + new domain, skip LLM and reject immediately
  if (isNewDomain && input.informationalCategory === "informational") {
    await upsertDomainTrustStats(input.senderDomain, true, false);
    return {
      urgentVerified: false,
      reason: "New domain sending informational email with urgency keywords",
    };
  }

  const result = await callLLM(input);

  // For new domains, require higher confidence: only pass if LLM says urgent AND category is action_required
  if (isNewDomain && result.urgentVerified && input.informationalCategory !== "action_required") {
    await upsertDomainTrustStats(input.senderDomain, true, false);
    return {
      urgentVerified: false,
      reason: `New domain trust penalty: ${result.reason}`,
    };
  }

  await upsertDomainTrustStats(input.senderDomain, true, result.urgentVerified);
  return result;
}
