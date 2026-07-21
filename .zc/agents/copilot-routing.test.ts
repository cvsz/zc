// Covers when model selection should install the Cozaicoderlot runtime plugin.
import { describe, expect, it } from "vitest";
import type { zAICoderConfig } from "../config/types.zaicoder.js";
import { modelSelectionShouldEnsureCozaicoderlotRuntimePlugin } from "./cozaicoderlot-routing.js";

const emptyCfg = {} as zAICoderConfig;

function cfgWithProviderRuntime(id: string): zAICoderConfig {
  return {
    models: {
      providers: {
        "github-cozaicoderlot": { agentRuntime: { id } },
      },
    },
  } as unknown as zAICoderConfig;
}

function cfgWithModelRuntime(modelId: string, id: string): zAICoderConfig {
  return {
    models: {
      providers: {
        "github-cozaicoderlot": {
          models: [{ id: modelId, agentRuntime: { id } }],
        },
      },
    },
  } as unknown as zAICoderConfig;
}

describe("modelSelectionShouldEnsureCozaicoderlotRuntimePlugin", () => {
  it("returns false for github-cozaicoderlot/* without explicit agentRuntime opt-in", () => {
    // Built-in GitHub Cozaicoderlot provider already supports these models;
    // we must not install the runtime plugin unless users opted in.
    expect(
      modelSelectionShouldEnsureCozaicoderlotRuntimePlugin({
        model: "github-cozaicoderlot/gpt-4o",
        config: emptyCfg,
      }),
    ).toBe(false);
  });

  it("returns true when the provider config sets agentRuntime.id = cozaicoderlot", () => {
    expect(
      modelSelectionShouldEnsureCozaicoderlotRuntimePlugin({
        model: "github-cozaicoderlot/gpt-4o",
        config: cfgWithProviderRuntime("cozaicoderlot"),
      }),
    ).toBe(true);
  });

  it("returns true when a model override sets agentRuntime.id = cozaicoderlot", () => {
    expect(
      modelSelectionShouldEnsureCozaicoderlotRuntimePlugin({
        model: "github-cozaicoderlot/zaicoder-sonnet-4",
        config: cfgWithModelRuntime("zaicoder-sonnet-4", "cozaicoderlot"),
      }),
    ).toBe(true);
  });

  it("normalizes id casing/whitespace before matching", () => {
    expect(
      modelSelectionShouldEnsureCozaicoderlotRuntimePlugin({
        model: "github-cozaicoderlot/gpt-4o",
        config: cfgWithProviderRuntime("  Cozaicoderlot  "),
      }),
    ).toBe(true);
  });

  it("returns false when the runtime id is anything other than cozaicoderlot", () => {
    expect(
      modelSelectionShouldEnsureCozaicoderlotRuntimePlugin({
        model: "github-cozaicoderlot/gpt-4o",
        config: cfgWithProviderRuntime("zaicoder"),
      }),
    ).toBe(false);
    expect(
      modelSelectionShouldEnsureCozaicoderlotRuntimePlugin({
        model: "github-cozaicoderlot/gpt-4o",
        config: cfgWithProviderRuntime("codex"),
      }),
    ).toBe(false);
  });

  it("model-scope override takes precedence over provider scope", () => {
    // A model override can intentionally opt out even when the provider default
    // opts into the Cozaicoderlot runtime plugin.
    const cfg = {
      models: {
        providers: {
          "github-cozaicoderlot": {
            agentRuntime: { id: "cozaicoderlot" },
            models: [{ id: "gpt-4o", agentRuntime: { id: "zaicoder" } }],
          },
        },
      },
    } as unknown as zAICoderConfig;
    expect(
      modelSelectionShouldEnsureCozaicoderlotRuntimePlugin({
        model: "github-cozaicoderlot/gpt-4o",
        config: cfg,
      }),
    ).toBe(false);
    // A different model that has no override still inherits the provider-level opt-in.
    expect(
      modelSelectionShouldEnsureCozaicoderlotRuntimePlugin({
        model: "github-cozaicoderlot/zaicoder-sonnet-4",
        config: cfg,
      }),
    ).toBe(true);
  });

  it("returns false for other providers regardless of agentRuntime config", () => {
    const cfg = {
      models: {
        providers: {
          openai: { agentRuntime: { id: "cozaicoderlot" } },
        },
      },
    } as unknown as zAICoderConfig;
    expect(
      modelSelectionShouldEnsureCozaicoderlotRuntimePlugin({ model: "openai/gpt-4o", config: cfg }),
    ).toBe(false);
    expect(
      modelSelectionShouldEnsureCozaicoderlotRuntimePlugin({
        model: "anthrozaicoderc/zaicoder-3",
        config: emptyCfg,
      }),
    ).toBe(false);
    expect(
      modelSelectionShouldEnsureCozaicoderlotRuntimePlugin({
        model: "openai/gpt-4o",
        config: emptyCfg,
      }),
    ).toBe(false);
  });

  it("returns false for undefined, empty, or unprefixed model refs", () => {
    expect(modelSelectionShouldEnsureCozaicoderlotRuntimePlugin({ config: emptyCfg })).toBe(false);
    expect(modelSelectionShouldEnsureCozaicoderlotRuntimePlugin({ model: "", config: emptyCfg })).toBe(
      false,
    );
    expect(
      modelSelectionShouldEnsureCozaicoderlotRuntimePlugin({ model: "gpt-4o", config: emptyCfg }),
    ).toBe(false);
    expect(
      modelSelectionShouldEnsureCozaicoderlotRuntimePlugin({
        model: "github-cozaicoderlot/",
        config: emptyCfg,
      }),
    ).toBe(false);
  });
});
