import { describe, it, expect, vi, beforeEach } from "vitest";

const createMessageMock = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    beta = { promptCaching: { messages: { create: createMessageMock } } };
  }
  return { default: Anthropic };
});

const { classifyPhase2 } = await import("../classifier-phase2.js");

function makeLLMResponse(json: object) {
  return { content: [{ type: "text", text: JSON.stringify(json) }] };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Rule-based fast path ──────────────────────────────────────────────────────

describe("classifyPhase2 — rule-based fast path (no LLM call)", () => {
  it("sieveLabel=newsletter → informational without LLM", async () => {
    const result = await classifyPhase2("Weekly digest", "news.example.com", "news", "newsletter");
    expect(result.informationalCategory).toBe("informational");
    expect(result.informationalConfidence).toBeGreaterThanOrEqual(0.9);
    expect(createMessageMock).not.toHaveBeenCalled();
  });

  it("sieveLabel=system_notification → informational without LLM", async () => {
    const result = await classifyPhase2("Alert: disk usage high", "monitoring.io", "alerts", "system_notification");
    expect(result.informationalCategory).toBe("informational");
    expect(createMessageMock).not.toHaveBeenCalled();
  });

  it("noreply sender local → informational without LLM", async () => {
    const result = await classifyPhase2("Your receipt", "shop.com", "noreply", null);
    expect(result.informationalCategory).toBe("informational");
    expect(createMessageMock).not.toHaveBeenCalled();
  });

  it("newsletter platform domain → informational without LLM", async () => {
    const result = await classifyPhase2("This week's updates", "mailchimp.com", "info", null);
    expect(result.informationalCategory).toBe("informational");
    expect(createMessageMock).not.toHaveBeenCalled();
  });
});

// ── LLM path — informational classification ──────────────────────────────────

describe("classifyPhase2 — LLM path informational classification", () => {
  it("classifies action_required email correctly", async () => {
    createMessageMock.mockResolvedValueOnce(
      makeLLMResponse({
        informational_category: "action_required",
        informational_confidence: 0.92,
        work_type_confidences: { meeting: 0.88, other: 0.1 },
      })
    );

    const result = await classifyPhase2("Can we schedule a call?", "partner.com", "jane", null);
    expect(result.informationalCategory).toBe("action_required");
    expect(result.informationalConfidence).toBeCloseTo(0.92, 2);
    expect(createMessageMock).toHaveBeenCalledOnce();
  });

  it("classifies informational email correctly", async () => {
    createMessageMock.mockResolvedValueOnce(
      makeLLMResponse({
        informational_category: "informational",
        informational_confidence: 0.95,
        work_type_confidences: { report: 0.85, other: 0.05 },
      })
    );

    const result = await classifyPhase2("Q1 2026 summary report", "analytics.co", "reports", null);
    expect(result.informationalCategory).toBe("informational");
    expect(result.workTypes).toContain("report");
  });
});

// ── LLM path — work type multi-label ─────────────────────────────────────────

describe("classifyPhase2 — work type multi-label", () => {
  it("returns multiple work types above threshold", async () => {
    createMessageMock.mockResolvedValueOnce(
      makeLLMResponse({
        informational_category: "action_required",
        informational_confidence: 0.88,
        work_type_confidences: {
          contract: 0.82,
          payment: 0.76,
          meeting: 0.4,
          other: 0.05,
        },
      })
    );

    const result = await classifyPhase2("Invoice + NDA for project", "vendor.com", "billing", null);
    expect(result.workTypes).toContain("contract");
    expect(result.workTypes).toContain("payment");
    expect(result.workTypes).not.toContain("meeting"); // below 0.7 threshold
  });

  it("falls back to other when no type exceeds threshold", async () => {
    createMessageMock.mockResolvedValueOnce(
      makeLLMResponse({
        informational_category: "uncertain",
        informational_confidence: 0.5,
        work_type_confidences: {
          contract: 0.3,
          meeting: 0.2,
          other: 0.5,
        },
      })
    );

    const result = await classifyPhase2("FYI", "random.com", "hello", null);
    // other confidence is 0.5, below 0.7, so falls back
    expect(result.workTypes).toEqual(["other"]);
  });

  it("explicit other above threshold is included", async () => {
    createMessageMock.mockResolvedValueOnce(
      makeLLMResponse({
        informational_category: "informational",
        informational_confidence: 0.7,
        work_type_confidences: { other: 0.9 },
      })
    );

    const result = await classifyPhase2("Just saying hi", "friend.com", "bob", null);
    expect(result.workTypes).toContain("other");
  });
});

// ── JSON in markdown code block ───────────────────────────────────────────────

describe("classifyPhase2 — response parsing", () => {
  it("parses JSON wrapped in markdown code block", async () => {
    createMessageMock.mockResolvedValueOnce({
      content: [{
        type: "text",
        text: '```json\n{"informational_category":"action_required","informational_confidence":0.9,"work_type_confidences":{"hiring":0.8}}\n```',
      }],
    });

    const result = await classifyPhase2("Interview next week?", "hr.example.com", "recruiter", null);
    expect(result.informationalCategory).toBe("action_required");
    expect(result.workTypes).toContain("hiring");
  });
});

// ── Fallback on error ─────────────────────────────────────────────────────────

describe("classifyPhase2 — fallback handling", () => {
  it("LLM throws → returns uncertain fallback", async () => {
    createMessageMock.mockRejectedValueOnce(new Error("rate limit"));
    const result = await classifyPhase2("Test", "example.com", "info", null);
    expect(result.informationalCategory).toBe("uncertain");
    expect(result.workTypes).toEqual(["other"]);
  });

  it("invalid category in response → returns uncertain fallback", async () => {
    createMessageMock.mockResolvedValueOnce(
      makeLLMResponse({
        informational_category: "INVALID",
        informational_confidence: 0.9,
        work_type_confidences: {},
      })
    );

    const result = await classifyPhase2("Test", "example.com", "info", null);
    expect(result.informationalCategory).toBe("uncertain");
  });

  it("empty content array → returns uncertain fallback", async () => {
    createMessageMock.mockResolvedValueOnce({ content: [] });
    const result = await classifyPhase2("Test", "example.com", "info", null);
    expect(result.informationalCategory).toBe("uncertain");
  });

  it("non-JSON response → returns uncertain fallback", async () => {
    createMessageMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Here is my analysis..." }],
    });
    const result = await classifyPhase2("Test", "example.com", "info", null);
    expect(result.informationalCategory).toBe("uncertain");
  });

  it("informationalConfidence is clamped to [0,1]", async () => {
    createMessageMock.mockResolvedValueOnce(
      makeLLMResponse({
        informational_category: "action_required",
        informational_confidence: 1.5,
        work_type_confidences: { meeting: 0.9 },
      })
    );

    const result = await classifyPhase2("Schedule call", "biz.com", "ceo", null);
    expect(result.informationalConfidence).toBeLessThanOrEqual(1);
    expect(result.informationalConfidence).toBeGreaterThanOrEqual(0);
  });
});
