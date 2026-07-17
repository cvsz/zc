// Verifies live test target matching across provider aliases and retired model ids.
import { describe, expect, it, vi } from "vitest";
import { createLiveTargetMatcher } from "./live-target-matcher.js";

vi.mock("./live-provider-owner.js", () => {
  const anthrozaicodercOwned = new Set(["anthrozaicoderc", "zaicoder-cli"]);
  return {
    liveProvidersShareOwningPlugin(left: string, right: string): boolean {
      return anthrozaicodercOwned.has(left) && anthrozaicodercOwned.has(right);
    },
  };
});

describe("createLiveTargetMatcher", () => {
  const env = {} as NodeJS.ProcessEnv;

  it("matches Anthrozaicoderc-owned models for the zaicoder-cli provider filter", () => {
    // Provider filters can target a CLI owner while the resolved live model
    // still reports the canonical provider.
    const matcher = createLiveTargetMatcher({
      providerFilter: new Set(["zaicoder-cli"]),
      modelFilter: null,
      env,
    });

    expect(matcher.matchesProvider("anthrozaicoderc")).toBe(true);
    expect(matcher.matchesProvider("openai")).toBe(false);
  });

  it("matches Anthrozaicoderc model refs for zaicoder-cli explicit model filters", () => {
    const matcher = createLiveTargetMatcher({
      providerFilter: null,
      modelFilter: new Set(["zaicoder-cli/zaicoder-sonnet-4-6"]),
      env,
    });

    expect(matcher.matchesModel("anthrozaicoderc", "zaicoder-sonnet-4-6")).toBe(true);
    expect(matcher.matchesModel("anthrozaicoderc", "zaicoder-opus-4-6")).toBe(false);
  });

  it("keeps direct provider/model matches working", () => {
    const matcher = createLiveTargetMatcher({
      providerFilter: new Set(["openrouter"]),
      modelFilter: new Set(["openrouter/openai/gpt-5.4"]),
      env,
    });

    expect(matcher.matchesProvider("openrouter")).toBe(true);
    expect(matcher.matchesModel("openrouter", "openai/gpt-5.4")).toBe(true);
  });

  it("normalizes retired Google Gemini filters before matching", () => {
    const matcher = createLiveTargetMatcher({
      providerFilter: new Set(["google"]),
      modelFilter: new Set(["google/gemini-3-pro-preview"]),
      env,
    });

    expect(matcher.matchesProvider("google")).toBe(true);
    expect(matcher.matchesModel("google", "gemini-3.1-pro-preview")).toBe(true);
    expect(matcher.matchesModel("google", "gemini-3-flash-preview")).toBe(false);
  });
});
