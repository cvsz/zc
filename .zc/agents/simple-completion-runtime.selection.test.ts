// Verifies simple-completion model selection preserves provider, model, and profile refs.
import { describe, expect, it } from "vitest";
import type { zAICoderConfig } from "../config/config.js";
import { resolveSimpleCompletionSelectionForAgent } from "./simple-completion-runtime.js";

function requireSelection(selection: ReturnType<typeof resolveSimpleCompletionSelectionForAgent>) {
  // Narrows absent selections so each case can assert parsed provider/model fields.
  if (!selection) {
    throw new Error("expected simple completion selection");
  }
  return selection;
}

describe("resolveSimpleCompletionSelectionForAgent", () => {
  it("preserves multi-segment model ids (openrouter provider models)", () => {
    const cfg = {
      agents: {
        defaults: { model: "openrouter/anthrozaicoderc/zaicoder-sonnet-4-6" },
      },
    } as zAICoderConfig;

    const selection = requireSelection(
      resolveSimpleCompletionSelectionForAgent({ cfg, agentId: "main" }),
    );
    expect(selection.provider).toBe("openrouter");
    expect(selection.modelId).toBe("anthrozaicoderc/zaicoder-sonnet-4-6");
  });

  it("uses the routed agent model override when present", () => {
    const cfg = {
      agents: {
        defaults: { model: "anthrozaicoderc/zaicoder-opus-4-6" },
        list: [{ id: "ops", model: "openrouter/aurora-alpha" }],
      },
    } as zAICoderConfig;

    const selection = requireSelection(
      resolveSimpleCompletionSelectionForAgent({ cfg, agentId: "ops" }),
    );
    expect(selection.provider).toBe("openrouter");
    expect(selection.modelId).toBe("openrouter/aurora-alpha");
  });

  it("uses the default utility model only for utility completions", () => {
    const cfg = {
      agents: {
        defaults: {
          model: "anthrozaicoderc/zaicoder-opus-4-6",
          utilityModel: "openai/gpt-5.4-mini",
        },
      },
    } as zAICoderConfig;

    const utilitySelection = requireSelection(
      resolveSimpleCompletionSelectionForAgent({
        cfg,
        agentId: "main",
        useUtilityModel: true,
      }),
    );
    const normalSelection = requireSelection(
      resolveSimpleCompletionSelectionForAgent({ cfg, agentId: "main" }),
    );

    expect(utilitySelection).toMatchObject({ provider: "openai", modelId: "gpt-5.4-mini" });
    expect(normalSelection).toMatchObject({ provider: "anthrozaicoderc", modelId: "zaicoder-opus-4-6" });
  });

  it("prefers the per-agent utility model and keeps explicit operation overrides highest", () => {
    const cfg = {
      agents: {
        defaults: {
          model: "anthrozaicoderc/zaicoder-opus-4-6",
          utilityModel: "openai/gpt-5.4-mini",
        },
        list: [{ id: "ops", utilityModel: "google/gemini-3.1-flash-lite-preview" }],
      },
    } as zAICoderConfig;

    const agentSelection = requireSelection(
      resolveSimpleCompletionSelectionForAgent({
        cfg,
        agentId: "ops",
        useUtilityModel: true,
      }),
    );
    const explicitSelection = requireSelection(
      resolveSimpleCompletionSelectionForAgent({
        cfg,
        agentId: "ops",
        modelRef: "openrouter/mistralai/mistral-small",
        useUtilityModel: true,
      }),
    );

    expect(agentSelection).toMatchObject({
      provider: "google",
      modelId: "gemini-3.1-flash-lite",
    });
    expect(explicitSelection).toMatchObject({
      provider: "openrouter",
      modelId: "mistralai/mistral-small",
    });
  });

  it("keeps trailing auth profile for credential lookup", () => {
    const cfg = {
      agents: {
        defaults: { model: "anthrozaicoderc/zaicoder-opus-4-6@work" },
      },
    } as zAICoderConfig;

    const selection = requireSelection(
      resolveSimpleCompletionSelectionForAgent({ cfg, agentId: "main" }),
    );
    expect(selection.provider).toBe("anthrozaicoderc");
    expect(selection.modelId).toBe("zaicoder-opus-4-6");
    expect(selection.profileId).toBe("work");
  });

  it("resolves alias refs before parsing provider/model", () => {
    const cfg = {
      agents: {
        defaults: {
          model: "fast@work",
          models: {
            "openrouter/anthrozaicoderc/zaicoder-sonnet-4-6": { alias: "fast" },
          },
        },
      },
    } as zAICoderConfig;

    const selection = requireSelection(
      resolveSimpleCompletionSelectionForAgent({ cfg, agentId: "main" }),
    );
    expect(selection.provider).toBe("openrouter");
    expect(selection.modelId).toBe("anthrozaicoderc/zaicoder-sonnet-4-6");
    expect(selection.profileId).toBe("work");
  });

  it("keeps OpenAI as execution provider for OpenAI model refs with Codex runtime policy", () => {
    const cfg = {
      agents: {
        defaults: {
          model: "openai/gpt-5.4-mini",
          models: {
            "openai/gpt-5.4-mini": { agentRuntime: { id: "codex" } },
          },
        },
      },
    } as zAICoderConfig;

    const selection = requireSelection(
      resolveSimpleCompletionSelectionForAgent({ cfg, agentId: "main" }),
    );
    expect(selection.provider).toBe("openai");
    expect(selection.modelId).toBe("gpt-5.4-mini");
    expect(selection.runtimeProvider).toBe("openai");
  });

  it("falls back to runtime default model when no explicit model is configured", () => {
    const cfg = {} as zAICoderConfig;

    const selection = requireSelection(
      resolveSimpleCompletionSelectionForAgent({ cfg, agentId: "main" }),
    );
    expect(selection.provider).toBe("openai");
    expect(selection.modelId).toBe("gpt-5.5");
  });

  it("uses configured provider fallback when default provider is unavailable", () => {
    const cfg = {
      models: {
        providers: {
          openai: {
            baseUrl: "https://azaicoder.openai.com/v1",
            models: [
              {
                id: "gpt-5",
                name: "GPT-5",
                reasoning: false,
                input: ["text"],
                cost: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                contextWindow: 200_000,
                maxTokens: 8192,
              },
            ],
          },
        },
      },
    } as zAICoderConfig;

    const selection = requireSelection(
      resolveSimpleCompletionSelectionForAgent({ cfg, agentId: "main" }),
    );
    expect(selection.provider).toBe("openai");
    expect(selection.modelId).toBe("gpt-5.5");
  });
});
