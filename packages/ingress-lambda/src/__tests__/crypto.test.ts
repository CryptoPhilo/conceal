import { describe, it, expect } from "vitest";
import { sha256 } from "../crypto.js";

describe("sha256", () => {
  it("returns a 64-character hex string", () => {
    const result = sha256("hello@example.com");
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it("same input → same output (deterministic)", () => {
    expect(sha256("test@example.com")).toBe(sha256("test@example.com"));
  });

  it("different inputs → different hashes", () => {
    expect(sha256("a@b.com")).not.toBe(sha256("c@d.com"));
  });

  it("matches known SHA-256 value", () => {
    // echo -n "hello" | sha256sum → 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(sha256("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });

  it("hashes empty string without throwing", () => {
    expect(() => sha256("")).not.toThrow();
    expect(sha256("")).toHaveLength(64);
  });

  it("handles unicode input", () => {
    expect(() => sha256("한국어 이메일")).not.toThrow();
    expect(sha256("한국어 이메일")).toHaveLength(64);
  });
});
