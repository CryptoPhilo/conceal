export const QUEUE_NAMES = {
  INBOUND: "email:inbound",
  SIEVE: "email:sieve",
  BRAIN: "email:brain",
  BRAIN_BATCH: "email:brain:batch",
  DELIVERY: "email:delivery",
  EMAIL_ANALYSIS: "email-analysis",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
