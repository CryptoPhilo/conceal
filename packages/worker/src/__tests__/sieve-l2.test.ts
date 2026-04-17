import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";
import type { SievedJob } from "@shadow/shared";

const addMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("bullmq", () => {
  class Queue {
    add = addMock;
  }
  return { Queue };
});

vi.mock("../db.js", () => ({
  updateEmailLogSieve: vi.fn().mockResolvedValue(undefined),
}));

const { processSieveL2 } = await import("../workers/sieve-l2.js");
const { updateEmailLogSieve } = await import("../db.js");

function makeJob(overrides: Partial<SievedJob> = {}): Job<SievedJob> {
  const data: SievedJob = {
    messageId: "msg-001",
    maskingAddress: "mask@shadow.com",
    realAddress: "user@gmail.com",
    userId: "user-1",
    senderHash: "abc",
    subjectHash: "def",
    senderDomain: "example.com",
    senderLocalPart: "hello",
    subject: "Hello",
    rawS3Key: "emails/msg-001",
    receivedAt: new Date().toISOString(),
    sieveLabel: null,
    sieveAction: "pass_through",
    ...overrides,
  };
  return {
    data,
    log: vi.fn(),
  } as unknown as Job<SievedJob>;
}

const mockRedisConnection = {} as any;

function mockFetch(response: object, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(response),
  } as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
  addMock.mockResolvedValue(undefined);
});

describe("processSieveL2 — routing", () => {
  it("urgent label → routes to brain queue with priority 1", async () => {
    mockFetch({ label: "urgent", score: 0.92, priority: true });
    const job = makeJob({ subject: "URGENT: server is down" });
    await processSieveL2(job, mockRedisConnection);

    expect(addMock).toHaveBeenCalledWith(
      "l2-sieved",
      expect.objectContaining({ sieveLabel: "urgent" }),
      expect.objectContaining({ priority: 1 })
    );
  });

  it("newsletter label → routes to batch queue, priority 10", async () => {
    mockFetch({ label: "newsletter", score: 0.88, priority: false });
    const job = makeJob({ subject: "Weekly digest" });
    await processSieveL2(job, mockRedisConnection);

    expect(addMock).toHaveBeenCalledWith(
      "l2-sieved",
      expect.objectContaining({ sieveLabel: "newsletter" }),
      expect.objectContaining({ priority: 10 })
    );
  });

  it("spam label → drops (db action='drop'), no queue add", async () => {
    mockFetch({ label: "spam", score: 0.95, priority: false });
    const job = makeJob();
    await processSieveL2(job, mockRedisConnection);

    expect(updateEmailLogSieve).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      "spam",
      "drop"
    );
    expect(addMock).not.toHaveBeenCalled();
  });

  it("normal label → routes to brain queue, priority 10 (non-urgent)", async () => {
    mockFetch({ label: "normal", score: 0.75, priority: false });
    const job = makeJob({ subject: "Hey just checking in" });
    await processSieveL2(job, mockRedisConnection);

    expect(addMock).toHaveBeenCalledWith(
      "l2-sieved",
      expect.objectContaining({ sieveLabel: "normal" }),
      expect.objectContaining({ priority: 10 })
    );
  });

  it("service fetch failure → falls back to 'normal', still routes", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error"));
    const job = makeJob();
    await processSieveL2(job, mockRedisConnection);

    // Fallback is label=normal → brain queue
    expect(addMock).toHaveBeenCalled();
  });

  it("service returns non-ok status → falls back to normal", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: vi.fn() } as any);
    const job = makeJob();
    await processSieveL2(job, mockRedisConnection);

    expect(addMock).toHaveBeenCalled();
  });
});
