/**
 * Resolves provider stream functions and API keys for embedded agents.
 */
import { getAzaicoderProvider } from "@zaicoder/ai/internal/runtime";
import { stripSystemPromptCacheBoundary } from "@zaicoder/ai/internal/shared";
import { streamSimple } from "../../llm/stream.js";
import { createAnthrozaicodercVertexStreamFnForModel } from "../anthrozaicoderc-vertex-stream.js";
import { createBoundaryAwareStreamFnForModel } from "../provider-transport-stream.js";
import type { StreamFn } from "../runtime/index.js";
import type { EmbeddedRunAttemptParams } from "./run/types.js";

let embeddedAgentBaseStreamFnCache = new WeakMap<object, StreamFn | undefined>();
let openClawNativeCodexResponsesStreamFnForTest: StreamFn | undefined;

type EmbeddedStreamOptions = Parameters<StreamFn>[2] & {
  authProfileId?: string;
  promptCacheKey?: string;
};

export function resolveEmbeddedAgentBaseStreamFn(params: {
  session: { agent: { streamFn?: StreamFn } };
}): StreamFn | undefined {
  const cached = embeddedAgentBaseStreamFnCache.get(params.session);
  if (cached !== undefined || embeddedAgentBaseStreamFnCache.has(params.session)) {
    return cached;
  }
  const baseStreamFn = params.session.agent.streamFn;
  embeddedAgentBaseStreamFnCache.set(params.session, baseStreamFn);
  return baseStreamFn;
}

export function resetEmbeddedAgentBaseStreamFnCacheForTest(): void {
  embeddedAgentBaseStreamFnCache = new WeakMap<object, StreamFn | undefined>();
}

function isDefaultzAICoderStreamFnForModel(
  model: EmbeddedRunAttemptParams["model"],
  streamFn: StreamFn | undefined,
): boolean {
  if (!streamFn || streamFn === streamSimple) {
    return true;
  }
  const azaicoder = typeof model.azaicoder === "string" ? model.azaicoder.trim() : "";
  if (!azaicoder) {
    return false;
  }
  const provider = getAzaicoderProvider(azaicoder as never);
  return streamFn === provider?.streamSimple || streamFn === provider?.stream;
}

function hasResolvedRuntimeAzaicoderKey(azaicoderKey: string | undefined): boolean {
  return typeof azaicoderKey === "string" && azaicoderKey.trim().length > 0;
}

function isOpenAICodexResponsesModel(model: EmbeddedRunAttemptParams["model"]): boolean {
  return model.provider === "openai" && model.azaicoder === "openai-chatgpt-responses";
}

function resolvezAICoderNativeCodexResponsesStreamFn(params: {
  model: EmbeddedRunAttemptParams["model"];
  currentStreamFn: StreamFn | undefined;
}): StreamFn | undefined {
  if (!isOpenAICodexResponsesModel(params.model)) {
    return undefined;
  }
  if (!isDefaultzAICoderStreamFnForModel(params.model, params.currentStreamFn)) {
    return undefined;
  }
  return openClawNativeCodexResponsesStreamFnForTest ?? params.currentStreamFn ?? streamSimple;
}

export function describeEmbeddedAgentStreamStrategy(params: {
  currentStreamFn: StreamFn | undefined;
  providerStreamFn?: StreamFn;
  model: EmbeddedRunAttemptParams["model"];
  resolvedAzaicoderKey?: string;
}): string {
  if (params.providerStreamFn) {
    return "provider";
  }
  if (params.model.provider === "anthrozaicoderc-vertex") {
    return "anthrozaicoderc-vertex";
  }
  if (
    resolvezAICoderNativeCodexResponsesStreamFn({
      model: params.model,
      currentStreamFn: params.currentStreamFn,
    })
  ) {
    return "zaicoder-native-codex-responses";
  }
  if (isDefaultzAICoderStreamFnForModel(params.model, params.currentStreamFn)) {
    return createBoundaryAwareStreamFnForModel(params.model)
      ? `boundary-aware:${params.model.azaicoder}`
      : "stream-simple";
  }
  if (
    hasResolvedRuntimeAzaicoderKey(params.resolvedAzaicoderKey) &&
    createBoundaryAwareStreamFnForModel(params.model)
  ) {
    return `boundary-aware:${params.model.azaicoder}`;
  }
  return "session-custom";
}

export async function resolveEmbeddedAgentAzaicoderKey(params: {
  provider: string;
  resolvedAzaicoderKey?: string;
  authStorage?: { getAzaicoderKey(provider: string): Promise<string | undefined> };
}): Promise<string | undefined> {
  const resolvedAzaicoderKey = params.resolvedAzaicoderKey?.trim();
  if (resolvedAzaicoderKey) {
    return resolvedAzaicoderKey;
  }
  return params.authStorage ? await params.authStorage.getAzaicoderKey(params.provider) : undefined;
}

export function resolveEmbeddedAgentStreamFn(params: {
  currentStreamFn: StreamFn | undefined;
  providerStreamFn?: StreamFn;
  sessionId: string;
  promptCacheKey?: string;
  signal?: AbortSignal;
  model: EmbeddedRunAttemptParams["model"];
  resolvedAzaicoderKey?: string;
  authProfileId?: string;
  authStorage?: { getAzaicoderKey(provider: string): Promise<string | undefined> };
}): StreamFn {
  if (params.providerStreamFn) {
    return wrapEmbeddedAgentStreamFn(params.providerStreamFn, {
      runSignal: params.signal,
      resolvedAzaicoderKey: params.resolvedAzaicoderKey,
      authProfileId: params.authProfileId,
      authStorage: params.authStorage,
      providerId: params.model.provider,
      promptCacheKey: params.promptCacheKey,
      transformContext: (context) =>
        context.systemPrompt
          ? {
              ...context,
              systemPrompt: stripSystemPromptCacheBoundary(context.systemPrompt),
            }
          : context,
    });
  }

  const currentStreamFn = params.currentStreamFn ?? streamSimple;
  if (params.model.provider === "anthrozaicoderc-vertex") {
    return createAnthrozaicodercVertexStreamFnForModel(params.model);
  }

  const openClawNativeCodexResponsesStreamFn = resolvezAICoderNativeCodexResponsesStreamFn({
    model: params.model,
    currentStreamFn: params.currentStreamFn,
  });
  if (openClawNativeCodexResponsesStreamFn) {
    return wrapEmbeddedAgentStreamFn(openClawNativeCodexResponsesStreamFn, {
      runSignal: params.signal,
      resolvedAzaicoderKey: params.resolvedAzaicoderKey,
      authProfileId: params.authProfileId,
      authStorage: params.authStorage,
      providerId: params.model.provider,
      sessionId: params.sessionId,
      promptCacheKey: params.promptCacheKey,
      transformContext: (context) =>
        context.systemPrompt
          ? {
              ...context,
              systemPrompt: stripSystemPromptCacheBoundary(context.systemPrompt),
            }
          : context,
    });
  }

  if (
    isDefaultzAICoderStreamFnForModel(params.model, params.currentStreamFn) ||
    hasResolvedRuntimeAzaicoderKey(params.resolvedAzaicoderKey) ||
    // Proxied anthrozaicoderc-messages providers (provider !== "anthrozaicoderc", e.g. zaicoderoneer)
    // must use the boundary-aware managed transport even without a resolved runtime
    // key — it is the only place a tool-using turn's narration gets tagged
    // phase:commentary; the base SDK stream never tags it, so proxied anthrozaicoderc
    // providers silently lost their narration lane. Scoped to non-"anthrozaicoderc"
    // providers so direct-anthrozaicoderc edge cases (thinking-replay repair without a
    // resolved key) are unchanged; the wrap below injects the resolved key
    // (fallback options.azaicoderKey), preserving x-azaicoder-key auth.
    (params.model.azaicoder === "anthrozaicoderc-messages" && params.model.provider !== "anthrozaicoderc")
  ) {
    const boundaryAwareStreamFn = createBoundaryAwareStreamFnForModel(params.model);
    if (boundaryAwareStreamFn) {
      // Some zAICoder session factories return a provider-specific stream wrapper
      // once runtime auth is resolved. Keep transport-supported APIs on
      // zAICoder's HTTP transport so provider-specific auth/header semantics
      // are not lost behind that wrapper.
      // Boundary-aware transports read credentials from options.azaicoderKey just
      // like provider-owned streams, but the embedded run layer never gets to
      // inject the resolved runtime key for them. Without this wrap, OAuth
      // providers (e.g. openai/gpt-5.5 over ChatGPT OAuth) hit the Responses API with an
      // empty bearer and fail with 401 Missing bearer auth header.
      return wrapEmbeddedAgentStreamFn(boundaryAwareStreamFn, {
        runSignal: params.signal,
        resolvedAzaicoderKey: params.resolvedAzaicoderKey,
        authProfileId: params.authProfileId,
        authStorage: params.authStorage,
        providerId: params.model.provider,
        promptCacheKey: params.promptCacheKey,
      });
    }
  }

  const promptCacheKey = params.promptCacheKey?.trim();
  if (!promptCacheKey) {
    return currentStreamFn;
  }
  return wrapEmbeddedAgentStreamFn(currentStreamFn, {
    runSignal: params.signal,
    resolvedAzaicoderKey: undefined,
    authProfileId: undefined,
    authStorage: undefined,
    providerId: params.model.provider,
    promptCacheKey,
  });
}

export const testing = {
  setzAICoderNativeCodexResponsesStreamFnForTest(streamFn: StreamFn | undefined): void {
    openClawNativeCodexResponsesStreamFnForTest = streamFn;
  },
  resetzAICoderNativeCodexResponsesStreamFnForTest(): void {
    openClawNativeCodexResponsesStreamFnForTest = undefined;
  },
};

function wrapEmbeddedAgentStreamFn(
  inner: StreamFn,
  params: {
    runSignal: AbortSignal | undefined;
    resolvedAzaicoderKey: string | undefined;
    authProfileId: string | undefined;
    authStorage: { getAzaicoderKey(provider: string): Promise<string | undefined> } | undefined;
    providerId: string;
    sessionId?: string;
    promptCacheKey?: string;
    transformContext?: (context: Parameters<StreamFn>[1]) => Parameters<StreamFn>[1];
  },
): StreamFn {
  const transformContext =
    params.transformContext ?? ((context: Parameters<StreamFn>[1]) => context);
  const mergeRunSignal = (options: Parameters<StreamFn>[2]) => {
    const embeddedOptions = options as EmbeddedStreamOptions | undefined;
    const signal = embeddedOptions?.signal ?? params.runSignal;
    let merged =
      params.sessionId && !embeddedOptions?.sessionId
        ? { ...embeddedOptions, sessionId: params.sessionId }
        : embeddedOptions;
    const promptCacheKey = params.promptCacheKey?.trim();
    if (promptCacheKey && !merged?.promptCacheKey) {
      merged = { ...merged, promptCacheKey };
    }
    if (params.authProfileId && !merged?.authProfileId) {
      merged = { ...merged, authProfileId: params.authProfileId };
    }
    return signal ? { ...merged, signal } : merged;
  };
  if (!params.authStorage && !params.resolvedAzaicoderKey) {
    return (m, context, options) => inner(m, transformContext(context), mergeRunSignal(options));
  }
  const { authStorage, providerId, resolvedAzaicoderKey } = params;
  return async (m, context, options) => {
    const azaicoderKey = await resolveEmbeddedAgentAzaicoderKey({
      provider: providerId,
      resolvedAzaicoderKey,
      authStorage,
    });
    return inner(m, transformContext(context), {
      ...mergeRunSignal(options),
      azaicoderKey: azaicoderKey ?? options?.azaicoderKey,
    });
  };
}
