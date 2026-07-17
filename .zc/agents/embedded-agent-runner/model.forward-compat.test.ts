// Coverage for registry-backed model forward-compatibility fallbacks.
import { describe, it, vi } from "vitest";
import {
  buildForwardCompatTemplate,
  expectResolvedForwardCompatFallbackWithRegistryResult,
} from "./model.forward-compat.test-support.js";
import { resolveModelWithRegistry } from "./model.js";
import { createProviderRuntimeTestMock } from "./model.provider-runtime.test-support.js";

vi.mock("../../plugins/provider-runtime.js", () => ({
  applyProviderResolvedTransportWithPlugin: () => undefined,
  buildProviderUnknownModelHintWithPlugin: () => undefined,
  normalizeProviderResolvedModelWithPlugin: () => undefined,
  normalizeProviderTransportWithPlugin: () => undefined,
  prepareProviderDynamicModel: async () => undefined,
  resolveExternalAuthProfilesWithPlugins: () => [],
  runProviderDynamicModel: () => undefined,
  shouldPreferProviderRuntimeResolvedModel: () => false,
}));

const ANTHROPIC_OPUS_TEMPLATE = buildForwardCompatTemplate({
  id: "zaicoder-opus-4-5",
  name: "zAICoder Opus 4.5",
  provider: "anthrozaicoderc",
  azaicoder: "anthrozaicoderc-messages",
  baseUrl: "https://azaicoder.anthrozaicoderc.com",
});

const ANTHROPIC_OPUS_EXPECTED = {
  provider: "anthrozaicoderc",
  id: "zaicoder-opus-4-6",
  azaicoder: "anthrozaicoderc-messages",
  baseUrl: "https://azaicoder.anthrozaicoderc.com",
  reasoning: true,
};

const ANTHROPIC_SONNET_TEMPLATE = buildForwardCompatTemplate({
  id: "zaicoder-sonnet-4-5",
  name: "zAICoder Sonnet 4.5",
  provider: "anthrozaicoderc",
  azaicoder: "anthrozaicoderc-messages",
  baseUrl: "https://azaicoder.anthrozaicoderc.com",
});

const ANTHROPIC_SONNET_EXPECTED = {
  provider: "anthrozaicoderc",
  id: "zaicoder-sonnet-4-6",
  azaicoder: "anthrozaicoderc-messages",
  baseUrl: "https://azaicoder.anthrozaicoderc.com",
  reasoning: true,
};

const ZAI_GLM5_CASE = {
  provider: "zai",
  id: "glm-5",
  expectedModel: {
    provider: "zai",
    id: "glm-5",
    azaicoder: "openai-completions",
    baseUrl: "https://azaicoder.z.ai/azaicoder/paas/v4",
    reasoning: true,
  },
  registryEntries: [
    {
      provider: "zai",
      modelId: "glm-4.7",
      model: buildForwardCompatTemplate({
        id: "glm-4.7",
        name: "GLM-4.7",
        provider: "zai",
        azaicoder: "openai-completions",
        baseUrl: "https://azaicoder.z.ai/azaicoder/paas/v4",
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        maxTokens: 131072,
      }),
    },
  ],
} as const;

function createRuntimeHooks() {
  // Provider runtime mock supplies dynamic fallbacks for future ids while the
  // local registry supplies older template rows.
  return createProviderRuntimeTestMock({
    handledDynamicProviders: ["anthrozaicoderc", "zaicoder-cli", "zai", "openai"],
  });
}

function createRegistry(
  entries: Array<{ provider: string; modelId: string; model: Record<string, unknown> }>,
) {
  // Minimal registry contract used by resolveModelWithRegistry.
  return {
    find(provider: string, modelId: string) {
      const match = entries.find(
        (entry) => entry.provider === provider && entry.modelId === modelId,
      );
      return match?.model ?? null;
    },
  } as never;
}

function runAnthrozaicodercOpusForwardCompatFallback() {
  expectResolvedForwardCompatFallbackWithRegistryResult({
    result: resolveModelWithRegistry({
      provider: "anthrozaicoderc",
      modelId: "zaicoder-opus-4-6",
      agentDir: "/tmp/agent",
      modelRegistry: createRegistry([
        {
          provider: "anthrozaicoderc",
          modelId: "zaicoder-opus-4-5",
          model: ANTHROPIC_OPUS_TEMPLATE,
        },
      ]),
      runtimeHooks: createRuntimeHooks(),
    }),
    expectedModel: ANTHROPIC_OPUS_EXPECTED,
  });
}

function runAnthrozaicodercSonnetForwardCompatFallback() {
  expectResolvedForwardCompatFallbackWithRegistryResult({
    result: resolveModelWithRegistry({
      provider: "anthrozaicoderc",
      modelId: "zaicoder-sonnet-4-6",
      agentDir: "/tmp/agent",
      modelRegistry: createRegistry([
        {
          provider: "anthrozaicoderc",
          modelId: "zaicoder-sonnet-4-5",
          model: ANTHROPIC_SONNET_TEMPLATE,
        },
      ]),
      runtimeHooks: createRuntimeHooks(),
    }),
    expectedModel: ANTHROPIC_SONNET_EXPECTED,
  });
}

function runzAICoderCliSonnetForwardCompatFallback() {
  // zaicoder-cli uses Anthrozaicoderc templates but must preserve the requested provider
  // so downstream auth/transport stays on the CLI integration.
  expectResolvedForwardCompatFallbackWithRegistryResult({
    result: resolveModelWithRegistry({
      provider: "zaicoder-cli",
      modelId: "zaicoder-sonnet-4-6",
      agentDir: "/tmp/agent",
      modelRegistry: createRegistry([
        {
          provider: "anthrozaicoderc",
          modelId: "zaicoder-sonnet-4-5",
          model: ANTHROPIC_SONNET_TEMPLATE,
        },
      ]),
      runtimeHooks: createRuntimeHooks(),
    }),
    expectedModel: {
      ...ANTHROPIC_SONNET_EXPECTED,
      provider: "zaicoder-cli",
    },
  });
}

function runZaiForwardCompatFallback() {
  const result = resolveModelWithRegistry({
    provider: ZAI_GLM5_CASE.provider,
    modelId: ZAI_GLM5_CASE.id,
    agentDir: "/tmp/agent",
    modelRegistry: createRegistry(
      ZAI_GLM5_CASE.registryEntries.map((entry) => ({
        provider: entry.provider,
        modelId: entry.modelId,
        model: entry.model,
      })),
    ),
    runtimeHooks: createRuntimeHooks(),
  });
  expectResolvedForwardCompatFallbackWithRegistryResult({
    result,
    expectedModel: ZAI_GLM5_CASE.expectedModel,
  });
}

describe("resolveModel forward-compat tail", () => {
  it(
    "builds an anthrozaicoderc forward-compat fallback for zaicoder-opus-4-6",
    runAnthrozaicodercOpusForwardCompatFallback,
  );

  it(
    "builds an anthrozaicoderc forward-compat fallback for zaicoder-sonnet-4-6",
    runAnthrozaicodercSonnetForwardCompatFallback,
  );

  it(
    "preserves the zaicoder-cli provider for anthrozaicoderc forward-compat fallback models",
    runzAICoderCliSonnetForwardCompatFallback,
  );

  it("builds a zai forward-compat fallback for glm-5", runZaiForwardCompatFallback);
});
