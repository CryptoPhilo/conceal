import { describe, it, expect } from "vitest";
import { groupEmails, type EmailRecord } from "../email-grouper.js";

function makeEmail(overrides: Partial<EmailRecord> = {}): EmailRecord {
  return {
    senderDomain: "example.com",
    sieveLabel: "normal",
    workTypes: [],
    informationalCategory: null,
    priorityScore: null,
    summary: null,
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("groupEmails — work-type grouping", () => {
  it("assigns emails with no work_types to 'other'", () => {
    const result = groupEmails([makeEmail({ workTypes: [] })]);
    const other = result.workTypes.find((g) => g.workType === "other");
    expect(other).toBeDefined();
    expect(other!.count).toBe(1);
  });

  it("groups emails by each of their work_types (multi-type fan-out)", () => {
    const email = makeEmail({ workTypes: ["contract", "meeting"] });
    const result = groupEmails([email]);
    const contract = result.workTypes.find((g) => g.workType === "contract");
    const meeting = result.workTypes.find((g) => g.workType === "meeting");
    expect(contract!.count).toBe(1);
    expect(meeting!.count).toBe(1);
  });

  it("sorts groups by count descending", () => {
    const emails = [
      makeEmail({ workTypes: ["meeting"] }),
      makeEmail({ workTypes: ["meeting"] }),
      makeEmail({ workTypes: ["contract"] }),
    ];
    const result = groupEmails(emails);
    expect(result.workTypes[0].workType).toBe("meeting");
  });

  it("includes non-null summaries per work-type group", () => {
    const emails = [
      makeEmail({ workTypes: ["report"], summary: "Q1 report summary" }),
      makeEmail({ workTypes: ["report"], summary: null }),
    ];
    const result = groupEmails(emails);
    const report = result.workTypes.find((g) => g.workType === "report")!;
    expect(report.summaries).toEqual(["Q1 report summary"]);
  });

  it("returns empty workTypes when no emails", () => {
    const result = groupEmails([]);
    expect(result.workTypes).toHaveLength(0);
    expect(result.totalEmails).toBe(0);
  });
});

describe("groupEmails — sender grouping", () => {
  it("aggregates emails by sender_domain", () => {
    const emails = [
      makeEmail({ senderDomain: "acme.com" }),
      makeEmail({ senderDomain: "acme.com" }),
      makeEmail({ senderDomain: "other.com" }),
    ];
    const result = groupEmails(emails);
    const acme = result.topSenders.find((s) => s.senderDomain === "acme.com")!;
    expect(acme.count).toBe(2);
  });

  it("skips emails with null sender_domain", () => {
    const emails = [makeEmail({ senderDomain: null })];
    const result = groupEmails(emails);
    expect(result.topSenders).toHaveLength(0);
  });

  it("collects unique labels per sender", () => {
    const emails = [
      makeEmail({ senderDomain: "news.com", sieveLabel: "newsletter" }),
      makeEmail({ senderDomain: "news.com", sieveLabel: "newsletter" }),
      makeEmail({ senderDomain: "news.com", sieveLabel: "promo" }),
    ];
    const result = groupEmails(emails);
    const sender = result.topSenders[0];
    expect(sender.labels.sort()).toEqual(["newsletter", "promo"]);
  });

  it("includes summaries per sender group", () => {
    const emails = [
      makeEmail({ senderDomain: "partner.com", summary: "Invoice received" }),
      makeEmail({ senderDomain: "partner.com", summary: null }),
      makeEmail({ senderDomain: "partner.com", summary: "Contract update" }),
    ];
    const result = groupEmails(emails);
    const sender = result.topSenders[0];
    expect(sender.summaries).toEqual(["Invoice received", "Contract update"]);
  });

  it("limits top senders to 20", () => {
    const emails = Array.from({ length: 25 }, (_, i) =>
      makeEmail({ senderDomain: `domain${i}.com` })
    );
    const result = groupEmails(emails);
    expect(result.topSenders).toHaveLength(20);
  });
});

describe("groupEmails — urgent grouping", () => {
  it("includes emails with sieve_label=urgent", () => {
    const email = makeEmail({ sieveLabel: "urgent", priorityScore: 50 });
    const result = groupEmails([email]);
    expect(result.urgent.count).toBe(1);
  });

  it("includes emails with priority_score >= 80", () => {
    const email = makeEmail({ sieveLabel: "normal", priorityScore: 85 });
    const result = groupEmails([email]);
    expect(result.urgent.count).toBe(1);
  });

  it("excludes emails with priority_score < 80 and non-urgent label", () => {
    const email = makeEmail({ sieveLabel: "normal", priorityScore: 70 });
    const result = groupEmails([email]);
    expect(result.urgent.count).toBe(0);
  });

  it("sorts urgent emails by priority_score descending", () => {
    const emails = [
      makeEmail({ sieveLabel: "urgent", priorityScore: 60 }),
      makeEmail({ sieveLabel: "urgent", priorityScore: 90 }),
    ];
    const result = groupEmails(emails);
    expect(result.urgent.emails[0].priorityScore).toBe(90);
  });

  it("caps urgent list at 20 entries", () => {
    const emails = Array.from({ length: 25 }, () =>
      makeEmail({ sieveLabel: "urgent" })
    );
    const result = groupEmails(emails);
    expect(result.urgent.emails).toHaveLength(20);
    expect(result.urgent.count).toBe(25);
  });
});

describe("groupEmails — totalEmails", () => {
  it("counts all input emails", () => {
    const emails = Array.from({ length: 10 }, () => makeEmail());
    const result = groupEmails(emails);
    expect(result.totalEmails).toBe(10);
  });
});
