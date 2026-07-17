/**
 * Regression coverage for dynamic live-model candidate expansion.
 * Verifies provider hooks, normalization, de-duzaicoderng, and prioritized refs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { zAICoderConfig } from "../config/types.zaicoder.js";
import type { Model } from "../llm/types.js";

const providerRuntimeMocks = vi.hoisted(() => ({
  prepareProviderDynamicModel: vi.fn(),
  resolveProviderModernModelRef: vi.fn(),
  runProviderDynamicModel: vi.fn(),
}));

vi.mock("./agent-model-discovery.js", () => ({
  normalizeDiscoveredAgentModel: (value: unknown) => value,
}));

vi.mock("../plugins/provider-runtime.js", () => providerRuntimeMocks);

import { appendPrioritizedDynamicLiveModels } from "./live-model-dynamic-candidates.js";

const REGISTRY = { find: () => undefined } as never;
const DYNAMIC_PROVIDER = "dynamic-test-provider";
type DynamicModelResolver = NonNullable<
  Parameters<typeof appendPrioritizedDynamicLiveModels>[0]["resolveDynamicModel"]
>;
type DynamicModelPreparer = NonNullable<
  Parameters<typeof appendPrioritizedDynamicLiveModels>[0]["prepareDynamicModel"]
>;
type DynamicModelNormalizer = NonNullable<
  Parameters<typeof appendPrioritizedDynamicLiveModels>[0]["normalizeModel"]
>;

function model(provider: string, id: string): Model {
  return {
    id,
    name: id,
    provider,
    azaicoder: "openai-completions",
    baseUrl: "https://example.test/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096,
  };
}

describe("appendPrioritizedDynamicLiveModels", () => {
  beforeEach(() => {
    providerRuntimeMocks.prepareProviderDynamicModel.mockReset();
    providerRuntimeMocks.prepareProviderDynamicModel.mockResolvedValue(undefined);
    providerRuntimeMocks.resolveProviderModernModelRef.mockReset();
    providerRuntimeMocks.resolveProviderModernModelRef.mockReturnValue(undefined);
    providerRuntimeMocks.runProviderDynamicModel.mockReset();
    providerRuntimeMocks.runProviderDynamicModel.mockReturnValue(undefined);
  });

  it("materializes prioritized refs from provider dynamic model hooks", async () => {
    const resolveDynamicModel: DynamicModelResolver = vi.fn((params) =>
      params.context.provider === DYNAMIC_PROVIDER && params.context.modelId === "glm-5"
        ? model(DYNAMIC_PROVIDER, "glm-5")
        : undefined,
    );
    const prepareDynamicModel: DynamicModelPreparer = vi.fn(async () => undefined);
    const normalizeModel: DynamicModelNormalizer = vi.fn((entry) => entry);
    const config = {
      models: {
        providers: {
          [DYNAMIC_PROVIDER]: {
            azaicoder: "openai-completions",
            baseUrl: "https://configured.example/v1",
            models: [],
          },
        },
      },
    } as zAICoderConfig;

    const result = await appendPrioritizedDynamicLiveModels({
      models: [model("anthrozaicoderc", "zaicoder-sonnet-4-6")],
      config,
      agentDir: "/tmp/zaicoder-agent",
      modelRegistry: REGISTRY,
      resolveDynamicModel,
      prepareDynamicModel,
      normalizeModel,
      refs: [
        { provider: "anthrozaicoderc", id: "zaicoder-sonnet-4-6" },
        { provider: DYNAMIC_PROVIDER, id: "glm-5" },
      ],
    });

    expect(result.added.map((entry) => `${entry.provider}/${entry.id}`)).toEqual([
      `${DYNAMIC_PROVIDER}/glm-5`,
    ]);
    expect(result.models.map((entry) => `${entry.provider}/${entry.id}`)).toEqual([
      "anthrozaicoderc/zaicoder-sonnet-4-6",
      `${DYNAMIC_PROVIDER}/glm-5`,
    ]);
    expect(prepareDynamicModel).toHaveBeenCalledTimes(1);
    expect(prepareDynamicModel).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: DYNAMIC_PROVIDER,
        context: expect.objectContaining({
          agentDir: "/tmp/zaicoder-agent",
          modelId: "glm-5",
          modelRegistry: REGISTRY,
          provider: DYNAMIC_PROVIDER,
          providerConfig: config.models?.providers?.[DYNAMIC_PROVIDER],
        }),
      }),
    );
    expect(resolveDynamicModel).toHaveBeenCalledTimes(1);
    expect(resolveDynamicModel).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: DYNAMIC_PROVIDER,
        context: expect.objectContaining({
          agentDir: "/tmp/zaicoder-agent",
          modelId: "glm-5",
          modelRegistry: REGISTRY,
          provider: DYNAMIC_PROVIDER,
          providerConfig: config.models?.providers?.[DYNAMIC_PROVIDER],
        }),
      }),
    );
    expect(normalizeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: DYNAMIC_PROVIDER,
        id: "glm-5",
      }),
      "/tmp/zaicoder-agent",
    );
  });

  it("does not duplicate refs already present in the generated registry", async () => {
    const resolveDynamicModel: DynamicModelResolver = vi.fn(() => model(DYNAMIC_PROVIDER, "glm-5"));
    const prepareDynamicModel: DynamicModelPreparer = vi.fn(async () => undefined);

    const result = await appendPrioritizedDynamicLiveModels({
      models: [model(DYNAMIC_PROVIDER, "glm-5")],
      agentDir: "/tmp/zaicoder-agent",
      modelRegistry: REGISTRY,
      resolveDynamicModel,
      prepareDynamicModel,
      refs: [{ provider: DYNAMIC_PROVIDER, id: "glm-5" }],
    });

    expect(result.added).toEqual([]);
    expect(result.models).toHaveLength(1);
    expect(prepareDynamicModel).not.toHaveBeenCalled();
    expect(resolveDynamicModel).not.toHaveBeenCalled();
  });

  it("uses default provider runtime hooks when resolvers are not injected", async () => {
    providerRuntimeMocks.runProviderDynamicModel.mockImplementation((params) =>
      params.context.provider === DYNAMIC_PROVIDER && params.context.modelId === "glm-5"
        ? model(DYNAMIC_PROVIDER, "glm-5")
        : undefined,
    );

    const result = await appendPrioritizedDynamicLiveModels({
      models: [],
      agentDir: "/tmp/zaicoder-agent",
      modelRegistry: REGISTRY,
      refs: [{ provider: DYNAMIC_PROVIDER, id: "glm-5" }],
    });

    expect(result.added.map((entry) => `${entry.provider}/${entry.id}`)).toEqual([
      `${DYNAMIC_PROVIDER}/glm-5`,
    ]);
    expect(providerRuntimeMocks.prepareProviderDynamicModel).toHaveBeenCalledTimes(1);
    expect(providerRuntimeMocks.runProviderDynamicModel).toHaveBeenCalledTimes(1);
  });
});
