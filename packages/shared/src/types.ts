export interface User {
  id: string;
  email: string;
  plan: "free" | "pro" | "team";
  byokKeyEnc?: string | null;
  createdAt: Date;
}

export interface MaskingAddress {
  id: string;
  userId: string;
  address: string;
  label?: string | null;
  active: boolean;
  createdAt: Date;
}

export interface FilterRule {
  id: string;
  userId: string;
  priority: number;
  ruleType: "regex" | "keyword" | "sender_domain" | "sieve_label";
  pattern: string;
  action: "drop" | "batch" | "priority" | "reply";
  replyTemplate?: string | null;
  active: boolean;
  createdAt: Date;
}

export interface EmailLogEntry {
  id: string;
  userId: string;
  maskingAddressId?: string | null;
  senderHash: string;
  subjectHash: string;
  receivedAt: Date;
  sieveLabel?: string | null;
  priorityScore?: number | null;
  summary?: string | null;
  actionTaken: "drop" | "delivered" | "replied" | "batched" | "bounced";
  deliveredAt?: Date | null;
}

export interface InboundEmailJob {
  messageId: string;
  maskingAddress: string;
  realAddress: string;
  userId: string;
  senderHash: string;
  subjectHash: string;
  /** Sender domain extracted from envelope From header — ephemeral, never stored in DB */
  senderDomain: string;
  /** Local part of the sender address (before @) — ephemeral, never stored in DB */
  senderLocalPart: string;
  /** Email subject — ephemeral in Redis (TTL 5 min), never stored in DB */
  subject: string;
  rawS3Key: string;
  receivedAt: string;
}

export type InboundEmailJobStatus = "pending" | "sieving" | "brain" | "delivered" | "dropped";

export type SievedJob = InboundEmailJob & { sieveLabel: string | null; sieveAction: string };

export type DeliveryJob = SievedJob & {
  summary: string;
  priorityScore: number;
  brainAction: "deliver" | "reply";
  replyDraft?: string;
};

export type SieveAction = "pass_through" | "quarantine" | "auto_delete";

export interface SieveResult {
  action: SieveAction;
  /** Human-readable label stored in email_log.sieve_label */
  label: string | null;
  /** DB rule id that triggered this result, or null for built-in defaults */
  matchedRuleId: string | null;
  /** Reply template body, only set when action is pass_through and a reply rule fired */
  replyTemplate: string | null;
  /** Whether this email should jump to the priority Brain queue */
  priority: boolean;
}
