import type { InboundEmailJob, FilterRule, SieveResult } from "@shadow/shared";

// ── Built-in system defaults ──────────────────────────────────────────────────
// These fire only when no user rule matches. Users can override by adding
// explicit rules with higher priority.

const NOREPLY_PATTERN = /^(noreply|no-reply|donotreply|notifications?|automated?|mailer-daemon|postmaster|bounce|alert|updates?)@/i;

const NEWSLETTER_SUBJECT_PATTERN = /\b(unsubscribe|newsletter|mailing.?list|weekly.?digest|monthly.?roundup)\b|뉴스레터|레터/i;
const NEWSLETTER_DOMAIN_PATTERN = /\b(mailchimp|sendgrid|constantcontact|campaignmonitor|klaviyo|substack|beehiiv|facebookmail|instagram|twittermail)\b/;

const SPAM_SUBJECT_PATTERN =
  /\b(you.?ve won|you.?re the winner|lottery|claim your prize|unclaimed (funds|inheritance)|million (dollars?|USD)|cheap(est)? (meds?|pills?|viagra|cialis)|enlarge|work from home|make money fast|limited time offer|act now|urgent reply)\b/i;

// Korean statutory ad label — KT Act requires (광고) or [광고] prefix in subject
const KOREAN_AD_PATTERN = /^[\(\[](광고|홍보)[\)\]]/;

interface BuiltinRule {
  label: string;
  action: "auto_delete" | "quarantine";
  test: (job: InboundEmailJob) => boolean;
}

const SYSTEM_RULES: BuiltinRule[] = [
  {
    label: "spam",
    action: "auto_delete",
    test: (j) => SPAM_SUBJECT_PATTERN.test(j.subject) || KOREAN_AD_PATTERN.test(j.subject),
  },
  {
    label: "system_notification",
    action: "quarantine",
    test: (j) => NOREPLY_PATTERN.test(j.senderLocalPart + "@"),
  },
  {
    label: "newsletter",
    action: "quarantine",
    test: (j) =>
      NEWSLETTER_SUBJECT_PATTERN.test(j.subject) ||
      NEWSLETTER_DOMAIN_PATTERN.test(j.senderDomain),
  },
];

// ── User-rule evaluation ──────────────────────────────────────────────────────

type DbRule = {
  id: string;
  rule_type: FilterRule["ruleType"];
  pattern: string;
  action: FilterRule["action"];
  reply_template: string | null;
};

function evalUserRule(rule: DbRule, job: InboundEmailJob): boolean {
  switch (rule.rule_type) {
    case "sender_domain": {
      const pat = rule.pattern.toLowerCase();
      return job.senderDomain === pat || job.senderDomain.endsWith("." + pat);
    }
    case "keyword": {
      return job.subject.toLowerCase().includes(rule.pattern.toLowerCase());
    }
    case "regex": {
      try {
        return new RegExp(rule.pattern, "i").test(job.subject) ||
          new RegExp(rule.pattern, "i").test(job.senderDomain);
      } catch {
        return false;
      }
    }
    case "sieve_label": {
      return job.maskingAddress.toLowerCase().includes(rule.pattern.toLowerCase());
    }
  }
}

function dbActionToSieve(
  action: FilterRule["action"],
  replyTemplate: string | null
): Pick<SieveResult, "action" | "priority" | "replyTemplate"> {
  switch (action) {
    case "drop":
      return { action: "auto_delete", priority: false, replyTemplate: null };
    case "batch":
      return { action: "quarantine", priority: false, replyTemplate: null };
    case "priority":
      return { action: "pass_through", priority: true, replyTemplate: null };
    case "reply":
      return { action: "pass_through", priority: false, replyTemplate: replyTemplate ?? null };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function classify(
  job: InboundEmailJob,
  userRules: DbRule[]
): SieveResult {
  const start = Date.now();

  // User rules take precedence (ordered by priority DESC from DB query)
  for (const rule of userRules) {
    if (evalUserRule(rule, job)) {
      const sieve = dbActionToSieve(rule.action, rule.reply_template);
      return {
        ...sieve,
        label: rule.rule_type,
        matchedRuleId: rule.id,
      };
    }
  }

  // Fall back to built-in system defaults
  for (const sys of SYSTEM_RULES) {
    if (sys.test(job)) {
      const elapsed = Date.now() - start;
      if (elapsed > 100) {
        console.warn(`[sieve] classification exceeded 100ms: ${elapsed}ms`);
      }
      return {
        action: sys.action,
        label: sys.label,
        matchedRuleId: null,
        replyTemplate: null,
        priority: false,
      };
    }
  }

  const elapsed = Date.now() - start;
  if (elapsed > 100) {
    console.warn(`[sieve] classification exceeded 100ms: ${elapsed}ms`);
  }

  return {
    action: "pass_through",
    label: null,
    matchedRuleId: null,
    replyTemplate: null,
    priority: false,
  };
}
