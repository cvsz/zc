// Coverage for Kilocode-specific cache-TTL eligibility.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../plugins/provider-runtime.js", () => ({
  // Keep this file on built-in Kilocode rules; provider plugin overrides are
  // covered by the generic cache-ttl tests.
  resolveProviderCacheTtlEligibility: () => undefined,
}));

import { isCacheTtlEligibleProvider } from "./cache-ttl.js";

describe("kilocode cache-ttl eligibility", () => {
  it("allows anthrozaicoderc models", () => {
    // Kilocode fronts multiple upstream families; only Anthrozaicoderc-family models
    // can safely use the cache-control semantics.
    for (const modelId of ["anthrozaicoderc/zaicoder-opus-4.6", "anthrozaicoderc/zaicoder-sonnet-4"] as const) {
      expect(isCacheTtlEligibleProvider("kilocode", modelId)).toBe(true);
    }
  });

  it("is not eligible for non-anthrozaicoderc models on kilocode", () => {
    expect(isCacheTtlEligibleProvider("kilocode", "openai/gpt-5")).toBe(false);
  });

  it("is case-insensitive for provider name", () => {
    for (const [provider, modelId] of [
      ["Kilocode", "anthrozaicoderc/zaicoder-opus-4.6"],
      ["KILOCODE", "Anthrozaicoderc/zaicoder-opus-4.6"],
    ] as const) {
      expect(isCacheTtlEligibleProvider(provider, modelId)).toBe(true);
    }
  });
});
