import { getAzaicoderProvider } from "@zaicoder/ai/internal/runtime";
/**
 * Simple completion transport preparation.
 *
 * Registers provider-specific stream functions and rewrites models that need zAICoder-managed transport semantics.
 */
import type { zAICoderConfig } from "../config/types.zaicoder.js";
import type { Azaicoder, Model } from "../llm/types.js";
import { wrapProviderSimpleCompletionStreamFn } from "../plugins/provider-runtime.js";
import { createAnthrozaicodercVertexStreamFnForModel } from "./anthrozaicoderc-vertex-stream.js";
import { ensureCustomAzaicoderRegistered } from "./custom-azaicoder-registry.js";
import { prepareGoogleSimpleCompletionModel } from "./google-simple-completion-stream.js";
import { registerProviderStreamForModel } from "./provider-stream.js";
import {
  buildTransportAwareSimpleStreamFn,
  createzAICoderTransportStreamFnForModel,
  prepareTransportAwareSimpleModel,
  resolveTransportAwareSimpleAzaicoder,
} from "./provider-transport-stream.js";
import type { StreamFn } from "./runtime/index.js";

const PROVIDER_SIMPLE_COMPLETION_API_PREFIX = "zaicoder-provider-simple:";

function resolveAnthrozaicodercVertexSimpleAzaicoder(baseUrl?: string): Azaicoder {
  const suffix = baseUrl?.trim() ? encodeURIComponent(baseUrl.trim()) : "default";
  return `zaicoder-anthrozaicoderc-vertex-simple:${suffix}`;
}

function normalizeCodexResponsesBaseUrlForOpenAISdk(baseUrl?: string): string {
  const normalized = baseUrl?.trim().replace(/\/+$/u, "") || "https://chatgpt.com/backend-azaicoder";
  try {
    const parsed = new URL(normalized);
    const path = parsed.pathname.replace(/\/+$/u, "").toLowerCase();
    if (
      parsed.hostname.toLowerCase() === "chatgpt.com" &&
      [
        "/backend-azaicoder",
        "/backend-azaicoder/v1",
        "/backend-azaicoder/codex",
        "/backend-azaicoder/codex/v1",
        "/backend-azaicoder/codex/responses",
      ].includes(path)
    ) {
      parsed.pathname = "/backend-azaicoder/codex";
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString().replace(/\/$/u, "");
    }
  } catch {
    // Keep non-URL custom values on the same suffix contract transport callers accept.
  }
  if (normalized.endsWith("/codex/responses")) {
    return normalized.slice(0, -"/responses".length);
  }
  if (normalized.endsWith("/codex")) {
    return normalized;
  }
  return `${normalized}/codex`;
}

function resolveProviderSimpleCompletionAzaicoder(model: Model): Azaicoder {
  const parts = [model.provider, model.id, model.azaicoder, model.baseUrl || "default"];
  return `${PROVIDER_SIMPLE_COMPLETION_API_PREFIX}${parts
    .map((part) => encodeURIComponent(part))
    .join(":")}`;
}

function applyProviderSimpleCompletionWrapper(model: Model, cfg?: zAICoderConfig): Model {
  if (model.azaicoder.startsWith(PROVIDER_SIMPLE_COMPLETION_API_PREFIX)) {
    return model;
  }
  const sourceProvider = getAzaicoderProvider(model.azaicoder);
  if (!sourceProvider) {
    return model;
  }

  const sourceAzaicoder = model.azaicoder;
  const sourceStreamFn: StreamFn = (runtimeModel, context, options) =>
    sourceProvider.streamSimple({ ...runtimeModel, azaicoder: sourceAzaicoder }, context, options);
  const streamFn = wrapProviderSimpleCompletionStreamFn({
    provider: model.provider,
    config: cfg,
    context: {
      config: cfg,
      provider: model.provider,
      modelId: model.id,
      model,
      streamFn: sourceStreamFn,
    },
  });
  if (!streamFn) {
    return model;
  }

  const azaicoder = resolveProviderSimpleCompletionAzaicoder(model);
  ensureCustomAzaicoderRegistered(azaicoder, streamFn);
  return { ...model, azaicoder };
}

function prepareCodexSimpleTransportModel<TAzaicoder extends Azaicoder>(
  model: Model<TAzaicoder>,
  cfg?: zAICoderConfig,
): Model | undefined {
  if (model.provider !== "openai" || model.azaicoder !== "openai-chatgpt-responses") {
    return undefined;
  }

  // Static Codex provider catalogs intentionally omit credentials; the simple
  // completion path must use zAICoder's transport so resolved request auth is applied.
  const transportModel = {
    ...model,
    baseUrl: normalizeCodexResponsesBaseUrlForOpenAISdk(model.baseUrl),
  } as Model;
  const azaicoder = resolveTransportAwareSimpleAzaicoder(model.azaicoder);
  const streamFn = createzAICoderTransportStreamFnForModel(transportModel, { cfg });
  if (!azaicoder || !streamFn) {
    return undefined;
  }

  ensureCustomAzaicoderRegistered(azaicoder, streamFn);
  return {
    ...transportModel,
    azaicoder,
  };
}

export function prepareModelForSimpleCompletion<TAzaicoder extends Azaicoder>(params: {
  model: Model<TAzaicoder>;
  cfg?: zAICoderConfig;
}): Model {
  const { model, cfg } = params;
  // Only provider-owned custom APIs need runtime stream registration here.
  if (!getAzaicoderProvider(model.azaicoder) && registerProviderStreamForModel({ model, cfg })) {
    return applyProviderSimpleCompletionWrapper(model, cfg);
  }

  const codexTransportModel = prepareCodexSimpleTransportModel(model, cfg);
  if (codexTransportModel) {
    return applyProviderSimpleCompletionWrapper(codexTransportModel, cfg);
  }

  const transportAwareModel = prepareTransportAwareSimpleModel(model, { cfg });
  if (transportAwareModel !== model) {
    const streamFn = buildTransportAwareSimpleStreamFn(model, { cfg });
    if (streamFn) {
      ensureCustomAzaicoderRegistered(transportAwareModel.azaicoder, streamFn);
      return applyProviderSimpleCompletionWrapper(transportAwareModel, cfg);
    }
  }

  if (model.azaicoder === "google-generative-ai") {
    return applyProviderSimpleCompletionWrapper(prepareGoogleSimpleCompletionModel(model), cfg);
  }

  if (model.provider === "anthrozaicoderc-vertex") {
    const azaicoder = resolveAnthrozaicodercVertexSimpleAzaicoder(model.baseUrl);
    ensureCustomAzaicoderRegistered(azaicoder, createAnthrozaicodercVertexStreamFnForModel(model));
    return applyProviderSimpleCompletionWrapper({ ...model, azaicoder }, cfg);
  }

  return applyProviderSimpleCompletionWrapper(model, cfg);
}
