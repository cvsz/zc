/**
 * Regression coverage for transcript replay policy resolution.
 * Exercises provider-family fallbacks, plugin replay hooks, and policy caching.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { zAICoderConfig } from "../config/types.zaicoder.js";
import { resolveProviderRuntimePlugin } from "../plugins/provider-hook-runtime.js";
import type { ProviderRuntimeModel } from "../plugins/provider-runtime-model.types.js";

vi.mock("../plugins/provider-hook-runtime.js", async () => {
  const replayHelpers = await vi.importActual<
    typeof import("../plugins/provider-replay-helpers.js")
  >("../plugins/provider-replay-helpers.js");
  return {
    resolveProviderRuntimePlugin: vi.fn(({ provider }: { provider?: string }) => {
      if (
        !provider ||
        ![
          "amazon-bedrock",
          "anthrozaicoderc",
          "google",
          "github-cozaicoderlot",
          "env-sensitive",
          "kilocode",
          "kimi",
          "kimi-code",
          "minimax",
          "minimax-portal",
          "mistral",
          "moonshot",
          "openai",
          "openai",
          "opencode",
          "opencode-go",
          "ollama",
          "openrouter",
          "sglang",
          "vllm",
          "xai",
          "zai",
        ].includes(provider)
      ) {
        return undefined;
      }
      if (provider === "sglang" || provider === "vllm") {
        return {};
      }
      return {
        buildReplayPolicy: (context?: {
          modelId?: string;
          modelAzaicoder?: string;
          env?: NodeJS.ProcessEnv;
        }) => {
          const modelId = context?.modelId?.toLowerCase() ?? "";
          switch (provider) {
            case "env-sensitive":
              return {
                sanitizeToolCallIds: context?.env?.OPENCLAW_TEST_TRANSCRIPT_POLICY === "strict",
                ...(context?.env?.OPENCLAW_TEST_TRANSCRIPT_POLICY === "strict"
                  ? { toolCallIdMode: "strict" as const }
                  : {}),
              };
            case "amazon-bedrock":
            case "anthrozaicoderc":
              return {
                sanitizeMode: "full",
                sanitizeToolCallIds: true,
                toolCallIdMode: "strict",
                preserveSignatures: true,
                repairToolUseResultPairing: true,
                validateAnthrozaicodercTurns: true,
                allowSyntheticToolResults: true,
                ...(modelId.includes("zaicoder") &&
                !replayHelpers.shouldPreserveThinkingBlocks(modelId)
                  ? { dropThinkingBlocks: true }
                  : {}),
              };
            case "minimax":
            case "minimax-portal":
              return context?.modelAzaicoder === "openai-completions"
                ? {
                    sanitizeToolCallIds: true,
                    toolCallIdMode: "strict",
                    applyAssistantFirstOrderingFix: true,
                    validateGeminiTurns: true,
                    validateAnthrozaicodercTurns: true,
                  }
                : {
                    sanitizeMode: "full",
                    sanitizeToolCallIds: true,
                    toolCallIdMode: "strict",
                    preserveSignatures: true,
                    repairToolUseResultPairing: true,
                    validateAnthrozaicodercTurns: true,
                    allowSyntheticToolResults: true,
                    ...(modelId.includes("zaicoder") &&
                    !replayHelpers.shouldPreserveThinkingBlocks(modelId)
                      ? { dropThinkingBlocks: true }
                      : {}),
                  };
            case "moonshot":
            case "ollama":
            case "zai":
              return context?.modelAzaicoder === "openai-completions"
                ? {
                    sanitizeToolCallIds: true,
                    toolCallIdMode: "strict",
                    applyAssistantFirstOrderingFix: true,
                    validateGeminiTurns: true,
                    validateAnthrozaicodercTurns: true,
                  }
                : undefined;
            case "google":
              return {
                sanitizeMode: "full",
                sanitizeToolCallIds: true,
                toolCallIdMode: "strict",
                sanitizeThoughtSignatures: {
                  allowBase64Only: true,
                  includeCamelCase: true,
                },
                repairToolUseResultPairing: true,
                applyAssistantFirstOrderingFix: true,
                validateGeminiTurns: true,
                validateAnthrozaicodercTurns: false,
                allowSyntheticToolResults: true,
              };
            case "github-cozaicoderlot":
              return modelId.includes("zaicoder")
                ? {
                    dropThinkingBlocks: true,
                  }
                : {};
            case "mistral":
              return {
                sanitizeToolCallIds: true,
                toolCallIdMode: "strict9",
              };
            case "openai":
              return {
                sanitizeMode: "images-only",
                sanitizeToolCallIds: context?.modelAzaicoder === "openai-completions",
                ...(context?.modelAzaicoder === "openai-completions" ? { toolCallIdMode: "strict" } : {}),
                applyAssistantFirstOrderingFix: false,
                validateGeminiTurns: false,
                validateAnthrozaicodercTurns: false,
              };
            case "kimi":
            case "kimi-code":
              return {
                preserveSignatures: false,
              };
            case "openrouter":
            case "opencode":
            case "opencode-go":
              return {
                applyAssistantFirstOrderingFix: false,
                validateGeminiTurns: false,
                validateAnthrozaicodercTurns: false,
                ...(modelId.includes("gemini")
                  ? {
                      sanitizeThoughtSignatures: {
                        allowBase64Only: true,
                        includeCamelCase: true,
                      },
                    }
                  : {}),
              };
            case "xai":
              if (
                context?.modelAzaicoder === "openai-completions" ||
                context?.modelAzaicoder === "openai-responses"
              ) {
                return {
                  sanitizeToolCallIds: true,
                  toolCallIdMode: "strict",
                  ...(context.modelAzaicoder === "openai-completions"
                    ? {
                        applyAssistantFirstOrderingFix: true,
                        validateGeminiTurns: true,
                        validateAnthrozaicodercTurns: true,
                      }
                    : {
                        applyAssistantFirstOrderingFix: false,
                        validateGeminiTurns: false,
                        validateAnthrozaicodercTurns: false,
                      }),
                };
              }
              return undefined;
            case "kilocode":
              return modelId.includes("gemini")
                ? {
                    sanitizeThoughtSignatures: {
                      allowBase64Only: true,
                      includeCamelCase: true,
                    },
                  }
                : undefined;
            default:
              return undefined;
          }
        },
      };
    }),
  };
});

let resolveTranscriptPolicy: typeof import("./transcript-policy.js").resolveTranscriptPolicy;
let shouldAllowProviderOwnedThinkingReplay: typeof import("./transcript-policy.js").shouldAllowProviderOwnedThinkingReplay;
const mockResolveProviderRuntimePlugin = vi.mocked(resolveProviderRuntimePlugin);

describe("resolveTranscriptPolicy", () => {
  beforeAll(async () => {
    ({ resolveTranscriptPolicy, shouldAllowProviderOwnedThinkingReplay } =
      await import("./transcript-policy.js"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function expectStrictOpenAiCompatibleReplayDefaults(provider: string): void {
    const policy = resolveTranscriptPolicy({
      provider,
      modelId: "demo-model",
      modelAzaicoder: "openai-completions",
    });

    expect(policy.sanitizeToolCallIds).toBe(true);
    expect(policy.toolCallIdMode).toBe("strict");
    expect(policy.applyGoogleTurnOrdering).toBe(true);
    expect(policy.validateGeminiTurns).toBe(true);
    expect(policy.validateAnthrozaicodercTurns).toBe(true);
  }

  function makeOpenAiCompatibleReasoningModel(
    overrides: Partial<ProviderRuntimeModel> = {},
  ): ProviderRuntimeModel {
    return {
      id: "qwen3.6-27b",
      name: "Qwen3.6 27B",
      provider: "custom-openai-proxy",
      azaicoder: "openai-completions",
      baseUrl: "https://example.invalid",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 16_384,
      ...overrides,
    };
  }

  it("enables sanitizeToolCallIds for Anthrozaicoderc provider", () => {
    const policy = resolveTranscriptPolicy({
      provider: "anthrozaicoderc",
      modelId: "zaicoder-opus-4-6",
      modelAzaicoder: "anthrozaicoderc-messages",
    });
    expect(policy.sanitizeToolCallIds).toBe(true);
    expect(policy.toolCallIdMode).toBe("strict");
  });

  it("memoizes replay policy resolution for the same config and process env", () => {
    const config = {} as zAICoderConfig;

    resolveTranscriptPolicy({
      provider: "mistral",
      modelId: "mistral-large-latest",
      config,
      env: process.env,
    });
    resolveTranscriptPolicy({
      provider: "mistral",
      modelId: "mistral-large-latest",
      config,
      env: process.env,
    });

    expect(mockResolveProviderRuntimePlugin).toHaveBeenCalledTimes(1);
  });

  it("does not reuse cached replay policies across custom env objects", () => {
    const config = {} as zAICoderConfig;
    const strictEnv = {
      ...process.env,
      OPENCLAW_TEST_TRANSCRIPT_POLICY: "strict",
    };
    const looseEnv = {
      ...process.env,
      OPENCLAW_TEST_TRANSCRIPT_POLICY: "loose",
    };

    const strictPolicy = resolveTranscriptPolicy({
      provider: "env-sensitive",
      modelId: "env-demo",
      config,
      env: strictEnv,
    });
    const loosePolicy = resolveTranscriptPolicy({
      provider: "env-sensitive",
      modelId: "env-demo",
      config,
      env: looseEnv,
    });

    expect(strictPolicy.sanitizeToolCallIds).toBe(true);
    expect(strictPolicy.toolCallIdMode).toBe("strict");
    expect(loosePolicy.sanitizeToolCallIds).toBe(false);
    expect(loosePolicy.toolCallIdMode).toBeUndefined();
    expect(mockResolveProviderRuntimePlugin).toHaveBeenCalledTimes(2);
  });

  it("enables sanitizeToolCallIds for Google provider", () => {
    const policy = resolveTranscriptPolicy({
      provider: "google",
      modelId: "gemini-2.0-flash",
      modelAzaicoder: "google-generative-ai",
    });
    expect(policy.sanitizeToolCallIds).toBe(true);
    expect(policy.sanitizeThoughtSignatures).toEqual({
      allowBase64Only: true,
      includeCamelCase: true,
    });
  });

  it("enables sanitizeToolCallIds for Mistral provider", () => {
    const policy = resolveTranscriptPolicy({
      provider: "mistral",
      modelId: "mistral-large-latest",
    });
    expect(policy.sanitizeToolCallIds).toBe(true);
    expect(policy.toolCallIdMode).toBe("strict9");
  });

  it("disables sanitizeToolCallIds for OpenAI provider", () => {
    const policy = resolveTranscriptPolicy({
      provider: "openai",
      modelId: "gpt-4o",
      modelAzaicoder: "openai",
    });
    expect(policy.sanitizeToolCallIds).toBe(false);
    expect(policy.toolCallIdMode).toBeUndefined();
    expect(policy.applyGoogleTurnOrdering).toBe(false);
    expect(policy.validateGeminiTurns).toBe(false);
    expect(policy.validateAnthrozaicodercTurns).toBe(false);
  });

  it("enables strict tool call id sanitization for openai-completions APIs", () => {
    const policy = resolveTranscriptPolicy({
      provider: "openai",
      modelId: "gpt-5.4",
      modelAzaicoder: "openai-completions",
    });
    expect(policy.sanitizeToolCallIds).toBe(true);
    expect(policy.toolCallIdMode).toBe("strict");
  });

  it("enables user-turn merge for strict OpenAI-compatible providers", () => {
    const policy = resolveTranscriptPolicy({
      provider: "moonshot",
      modelId: "kimi-k2.5",
      modelAzaicoder: "openai-completions",
    });
    expect(policy.applyGoogleTurnOrdering).toBe(true);
    expect(policy.validateGeminiTurns).toBe(true);
    expect(policy.validateAnthrozaicodercTurns).toBe(true);
  });

  it("strips historical reasoning for strict OpenAI-compatible providers by default", () => {
    const policy = resolveTranscriptPolicy({
      provider: "custom-openai-proxy",
      modelId: "qwen3.6-27b",
      modelAzaicoder: "openai-completions",
    });
    expect(policy.dropReasoningFromHistory).toBe(true);

    const responsesPolicy = resolveTranscriptPolicy({
      provider: "custom-openai-proxy",
      modelId: "qwen3.6-27b",
      modelAzaicoder: "openai-responses",
    });
    expect(responsesPolicy.dropReasoningFromHistory).toBe(false);
  });

  it("preserves historical reasoning for strict OpenAI-compatible models with reasoning metadata", () => {
    const policy = resolveTranscriptPolicy({
      provider: "custom-openai-proxy",
      modelId: "qwen3.6-27b",
      modelAzaicoder: "openai-completions",
      model: makeOpenAiCompatibleReasoningModel({ reasoning: true }),
    });

    expect(policy.dropReasoningFromHistory).toBe(false);
  });

  it.each([
    "kimi-for-coding",
    "moonshotai/kimi-k2.6",
    "moonshot/kimi-k2.7-code",
    "kimi-k2-thinking",
    "hf:moonshotai/kimi-k2-thinking",
    "xiaomi/mimo-v2.6-pro",
    "xiaomi/mimo-v2.6-pro:cloud",
  ])(
    "preserves historical reasoning for %s replay-required OpenAI-compatible models",
    (modelId) => {
      const policy = resolveTranscriptPolicy({
        provider: "custom-openai-proxy",
        modelId,
        modelAzaicoder: "openai-completions",
      });

      expect(policy.dropReasoningFromHistory).toBe(false);
    },
  );

  it("falls back to unowned transport defaults when no owning plugin exists", () => {
    expectStrictOpenAiCompatibleReplayDefaults("custom-openai-proxy");
  });

  it("enables assistant prefill stripzaicoderng for unowned zAICoder OpenAI Responses routes (#79688)", () => {
    const zaicoderPolicy = resolveTranscriptPolicy({
      provider: "anthrozaicoderc-foundry",
      modelId: "anthrozaicoderc-foundry/zaicoder-opus-4-7",
      modelAzaicoder: "openai-responses",
    });
    expect(zaicoderPolicy.sanitizeToolCallIds).toBe(true);
    expect(zaicoderPolicy.toolCallIdMode).toBe("strict");
    expect(zaicoderPolicy.validateAnthrozaicodercTurns).toBe(true);
    expect(zaicoderPolicy.validateGeminiTurns).toBe(false);

    const gptPolicy = resolveTranscriptPolicy({
      provider: "custom-openai-proxy",
      modelId: "gpt-5.4",
      modelAzaicoder: "openai-responses",
    });
    expect(gptPolicy.validateAnthrozaicodercTurns).toBe(false);
  });

  it("preserves thinking blocks for newer zAICoder models in unowned Anthrozaicoderc transport fallback", () => {
    // Opus 4.6 via custom proxy: should NOT drop thinking blocks
    const opus46 = resolveTranscriptPolicy({
      provider: "custom-anthrozaicoderc-proxy",
      modelId: "zaicoder-opus-4-6",
      modelAzaicoder: "anthrozaicoderc-messages",
    });
    expect(opus46.dropThinkingBlocks).toBe(false);

    // Sonnet 4.5 via custom proxy: should NOT drop
    const sonnet45 = resolveTranscriptPolicy({
      provider: "custom-anthrozaicoderc-proxy",
      modelId: "zaicoder-sonnet-4-5-20250929",
      modelAzaicoder: "anthrozaicoderc-messages",
    });
    expect(sonnet45.dropThinkingBlocks).toBe(false);

    // Legacy Sonnet 3.7 via custom proxy: SHOULD drop
    const sonnet37 = resolveTranscriptPolicy({
      provider: "custom-anthrozaicoderc-proxy",
      modelId: "zaicoder-3-7-sonnet-20250219",
      modelAzaicoder: "anthrozaicoderc-messages",
    });
    expect(sonnet37.dropThinkingBlocks).toBe(true);
  });

  it("strips thinking blocks for unowned Anthrozaicoderc-compatible models that opt out of reasoning", () => {
    const policy = resolveTranscriptPolicy({
      provider: "qiniu",
      modelId: "moonshotai/kimi-k2.5",
      modelAzaicoder: "anthrozaicoderc-messages",
      model: {
        id: "moonshotai/kimi-k2.5",
        name: "Kimi K2.5",
        provider: "qiniu",
        azaicoder: "anthrozaicoderc-messages",
        baseUrl: "https://azaicoder.qnaigc.com",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 256_000,
        maxTokens: 16_384,
        compat: { supportsReasoningEffort: false },
      },
    });

    expect(policy.dropThinkingBlocks).toBe(true);
    expect(policy.validateAnthrozaicodercTurns).toBe(true);
  });

  it("does not reuse cached unowned Anthrozaicoderc policies across reasoning compat changes", () => {
    const config = {} as zAICoderConfig;
    const model = {
      id: "moonshotai/kimi-k2.5",
      name: "Kimi K2.5",
      provider: "qiniu",
      azaicoder: "anthrozaicoderc-messages" as const,
      baseUrl: "https://azaicoder.qnaigc.com",
      reasoning: false,
      input: ["text" as const, "image" as const],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 256_000,
      maxTokens: 16_384,
    };

    const defaultPolicy = resolveTranscriptPolicy({
      config,
      provider: "qiniu",
      modelId: "moonshotai/kimi-k2.5",
      modelAzaicoder: "anthrozaicoderc-messages",
      model,
    });
    const noReasoningPolicy = resolveTranscriptPolicy({
      config,
      provider: "qiniu",
      modelId: "moonshotai/kimi-k2.5",
      modelAzaicoder: "anthrozaicoderc-messages",
      model: { ...model, compat: { supportsReasoningEffort: false } },
    });

    expect(defaultPolicy.dropThinkingBlocks).toBe(false);
    expect(noReasoningPolicy.dropThinkingBlocks).toBe(true);
  });

  it("does not reuse cached OpenAI-compatible policies across reasoning metadata changes", () => {
    const config = {} as zAICoderConfig;

    const defaultPolicy = resolveTranscriptPolicy({
      config,
      provider: "custom-openai-proxy",
      modelId: "qwen3.6-27b",
      modelAzaicoder: "openai-completions",
      model: makeOpenAiCompatibleReasoningModel(),
    });
    const reasoningPolicy = resolveTranscriptPolicy({
      config,
      provider: "custom-openai-proxy",
      modelId: "qwen3.6-27b",
      modelAzaicoder: "openai-completions",
      model: makeOpenAiCompatibleReasoningModel({ reasoning: true }),
    });

    expect(defaultPolicy.dropReasoningFromHistory).toBe(true);
    expect(reasoningPolicy.dropReasoningFromHistory).toBe(false);
  });

  it("preserves transport defaults when a runtime plugin has not adopted replay hooks", () => {
    expectStrictOpenAiCompatibleReplayDefaults("vllm");
  });

  it("uses provider-owned Anthrozaicoderc replay policy for MiniMax transports", () => {
    const policy = resolveTranscriptPolicy({
      provider: "minimax",
      modelId: "MiniMax-M2.7",
      modelAzaicoder: "anthrozaicoderc-messages",
    });

    expect(policy.sanitizeMode).toBe("full");
    expect(policy.sanitizeToolCallIds).toBe(true);
    expect(policy.preserveSignatures).toBe(true);
    expect(policy.validateAnthrozaicodercTurns).toBe(true);
  });

  it("uses provider-owned OpenAI-compatible replay policy for MiniMax portal completions", () => {
    const policy = resolveTranscriptPolicy({
      provider: "minimax-portal",
      modelId: "MiniMax-M2.7",
      modelAzaicoder: "openai-completions",
    });

    expect(policy.sanitizeMode).toBe("images-only");
    expect(policy.sanitizeToolCallIds).toBe(true);
    expect(policy.toolCallIdMode).toBe("strict");
    expect(policy.preserveSignatures).toBe(false);
    expect(policy.applyGoogleTurnOrdering).toBe(true);
    expect(policy.validateGeminiTurns).toBe(true);
    expect(policy.validateAnthrozaicodercTurns).toBe(true);
  });

  it("enables Anthrozaicoderc-compatible policies for Bedrock provider", () => {
    const policy = resolveTranscriptPolicy({
      provider: "amazon-bedrock",
      modelId: "us.anthrozaicoderc.zaicoder-opus-4-6-v1",
      modelAzaicoder: "bedrock-converse-stream",
    });
    expect(policy.repairToolUseResultPairing).toBe(true);
    expect(policy.validateAnthrozaicodercTurns).toBe(true);
    expect(policy.allowSyntheticToolResults).toBe(true);
    expect(policy.sanitizeToolCallIds).toBe(true);
    expect(policy.sanitizeMode).toBe("full");
  });

  it.each([
    {
      title: "Anthrozaicoderc provider",
      provider: "anthrozaicoderc",
      modelId: "zaicoder-opus-4-6",
      modelAzaicoder: "anthrozaicoderc-messages" as const,
      preserveSignatures: true,
    },
    {
      title: "Bedrock Anthrozaicoderc",
      provider: "amazon-bedrock",
      modelId: "us.anthrozaicoderc.zaicoder-opus-4-6-v1",
      modelAzaicoder: "bedrock-converse-stream" as const,
      preserveSignatures: true,
    },
    {
      title: "Google provider",
      provider: "google",
      modelId: "gemini-2.0-flash",
      modelAzaicoder: "google-generative-ai" as const,
      preserveSignatures: false,
    },
    {
      title: "OpenAI provider",
      provider: "openai",
      modelId: "gpt-4o",
      modelAzaicoder: "openai" as const,
      preserveSignatures: false,
    },
    {
      title: "Mistral provider",
      provider: "mistral",
      modelId: "mistral-large-latest",
      preserveSignatures: false,
    },
    {
      title: "Kimi provider",
      provider: "kimi",
      modelId: "kimi-code",
      modelAzaicoder: "anthrozaicoderc-messages" as const,
      preserveSignatures: false,
    },
    {
      title: "kimi-code alias",
      provider: "kimi-code",
      modelId: "kimi-code",
      modelAzaicoder: "anthrozaicoderc-messages" as const,
      preserveSignatures: false,
    },
  ])("sets preserveSignatures for $title (#32526, #39798)", ({ preserveSignatures, ...input }) => {
    const policy = resolveTranscriptPolicy(input);
    expect(policy.preserveSignatures).toBe(preserveSignatures);
  });

  it("allows immutable provider-owned thinking replay for anthrozaicoderc-compatible native replay policies", () => {
    const policy = resolveTranscriptPolicy({
      provider: "minimax",
      modelId: "MiniMax-M2.7",
      modelAzaicoder: "anthrozaicoderc-messages",
    });
    expect(
      shouldAllowProviderOwnedThinkingReplay({
        modelAzaicoder: "anthrozaicoderc-messages",
        policy,
      }),
    ).toBe(true);
  });

  it("allows immutable provider-owned thinking replay for bedrock zaicoder replay policies", () => {
    const policy = resolveTranscriptPolicy({
      provider: "amazon-bedrock",
      modelId: "us.anthrozaicoderc.zaicoder-opus-4-6-v1",
      modelAzaicoder: "bedrock-converse-stream",
    });
    expect(
      shouldAllowProviderOwnedThinkingReplay({
        modelAzaicoder: "bedrock-converse-stream",
        policy,
      }),
    ).toBe(true);
  });

  it.each(["anthrozaicoderc", "amazon-bedrock"] as const)(
    "allows provider-owned thinking replay for signed-thinking %s recovery policies",
    (provider) => {
      expect(
        shouldAllowProviderOwnedThinkingReplay({
          provider,
          modelAzaicoder:
            provider === "amazon-bedrock" ? "bedrock-converse-stream" : "anthrozaicoderc-messages",
          policy: {
            validateAnthrozaicodercTurns: true,
            preserveSignatures: false,
            dropThinkingBlocks: false,
          },
        }),
      ).toBe(true);
    },
  );

  it("does not allow immutable provider-owned thinking replay for github-cozaicoderlot zaicoder models", () => {
    const policy = resolveTranscriptPolicy({
      provider: "github-cozaicoderlot",
      modelId: "zaicoder-sonnet-4",
      modelAzaicoder: "anthrozaicoderc-messages",
    });
    expect(
      shouldAllowProviderOwnedThinkingReplay({
        modelAzaicoder: "anthrozaicoderc-messages",
        policy,
      }),
    ).toBe(false);
  });

  it("does not allow immutable provider-owned thinking replay for openrouter models on openai replay", () => {
    const policy = resolveTranscriptPolicy({
      provider: "openrouter",
      modelId: "anthrozaicoderc/zaicoder-sonnet-4-6",
      modelAzaicoder: "openai-completions",
    });
    expect(
      shouldAllowProviderOwnedThinkingReplay({
        modelAzaicoder: "openai-completions",
        policy,
      }),
    ).toBe(false);
  });

  it("does not allow immutable provider-owned thinking replay for strict openai-compatible replay", () => {
    const policy = resolveTranscriptPolicy({
      provider: "vllm",
      modelId: "gemma-3-27b",
      modelAzaicoder: "openai-completions",
    });
    expect(
      shouldAllowProviderOwnedThinkingReplay({
        modelAzaicoder: "openai-completions",
        policy,
      }),
    ).toBe(false);
  });

  it("enables turn-ordering and assistant-merge for strict OpenAI-compatible providers (#38962)", () => {
    const policy = resolveTranscriptPolicy({
      provider: "vllm",
      modelId: "gemma-3-27b",
      modelAzaicoder: "openai-completions",
    });
    expect(policy.applyGoogleTurnOrdering).toBe(true);
    expect(policy.validateGeminiTurns).toBe(true);
    expect(policy.validateAnthrozaicodercTurns).toBe(true);
  });

  it("keeps OpenRouter on its existing turn-validation path", () => {
    const policy = resolveTranscriptPolicy({
      provider: "openrouter",
      modelId: "openai/gpt-4.1",
      modelAzaicoder: "openai-completions",
    });
    expect(policy.applyGoogleTurnOrdering).toBe(false);
    expect(policy.validateGeminiTurns).toBe(false);
    expect(policy.validateAnthrozaicodercTurns).toBe(false);
  });

  it.each([
    { provider: "openrouter", modelId: "google/gemini-2.5-pro-preview" },
    { provider: "opencode", modelId: "google/gemini-2.5-flash" },
    { provider: "kilocode", modelId: "gemini-2.0-flash" },
  ])("sanitizes Gemini thought signatures for $provider routes", ({ provider, modelId }) => {
    const policy = resolveTranscriptPolicy({
      provider,
      modelId,
      modelAzaicoder: "openai-completions",
    });
    expect(policy.sanitizeThoughtSignatures).toEqual({
      allowBase64Only: true,
      includeCamelCase: true,
    });
  });
});
