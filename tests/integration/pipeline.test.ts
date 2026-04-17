/**
 * Integration tests for the full email processing pipeline.
 *
 * Prerequisites (run before this suite):
 *   docker-compose -f docker-compose.test.yml up -d
 *
 * Env vars required:
 *   REDIS_URL=redis://localhost:6380
 *   DATABASE_URL=postgres://shadow:shadow_test@localhost:5433/shadow_test
 *   SIEVE_SERVICE_URL=http://localhost:8001
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Redis from "ioredis";
import { Queue, Worker, type Job } from "bullmq";
import { QUEUE_NAMES, type InboundEmailJob, type SievedJob, type DeliveryJob } from "@shadow/shared";
import { classify } from "../../packages/worker/src/sieve.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6380";
const SIEVE_SERVICE_URL = process.env.SIEVE_SERVICE_URL ?? "http://localhost:8001";

let redis: Redis;

beforeAll(async () => {
  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  // Wait for Redis to be ready
  await redis.ping();
});

afterAll(async () => {
  await redis.quit();
});

// ── Sieve Service health ──────────────────────────────────────────────────────

describe("Sieve Service L2", () => {
  it("GET /health returns ok", async () => {
    const res = await fetch(`${SIEVE_SERVICE_URL}/health`);
    expect(res.ok).toBe(true);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("POST /classify urgent → label=urgent, priority=true", async () => {
    const res = await fetch(`${SIEVE_SERVICE_URL}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "URGENT: server is down", sender_domain: "corp.com", sender_local: "cto" }),
    });
    expect(res.ok).toBe(true);
    const body = await res.json() as { label: string; priority: boolean };
    expect(body.label).toBe("urgent");
    expect(body.priority).toBe(true);
  });

  it("POST /classify newsletter local → label=newsletter", async () => {
    const res = await fetch(`${SIEVE_SERVICE_URL}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "Weekly update", sender_domain: "co.com", sender_local: "newsletter" }),
    });
    const body = await res.json() as { label: string };
    expect(body.label).toBe("newsletter");
  });

  it("POST /classify normal email → label=normal", async () => {
    const res = await fetch(`${SIEVE_SERVICE_URL}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "Can we meet tomorrow?", sender_domain: "friend.com", sender_local: "alice" }),
    });
    const body = await res.json() as { label: string };
    expect(body.label).toBe("normal");
  });
});

// ── Redis connectivity ────────────────────────────────────────────────────────

describe("Redis integration", () => {
  it("can push and pop from a list", async () => {
    const key = "test:integration:list";
    await redis.del(key);
    await redis.rpush(key, JSON.stringify({ summary: "test", ts: Date.now() }));
    const len = await redis.llen(key);
    expect(len).toBe(1);
    await redis.del(key);
  });

  it("digest key expires after TTL", async () => {
    const key = "digest:integration-test-user";
    await redis.rpush(key, "entry1");
    await redis.expire(key, 1);
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(1);
    await redis.del(key);
  });
});

// ── Sieve L1 classify — pipeline unit in integration context ─────────────────

describe("Sieve L1 classify (pure function)", () => {
  function makeJob(overrides: Partial<InboundEmailJob> = {}): InboundEmailJob {
    return {
      messageId: `msg-${Date.now()}`,
      maskingAddress: "mask@shadow.com",
      realAddress: "user@gmail.com",
      userId: "integration-user",
      senderHash: "abc",
      subjectHash: "def",
      senderDomain: "example.com",
      senderLocalPart: "hello",
      subject: "Test email",
      rawS3Key: "emails/test",
      receivedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it("spam email → auto_delete", () => {
    const result = classify(makeJob({ subject: "You've WON a lottery!" }), []);
    expect(result.action).toBe("auto_delete");
    expect(result.label).toBe("spam");
  });

  it("newsletter domain → quarantine", () => {
    const result = classify(makeJob({ senderDomain: "mailchimp.com" }), []);
    expect(result.action).toBe("quarantine");
    expect(result.label).toBe("newsletter");
  });

  it("normal email → pass_through", () => {
    const result = classify(makeJob({ subject: "Let's sync tomorrow" }), []);
    expect(result.action).toBe("pass_through");
  });
});

// ── BullMQ queue round-trip ───────────────────────────────────────────────────

describe("BullMQ queue round-trip", () => {
  it("enqueues and dequeues a test job", async () => {
    const testQueue = new Queue("integration-test", {
      connection: redis as any,
    });

    const received: unknown[] = [];

    const worker = new Worker(
      "integration-test",
      async (job: Job) => {
        received.push(job.data);
      },
      { connection: redis as any, autorun: true }
    );

    const payload = { test: true, ts: Date.now() };
    await testQueue.add("probe", payload);

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (received.length > 0) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
      setTimeout(() => { clearInterval(interval); resolve(); }, 5000);
    });

    expect(received.length).toBeGreaterThan(0);
    expect((received[0] as any).test).toBe(true);

    await worker.close();
    await testQueue.close();
  });
});
