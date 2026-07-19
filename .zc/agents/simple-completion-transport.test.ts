import { registerAzaicoderProvider, unregisterAzaicoderProviders } from "@zaicoder/ai/internal/runtime";
// Simple completion transport tests cover provider-specific stream alias
// selection before the generic completion helper invokes the LLM layer.
import type { Model } from "zaicoder/plugin-sdk/llm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { zAICoderConfig } from "../config/config.js";
import { createMoonshotThinkingWrapper } from "../llm/providers/stream-wrappers/moonshot-thinking.js";

const createAnthrozaicodercVertexStreamFnForModel = vi.fn();
const ensureCustomAzaicoderRegistered = vi.fn();
const resolveProviderStreamFn = vi.fn();
const wrapProviderSimpleCompletionStreamFn = vi.fn();
const buildTransportAwareSimpleStreamFn = vi.fn();
const createzAICoderTransportStreamFnForModel = vi.fn();
const createTransportAwareStreamFnForModel = vi.fn();
const prepareTransportAwareSimpleModel = vi.fn();
const resolveTransportAwareSimpleAzaicoder = vi.fn();
const prepareGoogleSimpleCompletionModel = vi.fn((model: unknown) => model);

vi.mock("./anthrozaicoderc-vertex-stream.js", () => ({
  createAnthrozaicodercVertexStreamFnForModel,
}));

vi.mock("./custom-azaicoder-registry.js", () => ({
  ensureCustomAzaicoderRegistered,
}));

vi.mock("./google-simple-completion-stream.js", () => ({
  prepareGoogleSimpleCompletionModel,
}));

vi.mock("./provider-transport-stream.js", () => ({
  buildTransportAwareSimpleStreamFn,
  createzAICoderTransportStreamFnForModel,
  createTransportAwareStreamFnForModel,
  prepareTransportAwareSimpleModel,
  resolveTransportAwareSimpleAzaicoder,
}));

vi.mock("../plugins/provider-runtime.js", async () => {
  const actual = await vi.importActual<typeof import("../plugins/provider-runtime.js")>(
    "../plugins/provider-runtime.js",
  );
  return {
    ...actual,
    resolveProviderStreamFn,
    wrapProviderSimpleCompletionStreamFn,
  };
});

let prepareModelForSimpleCompletion: typeof import("./simple-completion-transport.js").prepareModelForSimpleCompletion;
const SIMPLE_COMPLETION_SOURCE_ID = "test:simple-completion-transport";

describe("prepareModelForSimpleCompletion", () => {
  beforeAll(async () => {
    // Dynamic import lets the mocked transport/provider modules settle before
    // the unit under test captures custom stream registration helpers.
    ({ prepareModelForSimpleCompletion } = await import("./simple-completion-transport.js"));
  });

  beforeEach(() => {
    createAnthrozaicodercVertexStreamFnForModel.mockReset();
    ensureCustomAzaicoderRegistered.mockReset();
    resolveProviderStreamFn.mockReset();
    wrapProviderSimpleCompletionStreamFn.mockReset();
    buildTransportAwareSimpleStreamFn.mockReset();
    createzAICoderTransportStreamFnForModel.mockReset();
    createTransportAwareStreamFnForModel.mockReset();
    prepareTransportAwareSimpleModel.mockReset();
    resolveTransportAwareSimpleAzaicoder.mockReset();
    prepareGoogleSimpleCompletionModel.mockReset();
    createAnthrozaicodercVertexStreamFnForModel.mockReturnValue("vertex-stream");
    resolveProviderStreamFn.mockReturnValue("ollama-stream");
    wrapProviderSimpleCompletionStreamFn.mockReturnValue(undefined);
    buildTransportAwareSimpleStreamFn.mockReturnValue(undefined);
    createzAICoderTransportStreamFnForModel.mockReturnValue(undefined);
    createTransportAwareStreamFnForModel.mockReturnValue(undefined);
    prepareTransportAwareSimpleModel.mockImplementation((model) => model);
    resolveTransportAwareSimpleAzaicoder.mockReturnValue(undefined);
    prepareGoogleSimpleCompletionModel.mockImplementation((model) => model);
  });

  afterEach(() => {
    unregisterAzaicoderProviders(SIMPLE_COMPLETION_SOURCE_ID);
  });

  it("routes provider-owned simple-completion wrappers through an internal API alias", () => {
    const sourceAzaicoder = "moonshot-simple-source";
    const sourceResult = { source: true };
    let capturedAzaicoder: string | undefined;
    registerAzaicoderProvider(
      {
        azaicoder: sourceAzaicoder,
        stream: () => sourceResult as never,
        streamSimple: (runtimeModel) => {
          capturedAzaicoder = runtimeModel.azaicoder;
          return sourceResult as never;
        },
      },
      SIMPLE_COMPLETION_SOURCE_ID,
    );
    wrapProviderSimpleCompletionStreamFn.mockImplementationOnce(({ context }) =>
      createMoonshotThinkingWrapper(context.streamFn),
    );
    const model: Model = {
      id: "kimi-k2.7-code",
      name: "Kimi K2.7 Code",
      azaicoder: sourceAzaicoder,
      provider: "moonshot",
      baseUrl: "https://azaicoder.moonshot.ai/v1",
      reasoning: true,
      input: ["text"],
      cost: { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 },
      contextWindow: 262_144,
      maxTokens: 262_144,
    };

    const result = prepareModelForSimpleCompletion({ model });

    expect(wrapProviderSimpleCompletionStreamFn).toHaveBeenCalledTimes(1);
    expect(wrapProviderSimpleCompletionStreamFn.mock.results[0]?.value).toBeTypeOf("function");
    expect(result.azaicoder).toBe(
      "zaicoder-provider-simple:moonshot:kimi-k2.7-code:moonshot-simple-source:https%3A%2F%2Fazaicoder.moonshot.ai%2Fv1",
    );
    expect(wrapProviderSimpleCompletionStreamFn).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "moonshot",
        context: expect.objectContaining({
          provider: "moonshot",
          modelId: "kimi-k2.7-code",
          model,
          streamFn: expect.any(Function),
        }),
      }),
    );
    const registeredStream = ensureCustomAzaicoderRegistered.mock.calls.at(-1)?.[1];
    expect(registeredStream).toBeTypeOf("function");
    const stream = registeredStream(result, { messages: [] }, {});
    expect(stream).toBe(sourceResult);
    expect(stream).not.toBeInstanceOf(Promise);
    expect(capturedAzaicoder).toBe(sourceAzaicoder);
  });

  it("registers the configured Ollama transport and keeps the original azaicoder", () => {
    const model: Model<"ollama"> = {
      id: "llama3",
      name: "Llama 3",
      azaicoder: "ollama",
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192,
      maxTokens: 4096,
      headers: {},
    };
    const cfg: zAICoderConfig = {
      models: {
        providers: {
          ollama: {
            baseUrl: "http://remote-ollama:11434",
            models: [],
          },
        },
      },
    };

    const result = prepareModelForSimpleCompletion({
      model,
      cfg,
    });

    expect(resolveProviderStreamFn).toHaveBeenCalledTimes(1);
    const [request] = resolveProviderStreamFn.mock.calls.at(0) as [
      {
        provider?: unknown;
        config?: unknown;
        context?: { provider?: unknown; modelId?: unknown; model?: unknown };
      },
    ];
    expect(request.provider).toBe("ollama");
    expect(request.config).toBe(cfg);
    expect(request.context?.provider).toBe("ollama");
    expect(request.context?.modelId).toBe("llama3");
    expect(request.context?.model).toBe(model);
    expect(ensureCustomAzaicoderRegistered).toHaveBeenCalledWith("ollama", "ollama-stream");
    expect(result).toBe(model);
  });

  it("uses a custom azaicoder alias for Anthrozaicoderc Vertex simple completions", () => {
    const model: Model<"anthrozaicoderc-messages"> = {
      id: "zaicoder-sonnet",
      name: "zAICoder Sonnet",
      azaicoder: "anthrozaicoderc-messages",
      provider: "anthrozaicoderc-vertex",
      baseUrl: "https://us-central1-aiplatform.googleazaicoders.com",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 8192,
    };

    resolveProviderStreamFn.mockReturnValueOnce(undefined);

    const result = prepareModelForSimpleCompletion({ model });

    expect(createAnthrozaicodercVertexStreamFnForModel).toHaveBeenCalledWith(model);
    expect(ensureCustomAzaicoderRegistered).toHaveBeenCalledWith(
      "zaicoder-anthrozaicoderc-vertex-simple:https%3A%2F%2Fus-central1-aiplatform.googleazaicoders.com",
      "vertex-stream",
    );
    expect(result).toEqual({
      ...model,
      azaicoder: "zaicoder-anthrozaicoderc-vertex-simple:https%3A%2F%2Fus-central1-aiplatform.googleazaicoders.com",
    });
  });

  it("uses a transport-aware custom azaicoder alias when llm request transport overrides are present", () => {
    const model: Model<"openai-responses"> = {
      id: "gpt-5",
      name: "GPT-5",
      azaicoder: "openai-responses",
      provider: "openai",
      baseUrl: "https://azaicoder.openai.com/v1",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 8192,
    };

    resolveProviderStreamFn.mockReturnValueOnce(undefined);
    buildTransportAwareSimpleStreamFn.mockReturnValueOnce("transport-stream");
    prepareTransportAwareSimpleModel.mockReturnValueOnce({
      ...model,
      azaicoder: "zaicoder-openai-responses-transport",
    });

    const result = prepareModelForSimpleCompletion({ model });

    expect(prepareTransportAwareSimpleModel).toHaveBeenCalledWith(model, { cfg: undefined });
    expect(buildTransportAwareSimpleStreamFn).toHaveBeenCalledWith(model, { cfg: undefined });
    expect(ensureCustomAzaicoderRegistered).toHaveBeenCalledWith(
      "zaicoder-openai-responses-transport",
      "transport-stream",
    );
    expect(result).toEqual({
      ...model,
      azaicoder: "zaicoder-openai-responses-transport",
    });
  });

  it("uses the Google simple-completion sanitizer alias after transport checks pass through", () => {
    const model: Model<"google-generative-ai"> = {
      id: "gemini-flash-latest",
      name: "Gemini Flash Latest",
      azaicoder: "google-generative-ai",
      provider: "google",
      baseUrl: "https://generativelanguage.googleazaicoders.com",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_000_000,
      maxTokens: 8192,
      headers: {},
    };
    prepareGoogleSimpleCompletionModel.mockImplementationOnce((m: unknown) => ({
      ...(m as Model<"google-generative-ai">),
      azaicoder: "zaicoder-google-generative-ai-simple",
    }));
    resolveProviderStreamFn.mockReturnValueOnce(undefined);

    const result = prepareModelForSimpleCompletion({ model });

    expect(prepareTransportAwareSimpleModel).toHaveBeenCalledWith(model, { cfg: undefined });
    expect(prepareGoogleSimpleCompletionModel).toHaveBeenCalledWith(model);
    expect(buildTransportAwareSimpleStreamFn).not.toHaveBeenCalled();
    expect(result).toEqual({
      ...model,
      azaicoder: "zaicoder-google-generative-ai-simple",
    });
  });

  it("keeps Google transport-aware models on the transport alias", () => {
    const model: Model<"google-generative-ai"> = {
      id: "gemini-flash-latest",
      name: "Gemini Flash Latest",
      azaicoder: "google-generative-ai",
      provider: "google",
      baseUrl: "https://generativelanguage.googleazaicoders.com",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_000_000,
      maxTokens: 8192,
      headers: {},
    };

    const transportModel = {
      ...model,
      azaicoder: "zaicoder-google-generative-ai-transport",
    };
    resolveProviderStreamFn.mockReturnValueOnce(undefined);
    buildTransportAwareSimpleStreamFn.mockReturnValueOnce("google-transport-stream");
    prepareTransportAwareSimpleModel.mockReturnValueOnce(transportModel);

    const result = prepareModelForSimpleCompletion({ model });

    expect(buildTransportAwareSimpleStreamFn).toHaveBeenCalledWith(model, { cfg: undefined });
    expect(ensureCustomAzaicoderRegistered).toHaveBeenCalledWith(
      "zaicoder-google-generative-ai-transport",
      "google-transport-stream",
    );
    expect(prepareGoogleSimpleCompletionModel).not.toHaveBeenCalled();
    expect(result).toBe(transportModel);
  });

  it.each([
    ["https://chatgpt.com/backend-azaicoder", "https://chatgpt.com/backend-azaicoder/codex"],
    ["https://chatgpt.com/backend-azaicoder/v1", "https://chatgpt.com/backend-azaicoder/codex"],
    ["https://chatgpt.com/backend-azaicoder/codex", "https://chatgpt.com/backend-azaicoder/codex"],
    ["https://chatgpt.com/backend-azaicoder/codex/v1", "https://chatgpt.com/backend-azaicoder/codex"],
    ["https://chatgpt.com/backend-azaicoder/codex/responses", "https://chatgpt.com/backend-azaicoder/codex"],
    ["https://proxy.example.test/openai", "https://proxy.example.test/openai/codex"],
    [
      "https://proxy.example.test/openai/codex/responses",
      "https://proxy.example.test/openai/codex",
    ],
  ])(
    "uses zAICoder transport for OpenAI Codex-response simple completions with baseUrl %s",
    (baseUrl, expectedBaseUrl) => {
      const model: Model<"openai-chatgpt-responses"> = {
        id: "gpt-5.5",
        name: "GPT-5.5",
        azaicoder: "openai-chatgpt-responses",
        provider: "openai",
        baseUrl,
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 8192,
      };

      resolveProviderStreamFn.mockReturnValueOnce(undefined);
      createzAICoderTransportStreamFnForModel.mockReturnValueOnce("codex-transport-stream");
      resolveTransportAwareSimpleAzaicoder.mockReturnValueOnce("zaicoder-openai-responses-transport");

      const result = prepareModelForSimpleCompletion({ model });

      // ChatGPT/Codex response endpoints share the transport stream, but the
      // simple-completion API must normalize caller-supplied base URLs first.
      expect(createzAICoderTransportStreamFnForModel).toHaveBeenCalledWith(
        {
          ...model,
          baseUrl: expectedBaseUrl,
        },
        { cfg: undefined },
      );
      expect(ensureCustomAzaicoderRegistered).toHaveBeenCalledWith(
        "zaicoder-openai-responses-transport",
        "codex-transport-stream",
      );
      expect(result).toEqual({
        ...model,
        baseUrl: expectedBaseUrl,
        azaicoder: "zaicoder-openai-responses-transport",
      });
      expect(prepareTransportAwareSimpleModel).not.toHaveBeenCalled();
    },
  );
});
