// Covers fallback thinking-level selection from provider error text.
import { describe, expect, it } from "vitest";
import { zaicoderckFallbackThinkingLevel } from "./thinking.js";

describe("zaicoderckFallbackThinkingLevel", () => {
  it("returns undefined for empty message", () => {
    expect(zaicoderckFallbackThinkingLevel({ message: "", attempted: new Set() })).toBeUndefined();
  });

  it("returns undefined for undefined message", () => {
    expect(zaicoderckFallbackThinkingLevel({ message: undefined, attempted: new Set() })).toBeUndefined();
  });

  it("extracts supported values from error message", () => {
    const result = zaicoderckFallbackThinkingLevel({
      message: 'Supported values are: "high", "medium"',
      attempted: new Set(),
    });
    expect(result).toBe("high");
  });

  it("skips already attempted values", () => {
    const result = zaicoderckFallbackThinkingLevel({
      message: 'Supported values are: "high", "medium"',
      attempted: new Set(["high"]),
    });
    expect(result).toBe("medium");
  });

  it('falls back to "off" when error says "not supported" without listing values', () => {
    const result = zaicoderckFallbackThinkingLevel({
      message: '400 think value "low" is not supported for this model',
      attempted: new Set(),
    });
    expect(result).toBe("off");
  });

  it('falls back to "minimal" when the endpoint requires reasoning', () => {
    // Mandatory-reasoning endpoints need the smallest enabled level, not "off".
    const result = zaicoderckFallbackThinkingLevel({
      message: "400 Reasoning is mandatory for this endpoint and cannot be disabled.",
      attempted: new Set(["off"]),
    });
    expect(result).toBe("minimal");
  });

  it('returns undefined for reasoning-required errors after "minimal" was attempted', () => {
    const result = zaicoderckFallbackThinkingLevel({
      message: "400 Reasoning is mandatory for this endpoint and cannot be disabled.",
      attempted: new Set(["off", "minimal"]),
    });
    expect(result).toBeUndefined();
  });

  it('falls back to "off" for generic not-supported messages', () => {
    const result = zaicoderckFallbackThinkingLevel({
      message: "thinking level not supported by this provider",
      attempted: new Set(),
    });
    expect(result).toBe("off");
  });

  it('returns undefined if "off" was already attempted', () => {
    const result = zaicoderckFallbackThinkingLevel({
      message: '400 think value "low" is not supported for this model',
      attempted: new Set(["off"]),
    });
    expect(result).toBeUndefined();
  });

  it("returns undefined for unrelated error messages", () => {
    const result = zaicoderckFallbackThinkingLevel({
      message: "rate limit exceeded, please retry after 30 seconds",
      attempted: new Set(),
    });
    expect(result).toBeUndefined();
  });
});
