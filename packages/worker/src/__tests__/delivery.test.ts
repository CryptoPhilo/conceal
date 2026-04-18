import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";
import type { DeliveryJob } from "@shadow/shared";

vi.mock("../db.js", () => ({
  loadDeliveryDestinations: vi.fn().mockResolvedValue([]),
  markEmailDelivered: vi.fn().mockResolvedValue(undefined),
  loadUserLocale: vi.fn().mockResolvedValue("ko"),
}));

const { processDelivery } = await import("../workers/delivery.js");
const { loadDeliveryDestinations, markEmailDelivered } = await import("../db.js");

function makeJob(overrides: Partial<DeliveryJob> = {}): Job<DeliveryJob> {
  const data: DeliveryJob = {
    messageId: "msg-001",
    maskingAddress: "mask@shadow.com",
    realAddress: "user@gmail.com",
    userId: "user-1",
    senderHash: "abc",
    subjectHash: "def",
    senderDomain: "example.com",
    senderLocalPart: "hello",
    subject: "Test email",
    rawS3Key: "emails/msg-001",
    receivedAt: new Date().toISOString(),
    toAddresses: ["mask@shadow.com"],
    ccAddresses: [],
    sieveLabel: "normal",
    sieveAction: "pass_through",
    summary: "Test email summary",
    priorityScore: 65,
    brainAction: "deliver",
    ...overrides,
  };
  return {
    data,
    log: vi.fn(),
  } as unknown as Job<DeliveryJob>;
}

function makeRedis() {
  return {
    rpush: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: vi.fn() } as any);
});

describe("processDelivery — Slack", () => {
  it("calls Slack webhook with summary and priority score", async () => {
    (loadDeliveryDestinations as any).mockResolvedValueOnce([
      { id: "dest-1", type: "slack", configEnc: { webhookUrl: "https://hooks.slack.com/test" } },
    ]);

    const job = makeJob({ summary: "Important meeting", priorityScore: 80 });
    await processDelivery(job, makeRedis());

    expect(global.fetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/test",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Important meeting"),
      })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: expect.stringContaining("80") })
    );
  });

  it("Slack missing webhookUrl → skips without throwing", async () => {
    (loadDeliveryDestinations as any).mockResolvedValueOnce([
      { id: "dest-1", type: "slack", configEnc: {} },
    ]);
    const job = makeJob();
    await expect(processDelivery(job, makeRedis())).resolves.not.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Slack fetch fails → logs error, continues", async () => {
    (loadDeliveryDestinations as any).mockResolvedValueOnce([
      { id: "dest-1", type: "slack", configEnc: { webhookUrl: "https://hooks.slack.com/test" } },
    ]);
    global.fetch = vi.fn().mockRejectedValue(new Error("network error"));
    const job = makeJob();
    await expect(processDelivery(job, makeRedis())).resolves.not.toThrow();
  });
});

describe("processDelivery — Notion", () => {
  it("creates a Notion page with summary and priority", async () => {
    (loadDeliveryDestinations as any).mockResolvedValueOnce([
      { id: "dest-2", type: "notion", configEnc: { token: "secret_token", databaseId: "db-123" } },
    ]);

    const job = makeJob({ summary: "Invoice from vendor", priorityScore: 55 });
    await processDelivery(job, makeRedis());

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.notion.com/v1/pages",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Invoice from vendor"),
      })
    );
  });

  it("Notion missing token → skips without throwing", async () => {
    (loadDeliveryDestinations as any).mockResolvedValueOnce([
      { id: "dest-2", type: "notion", configEnc: { databaseId: "db-123" } },
    ]);
    await expect(processDelivery(makeJob(), makeRedis())).resolves.not.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("processDelivery — email_digest", () => {
  it("pushes summary to Redis digest list", async () => {
    (loadDeliveryDestinations as any).mockResolvedValueOnce([
      { id: "dest-3", type: "email_digest", configEnc: {} },
    ]);

    const redis = makeRedis();
    const job = makeJob({ userId: "user-99", summary: "Daily digest entry" });
    await processDelivery(job, redis);

    expect(redis.rpush).toHaveBeenCalledWith(
      "digest:user-99",
      expect.stringContaining("Daily digest entry")
    );
    expect(redis.expire).toHaveBeenCalledWith("digest:user-99", 86400);
  });
});

describe("processDelivery — multiple destinations", () => {
  it("delivers to all configured destinations", async () => {
    (loadDeliveryDestinations as any).mockResolvedValueOnce([
      { id: "dest-1", type: "slack", configEnc: { webhookUrl: "https://hooks.slack.com/test" } },
      { id: "dest-2", type: "notion", configEnc: { token: "tok", databaseId: "db-1" } },
    ]);

    const job = makeJob();
    await processDelivery(job, makeRedis());

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("processDelivery — replyDraft logging", () => {
  it("logs reply draft availability when present", async () => {
    (loadDeliveryDestinations as any).mockResolvedValueOnce([]);
    const job = makeJob({ brainAction: "reply", replyDraft: "Thanks for reaching out." });
    await processDelivery(job, makeRedis());
    expect(job.log).toHaveBeenCalledWith(
      expect.stringContaining("reply draft available")
    );
  });
});

describe("processDelivery — DB", () => {
  it("marks email as delivered in DB", async () => {
    (loadDeliveryDestinations as any).mockResolvedValueOnce([]);
    const job = makeJob({ senderHash: "sh1", subjectHash: "sh2", userId: "u1" });
    await processDelivery(job, makeRedis());
    expect(markEmailDelivered).toHaveBeenCalledWith("sh1", "sh2", "u1");
  });

  it("DB failure → does not throw", async () => {
    (loadDeliveryDestinations as any).mockRejectedValueOnce(new Error("db down"));
    const job = makeJob();
    await expect(processDelivery(job, makeRedis())).resolves.not.toThrow();
  });
});
