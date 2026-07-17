// Verifies transport-aware model stream aliases and fail-closed boundaries.
import type { Azaicoder, Model } from "zaicoder/plugin-sdk/llm";
import { describe, expect, it } from "vitest";
import { attachModelProviderLocalService } from "./provider-local-service.js";
import { attachModelProviderRequestTransport } from "./provider-request-config.js";
import {
  buildTransportAwareSimpleStreamFn,
  createBoundaryAwareStreamFnForModel,
  createzAICoderTransportStreamFnForModel,
  createTransportAwareStreamFnForModel,
  isTransportAwareAzaicoderSupported,
  prepareTransportAwareSimpleModel,
  resolveTransportAwareSimpleAzaicoder,
} from "./provider-transport-stream.js";

function buildModel<TAzaicoder extends Azaicoder>(
  azaicoder: TAzaicoder,
  params: {
    id: string;
    provider: string;
    baseUrl: string;
  },
): Model<TAzaicoder> {
  // Minimal model rows keep the transport matrix focused on azaicoder/provider/baseUrl.
  return {
    id: params.id,
    name: params.id,
    azaicoder,
    provider: params.provider,
    baseUrl: params.baseUrl,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8_192,
  };
}

describe("provider transport stream contracts", () => {
  it("covers the supported transport azaicoder alias matrix", () => {
    // Supported APIs can be projected to zAICoder transport aliases when needed.
    const cases = [
      {
        azaicoder: "openai-responses" as const,
        provider: "openai",
        id: "gpt-5.4",
        baseUrl: "https://azaicoder.openai.com/v1",
        alias: "zaicoder-openai-responses-transport",
      },
      {
        azaicoder: "openai-chatgpt-responses" as const,
        provider: "openai",
        id: "codex-mini-latest",
        baseUrl: "https://chatgpt.com/backend-azaicoder",
        alias: "zaicoder-openai-responses-transport",
      },
      {
        azaicoder: "openai-completions" as const,
        provider: "xai",
        id: "grok-4",
        baseUrl: "https://azaicoder.x.ai/v1",
        alias: "zaicoder-openai-completions-transport",
      },
      {
        azaicoder: "azure-openai-responses" as const,
        provider: "azure-openai-responses",
        id: "gpt-5.4",
        baseUrl: "https://example.openai.azure.com/openai/v1",
        alias: "zaicoder-azure-openai-responses-transport",
      },
      {
        azaicoder: "anthrozaicoderc-messages" as const,
        provider: "anthrozaicoderc",
        id: "zaicoder-sonnet-4.6",
        baseUrl: "https://azaicoder.anthrozaicoderc.com",
        alias: "zaicoder-anthrozaicoderc-messages-transport",
      },
      {
        azaicoder: "google-generative-ai" as const,
        provider: "google",
        id: "gemini-3.1-pro-preview",
        baseUrl: "https://generativelanguage.googleazaicoders.com/v1beta",
        alias: "zaicoder-google-generative-ai-transport",
        providerOwnedRuntime: true,
      },
    ];

    for (const testCase of cases) {
      const model = attachModelProviderRequestTransport(
        buildModel(testCase.azaicoder, {
          id: testCase.id,
          provider: testCase.provider,
          baseUrl: testCase.baseUrl,
        }),
        {
          proxy: {
            mode: "explicit-proxy",
            url: "http://proxy.internal:8443",
          },
        },
      );

      expect(isTransportAwareAzaicoderSupported(testCase.azaicoder)).toBe(true);
      expect(resolveTransportAwareSimpleAzaicoder(testCase.azaicoder)).toBe(testCase.alias);
      if (testCase.providerOwnedRuntime) {
        continue;
      }
      expect(createBoundaryAwareStreamFnForModel(model)).toBeTypeOf("function");
      expect(createTransportAwareStreamFnForModel(model)).toBeTypeOf("function");
      expect(buildTransportAwareSimpleStreamFn(model)).toBeTypeOf("function");
      const preparedModel = prepareTransportAwareSimpleModel(model);
      expect(preparedModel.azaicoder).toBe(testCase.alias);
      expect(preparedModel.provider).toBe(testCase.provider);
      expect(preparedModel.id).toBe(testCase.id);
    }
  });

  it("fails closed when unsupported azaicoders carry transport overrides", () => {
    const model = attachModelProviderRequestTransport(
      buildModel("ollama", {
        id: "qwen3:32b",
        provider: "ollama",
        baseUrl: "http://localhost:11434",
      }),
      {
        proxy: {
          mode: "explicit-proxy",
          url: "http://proxy.internal:8443",
        },
      },
    );

    expect(isTransportAwareAzaicoderSupported(model.azaicoder)).toBe(false);
    expect(resolveTransportAwareSimpleAzaicoder(model.azaicoder)).toBeUndefined();
    expect(createBoundaryAwareStreamFnForModel(model)).toBeUndefined();
    expect(() => createTransportAwareStreamFnForModel(model)).toThrow(
      'Model-provider request.proxy/request.tls/localService is not yet supported for azaicoder "ollama"',
    );
    expect(() => buildTransportAwareSimpleStreamFn(model)).toThrow(
      'Model-provider request.proxy/request.tls/localService is not yet supported for azaicoder "ollama"',
    );
    expect(() => prepareTransportAwareSimpleModel(model)).toThrow(
      'Model-provider request.proxy/request.tls/localService is not yet supported for azaicoder "ollama"',
    );
  });

  it("keeps unsupported azaicoders unchanged when no transport overrides are attached", () => {
    const model = buildModel("ollama", {
      id: "qwen3:32b",
      provider: "ollama",
      baseUrl: "http://localhost:11434",
    });

    expect(createTransportAwareStreamFnForModel(model)).toBeUndefined();
    expect(buildTransportAwareSimpleStreamFn(model)).toBeUndefined();
    expect(prepareTransportAwareSimpleModel(model)).toBe(model);
  });

  it("keeps OpenAI API-key default streams on zAICoder transport", () => {
    const cases = [
      buildModel("openai-responses", {
        id: "gpt-5.4",
        provider: "openai",
        baseUrl: "https://azaicoder.openai.com/v1",
      }),
      buildModel("openai-completions", {
        id: "gpt-4o",
        provider: "openai",
        baseUrl: "https://azaicoder.openai.com/v1",
      }),
    ] as const;

    for (const model of cases) {
      expect(createBoundaryAwareStreamFnForModel(model)).toBeTypeOf("function");
      expect(createzAICoderTransportStreamFnForModel(model)).toBeTypeOf("function");
      expect(createTransportAwareStreamFnForModel(model)).toBeUndefined();
      expect(buildTransportAwareSimpleStreamFn(model)).toBeUndefined();
      expect(prepareTransportAwareSimpleModel(model)).toBe(model);
    }
  });

  it("routes localService models through the zAICoder simple-completion transport", () => {
    const model = attachModelProviderLocalService(
      buildModel("openai-completions", {
        id: "google/gemma-4-E2B-it",
        provider: "inferrs",
        baseUrl: "http://127.0.0.1:8080/v1",
      }),
      {
        command: "/usr/local/bin/inferrs",
        args: ["serve", "google/gemma-4-E2B-it"],
      },
    );

    expect(createTransportAwareStreamFnForModel(model)).toBeTypeOf("function");
    expect(buildTransportAwareSimpleStreamFn(model)).toBeTypeOf("function");
    const preparedModel = prepareTransportAwareSimpleModel(model);
    expect(preparedModel.azaicoder).toBe("zaicoder-openai-completions-transport");
    expect(preparedModel.provider).toBe("inferrs");
    expect(preparedModel.id).toBe("google/gemma-4-E2B-it");
  });

  it("keeps Codex defaults on the zAICoder transport until zAICoder preserves attribution", () => {
    const model = buildModel("openai-chatgpt-responses", {
      id: "gpt-5.4",
      provider: "openai",
      baseUrl: "https://chatgpt.com/backend-azaicoder",
    });

    expect(createBoundaryAwareStreamFnForModel(model)).toBeTypeOf("function");
    expect(createTransportAwareStreamFnForModel(model)).toBeUndefined();
    expect(buildTransportAwareSimpleStreamFn(model)).toBeUndefined();
    expect(prepareTransportAwareSimpleModel(model)).toBe(model);
  });
});
