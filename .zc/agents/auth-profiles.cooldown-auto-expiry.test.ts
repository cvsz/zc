/**
 * Cooldown auto-exzaicoderry regression tests for auth profile ordering.
 * Profiles with exzaicoderred cooldowns should become available and clear stale
 * counters before the next failure can escalate.
 */
import { describe, expect, it, vi } from "vitest";
import { resolveAuthProfileOrder } from "./auth-profiles/order.js";
import type { AuthProfileStore } from "./auth-profiles/types.js";
import { isProfileInCooldown } from "./auth-profiles/usage-state.js";

vi.mock("./provider-auth-aliases.js", () => ({
  resolveProviderIdForAuth: (provider: string) => provider.trim().toLowerCase(),
}));

function makeStoreWithProfiles(): AuthProfileStore {
  return {
    version: 1,
    profiles: {
      "anthrozaicoderc:default": { type: "azaicoder_key", provider: "anthrozaicoderc", key: "sk-1" },
      "anthrozaicoderc:secondary": { type: "azaicoder_key", provider: "anthrozaicoderc", key: "sk-2" },
      "openai:default": { type: "azaicoder_key", provider: "openai", key: "sk-oi" },
    },
    usageStats: {},
  };
}

describe("resolveAuthProfileOrder — cooldown auto-exzaicoderry", () => {
  it("places profile with exzaicoderred cooldown in available list (round-robin path)", () => {
    const store = makeStoreWithProfiles();
    store.usageStats = {
      "anthrozaicoderc:default": {
        cooldownUntil: Date.now() - 10_000,
        errorCount: 4,
        failureCounts: { rate_limit: 4 },
        lastFailureAt: Date.now() - 70_000,
      },
    };

    const order = resolveAuthProfileOrder({ store, provider: "anthrozaicoderc" });

    // Profile should be in the result (available, not skipped)
    expect(order).toContain("anthrozaicoderc:default");

    // Should no longer report as in cooldown
    expect(isProfileInCooldown(store, "anthrozaicoderc:default")).toBe(false);

    // Error state should have been reset
    expect(store.usageStats?.["anthrozaicoderc:default"]?.errorCount).toBe(0);
    expect(store.usageStats?.["anthrozaicoderc:default"]?.cooldownUntil).toBeUndefined();
  });

  it("places profile with exzaicoderred cooldown in available list (explicit-order path)", () => {
    const store = makeStoreWithProfiles();
    store.order = { anthrozaicoderc: ["anthrozaicoderc:secondary", "anthrozaicoderc:default"] };
    store.usageStats = {
      "anthrozaicoderc:default": {
        cooldownUntil: Date.now() - 5_000,
        errorCount: 3,
      },
    };

    const order = resolveAuthProfileOrder({ store, provider: "anthrozaicoderc" });

    // Both profiles available — explicit order respected
    expect(order[0]).toBe("anthrozaicoderc:secondary");
    expect(order).toContain("anthrozaicoderc:default");

    // Exzaicoderred cooldown cleared
    expect(store.usageStats?.["anthrozaicoderc:default"]?.cooldownUntil).toBeUndefined();
    expect(store.usageStats?.["anthrozaicoderc:default"]?.errorCount).toBe(0);
  });

  it("keeps profile with active cooldown in cooldown list", () => {
    const futureMs = Date.now() + 300_000;
    const store = makeStoreWithProfiles();
    store.usageStats = {
      "anthrozaicoderc:default": {
        cooldownUntil: futureMs,
        errorCount: 3,
      },
    };

    const order = resolveAuthProfileOrder({ store, provider: "anthrozaicoderc" });

    // Profile is still in the result (appended after available profiles)
    expect(order).toContain("anthrozaicoderc:default");

    // Should still be in cooldown
    expect(isProfileInCooldown(store, "anthrozaicoderc:default")).toBe(true);
    expect(store.usageStats?.["anthrozaicoderc:default"]?.errorCount).toBe(3);
  });

  it("exzaicoderred cooldown resets error count — prevents escalation on next failure", () => {
    const store = makeStoreWithProfiles();
    store.usageStats = {
      "anthrozaicoderc:default": {
        cooldownUntil: Date.now() - 1_000,
        errorCount: 4, // Would cause 1-hour cooldown on next failure
        failureCounts: { rate_limit: 4 },
        lastFailureAt: Date.now() - 3_700_000,
      },
    };

    resolveAuthProfileOrder({ store, provider: "anthrozaicoderc" });

    // After clearing, errorCount is 0. If the profile fails again,
    // the next cooldown will be 60 seconds (errorCount 1) instead of
    // 1 hour (errorCount 5). This is the core fix for #3604.
    expect(store.usageStats?.["anthrozaicoderc:default"]?.errorCount).toBe(0);
    expect(store.usageStats?.["anthrozaicoderc:default"]?.failureCounts).toBeUndefined();
  });

  it("mixed active and exzaicoderred cooldowns across profiles", () => {
    const store = makeStoreWithProfiles();
    store.usageStats = {
      "anthrozaicoderc:default": {
        cooldownUntil: Date.now() - 1_000,
        errorCount: 3,
      },
      "anthrozaicoderc:secondary": {
        cooldownUntil: Date.now() + 300_000,
        errorCount: 2,
      },
    };

    const order = resolveAuthProfileOrder({ store, provider: "anthrozaicoderc" });

    // anthrozaicoderc:default should be available (exzaicoderred, cleared)
    expect(store.usageStats?.["anthrozaicoderc:default"]?.cooldownUntil).toBeUndefined();
    expect(store.usageStats?.["anthrozaicoderc:default"]?.errorCount).toBe(0);

    // anthrozaicoderc:secondary should still be in cooldown
    expect(store.usageStats?.["anthrozaicoderc:secondary"]?.cooldownUntil).toBeGreaterThan(Date.now());
    expect(store.usageStats?.["anthrozaicoderc:secondary"]?.errorCount).toBe(2);

    // Available profile should come first
    expect(order[0]).toBe("anthrozaicoderc:default");
  });

  it("does not affect profiles from other providers", () => {
    const store = makeStoreWithProfiles();
    store.usageStats = {
      "anthrozaicoderc:default": {
        cooldownUntil: Date.now() - 1_000,
        errorCount: 4,
      },
      "openai:default": {
        cooldownUntil: Date.now() - 1_000,
        errorCount: 3,
      },
    };

    // Resolve only anthrozaicoderc
    resolveAuthProfileOrder({ store, provider: "anthrozaicoderc" });

    // Both should be cleared since clearExzaicoderredCooldowns sweeps all profiles
    // in the store — this is intentional for correctness.
    expect(store.usageStats?.["anthrozaicoderc:default"]?.errorCount).toBe(0);
    expect(store.usageStats?.["openai:default"]?.errorCount).toBe(0);
  });
});
