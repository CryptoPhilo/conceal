import { describe, it, expect } from "vitest";
import { classifyPhase3 } from "../classifier-phase3.js";

describe("classifyPhase3 — direct_to detection", () => {
  it("bare address in To → direct_to with 0.99 confidence", () => {
    const result = classifyPhase3(
      "user@alias.conceal.email",
      ["user@alias.conceal.email"],
      []
    );
    expect(result.recipientType).toBe("direct_to");
    expect(result.confidence).toBe(0.99);
  });

  it("RFC display-name format in To → direct_to", () => {
    const result = classifyPhase3(
      "user@alias.conceal.email",
      ["John Doe <user@alias.conceal.email>"],
      []
    );
    expect(result.recipientType).toBe("direct_to");
    expect(result.confidence).toBe(0.99);
  });

  it("case-insensitive match in To → direct_to", () => {
    const result = classifyPhase3(
      "User@Alias.CONCEAL.EMAIL",
      ["USER@ALIAS.CONCEAL.EMAIL"],
      []
    );
    expect(result.recipientType).toBe("direct_to");
    expect(result.confidence).toBe(0.99);
  });

  it("masking address in To among multiple recipients → direct_to", () => {
    const result = classifyPhase3(
      "user@alias.conceal.email",
      ["other@example.com", "user@alias.conceal.email", "third@example.com"],
      []
    );
    expect(result.recipientType).toBe("direct_to");
    expect(result.confidence).toBe(0.99);
  });
});

describe("classifyPhase3 — cc detection", () => {
  it("address in CC (not in To) → cc", () => {
    const result = classifyPhase3(
      "user@alias.conceal.email",
      ["primary@example.com"],
      ["user@alias.conceal.email"]
    );
    expect(result.recipientType).toBe("cc");
    expect(result.confidence).toBe(0.99);
  });

  it("RFC display-name format in CC → cc", () => {
    const result = classifyPhase3(
      "user@alias.conceal.email",
      ["boss@example.com"],
      ["Alice <user@alias.conceal.email>"]
    );
    expect(result.recipientType).toBe("cc");
    expect(result.confidence).toBe(0.99);
  });

  it("To takes precedence over CC when address in both", () => {
    const result = classifyPhase3(
      "user@alias.conceal.email",
      ["user@alias.conceal.email"],
      ["user@alias.conceal.email"]
    );
    expect(result.recipientType).toBe("direct_to");
  });
});

describe("classifyPhase3 — team_group detection", () => {
  it("To headers present but masking address absent → team_group", () => {
    const result = classifyPhase3(
      "user@alias.conceal.email",
      ["team-list@company.com"],
      []
    );
    expect(result.recipientType).toBe("team_group");
    expect(result.confidence).toBe(0.97);
  });

  it("CC headers present but masking address absent → team_group", () => {
    const result = classifyPhase3(
      "user@alias.conceal.email",
      [],
      ["all-hands@company.com"]
    );
    expect(result.recipientType).toBe("team_group");
    expect(result.confidence).toBe(0.97);
  });

  it("both To and CC present but address absent → team_group", () => {
    const result = classifyPhase3(
      "user@alias.conceal.email",
      ["manager@company.com"],
      ["everyone@company.com"]
    );
    expect(result.recipientType).toBe("team_group");
    expect(result.confidence).toBe(0.97);
  });
});

describe("classifyPhase3 — unknown fallback", () => {
  it("no To or CC headers → unknown with 0.5 confidence", () => {
    const result = classifyPhase3("user@alias.conceal.email", [], []);
    expect(result.recipientType).toBe("unknown");
    expect(result.confidence).toBe(0.5);
  });
});
