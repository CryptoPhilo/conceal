import Anthropic from "@anthropic-ai/sdk";

export type InformationalCategory = "informational" | "action_required" | "uncertain";
export type WorkType = "contract" | "meeting" | "cs" | "report" | "hiring" | "payment" | "other";
export type UrgencyLevel = "critical" | "high" | "normal" | "low";

export interface Phase2Result {
  informationalCategory: InformationalCategory;
  informationalConfidence: number;
  workTypes: WorkType[];
  workTypeConfidences: Partial<Record<WorkType, number>>;
  urgencyLevel: UrgencyLevel;
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const WORK_TYPE_LABELS: WorkType[] = [
  "contract", "meeting", "cs", "report", "hiring", "payment", "other",
];

// Rule-based pre-classification — matches sieve.ts patterns to avoid redundant LLM calls
const NOREPLY_PATTERN =
  /^(noreply|no-reply|donotreply|notifications?|automated?|mailer-daemon|postmaster|bounce|alert|updates?)@/i;
const NOREPLY_CONTAINS = /(?:noreply|no-reply|donotreply|do-not-reply)/i;
const NEWSLETTER_DOMAIN_PATTERN =
  /\b(mailchimp|sendgrid|constantcontact|campaignmonitor|klaviyo|substack|beehiiv)\b/;

// Static system prompt — never changes, maximises Anthropic prompt cache hit rate
const SYSTEM_PROMPT =
  "You are an email classifier. Given email metadata (subject, sender domain, sieve label) " +
  "and optionally the email body preview, output a single JSON object with three classifications:\n\n" +
  "1. informational_category — is this email purely informational or does it require action?\n" +
  '   "informational": newsletters, receipts, automated notifications, FYI/status updates\n' +
  '   "action_required": needs a reply, approval, scheduling decision, or task\n' +
  '   "uncertain": genuinely ambiguous\n\n' +
  "2. work_type_confidences — business category scores (0.0–1.0 each):\n" +
  '   "contract": legal agreements, NDAs, terms, signature requests\n' +
  '   "meeting": scheduling requests, calendar invites, video-call links\n' +
  '   "cs": customer support tickets, complaints, helpdesk inquiries\n' +
  '   "report": weekly/monthly reports, summaries, analytics digests\n' +
  '   "hiring": job applications, resumes, interview scheduling, recruiting\n' +
  '   "payment": invoices, billing statements, payment confirmations, receipts\n' +
  '   "other": does not fit any category above\n\n' +
  "3. urgency_level — how urgently does this email need attention?\n" +
  '   "critical": needs response within hours (escalations, outages, legal deadlines)\n' +
  '   "high": needs response today (meeting requests, approvals, time-sensitive tasks)\n' +
  '   "normal": can wait 1-2 days\n' +
  '   "low": informational, no action needed\n' +
  "Use body content (if provided) to detect deadlines, urgency signals, and escalation language.\n\n" +
  "Output JSON only — no explanation, no markdown:\n" +
  '{"informational_category":"...","informational_confidence":0.0,"work_type_confidences":{"contract":0.0,"meeting":0.0,"cs":0.0,"report":0.0,"hiring":0.0,"payment":0.0,"other":0.0},"urgency_level":"normal"}';

const CONFIDENCE_THRESHOLD = 0.7;

function applyRules(
  senderLocalPart: string,
  senderDomain: string,
  sieveLabel: string | null
): Phase2Result | null {
  if (
    sieveLabel === "newsletter" ||
    sieveLabel === "system_notification" ||
    NOREPLY_PATTERN.test(senderLocalPart + "@") ||
    NOREPLY_CONTAINS.test(senderLocalPart) ||
    NEWSLETTER_DOMAIN_PATTERN.test(senderDomain)
  ) {
    return {
      informationalCategory: "informational",
      informationalConfidence: 0.97,
      workTypes: [],
      workTypeConfidences: {},
      urgencyLevel: "low",
    };
  }
  return null;
}

function buildFallback(): Phase2Result {
  return {
    informationalCategory: "uncertain",
    informationalConfidence: 0.5,
    workTypes: ["other"],
    workTypeConfidences: { other: 0.5 },
    urgencyLevel: "normal",
  };
}

const URGENCY_LEVELS: UrgencyLevel[] = ["critical", "high", "normal", "low"];

interface RawLLMResponse {
  informational_category: string;
  informational_confidence: number;
  work_type_confidences: Partial<Record<WorkType, number>>;
  urgency_level?: string;
}

function parseResponse(raw: string): Phase2Result {
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
  const jsonStr = (jsonMatch[1] ?? raw).trim();

  const parsed = JSON.parse(jsonStr) as RawLLMResponse;

  const category = parsed.informational_category as InformationalCategory;
  if (!["informational", "action_required", "uncertain"].includes(category)) {
    return buildFallback();
  }

  const confidences = parsed.work_type_confidences ?? {};
  const workTypes = WORK_TYPE_LABELS.filter((t) => (confidences[t] ?? 0) >= CONFIDENCE_THRESHOLD);
  if (workTypes.length === 0) workTypes.push("other");

  const informationalConfidence =
    typeof parsed.informational_confidence === "number"
      ? Math.min(1, Math.max(0, parsed.informational_confidence))
      : 0.5;

  const urgencyLevel = URGENCY_LEVELS.includes(parsed.urgency_level as UrgencyLevel)
    ? (parsed.urgency_level as UrgencyLevel)
    : "normal";

  return {
    informationalCategory: category,
    informationalConfidence,
    workTypes,
    workTypeConfidences: confidences,
    urgencyLevel,
  };
}

export async function classifyPhase2(
  subject: string,
  senderDomain: string,
  senderLocalPart: string,
  sieveLabel: string | null,
  bodyPreview?: string
): Promise<Phase2Result> {
  const ruleResult = applyRules(senderLocalPart, senderDomain, sieveLabel);
  if (ruleResult) return ruleResult;

  const bodySection = bodyPreview
    ? `\nBody preview:\n${bodyPreview.slice(0, 800)}`
    : "";

  try {
    const response = await anthropic.beta.promptCaching.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content:
            `Subject: ${subject}\n` +
            `Sender domain: ${senderDomain}\n` +
            `Sieve label: ${sieveLabel ?? "none"}` +
            bodySection,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return buildFallback();

    return parseResponse(textBlock.text);
  } catch {
    return buildFallback();
  }
}
