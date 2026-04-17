/**
 * Integration tests for Sieve L2 HTTP service.
 * Requires: sieve-service running at SIEVE_SERVICE_URL (default: http://localhost:8001)
 * Start: cd packages/sieve-service && uvicorn main:app --port 8001
 */
import { describe, it, expect } from "vitest";

const BASE = process.env.SIEVE_SERVICE_URL ?? "http://127.0.0.1:8001";

async function classify(subject: string, senderDomain: string, senderLocal: string) {
  const res = await fetch(`${BASE}/classify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject, sender_domain: senderDomain, sender_local: senderLocal }),
  });
  if (!res.ok) throw new Error(`classify returned ${res.status}`);
  return res.json() as Promise<{ label: string; score: number; priority: boolean }>;
}

describe("Sieve Service L2 — live HTTP", () => {
  it("GET /health → ok:true", async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.ok).toBe(true);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("urgent subject → label=urgent, priority=true", async () => {
    const body = await classify("URGENT: deploy failed", "corp.com", "cto");
    expect(body.label).toBe("urgent");
    expect(body.priority).toBe(true);
  });

  it("IMPORTANT subject → label=urgent", async () => {
    const body = await classify("IMPORTANT: please review this PR", "dev.com", "alice");
    expect(body.label).toBe("urgent");
  });

  it("ACTION REQUIRED subject → label=urgent", async () => {
    const body = await classify("ACTION REQUIRED: renew certificate", "corp.com", "ops");
    expect(body.label).toBe("urgent");
  });

  it("newsletter sender local → label=newsletter", async () => {
    const body = await classify("This week's digest", "company.com", "newsletter");
    expect(body.label).toBe("newsletter");
    expect(body.priority).toBe(false);
  });

  it("noreply sender → label=newsletter", async () => {
    const body = await classify("Your account notification", "service.com", "noreply");
    expect(body.label).toBe("newsletter");
  });

  it("normal email → label=normal", async () => {
    const body = await classify("Can we meet tomorrow?", "friend.com", "alice");
    expect(body.label).toBe("normal");
    expect(body.priority).toBe(false);
  });

  it("score is between 0 and 1 for all labels", async () => {
    const cases = [
      { subject: "URGENT: act now", domain: "x.com", local: "cto" },
      { subject: "Latest newsletter", domain: "x.com", local: "newsletter" },
      { subject: "Hi there", domain: "x.com", local: "john" },
    ];
    for (const c of cases) {
      const body = await classify(c.subject, c.domain, c.local);
      expect(body.score).toBeGreaterThanOrEqual(0);
      expect(body.score).toBeLessThanOrEqual(1);
    }
  });

  it("response has label, score, priority fields", async () => {
    const body = await classify("Test email", "example.com", "user");
    expect(typeof body.label).toBe("string");
    expect(typeof body.score).toBe("number");
    expect(typeof body.priority).toBe("boolean");
  });
});
