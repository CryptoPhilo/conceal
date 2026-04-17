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
  rawS3Key: string;
  receivedAt: string;
}

export type InboundEmailJobStatus = "pending" | "sieving" | "brain" | "delivered" | "dropped";
