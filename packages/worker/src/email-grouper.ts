import type { WorkType } from "./classifier-phase2.js";

export interface EmailRecord {
  senderDomain: string | null;
  sieveLabel: string | null;
  workTypes: string[];
  informationalCategory: string | null;
  priorityScore: number | null;
  summary: string | null;
  receivedAt: string | Date;
}

export interface WorkTypeGroup {
  workType: WorkType | "other";
  count: number;
  emails: EmailRecord[];
}

export interface SenderGroup {
  senderDomain: string;
  count: number;
  labels: string[];
  topWorkTypes: string[];
}

export interface GroupedView {
  workTypes: WorkTypeGroup[];
  topSenders: SenderGroup[];
  urgent: { count: number; emails: EmailRecord[] };
  totalEmails: number;
}

const WORK_TYPES: (WorkType | "other")[] = [
  "contract", "meeting", "cs", "report", "hiring", "payment", "other",
];

export function groupEmails(emails: EmailRecord[]): GroupedView {
  // ── Work-type groups ─────────────────────────────────────────────────────
  const workTypeBuckets = new Map<string, EmailRecord[]>();
  for (const wt of WORK_TYPES) workTypeBuckets.set(wt, []);

  for (const email of emails) {
    const types = email.workTypes.length > 0 ? email.workTypes : ["other"];
    for (const wt of types) {
      const bucket = workTypeBuckets.get(wt) ?? workTypeBuckets.get("other")!;
      bucket.push(email);
    }
  }

  const workTypeGroups: WorkTypeGroup[] = WORK_TYPES
    .map((wt) => ({ workType: wt, count: workTypeBuckets.get(wt)!.length, emails: workTypeBuckets.get(wt)! }))
    .filter((g) => g.count > 0)
    .sort((a, b) => b.count - a.count);

  // ── Sender groups ────────────────────────────────────────────────────────
  const senderMap = new Map<string, { emails: EmailRecord[]; labels: Set<string>; workTypes: Set<string> }>();

  for (const email of emails) {
    if (!email.senderDomain) continue;
    if (!senderMap.has(email.senderDomain)) {
      senderMap.set(email.senderDomain, { emails: [], labels: new Set(), workTypes: new Set() });
    }
    const entry = senderMap.get(email.senderDomain)!;
    entry.emails.push(email);
    if (email.sieveLabel) entry.labels.add(email.sieveLabel);
    for (const wt of email.workTypes) entry.workTypes.add(wt);
  }

  const topSenders: SenderGroup[] = Array.from(senderMap.entries())
    .map(([domain, d]) => ({
      senderDomain: domain,
      count: d.emails.length,
      labels: Array.from(d.labels),
      topWorkTypes: Array.from(d.workTypes),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // ── Urgent group ─────────────────────────────────────────────────────────
  const urgentEmails = emails
    .filter((e) => e.sieveLabel === "urgent" || (e.priorityScore != null && e.priorityScore >= 80))
    .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));

  return {
    workTypes: workTypeGroups,
    topSenders,
    urgent: { count: urgentEmails.length, emails: urgentEmails.slice(0, 20) },
    totalEmails: emails.length,
  };
}
