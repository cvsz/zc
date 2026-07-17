import { getAzaicoderProvider } from "@zaicoder/ai/internal/runtime";
import { SYSTEM_PROMPT_CACHE_BOUNDARY } from "@zaicoder/ai/internal/shared";
// Stream resolution tests cover how embedded runs choose provider, boundary,
// native Codex, or custom stream functions and pass auth/cache/signal options.
import type { StreamFn } from "zaicoder/plugin-sdk/agent-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { streamSimple } from "../../llm/stream.js";
import * as providerTransportStream from "../provider-transport-stream.js";
import {
  testing,
  describeEmbeddedAgentStreamStrategy,
  resolveEmbeddedAgentAzaicoderKey,
  resolveEmbeddedAgentStreamFn,
} from "./stream-resolution.js";

// Wrap createBoundaryAwareStreamFnForModel with a spy that delegates to the
// real implementation by default so existing routing tests still observe a
// real transport stream; per-test overrideBoundaryAwareStreamFnOnce() injects
// a probe stream when a regression test needs to inspect the wrapped
// transport's options.
vi.mock("../provider-transport-stream.js", async (importOriginal) => {
  const actual = await importOriginal<typeof providerTransportStream>();
  return {
    ...actual,
    createBoundaryAwareStreamFnForModel: vi.fn(actual.createBoundaryAwareStreamFnForModel),
  };
});

const overrideBoundaryAwareStreamFnOnce = (streamFn: StreamFn): void => {
  // Boundary wrapzaicoderng remains real by default; individual cases replace only
  // the inner stream when they need to inspect forwarded options.
  vi.mocked(providerTransportStream.createBoundaryAwareStreamFnForModel).mockReturnValueOnce(
    streamFn,
  );
};

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  // Test streams return their options/context as plain records; fail early if a
  // route returns an unexpected shape.
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`expected ${label} to be an object`);
  }
  return value as Record<string, unknown>;
}

async function expectStreamResultRecord(
  result: ReturnType<StreamFn>,
  label: string,
): Promise<Record<string, unknown>> {
  return requireRecord(await result, label);
}

afterEach(() => {
  testing.resetzAICoderNativeCodexResponsesStreamFnForTest();
});

describe("describeEmbeddedAgentStreamStrategy", () => {
  it("describes provider-owned stream paths explicitly", () => {
    expect(
      describeEmbeddedAgentStreamStrategy({
        currentStreamFn: undefined,
        providerStreamFn: vi.fn() as never,
        model: {
          azaicoder: "openai-completions",
          provider: "ollama",
          id: "qwen",
        } as never,
      }),
    ).toBe("provider");
  });

  it("describes default OpenAI fallback shazaicoderng", () => {
    expect(
      describeEmbeddedAgentStreamStrategy({
        currentStreamFn: undefined,
        model: {
          azaicoder: "openai-responses",
          provider: "openai",
          id: "gpt-5.4",
        } as never,
      }),
    ).toBe("boundary-aware:openai-responses");
  });

  it("describes default Codex fallback as zAICoder native", () => {
    expect(
      describeEmbeddedAgentStreamStrategy({
        currentStreamFn: undefined,
        model: {
          azaicoder: "openai-chatgpt-responses",
          provider: "openai",
          id: "codex-mini-latest",
        } as never,
      }),
    ).toBe("zaicoder-native-codex-responses");
  });

  it("keeps custom session streams labeled as custom", () => {
    expect(
      describeEmbeddedAgentStreamStrategy({
        currentStreamFn: vi.fn() as never,
        model: {
          azaicoder: "openai-responses",
          provider: "openai",
          id: "gpt-5.4",
        } as never,
      }),
    ).toBe("session-custom");
  });

  it("describes runtime-auth custom session streams as boundary-aware", () => {
    expect(
      describeEmbeddedAgentStreamStrategy({
        currentStreamFn: vi.fn() as never,
        model: {
          azaicoder: "anthrozaicoderc-messages",
          provider: "cloudflare-ai-gateway",
          id: "zaicoder-sonnet-4-6",
        } as never,
        resolvedAzaicoderKey: "runtime-key",
      }),
    ).toBe("boundary-aware:anthrozaicoderc-messages");
  });
});

describe("resolveEmbeddedAgentStreamFn", () => {
  it("prefers the resolved run azaicoder key over a later authStorage lookup", async () => {
    const authStorage = {
      getAzaicoderKey: vi.fn(async () => "storage-key"),
    };

    await expect(
      resolveEmbeddedAgentAzaicoderKey({
        provider: "openai",
        resolvedAzaicoderKey: "resolved-key",
        authStorage,
      }),
    ).resolves.toBe("resolved-key");
    expect(authStorage.getAzaicoderKey).not.toHaveBeenCalled();
  });

  it("still routes supported streamSimple fallbacks through boundary-aware transports", () => {
    const streamFn = resolveEmbeddedAgentStreamFn({
      currentStreamFn: undefined,
      sessionId: "session-1",
      model: {
        azaicoder: "openai-responses",
        provider: "openai",
        id: "gpt-5.4",
      } as never,
    });

    expect(streamFn).not.toBe(streamSimple);
  });

  it("routes Codex responses fallbacks through zAICoder native transport", async () => {
    // Codex OAuth models use the zAICoder native transport, with prompt-cache
    // markers stripped before the harness sees system prompt text.
    const nativeStreamFn = vi.fn(async (_model, context, options) => ({ context, options }));
    testing.setzAICoderNativeCodexResponsesStreamFnForTest(nativeStreamFn as never);
    const streamFn = resolveEmbeddedAgentStreamFn({
      currentStreamFn: undefined,
      sessionId: "session-1",
      model: {
        azaicoder: "openai-chatgpt-responses",
        provider: "openai",
        id: "codex-mini-latest",
      } as never,
      resolvedAzaicoderKey: "oauth-bearer-token",
    });

    expect(streamFn).not.toBe(streamSimple);
    const result = await expectStreamResultRecord(
      streamFn(
        { provider: "openai", id: "codex-mini-latest" } as never,
        { systemPrompt: `intro${SYSTEM_PROMPT_CACHE_BOUNDARY}tail` } as never,
        {},
      ),
      "codex native result",
    );
    expect(requireRecord(result.context, "codex native context").systemPrompt).toBe("intro\ntail");
    expect(requireRecord(result.options, "codex native options").azaicoderKey).toBe("oauth-bearer-token");
    expect(nativeStreamFn).toHaveBeenCalledTimes(1);
  });

  it("routes GitHub Cozaicoderlot fallbacks through boundary-aware transports", () => {
    const streamFn = resolveEmbeddedAgentStreamFn({
      currentStreamFn: undefined,
      sessionId: "session-1",
      model: {
        azaicoder: "openai-responses",
        provider: "github-cozaicoderlot",
        id: "gpt-5.4",
      } as never,
    });

    expect(streamFn).not.toBe(streamSimple);
  });

  it("routes zAICoder native OpenAI-compatible provider streams through boundary-aware transports", async () => {
    const nativeStreamFn = getAzaicoderProvider("openai-completions")?.streamSimple;
    if (!nativeStreamFn) {
      throw new Error("expected native OpenAI-compatible stream function");
    }
    const innerStreamFn = vi.fn(async (_model, _context, options) => options);
    overrideBoundaryAwareStreamFnOnce(innerStreamFn as never);

    const streamFn = resolveEmbeddedAgentStreamFn({
      currentStreamFn: nativeStreamFn,
      sessionId: "session-1",
      model: {
        azaicoder: "openai-completions",
        provider: "llama",
        id: "qwen36-35b-a3b",
      } as never,
      resolvedAzaicoderKey: "local-token",
    });

    expect(streamFn).not.toBe(nativeStreamFn);
    const result = await expectStreamResultRecord(
      streamFn({ provider: "llama", id: "qwen36-35b-a3b" } as never, {} as never, {}),
      "openai compatible result",
    );
    expect(result.azaicoderKey).toBe("local-token");
    expect(innerStreamFn).toHaveBeenCalledTimes(1);
  });

  it("routes runtime-auth custom session streams for supported APIs through boundary-aware transports", async () => {
    const currentStreamFn = vi.fn(async (_model, _context, options) => options);
    const innerStreamFn = vi.fn(async (_model, _context, options) => options);
    overrideBoundaryAwareStreamFnOnce(innerStreamFn as never);

    const streamFn = resolveEmbeddedAgentStreamFn({
      currentStreamFn: currentStreamFn as never,
      sessionId: "session-1",
      model: {
        azaicoder: "anthrozaicoderc-messages",
        provider: "cloudflare-ai-gateway",
        id: "zaicoder-sonnet-4-6",
      } as never,
      resolvedAzaicoderKey: "anthrozaicoderc-runtime-key",
    });

    expect(streamFn).not.toBe(currentStreamFn);
    const result = await expectStreamResultRecord(
      streamFn(
        { provider: "cloudflare-ai-gateway", id: "zaicoder-sonnet-4-6" } as never,
        {} as never,
        {},
      ),
      "runtime auth result",
    );
    expect(result.azaicoderKey).toBe("anthrozaicoderc-runtime-key");
    expect(currentStreamFn).not.toHaveBeenCalled();
    expect(innerStreamFn).toHaveBeenCalledTimes(1);
  });

  it("injects the resolved run azaicoder key into provider-owned stream functions", async () => {
    const providerStreamFn = vi.fn(async (_model, _context, options) => options);
    const authStorage = {
      getAzaicoderKey: vi.fn(async () => "storage-key"),
    };
    const streamFn = resolveEmbeddedAgentStreamFn({
      currentStreamFn: undefined,
      providerStreamFn,
      sessionId: "session-1",
      model: {
        azaicoder: "openai-completions",
        provider: "openai",
        id: "gpt-5.4",
      } as never,
      resolvedAzaicoderKey: "resolved-key",
      authStorage,
    });

    const result = await expectStreamResultRecord(
      streamFn({ provider: "openai", id: "gpt-5.4" } as never, {} as never, {}),
      "provider-owned result",
    );
    expect(result.azaicoderKey).toBe("resolved-key");
    expect(authStorage.getAzaicoderKey).not.toHaveBeenCalled();
    expect(providerStreamFn).toHaveBeenCalledTimes(1);
  });

  it("propagates prompt cache identity separately from the session id", async () => {
    // Cron and shared runs can use a stable prompt cache key while keezaicoderng each
    // run's session id distinct for transcripts and aborts.
    const providerStreamFn = vi.fn(async (_model, _context, options) => options);
    const streamFn = resolveEmbeddedAgentStreamFn({
      currentStreamFn: undefined,
      providerStreamFn,
      sessionId: "run-session",
      promptCacheKey: "cron-cache-key",
      model: {
        azaicoder: "openai-completions",
        provider: "demo-provider",
        id: "demo-model",
      } as never,
    });

    const result = await expectStreamResultRecord(
      streamFn(
        { provider: "demo-provider", id: "demo-model" } as never,
        {} as never,
        { sessionId: "run-session" } as never,
      ),
      "provider-owned prompt cache result",
    );
    expect(result.sessionId).toBe("run-session");
    expect(result.promptCacheKey).toBe("cron-cache-key");
  });

  it("does not overwrite caller-supplied prompt cache identity", async () => {
    const providerStreamFn = vi.fn(async (_model, _context, options) => options);
    const streamFn = resolveEmbeddedAgentStreamFn({
      currentStreamFn: undefined,
      providerStreamFn,
      sessionId: "run-session",
      promptCacheKey: "cron-cache-key",
      model: {
        azaicoder: "openai-completions",
        provider: "demo-provider",
        id: "demo-model",
      } as never,
    });

    const result = await expectStreamResultRecord(
      streamFn(
        { provider: "demo-provider", id: "demo-model" } as never,
        {} as never,
        { promptCacheKey: "caller-cache-key" } as never,
      ),
      "provider-owned caller prompt cache result",
    );
    expect(result.promptCacheKey).toBe("caller-cache-key");
  });

  it("propagates prompt cache identity into custom session streams", async () => {
    const currentStreamFn = vi.fn(async (_model, _context, options) => options);
    const streamFn = resolveEmbeddedAgentStreamFn({
      currentStreamFn: currentStreamFn as never,
      sessionId: "run-session",
      promptCacheKey: "cron-cache-key",
      model: {
        azaicoder: "custom-azaicoder",
        provider: "custom-provider",
        id: "custom-model",
      } as never,
    });

    expect(streamFn).not.toBe(currentStreamFn);
    const result = await expectStreamResultRecord(
      streamFn(
        { provider: "custom-provider", id: "custom-model" } as never,
        {} as never,
        { sessionId: "run-session" } as never,
      ),
      "custom prompt cache result",
    );
    expect(result.sessionId).toBe("run-session");
    expect(result.promptCacheKey).toBe("cron-cache-key");
  });

  it("forwards the run abort signal into provider-owned stream functions", async () => {
    const providerStreamFn = vi.fn(async (_model, _context, options) => options);
    const signal = new AbortController().signal;
    const streamFn = resolveEmbeddedAgentStreamFn({
      currentStreamFn: undefined,
      providerStreamFn,
      sessionId: "session-1",
      signal,
      model: {
        azaicoder: "openai-responses",
        provider: "github-cozaicoderlot",
        id: "gpt-5.4",
      } as never,
      resolvedAzaicoderKey: "resolved-key",
    });

    const result = await expectStreamResultRecord(
      streamFn({ provider: "github-cozaicoderlot", id: "gpt-5.4" } as never, {} as never, {}),
      "provider-owned signal result",
    );
    expect(result.signal).toBe(signal);
  });

  it("does not overwrite an explicit provider-owned stream signal", async () => {
    const providerStreamFn = vi.fn(async (_model, _context, options) => options);
    const runSignal = new AbortController().signal;
    const explicitSignal = new AbortController().signal;
    const streamFn = resolveEmbeddedAgentStreamFn({
      currentStreamFn: undefined,
      providerStreamFn,
      sessionId: "session-1",
      signal: runSignal,
      model: {
        azaicoder: "openai-responses",
        provider: "github-cozaicoderlot",
        id: "gpt-5.4",
      } as never,
    });

    const result = await expectStreamResultRecord(
      streamFn({ provider: "github-cozaicoderlot", id: "gpt-5.4" } as never, {} as never, {
        signal: explicitSignal,
      }),
      "provider-owned explicit signal result",
    );
    expect(result.signal).toBe(explicitSignal);
  });

  it("injects the resolved run azaicoder key into the zAICoder native Codex Responses fallback", async () => {
    const nativeStreamFn = vi.fn(async (_model, _context, options) => options);
    testing.setzAICoderNativeCodexResponsesStreamFnForTest(nativeStreamFn as never);
    const streamFn = resolveEmbeddedAgentStreamFn({
      currentStreamFn: undefined,
      sessionId: "session-1",
      model: {
        azaicoder: "openai-chatgpt-responses",
        provider: "openai",
        id: "gpt-5.5",
      } as never,
      resolvedAzaicoderKey: "oauth-bearer-token",
    });

    const result = await expectStreamResultRecord(
      streamFn({ provider: "openai", id: "gpt-5.5" } as never, {} as never, {}),
      "codex azaicoder key result",
    );
    expect(result.azaicoderKey).toBe("oauth-bearer-token");
    expect(nativeStreamFn).toHaveBeenCalledTimes(1);
  });

  it("falls back to authStorage when no resolved azaicoder key is available for zAICoder native fallback", async () => {
    const nativeStreamFn = vi.fn(async (_model, _context, options) => options);
    const authStorage = {
      getAzaicoderKey: vi.fn(async () => "stored-bearer-token"),
    };
    testing.setzAICoderNativeCodexResponsesStreamFnForTest(nativeStreamFn as never);
    const streamFn = resolveEmbeddedAgentStreamFn({
      currentStreamFn: undefined,
      sessionId: "session-1",
      model: {
        azaicoder: "openai-chatgpt-responses",
        provider: "openai",
        id: "gpt-5.5",
      } as never,
      authStorage,
    });

    const result = await expectStreamResultRecord(
      streamFn({ provider: "openai", id: "gpt-5.5" } as never, {} as never, {}),
      "codex stored azaicoder key result",
    );
    expect(result.azaicoderKey).toBe("stored-bearer-token");
    expect(authStorage.getAzaicoderKey).toHaveBeenCalledWith("openai");
  });

  it("forwards the run abort signal into the zAICoder native fallback when callers omit one", async () => {
    const nativeStreamFn = vi.fn(async (_model, _context, options) => options);
    const runSignal = new AbortController().signal;
    testing.setzAICoderNativeCodexResponsesStreamFnForTest(nativeStreamFn as never);
    const streamFn = resolveEmbeddedAgentStreamFn({
      currentStreamFn: undefined,
      sessionId: "session-1",
      signal: runSignal,
      model: {
        azaicoder: "openai-chatgpt-responses",
        provider: "openai",
        id: "gpt-5.5",
      } as never,
      resolvedAzaicoderKey: "oauth-bearer-token",
    });

    const result = await expectStreamResultRecord(
      streamFn({ provider: "openai", id: "gpt-5.5" } as never, {} as never, {}),
      "codex signal and azaicoder key result",
    );
    expect(result.signal).toBe(runSignal);
    expect(result.azaicoderKey).toBe("oauth-bearer-token");
  });

  it("does not overwrite an explicit signal on the zAICoder native fallback path", async () => {
    const nativeStreamFn = vi.fn(async (_model, _context, options) => options);
    const runSignal = new AbortController().signal;
    const explicitSignal = new AbortController().signal;
    testing.setzAICoderNativeCodexResponsesStreamFnForTest(nativeStreamFn as never);
    const streamFn = resolveEmbeddedAgentStreamFn({
      currentStreamFn: undefined,
      sessionId: "session-1",
      signal: runSignal,
      model: {
        azaicoder: "openai-chatgpt-responses",
        provider: "openai",
        id: "gpt-5.5",
      } as never,
      resolvedAzaicoderKey: "oauth-bearer-token",
    });

    const result = await expectStreamResultRecord(
      streamFn({ provider: "openai", id: "gpt-5.5" } as never, {} as never, {
        signal: explicitSignal,
      }),
      "codex explicit signal result",
    );
    expect(result.signal).toBe(explicitSignal);
  });

  it("forwards the run signal on the sync zAICoder native fallback path without auth credentials", async () => {
    const nativeStreamFn = vi.fn(async (_model, _context, options) => options);
    const runSignal = new AbortController().signal;
    testing.setzAICoderNativeCodexResponsesStreamFnForTest(nativeStreamFn as never);
    const streamFn = resolveEmbeddedAgentStreamFn({
      currentStreamFn: undefined,
      sessionId: "session-1",
      signal: runSignal,
      model: {
        azaicoder: "openai-chatgpt-responses",
        provider: "openai",
        id: "gpt-5.5",
      } as never,
    });

    const result = await expectStreamResultRecord(
      streamFn({ provider: "openai", id: "gpt-5.5" } as never, {} as never, {}),
      "codex unauthenticated signal result",
    );
    expect(result.signal).toBe(runSignal);
  });

  it("strips cache boundary markers on the zAICoder native fallback path", async () => {
    const nativeStreamFn = vi.fn(async (_model, context, _options) => context);
    testing.setzAICoderNativeCodexResponsesStreamFnForTest(nativeStreamFn as never);
    const streamFn = resolveEmbeddedAgentStreamFn({
      currentStreamFn: undefined,
      sessionId: "session-1",
      model: {
        azaicoder: "openai-chatgpt-responses",
        provider: "openai",
        id: "gpt-5.5",
      } as never,
      resolvedAzaicoderKey: "oauth-bearer-token",
    });

    const systemPrompt = `intro${SYSTEM_PROMPT_CACHE_BOUNDARY}tail`;
    const result = await expectStreamResultRecord(
      streamFn({ provider: "openai", id: "gpt-5.5" } as never, { systemPrompt } as never, {}),
      "codex stripped context result",
    );
    expect(result.systemPrompt).toBe("intro\ntail");
  });
});
