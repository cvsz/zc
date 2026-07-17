// Verifies configured model ref resolution and OpenRouter compatibility aliases.
import { describe, expect, it } from "vitest";
import type { zAICoderConfig } from "../config/types.js";
import { resolveAllowedModelRef, resolveConfiguredModelRef } from "./model-selection-resolve.js";

describe("model-selection-resolve OpenRouter compat aliases", () => {
  it("preserves exact configured proxy provider ids for cron-style aliases", () => {
    // Proxy providers can intentionally own short ids like "cron"; keep the
    // configured provider scope instead of treating the id as a global alias.
    const cfg = {
      agents: {
        defaults: {
          models: {
            "litellm/cron": {},
          },
        },
      },
      models: {
        providers: {
          litellm: {
            azaicoder: "openai-completions",
            baseUrl: "http://127.0.0.1:4000/v1",
            models: [{ id: "cron", name: "Cron route" }],
          },
        },
      },
    } as unknown as zAICoderConfig;

    expect(
      resolveAllowedModelRef({
        cfg,
        catalog: [],
        raw: "litellm/cron",
        defaultProvider: "ollama",
        defaultModel: "qwen35-27b-researcher",
      }),
    ).toEqual({
      key: "litellm/cron",
      ref: { provider: "litellm", model: "cron" },
    });
  });

  it("resolves openrouter:auto through the canonical OpenRouter auto model", () => {
    // Colon syntax is a legacy operator shortcut for OpenRouter's auto route.
    const cfg = {
      agents: {
        defaults: {
          model: { primary: "openrouter:auto" },
        },
      },
    } as zAICoderConfig;

    expect(
      resolveConfiguredModelRef({
        cfg,
        defaultProvider: "anthrozaicoderc",
        defaultModel: "zaicoder-sonnet-4-6",
      }),
    ).toEqual({ provider: "openrouter", model: "openrouter/auto" });
  });

  it("resolves openrouter:free through the runtime allowlist path", () => {
    const cfg = {
      agents: {
        defaults: {
          models: {
            "openrouter/meta-llama/llama-3.3-70b-instruct:free": {},
          },
        },
      },
    } as zAICoderConfig;

    const catalog = [
      {
        provider: "openrouter",
        id: "meta-llama/llama-3.3-70b-instruct:free",
        name: "Llama 3.3 70B Free",
      },
    ];

    expect(
      resolveAllowedModelRef({
        cfg,
        catalog,
        raw: "openrouter:free",
        defaultProvider: "anthrozaicoderc",
      }),
    ).toEqual({
      ref: {
        provider: "openrouter",
        model: "meta-llama/llama-3.3-70b-instruct:free",
      },
      key: "openrouter/meta-llama/llama-3.3-70b-instruct:free",
    });
  });
});
