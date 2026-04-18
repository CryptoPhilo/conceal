import { describe, it, expect } from "vitest";
import { classify } from "../sieve.js";
import type { InboundEmailJob } from "@shadow/shared";

function makeJob(overrides: Partial<InboundEmailJob> = {}): InboundEmailJob {
  return {
    messageId: "msg-001",
    maskingAddress: "mask@example.shadow.com",
    realAddress: "user@gmail.com",
    userId: "user-1",
    senderHash: "abc123",
    subjectHash: "def456",
    senderDomain: "example.com",
    senderLocalPart: "hello",
    subject: "Hello from a friend",
    rawS3Key: "emails/msg-001",
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("classify — built-in spam rules", () => {
  it("detects spam subject → auto_delete", () => {
    const result = classify(makeJob({ subject: "You've WON a lottery!" }), []);
    expect(result.action).toBe("auto_delete");
    expect(result.label).toBe("spam");
    expect(result.matchedRuleId).toBeNull();
  });

  it("detects 'make money fast' spam → auto_delete", () => {
    const result = classify(makeJob({ subject: "Make money fast today!" }), []);
    expect(result.action).toBe("auto_delete");
    expect(result.label).toBe("spam");
  });

  it("detects cheap pills spam → auto_delete", () => {
    const result = classify(makeJob({ subject: "Cheapest pills online" }), []);
    expect(result.action).toBe("auto_delete");
    expect(result.label).toBe("spam");
  });
});

describe("classify — built-in system_notification rules", () => {
  it("noreply sender → quarantine", () => {
    const result = classify(makeJob({ senderLocalPart: "noreply" }), []);
    expect(result.action).toBe("quarantine");
    expect(result.label).toBe("system_notification");
  });

  it("no-reply sender → quarantine", () => {
    const result = classify(makeJob({ senderLocalPart: "no-reply" }), []);
    expect(result.action).toBe("quarantine");
    expect(result.label).toBe("system_notification");
  });

  it("notifications sender → quarantine", () => {
    const result = classify(makeJob({ senderLocalPart: "notifications" }), []);
    expect(result.action).toBe("quarantine");
    expect(result.label).toBe("system_notification");
  });
});

describe("classify — built-in newsletter rules", () => {
  it("unsubscribe in subject → quarantine", () => {
    const result = classify(makeJob({ subject: "Click to unsubscribe from our list" }), []);
    expect(result.action).toBe("quarantine");
    expect(result.label).toBe("newsletter");
  });

  it("newsletter keyword in subject → quarantine", () => {
    const result = classify(makeJob({ subject: "Weekly newsletter from us" }), []);
    expect(result.action).toBe("quarantine");
    expect(result.label).toBe("newsletter");
  });

  it("mailchimp sender domain → quarantine", () => {
    const result = classify(makeJob({ senderDomain: "mailchimp.com" }), []);
    expect(result.action).toBe("quarantine");
    expect(result.label).toBe("newsletter");
  });

  it("sendgrid sender domain → quarantine", () => {
    const result = classify(makeJob({ senderDomain: "sendgrid.net" }), []);
    expect(result.action).toBe("quarantine");
    expect(result.label).toBe("newsletter");
  });

  it("substack sender domain → quarantine", () => {
    const result = classify(makeJob({ senderDomain: "substack.com" }), []);
    expect(result.action).toBe("quarantine");
    expect(result.label).toBe("newsletter");
  });
});

describe("classify — normal email → pass_through", () => {
  it("legitimate email with no matches → pass_through", () => {
    const result = classify(
      makeJob({ subject: "Meeting tomorrow at 10am", senderLocalPart: "john", senderDomain: "company.com" }),
      []
    );
    expect(result.action).toBe("pass_through");
    expect(result.label).toBeNull();
    expect(result.priority).toBe(false);
  });
});

describe("classify — user rules take precedence", () => {
  const baseRules = [
    {
      id: "rule-1",
      rule_type: "sender_domain" as const,
      pattern: "trusted.com",
      action: "priority" as const,
      reply_template: null,
    },
  ];

  it("user sender_domain rule matches → priority pass_through", () => {
    const result = classify(makeJob({ senderDomain: "trusted.com" }), baseRules);
    expect(result.action).toBe("pass_through");
    expect(result.priority).toBe(true);
    expect(result.matchedRuleId).toBe("rule-1");
  });

  it("user sender_domain rule with subdomain matches → priority pass_through", () => {
    const result = classify(makeJob({ senderDomain: "mail.trusted.com" }), baseRules);
    expect(result.action).toBe("pass_through");
    expect(result.priority).toBe(true);
  });

  it("user keyword rule → matches on subject", () => {
    const rules = [{ id: "rule-2", rule_type: "keyword" as const, pattern: "invoice", action: "priority" as const, reply_template: null }];
    const result = classify(makeJob({ subject: "Your invoice #1234" }), rules);
    expect(result.action).toBe("pass_through");
    expect(result.priority).toBe(true);
    expect(result.matchedRuleId).toBe("rule-2");
  });

  it("user drop rule overrides built-in pass_through", () => {
    const rules = [{ id: "rule-3", rule_type: "sender_domain" as const, pattern: "example.com", action: "drop" as const, reply_template: null }];
    const result = classify(makeJob({ senderDomain: "example.com", subject: "Normal email" }), rules);
    expect(result.action).toBe("auto_delete");
    expect(result.matchedRuleId).toBe("rule-3");
  });

  it("user batch rule → quarantine", () => {
    const rules = [{ id: "rule-4", rule_type: "keyword" as const, pattern: "promo", action: "batch" as const, reply_template: null }];
    const result = classify(makeJob({ subject: "Promo offer for you" }), rules);
    expect(result.action).toBe("quarantine");
    expect(result.priority).toBe(false);
  });

  it("user reply rule → pass_through with replyTemplate", () => {
    const rules = [{ id: "rule-5", rule_type: "keyword" as const, pattern: "vacation", action: "reply" as const, reply_template: "I am on vacation." }];
    const result = classify(makeJob({ subject: "Are you on vacation?" }), rules);
    expect(result.action).toBe("pass_through");
    expect(result.replyTemplate).toBe("I am on vacation.");
  });

  it("user regex rule → matches on subject", () => {
    const rules = [{ id: "rule-6", rule_type: "regex" as const, pattern: "^URGENT:", action: "priority" as const, reply_template: null }];
    const result = classify(makeJob({ subject: "URGENT: server down" }), rules);
    expect(result.action).toBe("pass_through");
    expect(result.priority).toBe(true);
  });

  it("user regex rule → invalid regex → does not crash, returns no match", () => {
    const rules = [{ id: "rule-7", rule_type: "regex" as const, pattern: "[invalid", action: "priority" as const, reply_template: null }];
    const result = classify(makeJob({ subject: "test" }), rules);
    expect(result.action).toBe("pass_through");
    expect(result.matchedRuleId).toBeNull();
  });

  it("user rules are applied in order — first match wins", () => {
    const rules = [
      { id: "rule-a", rule_type: "keyword" as const, pattern: "urgent", action: "priority" as const, reply_template: null },
      { id: "rule-b", rule_type: "keyword" as const, pattern: "urgent", action: "drop" as const, reply_template: null },
    ];
    const result = classify(makeJob({ subject: "urgent request" }), rules);
    expect(result.matchedRuleId).toBe("rule-a");
    expect(result.action).toBe("pass_through");
  });
});

describe("classify — Korean ad detection (CON-61)", () => {
  it("(광고) prefix → auto_delete spam", () => {
    const result = classify(makeJob({ subject: "(광고) 강남구 AI 교육 안내" }), []);
    expect(result.action).toBe("auto_delete");
    expect(result.label).toBe("spam");
  });

  it("[광고] prefix → auto_delete spam", () => {
    const result = classify(makeJob({ subject: "[광고] 중소기업 인턴십 모집" }), []);
    expect(result.action).toBe("auto_delete");
    expect(result.label).toBe("spam");
  });

  it("(홍보) prefix → auto_delete spam", () => {
    const result = classify(makeJob({ subject: "(홍보) 이벤트 안내" }), []);
    expect(result.action).toBe("auto_delete");
    expect(result.label).toBe("spam");
  });
});

describe("classify — social media domain detection (CON-62)", () => {
  it("Instagram notification domain → newsletter", () => {
    const result = classify(makeJob({ senderDomain: "mail.instagram.com" }), []);
    expect(result.action).toBe("quarantine");
    expect(result.label).toBe("newsletter");
  });

  it("Facebook mail domain → newsletter", () => {
    const result = classify(makeJob({ senderDomain: "facebookmail.com" }), []);
    expect(result.action).toBe("quarantine");
    expect(result.label).toBe("newsletter");
  });

  it("Twitter mail domain → newsletter", () => {
    const result = classify(makeJob({ senderDomain: "twittermail.com" }), []);
    expect(result.action).toBe("quarantine");
    expect(result.label).toBe("newsletter");
  });
});

describe("classify — Korean newsletter detection (CON-64)", () => {
  it("뉴스레터 in subject → quarantine newsletter", () => {
    const result = classify(makeJob({ subject: "이번 달 뉴스레터를 보내드립니다" }), []);
    expect(result.action).toBe("quarantine");
    expect(result.label).toBe("newsletter");
  });

  it("레터 in subject → quarantine newsletter", () => {
    const result = classify(makeJob({ subject: "주간 레터: 이번 주 소식" }), []);
    expect(result.action).toBe("quarantine");
    expect(result.label).toBe("newsletter");
  });
});

describe("classify — performance", () => {
  it("classifies 1000 emails in under 200ms total", () => {
    const job = makeJob({ subject: "Normal email from a friend" });
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      classify(job, []);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
  });
});
