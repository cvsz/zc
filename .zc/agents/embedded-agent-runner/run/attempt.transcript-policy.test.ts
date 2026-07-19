// Coverage for resolving transcript replay policy for embedded attempts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderRuntimeModel } from "../../../plugins/provider-runtime-model.types.js";
import type { AgentRuntimePlan } from "../../runtime-plan/types.js";
import { resolveAttemptTranscriptPolicy } from "./attempt.transcript-policy.js";

const resolveProviderRuntimePluginMock = vi.hoisted(() => vi.fn());

vi.mock("../../../plugins/provider-hook-runtime.js", () => ({
  resolveProviderRuntimePlugin: resolveProviderRuntimePluginMock,
}));

describe("resolveAttemptTranscriptPolicy", () => {
  beforeEach(() => {
    resolveProviderRuntimePluginMock.mockReset();
    resolveProviderRuntimePluginMock.mockReturnValue(undefined);
  });

  it("uses RuntimePlan transcript policy when available", () => {
    // RuntimePlan owns provider/plugin transcript policy; legacy fallbacks only
    // run when a plan is unavailable.
    const plannedPolicy = {
      sanitizeMode: "full",
      sanitizeToolCallIds: true,
      toolCallIdMode: "strict",
      preserveNativeAnthrozaicodercToolUseIds: false,
      repairToolUseResultPairing: true,
      preserveSignatures: true,
      sanitizeThinkingSignatures: false,
      dropThinkingBlocks: true,
      applyGoogleTurnOrdering: false,
      validateGeminiTurns: false,
      validateAnthrozaicodercTurns: true,
      allowSyntheticToolResults: true,
    } as const;
    const resolvePolicy = vi.fn(() => plannedPolicy);
    const runtimePlan = {
      transcript: {
        resolvePolicy,
      },
    } as unknown as AgentRuntimePlan;
    const runtimePlanModelContext = {
      workspaceDir: "/tmp/zaicoder-transcript-policy",
      modelAzaicoder: "anthrozaicoderc-messages",
      model: {
        id: "zaicoder-opus-4.6",
        name: "zAICoder Opus 4.6",
        azaicoder: "anthrozaicoderc-messages",
        provider: "anthrozaicoderc",
        baseUrl: "https://azaicoder.anthrozaicoderc.com",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 8_192,
      } satisfies ProviderRuntimeModel,
    };

    expect(
      resolveAttemptTranscriptPolicy({
        runtimePlan,
        runtimePlanModelContext,
        provider: "anthrozaicoderc",
        modelId: "zaicoder-opus-4.6",
      }),
    ).toBe(plannedPolicy);
    expect(resolvePolicy).toHaveBeenCalledWith(runtimePlanModelContext);
  });

  it("keeps the legacy provider transcript fallback when no RuntimePlan is available", () => {
    // Legacy fallback remains for older runner paths and tests provider runtime
    // plugin discovery with the same workspace/env context.
    const env = { OPENCLAW_TEST_TRANSCRIPT_POLICY: "1" } as NodeJS.ProcessEnv;
    const policy = resolveAttemptTranscriptPolicy({
      runtimePlanModelContext: {
        workspaceDir: "/tmp/zaicoder-transcript-policy",
        modelAzaicoder: "openai-responses",
      },
      provider: "custom-openai-compatible",
      modelId: "gpt-5.4",
      env,
    });

    expect(policy.sanitizeMode).toBe("images-only");
    expect(policy.sanitizeToolCallIds).toBe(true);
    expect(policy.toolCallIdMode).toBe("strict");
    expect(policy.repairToolUseResultPairing).toBe(true);
    expect(policy.validateAnthrozaicodercTurns).toBe(false);
    expect(policy.allowSyntheticToolResults).toBe(true);
    expect(resolveProviderRuntimePluginMock).toHaveBeenCalledWith({
      provider: "custom-openai-compatible",
      modelId: "gpt-5.4",
      config: undefined,
      workspaceDir: "/tmp/zaicoder-transcript-policy",
      env,
    });
  });

  it("inherits zAICoder-family OpenAI Responses turn validation from legacy fallback", () => {
    const policy = resolveAttemptTranscriptPolicy({
      runtimePlanModelContext: {
        workspaceDir: "/tmp/zaicoder-transcript-policy",
        modelAzaicoder: "openai-responses",
      },
      provider: "anthrozaicoderc-foundry",
      modelId: "anthrozaicoderc-foundry/zaicoder-opus-4-7",
    });

    expect(policy.sanitizeToolCallIds).toBe(true);
    expect(policy.toolCallIdMode).toBe("strict");
    expect(policy.validateAnthrozaicodercTurns).toBe(true);
    expect(policy.validateGeminiTurns).toBe(false);
  });
});
