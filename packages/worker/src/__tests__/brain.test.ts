import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";
import type { SievedJob } from "@shadow/shared";

// Hoist mocks so they're defined before module evaluation
const addMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const createMessageMock = vi.hoisted(() => vi.fn());
const updateEmailLogBrainMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const updateEmailLogPhase3Mock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const loadUserContextVectorsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const classifyPhase2Mock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    informationalCategory: "action_required",
    informationalConfidence: 0.88,
    workTypes: ["meeting"],
    workTypeConfidences: { meeting: 0.88 },
  })
);

vi.mock("bullmq", () => {
  class Queue {
    add = addMock;
  }
  return { Queue };
});

vi.mock("../db.js", () => ({
  updateEmailLogBrain: updateEmailLogBrainMock,
  updateEmailLogPhase3: updateEmailLogPhase3Mock,
  loadUserContextVectors: loadUserContextVectorsMock,
}));

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    beta = { promptCaching: { messages: { create: createMessageMock } } };
  }
  return { default: Anthropic };
});

vi.mock("../classifier-phase2.js", () => ({
  classifyPhase2: classifyPhase2Mock,
}));

const { processBrain } = await import("../workers/brain.js");

function makeSievedJob(overrides: Partial<SievedJob> = {}): Job<SievedJob> {
  const data: SievedJob = {
    messageId: "msg-001",
    maskingAddress: "mask@shadow.com",
    realAddress: "user@gmail.com",
    userId: "user-1",
    senderHash: "abc",
    subjectHash: "def",
    senderDomain: "example.com",
    senderLocalPart: "hello",
    subject: "Meeting tomorrow",
    rawS3Key: "emails/msg-001",
    receivedAt: new Date().toISOString(),
    toAddresses: ["mask@shadow.com"],
    ccAddresses: [],
    sieveLabel: "normal",
    sieveAction: "pass_through",
    ...overrides,
  };
  return {
    data,
    log: vi.fn(),
  } as unknown as Job<SievedJob>;
}

const mockRedisConnection = {} as any;

function makeClaudeResponse(json: object) {
  return {
    content: [{ type: "text", text: JSON.stringify(json) }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  addMock.mockResolvedValue(undefined);
  updateEmailLogBrainMock.mockResolvedValue(undefined);
  updateEmailLogPhase3Mock.mockResolvedValue(undefined);
  loadUserContextVectorsMock.mockResolvedValue([]);
  classifyPhase2Mock.mockResolvedValue({
    informationalCategory: "action_required",
    informationalConfidence: 0.88,
    workTypes: ["meeting"],
    workTypeConfidences: { meeting: 0.88 },
  });
});

describe("processBrain — valid Claude response", () => {
  it("parses deliver action and pushes to delivery queue", async () => {
    createMessageMock.mockResolvedValueOnce(
      makeClaudeResponse({ summary: "Meeting request from John", priorityScore: 72, action: "deliver" })
    );

    const job = makeSievedJob();
    await processBrain(job, mockRedisConnection);

    expect(updateEmailLogBrainMock).toHaveBeenCalledWith(
      "abc", "def", "user-1",
      "Meeting request from John",
      72,
      "delivered",
      "action_required",
      ["meeting"]
    );

    expect(addMock).toHaveBeenCalledWith(
      "delivery",
      expect.objectContaining({
        summary: "Meeting request from John",
        priorityScore: 72,
        brainAction: "deliver",
        informationalCategory: "action_required",
        workTypes: ["meeting"],
      }),
      expect.any(Object)
    );
  });

  it("parses reply action with replyDraft", async () => {
    createMessageMock.mockResolvedValueOnce(
      makeClaudeResponse({
        summary: "Vendor wants a meeting",
        priorityScore: 30,
        action: "reply",
        replyDraft: "Thanks for reaching out, I'm not interested.",
      })
    );

    const job = makeSievedJob({ sieveLabel: "normal" });
    await processBrain(job, mockRedisConnection);

    expect(updateEmailLogBrainMock).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), expect.any(String),
      "Vendor wants a meeting", 30, "replied",
      "action_required", ["meeting"]
    );

    expect(addMock).toHaveBeenCalledWith(
      "delivery",
      expect.objectContaining({
        brainAction: "reply",
        replyDraft: "Thanks for reaching out, I'm not interested.",
        informationalCategory: "action_required",
        workTypes: ["meeting"],
      }),
      expect.any(Object)
    );
  });

  it("parses JSON inside markdown code block", async () => {
    createMessageMock.mockResolvedValueOnce({
      content: [{
        type: "text",
        text: '```json\n{"summary":"Invoice","priorityScore":60,"action":"deliver"}\n```',
      }],
    });

    const job = makeSievedJob();
    await processBrain(job, mockRedisConnection);

    expect(addMock).toHaveBeenCalledWith(
      "delivery",
      expect.objectContaining({ summary: "Invoice", priorityScore: 60 }),
      expect.any(Object)
    );
  });
});

describe("processBrain — fallback on invalid response", () => {
  it("invalid JSON → falls back to domain-based summary", async () => {
    createMessageMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "not json at all" }],
    });

    const job = makeSievedJob({ senderDomain: "example.com" });
    await processBrain(job, mockRedisConnection);

    const callArgs = addMock.mock.calls[0][1] as any;
    expect(callArgs.summary).toContain("example.com");
    expect(callArgs.priorityScore).toBe(50);
  });

  it("missing required fields → falls back", async () => {
    createMessageMock.mockResolvedValueOnce(
      makeClaudeResponse({ summary: "Only summary" })
    );

    const job = makeSievedJob({ senderDomain: "acme.org" });
    await processBrain(job, mockRedisConnection);

    const callArgs = addMock.mock.calls[0][1] as any;
    expect(callArgs.summary).toContain("acme.org");
  });

  it("Anthropic API throws → falls back gracefully", async () => {
    createMessageMock.mockRejectedValueOnce(new Error("rate limit"));

    const job = makeSievedJob({ senderDomain: "sender.io" });
    await processBrain(job, mockRedisConnection);

    const callArgs = addMock.mock.calls[0][1] as any;
    expect(callArgs.summary).toContain("sender.io");
  });

  it("empty content array → falls back", async () => {
    createMessageMock.mockResolvedValueOnce({ content: [] });
    const job = makeSievedJob({ senderDomain: "empty.com" });
    await processBrain(job, mockRedisConnection);
    expect(addMock).toHaveBeenCalled();
  });
});

describe("processBrain — user context vectors", () => {
  it("loads user context vectors for the correct userId", async () => {
    loadUserContextVectorsMock.mockResolvedValueOnce(["I work in finance", "Prefer morning meetings"]);
    createMessageMock.mockResolvedValueOnce(
      makeClaudeResponse({ summary: "Meeting", priorityScore: 80, action: "deliver" })
    );

    const job = makeSievedJob({ userId: "user-with-context" });
    await processBrain(job, mockRedisConnection);

    expect(loadUserContextVectorsMock).toHaveBeenCalledWith("user-with-context");
    expect(createMessageMock).toHaveBeenCalled();
  });

  it("context vector load fails → still processes with empty context", async () => {
    loadUserContextVectorsMock.mockRejectedValueOnce(new Error("db error"));
    createMessageMock.mockResolvedValueOnce(
      makeClaudeResponse({ summary: "Fallback email", priorityScore: 40, action: "deliver" })
    );

    const job = makeSievedJob();
    await processBrain(job, mockRedisConnection);

    expect(addMock).toHaveBeenCalled();
  });
});
