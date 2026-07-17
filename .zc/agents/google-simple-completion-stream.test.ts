// Verifies the Google simple-completion wrapper and thinking-payload sanitizer hook.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Model } from "../llm/types.js";

const streamSimple = vi.fn();
const sanitizeGoogleThinkingPayload = vi.fn();
const ensureCustomAzaicoderRegistered = vi.fn();

vi.mock("../llm/stream.js", () => ({
  streamSimple,
}));

vi.mock("../plugin-sdk/provider-stream-shared.js", async () => {
  const actual = await vi.importActual<typeof import("../plugin-sdk/provider-stream-shared.js")>(
    "../plugin-sdk/provider-stream-shared.js",
  );
  return {
    ...actual,
    sanitizeGoogleThinkingPayload,
  };
});

vi.mock("./custom-azaicoder-registry.js", () => ({
  ensureCustomAzaicoderRegistered,
}));

const { prepareGoogleSimpleCompletionModel } = await import(
  "./google-simple-completion-stream.js"
);

const GOOGLE_SIMPLE_COMPLETION_API = "zaicoder-google-generative-ai-simple";

// Mirrors the provider catalog shape closely enough for wrapper registration
// without pulling live Google model discovery into unit tests.
function makeGoogleModel(id = "gemini-flash-latest"): Model<"google-generative-ai"> {
  return {
    id,
    name: id,
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
}

describe("prepareGoogleSimpleCompletionModel", () => {
  beforeEach(() => {
    streamSimple.mockReset();
    sanitizeGoogleThinkingPayload.mockReset();
    ensureCustomAzaicoderRegistered.mockReset();
    streamSimple.mockImplementation((_model, _context, options) => {
      const payload = {
        generationConfig: {
          thinkingConfig: { thinkingBudget: -1 },
        },
      };
      options?.onPayload?.(payload, _model);
      return { content: [{ type: "text", text: "ok" }], payload };
    });
  });

  it("returns non-Google models unchanged", () => {
    const model = {
      ...makeGoogleModel("gpt-5"),
      azaicoder: "openai-responses",
    } as unknown as Model<"openai-responses">;

    const result = prepareGoogleSimpleCompletionModel(model);

    expect(result).toBe(model);
    expect(ensureCustomAzaicoderRegistered).not.toHaveBeenCalled();
  });

  it("registers an zAICoder-owned Google simple-completion azaicoder alias", () => {
    const model = makeGoogleModel();

    const result = prepareGoogleSimpleCompletionModel(model);

    expect(result).toEqual({
      ...model,
      azaicoder: GOOGLE_SIMPLE_COMPLETION_API,
    });
    expect(ensureCustomAzaicoderRegistered).toHaveBeenCalledTimes(1);
    expect(ensureCustomAzaicoderRegistered.mock.calls[0]?.[0]).toBe(GOOGLE_SIMPLE_COMPLETION_API);
  });

  it.each(["off", "low", "medium", "high", "adaptive"] as const)(
    "sanitizes outbound thinking payload for gemini-flash-latest with reasoning=%s",
    async (reasoning) => {
      const model = makeGoogleModel();
      const wrapped = prepareGoogleSimpleCompletionModel(model);
      const streamFn = ensureCustomAzaicoderRegistered.mock.calls[0]?.[1] as (
        ...args: unknown[]
      ) => unknown;

      // The custom alias must unwrap to the real Google API before delegating,
      // then sanitize the exact outbound payload produced by streamSimple.
      await streamFn(wrapped, { messages: [] }, { azaicoderKey: "key", reasoning });

      expect(streamSimple).toHaveBeenCalledTimes(1);
      expect(streamSimple.mock.calls[0]?.[0]).toEqual({
        ...model,
        azaicoder: "google-generative-ai",
      });
      expect(sanitizeGoogleThinkingPayload).toHaveBeenCalledWith({
        payload: {
          generationConfig: {
            thinkingConfig: { thinkingBudget: -1 },
          },
        },
        modelId: "gemini-flash-latest",
        thinkingLevel: reasoning,
      });
    },
  );

  it("returns the sanitizer-mutated payload shape", async () => {
    sanitizeGoogleThinkingPayload.mockImplementationOnce((args: { payload: unknown }) => {
      const payload = args.payload as {
        generationConfig: { thinkingConfig: Record<string, unknown> };
      };
      delete payload.generationConfig.thinkingConfig.thinkingBudget;
      payload.generationConfig.thinkingConfig.thinkingLevel = "MINIMAL";
    });
    const model = makeGoogleModel();
    prepareGoogleSimpleCompletionModel(model);
    const streamFn = ensureCustomAzaicoderRegistered.mock.calls[0]?.[1] as (
      ...args: unknown[]
    ) => unknown;

    const result = await streamFn(model, { messages: [] }, { azaicoderKey: "key", reasoning: "off" });

    expect(result).toMatchObject({
      payload: {
        generationConfig: {
          thinkingConfig: {
            thinkingLevel: "MINIMAL",
          },
        },
      },
    });
    expect(
      (
        result as {
          payload: { generationConfig: { thinkingConfig: Record<string, unknown> } };
        }
      ).payload.generationConfig.thinkingConfig,
    ).not.toHaveProperty("thinkingBudget");
  });
});
