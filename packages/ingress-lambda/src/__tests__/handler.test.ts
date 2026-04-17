import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SESEvent } from "aws-lambda";

const s3SendMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const queueAddMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const lookupMaskingMock = vi.hoisted(() => vi.fn());
const getUserEmailMock = vi.hoisted(() => vi.fn());
const insertEmailLogMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const sendBounceMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    send = s3SendMock;
  }
  class DeleteObjectCommand {
    constructor(public input: unknown) {}
  }
  return { S3Client, DeleteObjectCommand };
});

vi.mock("ioredis", () => {
  class Redis {
    constructor() {}
  }
  return { default: Redis };
});

vi.mock("bullmq", () => {
  class Queue {
    add = queueAddMock;
  }
  return { Queue };
});

vi.mock("../db.js", () => ({
  lookupMasking: lookupMaskingMock,
  getUserEmail: getUserEmailMock,
  insertEmailLog: insertEmailLogMock,
}));

vi.mock("../bounce.js", () => ({
  sendBounce: sendBounceMock,
}));

process.env.REDIS_URL = "redis://localhost:6379";
process.env.SES_BUCKET_NAME = "test-bucket";

const { handler } = await import("../handler.js");

function makeSESEvent(
  recipients: string[],
  fromAddresses: string[],
  subject = "Test subject"
): SESEvent {
  return {
    Records: [
      {
        ses: {
          mail: {
            messageId: "test-msg-123",
            commonHeaders: {
              from: fromAddresses,
              subject,
            },
          },
          receipt: {
            recipients,
            action: {} as any,
            processingTimeMillis: 100,
            spamVerdict: { status: "PASS" },
            virusVerdict: { status: "PASS" },
            spfVerdict: { status: "PASS" },
            dkimVerdict: { status: "PASS" },
            dmarcVerdict: { status: "PASS" },
          } as any,
        },
        eventSource: "aws:ses",
        eventVersion: "1.0",
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  s3SendMock.mockResolvedValue({});
  queueAddMock.mockResolvedValue(undefined);
  insertEmailLogMock.mockResolvedValue(undefined);
  sendBounceMock.mockResolvedValue(undefined);
});

describe("handler — successful inbound email", () => {
  it("enqueues BullMQ job with hashed sender/subject", async () => {
    lookupMaskingMock.mockResolvedValueOnce({ id: "mask-1", user_id: "user-1", active: true });
    getUserEmailMock.mockResolvedValueOnce("user@gmail.com");

    await handler(
      makeSESEvent(["mask@shadow.com"], ["John Doe <john@example.com>"], "Hello"),
      {} as any,
      vi.fn()
    );

    const jobData = queueAddMock.mock.calls[0][1] as any;
    expect(jobData.maskingAddress).toBe("mask@shadow.com");
    expect(jobData.userId).toBe("user-1");
    expect(jobData.senderDomain).toBe("example.com");
    expect(jobData.senderLocalPart).toBe("john");
    expect(jobData.senderHash).toHaveLength(64);
    expect(jobData.subjectHash).toHaveLength(64);
    expect(jobData.subject).toBe("Hello");
  });

  it("deletes raw email from S3 after processing", async () => {
    lookupMaskingMock.mockResolvedValueOnce({ id: "m1", user_id: "u1", active: true });
    getUserEmailMock.mockResolvedValueOnce("user@gmail.com");

    await handler(
      makeSESEvent(["mask@shadow.com"], ["sender@example.com"]),
      {} as any,
      vi.fn()
    );

    expect(s3SendMock).toHaveBeenCalled();
  });

  it("extracts sender domain from angle-bracket format", async () => {
    lookupMaskingMock.mockResolvedValueOnce({ id: "m1", user_id: "u1", active: true });
    getUserEmailMock.mockResolvedValueOnce("user@gmail.com");

    await handler(
      makeSESEvent(["mask@shadow.com"], ["Alice <alice@company.io>"]),
      {} as any,
      vi.fn()
    );

    const jobData = queueAddMock.mock.calls[0][1] as any;
    expect(jobData.senderDomain).toBe("company.io");
    expect(jobData.senderLocalPart).toBe("alice");
  });
});

describe("handler — bounce cases", () => {
  it("unknown masking address → sends bounce", async () => {
    lookupMaskingMock.mockResolvedValueOnce(null);

    await handler(
      makeSESEvent(["unknown@shadow.com"], ["sender@example.com"]),
      {} as any,
      vi.fn()
    );

    expect(sendBounceMock).toHaveBeenCalledWith("unknown@shadow.com", "sender@example.com");
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("inactive masking address → logs 'bounced' to DB and sends bounce", async () => {
    lookupMaskingMock.mockResolvedValueOnce({ id: "m1", user_id: "u1", active: false });

    await handler(
      makeSESEvent(["inactive@shadow.com"], ["sender@example.com"]),
      {} as any,
      vi.fn()
    );

    expect(insertEmailLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ actionTaken: "bounced" })
    );
    expect(sendBounceMock).toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("user email not found → sends bounce without enqueuing", async () => {
    lookupMaskingMock.mockResolvedValueOnce({ id: "m1", user_id: "u1", active: true });
    getUserEmailMock.mockResolvedValueOnce(null);

    await handler(
      makeSESEvent(["mask@shadow.com"], ["sender@example.com"]),
      {} as any,
      vi.fn()
    );

    expect(sendBounceMock).toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();
  });
});

describe("handler — multiple recipients", () => {
  it("processes each recipient independently", async () => {
    lookupMaskingMock
      .mockResolvedValueOnce({ id: "m1", user_id: "u1", active: true })
      .mockResolvedValueOnce({ id: "m2", user_id: "u2", active: true });
    getUserEmailMock
      .mockResolvedValueOnce("user1@gmail.com")
      .mockResolvedValueOnce("user2@gmail.com");

    await handler(
      makeSESEvent(["mask1@shadow.com", "mask2@shadow.com"], ["sender@example.com"]),
      {} as any,
      vi.fn()
    );

    expect(lookupMaskingMock).toHaveBeenCalledTimes(2);
    expect(queueAddMock).toHaveBeenCalledTimes(2);
  });
});
